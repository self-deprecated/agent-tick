import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { AppState } from "react-native";
import { AgentTickClient } from "@self-deprecated/agent-tick-sdk";

import { resolveConnectionWorkspaceIDs } from "../AppLogic";
import { mobileSessionStorageKeys, type SavedMobileAccount } from "../mobileAuth";
import type { AccountPendingState } from "../mobileTypes";
import { normalizeRequests } from "../requests";
import { getStoredConnectionToken } from "./mobileSessionClientHelpers";

export function useSavedAccountPending({
  savedAccounts,
  menuOpen,
  settingsLoaded,
}: {
  savedAccounts: SavedMobileAccount[];
  menuOpen: boolean;
  settingsLoaded: boolean;
}): {
  accountPending: Record<string, AccountPendingState>;
  setAccountPending: Dispatch<SetStateAction<Record<string, AccountPendingState>>>;
  refreshConnectionPending: () => Promise<void>;
} {
  const [accountPending, setAccountPending] = useState<Record<string, AccountPendingState>>({});

  const checkSavedAccountPending = useCallback(async (account: SavedMobileAccount): Promise<AccountPendingState> => {
    try {
      const token = await getStoredConnectionToken(account);
      if (!token) return { status: "needs-sign-in", count: 0 };

      const scopedKeys = mobileSessionStorageKeys(account.serverURL);
      const storedWorkspaceID = account.workspaceID || (await AsyncStorage.getItem(scopedKeys.workspaceID)) || "";
      const workspaceClient = new AgentTickClient({
        baseUrl: account.serverURL,
        tokenProvider: () => token,
      });
      const workspaceIDs = await resolveConnectionWorkspaceIDs(account, workspaceClient, storedWorkspaceID);
      const requestGroups = await Promise.all(workspaceIDs.map(async (workspaceID) => {
        const accountClient = new AgentTickClient({
          baseUrl: account.serverURL,
          tokenProvider: () => token,
          workspaceIdProvider: () => workspaceID || null,
        });
        return accountClient.listRequests();
      }));
      return { status: "ready", count: normalizeRequests(requestGroups.flat()).filter((request) => request.status === "pending").length };
    } catch {
      return { status: "error", count: 0 };
    }
  }, []);

  const refreshConnectionPending = useCallback(async () => {
    if (savedAccounts.length === 0) {
      setAccountPending({});
      return;
    }
    setAccountPending((current) => {
      const next: Record<string, AccountPendingState> = {};
      for (const account of savedAccounts) {
        next[account.id] = current[account.id] ?? { status: "checking", count: 0 };
      }
      return next;
    });
    await Promise.all(savedAccounts.map(async (account) => {
      const state = await checkSavedAccountPending(account);
      setAccountPending((current) => ({ ...current, [account.id]: state }));
    }));
  }, [checkSavedAccountPending, savedAccounts]);

  useEffect(() => {
    if (!menuOpen) return;
    void refreshConnectionPending();
  }, [menuOpen, refreshConnectionPending]);

  useEffect(() => {
    if (!settingsLoaded || savedAccounts.length === 0) return;
    void refreshConnectionPending();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refreshConnectionPending();
    }, 120000);
    return () => clearInterval(timer);
  }, [refreshConnectionPending, savedAccounts.length, settingsLoaded]);

  return { accountPending, setAccountPending, refreshConnectionPending };
}
