import type { AgentTickAppClerkControls, AgentTickAppProps } from "./AgentTickAppProps";
import type { useActiveMobileConnectionIdentity } from "./useActiveMobileConnectionIdentity";
import type { useAgentTickAppState } from "./useAgentTickAppState";
import type { useMobileApiClient } from "./useMobileApiClient";
import { useMobileConnectionManagement } from "./useMobileConnectionManagement";

type AgentTickAppState = ReturnType<typeof useAgentTickAppState>;

type UseAgentTickConnectionManagementInput = {
  activeConnectionIdentity: ReturnType<typeof useActiveMobileConnectionIdentity>;
  activityState: AgentTickAppState["activityState"];
  appStatusState: AgentTickAppState["appStatusState"];
  clerkSessionToken: AgentTickAppProps["clerkSessionToken"];
  connectionAccountState: AgentTickAppState["connectionAccountState"];
  currentAuthToken: ReturnType<typeof useMobileApiClient>["currentAuthToken"];
  navigationState: AgentTickAppState["navigationState"];
  onForgetClerkSession: AgentTickAppClerkControls["onForgetClerkSession"];
  runtimeRefs: AgentTickAppState["runtimeRefs"];
};

export function useAgentTickConnectionManagement({
  activeConnectionIdentity,
  activityState,
  appStatusState,
  clerkSessionToken,
  connectionAccountState,
  currentAuthToken,
  navigationState,
  onForgetClerkSession,
  runtimeRefs,
}: UseAgentTickConnectionManagementInput) {
  return useMobileConnectionManagement({
    activeClerkSessionID: activeConnectionIdentity.activeClerkSessionID,
    activeConnectionID: activeConnectionIdentity.activeConnectionID,
    clerkSessionToken,
    connectionTokens: connectionAccountState.connectionTokens,
    currentAccountProfile: connectionAccountState.currentAccountProfile,
    currentAuthToken,
    deviceID: connectionAccountState.deviceID,
    lastClerkPushRegistrationKey: runtimeRefs.lastClerkPushRegistrationKey,
    loadedSessionServerURL: appStatusState.loadedSessionServerURL,
    menuOpen: navigationState.menuOpen,
    notificationsEnabled: appStatusState.notificationsEnabled,
    onForgetClerkSession,
    pushStatus: appStatusState.pushStatus,
    runtimeAuthConfig: connectionAccountState.runtimeAuthConfig,
    savedAccounts: connectionAccountState.savedAccounts,
    selectedWorkspaceID: connectionAccountState.selectedWorkspaceID,
    serverURL: connectionAccountState.serverURL,
    settingsLoaded: appStatusState.settingsLoaded,
    setConnectionStatus: appStatusState.setConnectionStatus,
    setConnectionTokens: connectionAccountState.setConnectionTokens,
    setCurrentAccountProfile: connectionAccountState.setCurrentAccountProfile,
    setDeviceID: connectionAccountState.setDeviceID,
    setDiagnosticsEnabled: appStatusState.setDiagnosticsEnabled,
    setDiagnosticsEventCount: appStatusState.setDiagnosticsEventCount,
    setHistory: activityState.setHistory,
    setLoadedSessionServerURL: appStatusState.setLoadedSessionServerURL,
    setNotificationStatus: appStatusState.setNotificationStatus,
    setNotificationsEnabled: appStatusState.setNotificationsEnabled,
    setPushStatus: appStatusState.setPushStatus,
    setRequests: activityState.setRequests,
    setSavedAccounts: connectionAccountState.setSavedAccounts,
    setSelectedID: activityState.setSelectedID,
    setSelectedWorkspaceID: connectionAccountState.setSelectedWorkspaceID,
    setServerURL: connectionAccountState.setServerURL,
    setSettingsLoaded: appStatusState.setSettingsLoaded,
    setToken: connectionAccountState.setToken,
    setWorkspaces: connectionAccountState.setWorkspaces,
    token: connectionAccountState.token,
    workspaces: connectionAccountState.workspaces,
  });
}
