import { useMobileHistory } from "./useMobileHistory";
import { useNotificationOpenRouting } from "./useNotificationOpenRouting";
import { useRequestResponseSubmission } from "./useRequestResponseSubmission";

type UseMobileRequestHandlingControllerInput =
  Parameters<typeof useMobileHistory>[0] &
  Parameters<typeof useRequestResponseSubmission>[0] &
  Parameters<typeof useNotificationOpenRouting>[0];

export function useMobileRequestHandlingController({
  hostedReadOnly,
  firstRealResponseBeforePaywallAllowed,
  interruptRealtime,
  load,
  loadRef,
  questionnaireAnswers,
  refreshPersonalBilling,
  reply,
  responseAppReadOnly,
  savedAccounts,
  screen,
  sdk,
  serverURL,
  setAccountPending,
  setConnectionStatus,
  setDiagnosticsEventCount,
  setError,
  setFirstRealResponseBeforePaywallPending,
  setHistory,
  setHistoryLoading,
  setHistorySessionDetails,
  setHistorySessions,
  setNotificationTargetID,
  setNotificationTargetRequestID,
  setNotificationTargetSessionID,
  setNotificationTargetStatusUpdateID,
  setQuestionnaireAnswers,
  setReply,
  setRequests,
  setRespondingRequestKeys,
  setScreen,
  setSelectedID,
  setSessionDetails,
}: UseMobileRequestHandlingControllerInput) {
  const { loadHistory } = useMobileHistory({
    savedAccounts,
    screen,
    sdk,
    setConnectionStatus,
    setDiagnosticsEventCount,
    setError,
    setHistory,
    setHistoryLoading,
    setHistorySessionDetails,
    setHistorySessions,
  });

  const { respond, submitQuestionnaire, submitResponse } = useRequestResponseSubmission({
    hostedReadOnly,
    firstRealResponseBeforePaywallAllowed,
    interruptRealtime,
    load,
    questionnaireAnswers,
    refreshPersonalBilling,
    reply,
    responseAppReadOnly,
    savedAccounts,
    sdk,
    serverURL,
    setAccountPending,
    setDiagnosticsEventCount,
    setFirstRealResponseBeforePaywallPending,
    setQuestionnaireAnswers,
    setReply,
    setRequests,
    setRespondingRequestKeys,
    setSelectedID,
    setSessionDetails,
  });

  useNotificationOpenRouting({
    interruptRealtime,
    loadRef,
    setDiagnosticsEventCount,
    setNotificationTargetID,
    setNotificationTargetRequestID,
    setNotificationTargetSessionID,
    setNotificationTargetStatusUpdateID,
    setScreen,
    setSelectedID,
  });

  return { loadHistory, respond, submitQuestionnaire, submitResponse };
}
