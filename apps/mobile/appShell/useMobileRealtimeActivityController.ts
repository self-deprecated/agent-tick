import { useMobileActivityLoad } from "./useMobileActivityLoad";
import { useSessionDetailLoading } from "./useSessionDetailLoading";
import { useWaiterLivenessRefresh } from "./useWaiterLivenessRefresh";
import { useRealtimeActivityRefresh } from "./useRealtimeActivityRefresh";

type UseMobileRealtimeActivityControllerInput =
  Parameters<typeof useMobileActivityLoad>[0] &
  Parameters<typeof useSessionDetailLoading>[0] &
  Omit<Parameters<typeof useWaiterLivenessRefresh>[0], "load" | "loadSessionDetailForSummary"> &
  Omit<Parameters<typeof useRealtimeActivityRefresh>[0], "load">;

export function useMobileRealtimeActivityController({
  authProvider,
  dashboardSessionSummaries,
  deviceID,
  didPrimeNotifications,
  didShowNotificationSettingsReminder,
  hasRequestAuth,
  notificationsEnabled,
  notificationStatus,
  notificationTargetID,
  onOpenNotificationSettings,
  pushStatus,
  realtimeUnavailable,
  refreshPersonalBilling,
  requests,
  savedAccounts,
  sdk,
  seenRequestIDs,
  selectedID,
  selectedSessionID,
  selectedSourceID,
  selectedWorkspaceID,
  serverURL,
  sessionDetails,
  sessionSummaries,
  setConnectionStatus,
  setDiagnosticsEventCount,
  setError,
  setLoading,
  setNotificationTargetID,
  setRealtimeUnavailable,
  setRequests,
  setSelectedID,
  setSelectedSourceID,
  setSessionDetails,
  setSessionSummaries,
  setStatusUpdates,
  settingsLoaded,
  token,
  visibleSessionSummaries,
}: UseMobileRealtimeActivityControllerInput) {
  const { load } = useMobileActivityLoad({
    authProvider,
    didPrimeNotifications,
    didShowNotificationSettingsReminder,
    notificationsEnabled,
    notificationStatus,
    notificationTargetID,
    onOpenNotificationSettings,
    pushStatus,
    savedAccounts,
    sdk,
    seenRequestIDs,
    selectedID,
    selectedSourceID,
    selectedWorkspaceID,
    serverURL,
    setConnectionStatus,
    setDiagnosticsEventCount,
    setError,
    setLoading,
    setNotificationTargetID,
    setRequests,
    setSelectedID,
    setSelectedSourceID,
    setSessionSummaries,
    setStatusUpdates,
  });

  const { loadSessionDetailForSummary } = useSessionDetailLoading({
    sdk,
    savedAccounts,
    hasRequestAuth,
    selectedSessionID,
    sessionSummaries,
    sessionDetails,
    visibleSessionSummaries,
    setSessionDetails,
    setDiagnosticsEventCount,
  });

  useWaiterLivenessRefresh({
    settingsLoaded,
    hasRequestAuth,
    requests,
    dashboardSessionSummaries,
    selectedSessionID,
    sessionSummaries,
    load,
    loadSessionDetailForSummary,
  });

  const { loadRef, interruptRealtime } = useRealtimeActivityRefresh({
    authProvider,
    deviceID,
    hasRequestAuth,
    load,
    refreshPersonalBilling,
    realtimeUnavailable,
    sdk,
    seenRequestIDs,
    selectedWorkspaceID,
    serverURL,
    setConnectionStatus,
    setDiagnosticsEventCount,
    setRealtimeUnavailable,
    settingsLoaded,
    token,
  });

  return { load, loadRef, interruptRealtime };
}
