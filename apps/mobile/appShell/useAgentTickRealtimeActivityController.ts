import type { useAgentTickAppState } from "./useAgentTickAppState";
import type { useAgentTickBillingController } from "./useAgentTickBillingController";
import type { useMobileApiClient } from "./useMobileApiClient";
import { useMobileRealtimeActivityController } from "./useMobileRealtimeActivityController";
import type { useMobileSelectionState } from "./useMobileSelectionState";
import type { useSessionStackDashboard } from "./useSessionStackDashboard";

type AgentTickAppState = ReturnType<typeof useAgentTickAppState>;

type UseAgentTickRealtimeActivityControllerInput = {
  activityState: AgentTickAppState["activityState"];
  appStatusState: AgentTickAppState["appStatusState"];
  billingController: ReturnType<typeof useAgentTickBillingController>;
  connectionAccountState: AgentTickAppState["connectionAccountState"];
  notificationTargetState: AgentTickAppState["notificationTargetState"];
  runtimeRefs: AgentTickAppState["runtimeRefs"];
  sdk: ReturnType<typeof useMobileApiClient>["sdk"];
  selectionState: ReturnType<typeof useMobileSelectionState>;
  sessionStackDashboard: ReturnType<typeof useSessionStackDashboard>;
};

export function useAgentTickRealtimeActivityController({
  activityState,
  appStatusState,
  billingController,
  connectionAccountState,
  notificationTargetState,
  runtimeRefs,
  sdk,
  selectionState,
  sessionStackDashboard,
}: UseAgentTickRealtimeActivityControllerInput) {
  return useMobileRealtimeActivityController({
    authProvider: connectionAccountState.runtimeAuthConfig?.authProvider,
    dashboardSessionSummaries: sessionStackDashboard.dashboardSessionSummaries,
    deviceID: connectionAccountState.deviceID,
    didPrimeNotifications: runtimeRefs.didPrimeNotifications,
    hasRequestAuth: selectionState.hasRequestAuth,
    notificationsEnabled: appStatusState.notificationsEnabled,
    notificationTargetID: notificationTargetState.notificationTargetID,
    pushStatus: appStatusState.pushStatus,
    realtimeUnavailable: appStatusState.realtimeUnavailable,
    refreshPersonalBilling: billingController.refreshPersonalBilling,
    requests: activityState.requests,
    savedAccounts: connectionAccountState.savedAccounts,
    sdk,
    seenRequestIDs: runtimeRefs.seenRequestIDs,
    selectedID: activityState.selectedID,
    selectedSessionID: activityState.selectedSessionID,
    selectedSourceID: activityState.selectedSourceID,
    selectedWorkspaceID: connectionAccountState.selectedWorkspaceID,
    serverURL: connectionAccountState.serverURL,
    sessionDetails: activityState.sessionDetails,
    sessionSummaries: activityState.sessionSummaries,
    setConnectionStatus: appStatusState.setConnectionStatus,
    setDiagnosticsEventCount: appStatusState.setDiagnosticsEventCount,
    setError: appStatusState.setError,
    setLoading: appStatusState.setLoading,
    setNotificationTargetID: notificationTargetState.setNotificationTargetID,
    setRealtimeUnavailable: appStatusState.setRealtimeUnavailable,
    setRequests: activityState.setRequests,
    setSelectedID: activityState.setSelectedID,
    setSelectedSourceID: activityState.setSelectedSourceID,
    setSessionDetails: activityState.setSessionDetails,
    setSessionSummaries: activityState.setSessionSummaries,
    setStatusUpdates: activityState.setStatusUpdates,
    settingsLoaded: appStatusState.settingsLoaded,
    token: connectionAccountState.token,
    visibleSessionSummaries: sessionStackDashboard.visibleSessionSummaries,
  });
}
