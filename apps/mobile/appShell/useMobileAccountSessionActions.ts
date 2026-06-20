import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { type Dispatch, type SetStateAction, useCallback } from "react";
import { Alert, Platform } from "react-native";
import { AgentTickClient, type MeResponse, type StatusUpdateRecord, type WorkspaceMemberRecord } from "@self-deprecated/agent-tick-sdk";
import { type PersonalBillingStatus } from "@self-deprecated/agent-tick-shared";

import {
  currentSavedAccounts,
  hostedAccountDeletionLocalCleanup,
  type NativeAppEntitlementGrant,
} from "../AppLogic";
import { diagnosticEvents, recordDiagnostic, setDiagnosticsEnabled as saveDiagnosticsEnabled } from "../diagnostics";
import { shouldTreatCurrentSessionAsClerk } from "../mobileClerkAuthState";
import { clearStoredMobileConnections, saveStoredMobileConnections } from "../mobileConnections";
import {
  hostedServerURL,
  mobileConnectionCredentialKey,
  mobileSessionStorageKeyList,
  mobileSessionStorageKeys,
  normalizeServerURL,
  type RuntimeAuthConfig,
  type SavedMobileAccount,
} from "../mobileAuth";
import { clearSecretValue } from "../mobileSecretStorage";
import { type CustomerInfo, type PaywallConfig, type StoreProduct } from "../purchases";
import type { ConnectionStatus, PushStatus } from "../SettingsScreen";
import type { AccountPendingState } from "../mobileTypes";
import type { MobileRequest } from "../requests";
import { apiStatus } from "./mobileActivityHelpers";
import { clearClerkClientSecret, deleteClerkClientSecureStoreToken, signOutNativeClerk } from "./clerkSessionHelpers";
import { fetchRuntimeAuthConfigIfAvailable } from "./runtimeAuthConfigCache";

type UnregisterSavedAccounts = (accounts: SavedMobileAccount[]) => Promise<void>;
type CurrentAuthToken = () => Promise<string>;
type ForgetClerkSession = (options?: { reopenSignIn?: boolean }) => void;

type BestEffortUnregisterDeviceOptions = {
  activeDeviceID?: string;
  activeServerURL?: string;
  activeToken?: string;
  authProvider?: string | null;
};

