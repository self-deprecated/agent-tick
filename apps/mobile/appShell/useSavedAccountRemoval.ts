import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { MeResponse, WorkspaceMemberRecord } from "@self-deprecated/agent-tick-sdk";

import { currentSavedAccounts } from "../AppLogic";
import { clearSecretValue } from "../mobileSecretStorage";
import { recordDiagnostic } from "../diagnostics";
import { mobileConnectionCredentialKey, mobileSessionStorageKeyList, mobileSessionStorageKeys, type SavedMobileAccount } from "../mobileAuth";
import { saveStoredMobileConnections, unregisterSavedConnectionDevice } from "../mobileConnections";
import type { MobileRequest } from "../requests";
import type { AccountPendingState } from "../mobileTypes";
import type { ConnectionStatus, PushStatus } from "../SettingsScreen";

export type UseSavedAccountRemovalOptions = {
  activeClerkSessionID: string | null;
  connectionTokens: Record<string, string>;
  currentAccountProfile: MeResponse | null;
  deviceID: string;
  onForgetClerkSession?: (options?: { reopenSignIn?: boolean }) => void;
  savedAccounts: SavedMobileAccount[];
  selectedWorkspaceID: string;
  serverURL: string;
  setAccountPending: Dispatch<SetStateAction<Record<string, AccountPendingState>>>;
  setConnectionStatus: Dispatch<SetStateAction<ConnectionStatus>>;
  setConnectionTokens: Dispatch<SetStateAction<Record<string, string>>>;
  setCurrentAccountProfile: Dispatch<SetStateAction<MeResponse | null>>;
  setDeviceID: Dispatch<SetStateAction<string>>;
  setHistory: Dispatch<SetStateAction<MobileRequest[]>>;
  setPushStatus: Dispatch<SetStateAction<PushStatus>>;
  setRequests: Dispatch<SetStateAction<MobileRequest[]>>;
  setSavedAccounts: Dispatch<SetStateAction<SavedMobileAccount[]>>;
  setSelectedID: Dispatch<SetStateAction<string | null>>;
  setSelectedWorkspaceID: Dispatch<SetStateAction<string>>;
  setToken: Dispatch<SetStateAction<string>>;
  setWorkspaces: Dispatch<SetStateAction<WorkspaceMemberRecord[]>>;
};

export function useSavedAccountRemoval({
  activeClerkSessionID,
  connectionTokens,
  currentAccountProfile,
  deviceID,
  onForgetClerkSession,
  savedAccounts,
  selectedWorkspaceID,
  serverURL,
  setAccountPending,
  setConnectionStatus,
  setConnectionTokens,
  setCurrentAccountProfile,
  setDeviceID,
  setHistory,
  setPushStatus,
  setRequests,
  setSavedAccounts,
  setSelectedID,
  setSelectedWorkspaceID,
  setToken,
  setWorkspaces,
}: UseSavedAccountRemovalOptions) {
  const bestEffortUnregisterSavedAccounts = useCallback(async (accounts: SavedMobileAccount[]) => {
    await Promise.allSettled(accounts.map(async (account) => {
      await unregisterSavedConnectionDevice(account, {
        token: connectionTokens[account.id] ?? (account.credentialRef ? connectionTokens[account.credentialRef] : undefined) ?? connectionTokens[mobileConnectionCredentialKey(account.id)],
      });
    }));
  }, [connectionTokens]);

  const removeSavedAccount = useCallback(async (account: SavedMobileAccount) => {
    const removingCurrentHostedLogin = account.authProvider === "clerk" && currentSavedAccounts([account], {
      authProvider: "clerk",
      clerkSessionID: activeClerkSessionID,
      currentAccountProfile,
      deviceID,
      selectedWorkspaceID,
      serverURL,
    }).length > 0;
    const nextAccounts = savedAccounts.filter((candidate) => candidate.id !== account.id);
    setSavedAccounts(nextAccounts);
    setAccountPending(({ [account.id]: _removed, ...remaining }) => remaining);
    setConnectionTokens((current) => {
      const { [account.id]: _removedAccountID, [account.credentialRef || mobileConnectionCredentialKey(account.id)]: _removedCredentialRef, ...remaining } = current;
      return remaining;
    });
    if (removingCurrentHostedLogin) {
      setDeviceID("");
      setToken("");
      setPushStatus("idle");
      setWorkspaces([]);
      setCurrentAccountProfile(null);
      setSelectedWorkspaceID("");
      setRequests([]);
      setHistory([]);
      setSelectedID(null);
      setConnectionStatus("disconnected");
    }
    const scopedKeys = mobileSessionStorageKeys(serverURL);
    await bestEffortUnregisterSavedAccounts([account]);
    await Promise.all([
      saveStoredMobileConnections(nextAccounts),
      clearSecretValue(account.credentialRef || mobileConnectionCredentialKey(account.id)),
      ...(removingCurrentHostedLogin ? [
        clearSecretValue(scopedKeys.token),
        AsyncStorage.multiRemove(mobileSessionStorageKeyList(serverURL)),
      ] : []),
    ]);
    if (removingCurrentHostedLogin) {
      onForgetClerkSession?.();
    }
    recordDiagnostic("info", "auth", "saved_account_removed", { authProvider: account.authProvider, signInMethod: account.signInMethod, hasEmail: Boolean(account.email), removedCurrentHostedLogin: removingCurrentHostedLogin });
  }, [activeClerkSessionID, bestEffortUnregisterSavedAccounts, currentAccountProfile, deviceID, onForgetClerkSession, savedAccounts, selectedWorkspaceID, serverURL]);

  return { bestEffortUnregisterSavedAccounts, removeSavedAccount };
}
