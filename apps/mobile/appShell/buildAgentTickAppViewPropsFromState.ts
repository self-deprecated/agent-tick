import { buildAgentTickAppViewProps, type BuildAgentTickAppViewPropsInput } from "./buildAgentTickAppViewProps";
import type { AgentTickAppClerkControls, AgentTickAppProps } from "./AgentTickAppProps";
import type { useAgentTickAppState } from "./useAgentTickAppState";
import type { useAgentTickBillingController } from "./useAgentTickBillingController";
import type { useAgentTickConnectionManagement } from "./useAgentTickConnectionManagement";
import type { useAgentTickRealtimeActivityController } from "./useAgentTickRealtimeActivityController";
import type { useAgentTickRequestHandlingActions } from "./useAgentTickRequestHandlingActions";
import type { useAgentTickSettingsActions } from "./useAgentTickSettingsActions";
import type { usePrivateEncryptionStatus } from "./usePrivateEncryptionStatus";
import type { useMobileBillingAccessState } from "./useMobileBillingAccessState";
import type { useMobileSelectionState } from "./useMobileSelectionState";
import { sessionStackSessionKey } from "../sessionStackState";
import type { useSelectedRequestDraft } from "./useSelectedRequestDraft";
import type { useSessionStackDashboard } from "./useSessionStackDashboard";
import type { useSessionStackPersistence } from "./useSessionStackPersistence";

type AgentTickAppState = ReturnType<typeof useAgentTickAppState>;
type RuntimePresentation = Pick<BuildAgentTickAppViewPropsInput, "choiceInteractionMode" | "confirmBeforeSubmit">;
type LocaleInputs = Pick<AgentTickAppProps, "activeLocale" | "localePreference" | "onLocalePreferenceChange">;

type BuildAgentTickAppViewPropsFromStateInput = {
  activityState: AgentTickAppState["activityState"];
  appStatusState: AgentTickAppState["appStatusState"];
  billingAccessState: ReturnType<typeof useMobileBillingAccessState>;
  billingController: ReturnType<typeof useAgentTickBillingController>;
  billingState: AgentTickAppState["billingState"];
  clerkControls: Pick<AgentTickAppClerkControls, "onAddClerkAccount">;
  connectionAccountState: AgentTickAppState["connectionAccountState"];
  connectionManagement: ReturnType<typeof useAgentTickConnectionManagement>;
  localeInputs: LocaleInputs;
  navigationState: AgentTickAppState["navigationState"];
  requestDraft: ReturnType<typeof useSelectedRequestDraft>;
  realtimeActivityController: ReturnType<typeof useAgentTickRealtimeActivityController>;
  privateEncryption: ReturnType<typeof usePrivateEncryptionStatus>;
  requestHandlingActions: ReturnType<typeof useAgentTickRequestHandlingActions>;
  runtimePresentation: RuntimePresentation;
  selectionState: ReturnType<typeof useMobileSelectionState>;
  sessionStackDashboard: ReturnType<typeof useSessionStackDashboard>;
  sessionStackPersistence: ReturnType<typeof useSessionStackPersistence>;
  settingsActions: ReturnType<typeof useAgentTickSettingsActions>;
  showDebugHostedExpiryWarning: () => void;
};

