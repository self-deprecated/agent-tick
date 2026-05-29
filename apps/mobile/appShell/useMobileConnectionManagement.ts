import { useMobileSessionRestore } from "./useMobileSessionRestore";
import { useMobileAppInitialization } from "./useMobileAppInitialization";
import { useSavedAccountPersistence } from "./useSavedAccountPersistence";
import { useMobileConnectionCredential } from "./useMobileConnectionCredential";
import { useClerkSessionReset } from "./useClerkSessionReset";
import { useSavedAccountPending } from "./useSavedAccountPending";
import { useSavedAccountRemoval } from "./useSavedAccountRemoval";
import { useMobileWorkspaces } from "./useMobileWorkspaces";

type UseMobileConnectionManagementInput =
  Parameters<typeof useMobileSessionRestore>[0] &
  Parameters<typeof useMobileAppInitialization>[0] &
  Parameters<typeof useSavedAccountPersistence>[0] &
  Parameters<typeof useMobileConnectionCredential>[0] &
  Parameters<typeof useClerkSessionReset>[0] &
  Parameters<typeof useSavedAccountPending>[0] &
  Omit<Parameters<typeof useSavedAccountRemoval>[0], "setAccountPending"> &
  Parameters<typeof useMobileWorkspaces>[0];

export function useMobileConnectionManagement({
  activeClerkSessionID,
  activeConnectionID,
  clerkSessionToken,
  connectionTokens,
  currentAccountProfile,
  currentAuthToken,
  deviceID,
  lastClerkPushRegistrationKey,
  loadedSessionServerURL,
  menuOpen,
  notificationsEnabled,
  onForgetClerkSession,
  pushStatus,
  runtimeAuthConfig,
  savedAccounts,
  selectedWorkspaceID,
  serverURL,
  settingsLoaded,
  setConnectionStatus,
  setConnectionTokens,
  setCurrentAccountProfile,
  setDeviceID,
  setDiagnosticsEnabled,
  setDiagnosticsEventCount,
  setHistory,
  setLoadedSessionServerURL,
  setNotificationStatus,
  setNotificationsEnabled,
  setPushStatus,
  setRequests,
  setSavedAccounts,
  setSelectedID,
  setSelectedWorkspaceID,
  setServerURL,
  setSettingsLoaded,
  setToken,
  setWorkspaces,
  token,
  workspaces,
}: UseMobileConnectionManagementInput) {
  useMobileSessionRestore({
    authProvider: runtimeAuthConfig?.authProvider,
    loadedSessionServerURL,
    serverURL,
    settingsLoaded,
    setDeviceID,
    setLoadedSessionServerURL,
    setNotificationsEnabled,
    setPushStatus,
    setSavedAccounts,
    setSelectedWorkspaceID,
    setServerURL,
    setSettingsLoaded,
    setToken,
  });

  useMobileAppInitialization({
    setDiagnosticsEnabled,
    setDiagnosticsEventCount,
    setNotificationStatus,
  });

  useSavedAccountPersistence({
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
  });

  useMobileConnectionCredential({
    activeClerkSessionID,
    activeConnectionID,
    clerkSessionToken,
    currentAccountProfile,
    runtimeAuthConfig,
    serverURL,
    setConnectionTokens,
    setDiagnosticsEventCount,
  });

  useClerkSessionReset({
    activeClerkSessionID,
    runtimeAuthConfig,
    serverURL,
    lastClerkPushRegistrationKey,
    setCurrentAccountProfile,
    setSelectedWorkspaceID,
    setDeviceID,
    setPushStatus,
    setRequests,
    setHistory,
    setSelectedID,
    setConnectionStatus,
  });

  const { accountPending, setAccountPending } = useSavedAccountPending({
    savedAccounts,
    menuOpen,
    settingsLoaded,
  });

  const { bestEffortUnregisterSavedAccounts, removeSavedAccount } = useSavedAccountRemoval({
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
  });

  useMobileWorkspaces({
    activeClerkSessionID,
    currentAuthToken,
    runtimeAuthConfig,
    serverURL,
    settingsLoaded,
    setCurrentAccountProfile,
    setSelectedWorkspaceID,
    setWorkspaces,
  });

  return {
    accountPending,
    setAccountPending,
    bestEffortUnregisterSavedAccounts,
    removeSavedAccount,
  };
}
