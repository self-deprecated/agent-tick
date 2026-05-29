import { useMobileRequestHandlingController } from "./useMobileRequestHandlingController";
import type { useAgentTickAppState } from "./useAgentTickAppState";
import type { useMobileApiClient } from "./useMobileApiClient";
import type { useMobileBillingAccessState } from "./useMobileBillingAccessState";
import type { useMobileBillingController } from "./useMobileBillingController";
import type { useMobileConnectionManagement } from "./useMobileConnectionManagement";
import type { useMobileRealtimeActivityController } from "./useMobileRealtimeActivityController";
import type { useSelectedRequestDraft } from "./useSelectedRequestDraft";

type AgentTickAppState = ReturnType<typeof useAgentTickAppState>;

type UseAgentTickRequestHandlingActionsInput = {
  activityState: AgentTickAppState["activityState"];
  appStatusState: AgentTickAppState["appStatusState"];
  billingAccessState: ReturnType<typeof useMobileBillingAccessState>;
  billingController: ReturnType<typeof useMobileBillingController>;
  billingState: AgentTickAppState["billingState"];
  connectionAccountState: AgentTickAppState["connectionAccountState"];
  connectionManagement: ReturnType<typeof useMobileConnectionManagement>;
  navigationState: AgentTickAppState["navigationState"];
  notificationTargetState: AgentTickAppState["notificationTargetState"];
  realtimeActivityController: ReturnType<typeof useMobileRealtimeActivityController>;
  requestDraft: ReturnType<typeof useSelectedRequestDraft>;
  sdk: ReturnType<typeof useMobileApiClient>["sdk"];
};

export function useAgentTickRequestHandlingActions({
  activityState,
  appStatusState,
  billingAccessState,
  billingController,
  billingState,
  connectionAccountState,
  connectionManagement,
  navigationState,
  notificationTargetState,
  realtimeActivityController,
  requestDraft,
  sdk,
}: UseAgentTickRequestHandlingActionsInput) {
  return useMobileRequestHandlingController({
    hostedReadOnly: billingAccessState.hostedReadOnly,
    firstRealResponseBeforePaywallAllowed: billingAccessState.firstRealResponseBeforePaywallAllowed,
    interruptRealtime: realtimeActivityController.interruptRealtime,
    load: realtimeActivityController.load,
    loadRef: realtimeActivityController.loadRef,
    questionnaireAnswers: requestDraft.questionnaireAnswers,
    refreshPersonalBilling: billingController.refreshPersonalBilling,
    reply: requestDraft.reply,
    responseAppReadOnly: billingAccessState.responseAppReadOnly,
    savedAccounts: connectionAccountState.savedAccounts,
    screen: navigationState.screen,
    sdk,
    serverURL: connectionAccountState.serverURL,
    setAccountPending: connectionManagement.setAccountPending,
    setConnectionStatus: appStatusState.setConnectionStatus,
    setDiagnosticsEventCount: appStatusState.setDiagnosticsEventCount,
    setError: appStatusState.setError,
    setHistory: activityState.setHistory,
    setHistoryLoading: appStatusState.setHistoryLoading,
    setHistorySessionDetails: activityState.setHistorySessionDetails,
    setHistorySessions: activityState.setHistorySessions,
    setNotificationTargetID: notificationTargetState.setNotificationTargetID,
    setNotificationTargetRequestID: notificationTargetState.setNotificationTargetRequestID,
    setNotificationTargetSessionID: notificationTargetState.setNotificationTargetSessionID,
    setNotificationTargetStatusUpdateID: notificationTargetState.setNotificationTargetStatusUpdateID,
    setFirstRealResponseBeforePaywallPending: billingState.setFirstRealResponseBeforePaywallPending,
    setQuestionnaireAnswers: requestDraft.setQuestionnaireAnswers,
    setReply: requestDraft.setReply,
    setRequests: activityState.setRequests,
    setRespondingRequestKeys: activityState.setRespondingRequestKeys,
    setScreen: navigationState.setScreen,
    setSelectedID: activityState.setSelectedID,
    setSessionDetails: activityState.setSessionDetails,
  });
}