export function useMobileAccountSessionActions({
  activeClerkSessionID,
  bestEffortUnregisterSavedAccounts,
  clerkSessionToken,
  clerkSignedIn,
  connectionStatusDisconnected,
  currentAccountProfile,
  currentAuthToken,
  debugDefaultServer = hostedServerURL,
  deviceID,
  onForgetClerkSession,
  onRuntimeAuthConfig,
  runtimeAuthProvider,
  savedAccounts,
  sdk,
  selectedWorkspaceID,
  serverURL,
  setAccountPending,
  setConnectionStatus,
  setConnectionTokens,
  setCurrentAccountProfile,
  setDebugPaywallVisible,
  setDeviceID,
  setDiagnosticsEnabled,
  setDiagnosticsEventCount,
  setError,
  setHistory,

  setLoadedSessionServerURL,
  setLocalDevAppAccessUnlocked,
  setLocalStoreHostedSubscriptionActive,
  setLocalStoreLifetimeUnlocked,
  setLocalStoreTrialPurchased,
  setLocalStoreTrialStartedAt,
  setLoading,
  setNotificationTargetID,
  setNotificationsEnabled,
  setPaywallConfig,
  setPaywallDismissedKey,
  setPersonalBillingStatus,
  setPushStatus,
  setRequests,
  setSavedAccounts,
  setSelectedID,
  setSelectedSourceID,
  setSelectedWorkspaceID,
  setServerURL,
  setStatusUpdates,
  setStoreEntitlementsSettled,
  setStoreProducts,
  setToken,
  setWorkspaces,
  token,
}: {
  activeClerkSessionID: string | null;
  bestEffortUnregisterSavedAccounts: UnregisterSavedAccounts;
  clerkSessionToken?: string | null;
  clerkSignedIn?: boolean;
  connectionStatusDisconnected?: ConnectionStatus;
  currentAccountProfile: MeResponse | null;
  currentAuthToken: CurrentAuthToken;
  debugDefaultServer?: string;
  deviceID: string;
  onForgetClerkSession?: ForgetClerkSession;
  onRuntimeAuthConfig?: (serverURL: string, authConfig: RuntimeAuthConfig | null) => void;
  runtimeAuthProvider?: RuntimeAuthConfig["authProvider"];
  savedAccounts: SavedMobileAccount[];
  sdk: AgentTickClient;
  selectedWorkspaceID: string;
  serverURL: string;
  setAccountPending: Dispatch<SetStateAction<Record<string, AccountPendingState>>>;
  setConnectionStatus: Dispatch<SetStateAction<ConnectionStatus>>;
  setConnectionTokens: Dispatch<SetStateAction<Record<string, string>>>;
  setCurrentAccountProfile: Dispatch<SetStateAction<MeResponse | null>>;
  setDebugPaywallVisible: Dispatch<SetStateAction<boolean>>;
  setDeviceID: Dispatch<SetStateAction<string>>;
  setDiagnosticsEnabled: Dispatch<SetStateAction<boolean>>;
  setDiagnosticsEventCount: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setHistory: Dispatch<SetStateAction<MobileRequest[]>>;

  setLoadedSessionServerURL: Dispatch<SetStateAction<string>>;
  setLocalDevAppAccessUnlocked: Dispatch<SetStateAction<boolean>>;
  setLocalStoreHostedSubscriptionActive: Dispatch<SetStateAction<boolean>>;
  setLocalStoreLifetimeUnlocked: Dispatch<SetStateAction<boolean>>;
  setLocalStoreTrialPurchased: Dispatch<SetStateAction<boolean>>;
  setLocalStoreTrialStartedAt: Dispatch<SetStateAction<string | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setNotificationTargetID: Dispatch<SetStateAction<string | null>>;
  setNotificationsEnabled: Dispatch<SetStateAction<boolean>>;
  setPaywallConfig: Dispatch<SetStateAction<PaywallConfig | null>>;
  setPaywallDismissedKey: Dispatch<SetStateAction<string>>;
  setPersonalBillingStatus: Dispatch<SetStateAction<PersonalBillingStatus | null>>;
  setPushStatus: Dispatch<SetStateAction<PushStatus>>;
  setRequests: Dispatch<SetStateAction<MobileRequest[]>>;
  setSavedAccounts: Dispatch<SetStateAction<SavedMobileAccount[]>>;
  setSelectedID: Dispatch<SetStateAction<string | null>>;
  setSelectedSourceID: Dispatch<SetStateAction<string | null>>;
  setSelectedWorkspaceID: Dispatch<SetStateAction<string>>;
  setServerURL: Dispatch<SetStateAction<string>>;
  setStatusUpdates: Dispatch<SetStateAction<StatusUpdateRecord[]>>;
  setStoreEntitlementsSettled: Dispatch<SetStateAction<boolean>>;
  setStoreProducts: Dispatch<SetStateAction<StoreProduct[]>>;
  setToken: Dispatch<SetStateAction<string>>;
  setWorkspaces: Dispatch<SetStateAction<WorkspaceMemberRecord[]>>;
  token: string;
}) {
  const clearStoredSessionForServer = useCallback(async (activeServerURL = serverURL) => {
    const keys = mobileSessionStorageKeys(activeServerURL);
    await Promise.all([
      clearSecretValue(keys.token),
      AsyncStorage.multiRemove(mobileSessionStorageKeyList(activeServerURL)),
    ]);
  }, [serverURL]);

  const resetLocalTestStateNow = useCallback(async () => {
    const accountsToClear = savedAccounts;
    const serverURLs = [...new Set([serverURL, debugDefaultServer, ...accountsToClear.map((account) => account.serverURL)].map(normalizeServerURL))];
    const asyncStorageKeys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("agent-tick."));
    const accountSecretKeys = accountsToClear.flatMap((account) => [
      account.credentialRef,
      mobileConnectionCredentialKey(account.id),
    ].filter((key): key is string => Boolean(key)));

    await Promise.allSettled([
      ...serverURLs.map((url) => clearStoredSessionForServer(url)),
      clearStoredMobileConnections(),
      AsyncStorage.multiRemove(asyncStorageKeys),
      clearClerkClientSecret(),
      deleteClerkClientSecureStoreToken().catch(() => undefined),
      ...accountSecretKeys.map((key) => clearSecretValue(key)),
      signOutNativeClerk().catch(() => undefined),
    ]);

    onForgetClerkSession?.();
    setSavedAccounts([]);
    setAccountPending({});
    setConnectionTokens({});
    setCurrentAccountProfile(null);
    setWorkspaces([]);
    setRequests([]);
    setStatusUpdates([]);
    setHistory([]);
    setSelectedID(null);
    setSelectedSourceID(null);
    setNotificationTargetID(null);
    setToken("");
    setDeviceID("");
    setSelectedWorkspaceID("");
    setLoadedSessionServerURL("");
    setServerURL(debugDefaultServer);
    setConnectionStatus("checking");
    setPushStatus("idle");
    setNotificationsEnabled(true);
    setPersonalBillingStatus(null);
    setStoreProducts([]);
    setLocalStoreTrialStartedAt(null);
    setLocalStoreTrialPurchased(false);
    setLocalStoreLifetimeUnlocked(false);
    setLocalDevAppAccessUnlocked(false);
    setLocalStoreHostedSubscriptionActive(false);
    setStoreEntitlementsSettled(Platform.OS !== "ios" && Platform.OS !== "android");
    setPaywallConfig(null);
    setPaywallDismissedKey("");
    setDebugPaywallVisible(false);
    setDiagnosticsEnabled(false);
    saveDiagnosticsEnabled(false);
    recordDiagnostic("info", "debug", "local_test_state_reset");
    setDiagnosticsEventCount(diagnosticEvents().length);
  }, [clearStoredSessionForServer, debugDefaultServer, onForgetClerkSession, savedAccounts, serverURL, setAccountPending, setConnectionStatus, setConnectionTokens, setCurrentAccountProfile, setDebugPaywallVisible, setDeviceID, setDiagnosticsEnabled, setDiagnosticsEventCount, setHistory, setLoadedSessionServerURL, setLocalDevAppAccessUnlocked, setLocalStoreHostedSubscriptionActive, setLocalStoreLifetimeUnlocked, setLocalStoreTrialPurchased, setLocalStoreTrialStartedAt, setNotificationTargetID, setNotificationsEnabled, setPaywallConfig, setPaywallDismissedKey, setPersonalBillingStatus, setPushStatus, setRequests, setSavedAccounts, setSelectedID, setSelectedSourceID, setSelectedWorkspaceID, setServerURL, setStatusUpdates, setStoreEntitlementsSettled, setStoreProducts, setToken, setWorkspaces]);

  const resetLocalTestState = useCallback(() => {
    Alert.alert(
      "Reset local test state?",
      "This clears this app install's Agent Tick storage, saved connections, Clerk login cache, and local purchase cache. It does not erase App Store purchase history or hosted server entitlements.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Reset", style: "destructive", onPress: () => void resetLocalTestStateNow() },
      ],
    );
  }, [resetLocalTestStateNow]);

  const bestEffortUnregisterDevice = useCallback(async (options: BestEffortUnregisterDeviceOptions = {}) => {
    const activeDeviceID = options.activeDeviceID ?? deviceID;
    if (!activeDeviceID) return;
    const activeAuthProvider = options.authProvider ?? runtimeAuthProvider;
    const trimmed = normalizeServerURL(options.activeServerURL ?? serverURL);
    try {
      const cleanupToken = activeAuthProvider === "clerk" ? await currentAuthToken() : (options.activeToken ?? token);
      if (!cleanupToken) return;
      const cleanupClient = new AgentTickClient({
        baseUrl: trimmed,
        tokenProvider: () => cleanupToken,
      });
      await cleanupClient.unregisterDevice(activeDeviceID);
    } catch {
      // Best-effort cleanup only; local credentials are still cleared.
    }
  }, [currentAuthToken, deviceID, runtimeAuthProvider, serverURL, token]);

  const forgetDevice = useCallback(async (options?: { reopenSignIn?: boolean; forceClerk?: boolean }) => {
    // In Clerk mode a phone installation can keep push-ready registrations for
    // multiple saved accounts. Forgetting one connection must unregister only
    // that account's server-side device so stale accounts stop sending push.
    const activeSavedAccount = currentSavedAccounts(savedAccounts, { authProvider: "clerk", clerkSessionID: activeClerkSessionID, currentAccountProfile, deviceID, selectedWorkspaceID, serverURL })[0];
    const isClerkSession = Boolean(options?.forceClerk || (clerkSignedIn && onForgetClerkSession)) || shouldTreatCurrentSessionAsClerk({
      runtimeAuthProvider,
      currentAccountAuthProvider: currentAccountProfile?.authProvider,
      activeSavedAccountAuthProvider: activeSavedAccount?.authProvider,
      hasClerkSessionToken: Boolean(clerkSignedIn && clerkSessionToken),
    });
    const currentAccountsToForget = isClerkSession
      ? currentSavedAccounts(savedAccounts, { authProvider: "clerk", clerkSessionID: activeClerkSessionID, currentAccountProfile, deviceID, selectedWorkspaceID, serverURL })
      : [];
    if (!isClerkSession) {
      await bestEffortUnregisterDevice();
    } else if (currentAccountsToForget.length > 0) {
      await bestEffortUnregisterSavedAccounts(currentAccountsToForget);
      if (deviceID && !currentAccountsToForget.some((account) => account.deviceID === deviceID)) {
        await bestEffortUnregisterDevice({ authProvider: "clerk" });
      }
      const nextAccounts = savedAccounts.filter((account) => !currentAccountsToForget.some((currentAccount) => currentAccount.id === account.id));
      setSavedAccounts(nextAccounts);
      await Promise.all([
        saveStoredMobileConnections(nextAccounts),
        ...currentAccountsToForget.map((account) => clearSecretValue(account.credentialRef || mobileConnectionCredentialKey(account.id))),
      ]);
    } else {
      await bestEffortUnregisterDevice({ authProvider: "clerk" });
    }
    await clearStoredSessionForServer();
    setDeviceID("");
    setToken("");
    setPushStatus("idle");
    setWorkspaces([]);
    setCurrentAccountProfile(null);
    setSelectedWorkspaceID("");
    setRequests([]);
    setHistory([]);
    setConnectionStatus(connectionStatusDisconnected ?? "disconnected");
    if (isClerkSession) onForgetClerkSession?.(options);
  }, [activeClerkSessionID, bestEffortUnregisterDevice, bestEffortUnregisterSavedAccounts, clearStoredSessionForServer, clerkSessionToken, clerkSignedIn, connectionStatusDisconnected, currentAccountProfile, deviceID, onForgetClerkSession, runtimeAuthProvider, savedAccounts, selectedWorkspaceID, serverURL, setConnectionStatus, setCurrentAccountProfile, setDeviceID, setHistory, setPushStatus, setRequests, setSavedAccounts, setSelectedWorkspaceID, setToken, setWorkspaces]);

  const clearHostedLoginSession = useCallback(async () => {
    const signedOutAccounts = currentSavedAccounts(savedAccounts, { authProvider: "clerk", clerkSessionID: activeClerkSessionID, currentAccountProfile, deviceID, selectedWorkspaceID, serverURL });
    const signedOutAccountIDs = new Set(signedOutAccounts.map((account) => account.id));
    const nextAccounts = signedOutAccounts.length > 0
      ? savedAccounts.filter((account) => !signedOutAccountIDs.has(account.id))
      : savedAccounts;
    if (signedOutAccounts.length > 0) {
      setSavedAccounts(nextAccounts);
      setAccountPending((current) => Object.fromEntries(Object.entries(current).filter(([accountID]) => !signedOutAccountIDs.has(accountID))));
      setConnectionTokens((current) => {
        const next = { ...current };
        for (const account of signedOutAccounts) {
          delete next[account.id];
          if (account.credentialRef) delete next[account.credentialRef];
          delete next[mobileConnectionCredentialKey(account.id)];
        }
        return next;
      });
      recordDiagnostic("info", "auth", "hosted_connection_signed_out", { removedConnectionCount: signedOutAccounts.length });
    }
    setDeviceID("");
    setToken("");
    setPushStatus("idle");
    setWorkspaces([]);
    setCurrentAccountProfile(null);
    setSelectedWorkspaceID("");
    setRequests([]);
    setHistory([]);
    setSelectedID(null);
    setConnectionStatus(connectionStatusDisconnected ?? "disconnected");
    if (signedOutAccounts.length > 0) {
      await bestEffortUnregisterSavedAccounts(signedOutAccounts);
      if (deviceID && !signedOutAccounts.some((account) => account.deviceID === deviceID)) {
        await bestEffortUnregisterDevice({ authProvider: "clerk" });
      }
    } else {
      await bestEffortUnregisterDevice({ authProvider: "clerk" });
    }
    await Promise.all([
      signedOutAccounts.length > 0 ? saveStoredMobileConnections(nextAccounts) : Promise.resolve(),
      ...signedOutAccounts.map((account) => clearSecretValue(account.credentialRef || mobileConnectionCredentialKey(account.id))),
      clearStoredSessionForServer(),
    ]);
    onForgetClerkSession?.();
  }, [activeClerkSessionID, bestEffortUnregisterDevice, bestEffortUnregisterSavedAccounts, clearStoredSessionForServer, connectionStatusDisconnected, currentAccountProfile, deviceID, onForgetClerkSession, savedAccounts, selectedWorkspaceID, serverURL, setAccountPending, setConnectionStatus, setConnectionTokens, setCurrentAccountProfile, setDeviceID, setHistory, setPushStatus, setRequests, setSavedAccounts, setSelectedID, setSelectedWorkspaceID, setToken, setWorkspaces]);

  const signOutFromSettings = useCallback(() => {
    if (clerkSignedIn && onForgetClerkSession) {
      void clearHostedLoginSession();
      return;
    }
    void forgetDevice();
  }, [clearHostedLoginSession, clerkSignedIn, forgetDevice, onForgetClerkSession]);

  const deleteAccount = useCallback(() => {
    if (runtimeAuthProvider !== "clerk" || !currentAccountProfile?.userId) {
      Alert.alert("Delete account unavailable", "Sign in to an Agent Tick hosted account before deleting it.");
      return;
    }
    Alert.alert(
      "Delete account?",
      "This permanently deletes your hosted Agent Tick account, removes hosted personal Request and Activity content, unregisters devices, and revokes Agent Tick tokens. Shared Workspace content may remain under that Workspace's policy. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setLoading(true);
              setError(null);
              try {
                await sdk.deleteMe();
                const cleanup = hostedAccountDeletionLocalCleanup(savedAccounts, {
                  serverURL,
                  deletedClerkSessionID: activeClerkSessionID,
                  deletedUserID: currentAccountProfile.userId,
                  deletedEmail: currentAccountProfile.email,
                });
                setSavedAccounts(cleanup.remainingAccounts);
                setAccountPending((current) => Object.fromEntries(Object.entries(current).filter(([accountID]) => !cleanup.removedAccountIDs.has(accountID))));
                setConnectionTokens((current) => {
                  const next = { ...current };
                  for (const accountID of cleanup.removedAccountIDs) delete next[accountID];
                  for (const credentialKey of cleanup.credentialKeys) delete next[credentialKey];
                  return next;
                });
                await saveStoredMobileConnections(cleanup.remainingAccounts);
                await Promise.all([
                  ...cleanup.credentialKeys.map((credentialKey) => clearSecretValue(credentialKey)),
                  clearStoredSessionForServer(),
                  Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined),
                ]);
                setDeviceID("");
                setToken("");
                setPushStatus("idle");
                setWorkspaces([]);
                setCurrentAccountProfile(null);
                setSelectedWorkspaceID("");
                setRequests([]);
                setHistory([]);
                setSelectedID(null);
                setConnectionStatus(connectionStatusDisconnected ?? "disconnected");
                setLoading(false);
                onForgetClerkSession?.();
              } catch (err) {
                const message = err instanceof Error ? err.message : "Could not delete account";
                recordDiagnostic("error", "auth", "delete_account_failed", { message, status: apiStatus(err) });
                setDiagnosticsEventCount(diagnosticEvents().length);
                setError(message);
                setLoading(false);
                Alert.alert("Account deletion failed", message);
              }
            })();
          },
        },
      ],
    );
  }, [activeClerkSessionID, clearStoredSessionForServer, connectionStatusDisconnected, currentAccountProfile, onForgetClerkSession, runtimeAuthProvider, savedAccounts, sdk, serverURL, setAccountPending, setConnectionStatus, setConnectionTokens, setCurrentAccountProfile, setDeviceID, setDiagnosticsEventCount, setError, setHistory, setLoading, setPushStatus, setRequests, setSavedAccounts, setSelectedID, setSelectedWorkspaceID, setToken, setWorkspaces]);

  const signInToServer = useCallback(async (targetServerURL: string) => {
    const normalizedTarget = normalizeServerURL(targetServerURL);
    if (deviceID) {
      void bestEffortUnregisterDevice();
    }
    await clearStoredSessionForServer();
    setLoadedSessionServerURL("");
    setDeviceID("");
    setToken("");
    setPushStatus("idle");
    setWorkspaces([]);
    setCurrentAccountProfile(null);
    setSelectedWorkspaceID("");
    setRequests([]);
    setHistory([]);
    setSelectedID(null);
    setConnectionStatus("checking");
    setServerURL(normalizedTarget);
    const config = await fetchRuntimeAuthConfigIfAvailable(normalizedTarget);
    onRuntimeAuthConfig?.(normalizedTarget, config);
  }, [bestEffortUnregisterDevice, clearStoredSessionForServer, deviceID, onRuntimeAuthConfig, setConnectionStatus, setCurrentAccountProfile, setDeviceID, setHistory, setLoadedSessionServerURL, setPushStatus, setRequests, setSelectedID, setSelectedWorkspaceID, setServerURL, setToken, setWorkspaces]);

  const useHostedSignIn = useCallback(async () => {
    await signInToServer(debugDefaultServer);
  }, [debugDefaultServer, signInToServer]);

  const selectWorkspace = useCallback((workspaceID: string) => {
    if (workspaceID === selectedWorkspaceID) return;
    setSelectedWorkspaceID(workspaceID);
    setRequests([]);
    setHistory([]);
    setSelectedID(null);
  }, [selectedWorkspaceID, setHistory, setRequests, setSelectedID, setSelectedWorkspaceID]);

  const handleServerURLChange = useCallback((value: string) => {
    const previousServerURL = normalizeServerURL(serverURL);
    const nextServerURL = normalizeServerURL(value);
    if (previousServerURL !== nextServerURL) {
      if (deviceID) {
        void bestEffortUnregisterDevice({
          activeDeviceID: deviceID,
          activeServerURL: previousServerURL,
          activeToken: token,
          authProvider: runtimeAuthProvider,
        });
      }
      void clearStoredSessionForServer(previousServerURL);
      setLoadedSessionServerURL("");
      setDeviceID("");
      setToken("");
      setPushStatus("idle");
      setWorkspaces([]);
      setCurrentAccountProfile(null);
      setSelectedWorkspaceID("");
      setRequests([]);
      setHistory([]);
      setSelectedID(null);
      setConnectionStatus("checking");
    }
    setServerURL(nextServerURL);
  }, [bestEffortUnregisterDevice, clearStoredSessionForServer, deviceID, runtimeAuthProvider, serverURL, setConnectionStatus, setCurrentAccountProfile, setDeviceID, setHistory, setLoadedSessionServerURL, setPushStatus, setRequests, setSelectedID, setSelectedWorkspaceID, setServerURL, setToken, setWorkspaces, token]);

  return {
    bestEffortUnregisterDevice,
    clearHostedLoginSession,
    clearStoredSessionForServer,
    deleteAccount,
    forgetDevice,
    handleServerURLChange,
    resetLocalTestState,
    selectWorkspace,
    signInToServer,
    signOutFromSettings,
    useHostedSignIn,
  };
}