export function buildAgentTickAppViewPropsFromState({
  activityState,
  appStatusState,
  billingAccessState,
  billingController,
  billingState,
  clerkControls,
  connectionAccountState,
  connectionManagement,
  localeInputs,
  navigationState,
  realtimeActivityController,
  privateEncryption,
  requestDraft,
  requestHandlingActions,
  runtimePresentation,
  selectionState,
  sessionStackDashboard,
  sessionStackPersistence,
  settingsActions,
  showDebugHostedExpiryWarning,
}: BuildAgentTickAppViewPropsFromStateInput) {
  const selectedVisibleSession = sessionStackDashboard.selectedVisibleSessionSummary;
  const needsInputBadgeCount = selectedVisibleSession && sessionStackDashboard.visibleSessionSummaries.length > 1
    ? sessionStackDashboard.visibleSessionSummaries
      .filter((session) => sessionStackSessionKey(session) !== activityState.selectedSessionID)
      .reduce((total, session) => total + session.pendingRequestCount, 0)
    : 0;

  return buildAgentTickAppViewProps({
    accountPending: connectionManagement.accountPending,
    accountProfile: connectionAccountState.currentAccountProfile,
    accounts: connectionAccountState.savedAccounts,
    activeLocale: localeInputs.activeLocale,
    appPaywallKey: billingAccessState.appPaywallKey,
    authProvider: connectionAccountState.runtimeAuthConfig?.authProvider,
    availability: appStatusState.availability,
    cameraPermission: appStatusState.cameraPermission,
    choiceInteractionMode: runtimePresentation.choiceInteractionMode,
    confirmBeforeSubmit: runtimePresentation.confirmBeforeSubmit,
    connectionStatus: appStatusState.connectionStatus,
    currentAccountProfile: connectionAccountState.currentAccountProfile,
    dashboardSessionDetails: sessionStackDashboard.dashboardSessionDetails,
    dashboardSessionSummaries: sessionStackDashboard.dashboardSessionSummaries,
    deviceID: connectionAccountState.deviceID,
    diagnosticsEnabled: appStatusState.diagnosticsEnabled,
    diagnosticsEventCount: appStatusState.diagnosticsEventCount,
    diagnosticsLastSentAt: appStatusState.diagnosticsLastSentAt,
    entitlementSourceDiagnostics: billingAccessState.entitlementSourceDiagnostics,
    error: appStatusState.error,
    hasAnyAppAccessEntitlement: billingAccessState.hasAnyAppAccessEntitlement,
    hasSelectedVisibleSession: Boolean(selectedVisibleSession),
    history: activityState.history,
    historyLoading: appStatusState.historyLoading,
    historySessionDetails: activityState.historySessionDetails,
    historySessions: activityState.historySessions,
    hostedPersonalCurrentlyActive: billingAccessState.hostedPersonalCurrentlyActive,
    hostedReadOnly: billingAccessState.hostedReadOnly,
    load: realtimeActivityController.load,
    loading: appStatusState.loading,
    localePreference: localeInputs.localePreference,
    localDevAppAccessUnlocked: billingState.localDevAppAccessUnlocked,
    menuOpen: navigationState.menuOpen,
    nativeEntitlement: billingAccessState.nativeEntitlement,
    nativePaywallVisible: billingAccessState.nativePaywallVisible,
    needsInputBadgeCount,
    notificationStatus: appStatusState.notificationStatus,
    notificationsEnabled: appStatusState.notificationsEnabled,
    onAddClerkAccount: clerkControls.onAddClerkAccount,
    onLocalePreferenceChange: localeInputs.onLocalePreferenceChange,
    openSessionActions: sessionStackDashboard.openSessionActions,
    pairingCode: connectionAccountState.pairingCode,
    paywallConfig: billingState.paywallConfig,
    paywallPlacement: billingState.paywallPlacement,
    paywallPurchaseUnavailable: billingAccessState.paywallPurchaseUnavailable,
    paywallPurchaseUnavailableMessage: billingAccessState.paywallPurchaseUnavailableMessage,
    personalBillingStatus: billingState.personalBillingStatus,
    privateEncryptionProps: {
      status: privateEncryption.privateEncryptionStatus,
      refresh: privateEncryption.refreshPrivateEncryptionStatus,
      repairRegistration: privateEncryption.repairPrivateEncryptionRegistration,
    },
    purchaseAccountReady: billingAccessState.purchaseAccountReady,
    pushStatus: appStatusState.pushStatus,
    questionnaireAnswers: requestDraft.questionnaireAnswers,
    removeSavedAccount: connectionManagement.removeSavedAccount,
    reply: requestDraft.reply,
    requestCameraPermission: appStatusState.requestCameraPermission,
    requestHandlingActions,
    respondingRequestKeys: activityState.respondingRequestKeys,
    responseAppReadOnly: billingAccessState.responseAppReadOnly,
    responseReadOnly: billingAccessState.responseReadOnly,
    screen: navigationState.screen,
    selectedRequestHosted: billingAccessState.selectedRequestHosted,
    selectedSessionID: activityState.selectedSessionID,
    selectedWorkspaceID: connectionAccountState.selectedWorkspaceID,
    serverURL: connectionAccountState.serverURL,
    sessionStackInteractionMode: sessionStackPersistence.sessionStackLocalState.preferences.interactionMode,
    sessionStackLocalState: sessionStackPersistence.sessionStackLocalState,
    sessionSummaries: activityState.sessionSummaries,
    setDebugPaywallVisible: billingState.setDebugPaywallVisible,
    setMenuOpen: navigationState.setMenuOpen,
    setPairingCode: connectionAccountState.setPairingCode,
    setPaywallDismissedKey: billingState.setPaywallDismissedKey,
    setQuestionnaireAnswers: requestDraft.setQuestionnaireAnswers,
    setReply: requestDraft.setReply,
    setScreen: navigationState.setScreen,
    setSelectedSessionID: activityState.setSelectedSessionID,
    setSessionStackLocalState: sessionStackPersistence.setSessionStackLocalState,
    setSettingsViewTarget: navigationState.setSettingsViewTarget,
    setToken: connectionAccountState.setToken,
    settingsActions,
    settingsViewTarget: navigationState.settingsViewTarget,
    showDebugHostedExpiryWarning,
    showNativePaywall: billingController.showNativePaywall,
    storeProducts: billingState.storeProducts,
    toggleSessionStackInteractionMode: sessionStackDashboard.toggleSessionStackInteractionMode,
    token: connectionAccountState.token,
    visibleSessionCount: sessionStackDashboard.visibleSessionSummaries.length,
    workspaces: connectionAccountState.workspaces,
    workspaceName: selectionState.selectedWorkspace?.name ?? connectionAccountState.selectedWorkspaceID,
  });
}
