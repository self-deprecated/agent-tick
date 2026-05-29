import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { MeResponse, WorkspaceMemberRecord } from "@self-deprecated/agent-tick-sdk";

import { recordDiagnostic } from "../diagnostics";
import { persistSavedConnectionCredential, saveStoredMobileConnections } from "../mobileConnections";
import {
  mobileSessionStorageKeys,
  normalizeServerURL,
  savedMobileAccountID,
  serverURLStorageKey,
  upsertSavedMobileAccountIfChanged,
  type RuntimeAuthConfig,
  type SavedMobileAccount,
} from "../mobileAuth";
import { setSecretValue } from "../mobileSecretStorage";
import type { PushStatus } from "../SettingsScreen";
import { hashDiagnosticID, savedAccountDiagnostics } from "./clerkSessionHelpers";

export function useSavedAccountPersistence({
  activeClerkSessionID,
  activeConnectionID,
  connectionTokens,
  currentAccountProfile,
  deviceID,
  loadedSessionServerURL,
  notificationsEnabled,
  pushStatus,
  runtimeAuthConfig,
  savedAccounts,
  selectedWorkspaceID,
  serverURL,
  settingsLoaded,
  setSavedAccounts,
  token,
  workspaces,
}: {
  activeClerkSessionID: string | null;
  activeConnectionID: string;
  connectionTokens: Record<string, string>;
  currentAccountProfile: MeResponse | null;
  deviceID: string;
  loadedSessionServerURL: string;
  notificationsEnabled: boolean;
  pushStatus: PushStatus;
  runtimeAuthConfig: RuntimeAuthConfig | null;
  savedAccounts: SavedMobileAccount[];
  selectedWorkspaceID: string;
  serverURL: string;
  settingsLoaded: boolean;
  setSavedAccounts: Dispatch<SetStateAction<SavedMobileAccount[]>>;
  token: string;
  workspaces: WorkspaceMemberRecord[];
}) {
  useEffect(() => {
    const activeServerURL = normalizeServerURL(serverURL);
    const isClerkMode = runtimeAuthConfig?.authProvider === "clerk";
    if (!settingsLoaded || (!isClerkMode && loadedSessionServerURL !== activeServerURL)) {
      return;
    }

    const scopedKeys = mobileSessionStorageKeys(activeServerURL);
    void setSecretValue(scopedKeys.token, token);
    void AsyncStorage.multiSet([
      [serverURLStorageKey, activeServerURL],
      [scopedKeys.deviceID, deviceID],
      [scopedKeys.workspaceID, isClerkMode ? "" : selectedWorkspaceID],
      [scopedKeys.pushStatus, pushStatus],
      [scopedKeys.notificationsEnabled, notificationsEnabled ? "true" : "false"],
    ]);
    const activeConnectionToken = activeConnectionID ? connectionTokens[activeConnectionID] : "";
    const shouldSaveAccount = isClerkMode ? Boolean(currentAccountProfile?.userId && activeClerkSessionID && activeConnectionToken) : Boolean(token || deviceID);
    if (shouldSaveAccount) {
      const accountInput = {
        serverURL: activeServerURL,
        authProvider: runtimeAuthConfig?.authProvider ?? "local",
        userID: currentAccountProfile?.userId,
        email: currentAccountProfile?.email,
        signInMethod: currentAccountProfile?.signInMethod,
        clerkSessionID: isClerkMode ? activeClerkSessionID || undefined : undefined,
        workspaceID: isClerkMode ? undefined : selectedWorkspaceID || undefined,
        workspaces: isClerkMode ? workspaces.map((workspace) => ({ id: workspace.workspaceId, name: workspace.name, role: workspace.role })) : [],
        deviceID: deviceID || undefined,
        label: isClerkMode && currentAccountProfile?.signInMethod ? `${currentAccountProfile.signInMethod} account` : "",
      };
      recordDiagnostic("info", "auth", "save_account_attempt", {
        authProvider: accountInput.authProvider,
        userIDHash: hashDiagnosticID(accountInput.userID),
        clerkSessionIDHash: hashDiagnosticID(accountInput.clerkSessionID),
        hasEmail: Boolean(accountInput.email),
        signInMethod: accountInput.signInMethod,
        savedAccountCountBefore: savedAccounts.length,
      });
      setSavedAccounts((current) => {
        const next = upsertSavedMobileAccountIfChanged(current, accountInput);
        if (next === current) return current;
        recordDiagnostic("info", "auth", "save_account_result", {
          savedAccountCountBefore: current.length,
          savedAccountCountAfter: next.length,
          savedAccounts: savedAccountDiagnostics(next),
        });
        const savedAccountID = savedMobileAccountID(accountInput);
        const savedAccount = next.find((account) => account.id === savedAccountID);
        if (savedAccount) {
          void persistSavedConnectionCredential(savedAccount, { isClerkMode, token });
        }
        void saveStoredMobileConnections(next);
        return next;
      });
    }
  }, [activeClerkSessionID, activeConnectionID, connectionTokens, currentAccountProfile?.email, currentAccountProfile?.signInMethod, currentAccountProfile?.userId, deviceID, loadedSessionServerURL, notificationsEnabled, pushStatus, runtimeAuthConfig?.authProvider, savedAccounts.length, selectedWorkspaceID, serverURL, settingsLoaded, token, workspaces]);
}
