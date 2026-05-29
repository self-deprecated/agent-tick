import type { ComponentProps } from "react";

import type { AgentTickMainRoute } from "./AgentTickMainRoute";
import { buildAgentTickSettingsRouteProps, type BuildAgentTickSettingsRoutePropsInput } from "./buildAgentTickSettingsRouteProps";
import type { useMobileRequestHandlingController } from "./useMobileRequestHandlingController";

export type AgentTickMainRouteProps = ComponentProps<typeof AgentTickMainRoute>;
type ScannerRouteProps = AgentTickMainRouteProps["scannerRouteProps"];
type HistoryRouteProps = AgentTickMainRouteProps["historyRouteProps"];
type SessionDashboardRouteProps = AgentTickMainRouteProps["sessionDashboardRouteProps"];
type RequestHandlingActions = Pick<ReturnType<typeof useMobileRequestHandlingController>, "loadHistory" | "respond" | "submitQuestionnaire">;

export type BuildAgentTickMainRoutePropsInput = BuildAgentTickSettingsRoutePropsInput & {
  cameraPermission: ScannerRouteProps["cameraPermission"];
  choiceInteractionMode: SessionDashboardRouteProps["choiceInteractionMode"];
  confirmBeforeSubmit: SessionDashboardRouteProps["confirmBeforeSubmit"];
  dashboardSessionDetails: SessionDashboardRouteProps["dashboardSessionDetails"];
  dashboardSessionSummaries: SessionDashboardRouteProps["dashboardSessionSummaries"];
  history: HistoryRouteProps["history"];
  historyLoading: HistoryRouteProps["historyLoading"];
  historySessionDetails: HistoryRouteProps["historySessionDetails"];
  historySessions: HistoryRouteProps["historySessions"];
  hostedReadOnly: SessionDashboardRouteProps["hostedReadOnly"];
  load: SessionDashboardRouteProps["load"];
  questionnaireAnswers: SessionDashboardRouteProps["questionnaireAnswers"];
  reply: SessionDashboardRouteProps["reply"];
  requestCameraPermission: ScannerRouteProps["requestCameraPermission"];
  requestHandlingActions: RequestHandlingActions;
  respondingRequestKeys: SessionDashboardRouteProps["respondingRequestKeys"];
  responseAppReadOnly: SessionDashboardRouteProps["responseAppReadOnly"];
  responseReadOnly: SessionDashboardRouteProps["responseReadOnly"];
  screen: AgentTickMainRouteProps["screen"];
  selectedRequestHosted: SessionDashboardRouteProps["selectedRequestHosted"];
  selectedSessionID: SessionDashboardRouteProps["selectedSessionID"];
  sessionStackLocalState: SessionDashboardRouteProps["sessionStackLocalState"];
  sessionSummaries: SessionDashboardRouteProps["sessionSummaries"];
  setQuestionnaireAnswers: SessionDashboardRouteProps["setQuestionnaireAnswers"];
  setReply: SessionDashboardRouteProps["setReply"];
  setScreen: ScannerRouteProps["setScreen"];
  setSelectedSessionID: SessionDashboardRouteProps["setSelectedSessionID"];
  setSessionStackLocalState: SessionDashboardRouteProps["setSessionStackLocalState"];
};

export function buildAgentTickMainRouteProps({
  accounts,
  activeLocale,
  authProvider,
  availability,
  cameraPermission,
  choiceInteractionMode,
  confirmBeforeSubmit,
  connectionStatus,
  currentAccountProfile,
  dashboardSessionDetails,
  dashboardSessionSummaries,
  deviceID,
  diagnosticsEnabled,
  diagnosticsEventCount,
  diagnosticsLastSentAt,
  entitlementSourceDiagnostics,
  error,
  history,
  historyLoading,
  historySessionDetails,
  historySessions,
  hostedPersonalCurrentlyActive,
  hostedReadOnly,
  load,
  loading,
  localePreference,
  nativeEntitlement,
  notificationStatus,
  notificationsEnabled,
  onAddClerkAccount,
  onLocalePreferenceChange,
  pairingCode,
  personalBillingStatus,
  purchaseAccountReady,
  pushStatus,
  questionnaireAnswers,
  removeSavedAccount,
  reply,
  requestCameraPermission,
  requestHandlingActions,
  respondingRequestKeys,
  responseAppReadOnly,
  responseReadOnly,
  screen,
  selectedRequestHosted,
  selectedSessionID,
  selectedWorkspaceID,
  serverURL,
  sessionStackLocalState,
  sessionSummaries,
  setPairingCode,
  setQuestionnaireAnswers,
  setReply,
  setScreen,
  setSelectedSessionID,
  setSessionStackLocalState,
  setToken,
  settingsActions,
  settingsHomeSignal,
  showDebugHostedExpiryWarning,
  showNativePaywall,
  storeProducts,
  token,
  workspaces,
}: BuildAgentTickMainRoutePropsInput): AgentTickMainRouteProps {
  const { loadHistory, respond, submitQuestionnaire } = requestHandlingActions;
  const {
    handlePairingScan,
    scannerLocked,
  } = settingsActions;

  return {
    screen,
    settingsRouteProps: buildAgentTickSettingsRouteProps({
      accounts,
      activeLocale,
      authProvider,
      availability,
      connectionStatus,
      currentAccountProfile,
      deviceID,
      diagnosticsEnabled,
      diagnosticsEventCount,
      diagnosticsLastSentAt,
      entitlementSourceDiagnostics,
      error,
      hostedPersonalCurrentlyActive,
      loading,
      localePreference,
      nativeEntitlement,
      notificationStatus,
      notificationsEnabled,
      onAddClerkAccount,
      onLocalePreferenceChange,
      pairingCode,
      personalBillingStatus,
      purchaseAccountReady,
      pushStatus,
      removeSavedAccount,
      selectedWorkspaceID,
      serverURL,
      setPairingCode,
      setToken,
      settingsActions,
      settingsHomeSignal,
      showDebugHostedExpiryWarning,
      showNativePaywall,
      storeProducts,
      token,
      workspaces,
    }),
    scannerRouteProps: {
      cameraPermission,
      handlePairingScan,
      requestCameraPermission,
      scannerLocked,
      setScreen,
    },
    historyRouteProps: {
      error,
      history,
      historyLoading,
      historySessionDetails,
      historySessions,
      loadHistory,
    },
    sessionDashboardRouteProps: {
      choiceInteractionMode,
      confirmBeforeSubmit,
      dashboardSessionDetails,
      dashboardSessionSummaries,
      hostedReadOnly,
      load,
      loading,
      questionnaireAnswers,
      reply,
      respond,
      respondingRequestKeys,
      responseAppReadOnly,
      responseReadOnly,
      selectedRequestHosted,
      selectedSessionID,
      sessionStackLocalState,
      sessionSummaries,
      setQuestionnaireAnswers,
      setReply,
      setSelectedSessionID,
      setSessionStackLocalState,
      showNativePaywall,
      submitQuestionnaire,
    },
  };
}
