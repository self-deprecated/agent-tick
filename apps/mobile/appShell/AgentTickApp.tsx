import { hostedServerURL } from "../mobileAuth";
import type { AgentTickAppClerkControls, AgentTickAppProps } from "./AgentTickAppProps";
import { useAgentTickDiagnosticsContextBinding } from "./useAgentTickDiagnosticsContextBinding";
import { useAgentTickSessionStackController } from "./useAgentTickSessionStackController";
import { useRuntimeAuthConfigRefresh } from "./useRuntimeAuthConfigRefresh";
import { useAgentTickConnectionManagement } from "./useAgentTickConnectionManagement";
import { useSelectedRequestDraft } from "./useSelectedRequestDraft";
import { useMobileApiClient } from "./useMobileApiClient";
import { useHostedExpiryWarning } from "./useHostedExpiryWarning";
import { useAgentTickRealtimeActivityController } from "./useAgentTickRealtimeActivityController";
import { useAgentTickRequestHandlingActions } from "./useAgentTickRequestHandlingActions";
import { useAgentTickBillingController } from "./useAgentTickBillingController";
import { useAgentTickSettingsActions } from "./useAgentTickSettingsActions";
import { useAgentTickDiagnosticsFlushBinding } from "./useAgentTickDiagnosticsFlushBinding";
import { useAgentTickBillingAccessState } from "./useAgentTickBillingAccessState";
import { useAgentTickSelectionState } from "./useAgentTickSelectionState";
import { AgentTickAppView } from "./AgentTickAppView";
import { buildAgentTickAppViewPropsFromState } from "./buildAgentTickAppViewPropsFromState";
import { choiceInteractionMode, confirmBeforeSubmit, optionPlacement } from "./useMobileRuntimeRefs";
import { useActiveMobileConnectionIdentity } from "./useActiveMobileConnectionIdentity";
import { useAgentTickAppState } from "./useAgentTickAppState";
import { usePrivateEncryptionStatus } from "./usePrivateEncryptionStatus";

const defaultServer = hostedServerURL;
export function AgentTickApp({
  initialServerURL,
  initialAuthConfig,
  clerkSessionToken,
  clerkSessionID,
  clerkSignedIn,
  clerkTokenProvider,
  clerkDebugState,
  onRuntimeAuthConfig,
  onAddClerkAccount,
  onForgetClerkSession,
  activeLocale,
  localePreference,
  onLocalePreferenceChange,
}: AgentTickAppProps & AgentTickAppClerkControls) {
  const appState = useAgentTickAppState({
    defaultServer,
    initialAuthConfig,
    initialServerURL,
  });
  const {
    navigationState,
    connectionAccountState,
    activityState,
    notificationTargetState,
    appStatusState,
    billingState,
    runtimeRefs,
  } = appState;

  useRuntimeAuthConfigRefresh({
    serverURL: connectionAccountState.serverURL,
    settingsLoaded: appStatusState.settingsLoaded,
    runtimeAuthConfig: connectionAccountState.runtimeAuthConfig,
    onRuntimeAuthConfig,
    setRuntimeAuthConfig: connectionAccountState.setRuntimeAuthConfig,
    setToken: connectionAccountState.setToken,
    setDeviceID: connectionAccountState.setDeviceID,
    setWorkspaces: connectionAccountState.setWorkspaces,
    setCurrentAccountProfile: connectionAccountState.setCurrentAccountProfile,
    setSelectedWorkspaceID: connectionAccountState.setSelectedWorkspaceID,
    setConnectionStatus: appStatusState.setConnectionStatus,
  });

  const activeConnectionIdentity = useActiveMobileConnectionIdentity({
    clerkSessionID,
    clerkSessionToken,
    currentAccountProfile: connectionAccountState.currentAccountProfile,
    runtimeAuthConfig: connectionAccountState.runtimeAuthConfig,
    serverURL: connectionAccountState.serverURL,
  });
  const { sessionStackDashboard, sessionStackPersistence } = useAgentTickSessionStackController({
    activeConnectionIdentity,
    activityState,
    appStatusState,
    connectionAccountState,
    notificationTargetState,
  });

  const selectionState = useAgentTickSelectionState({
    activeConnectionIdentity,
    activityState,
    connectionAccountState,
  });

  const billingAccessState = useAgentTickBillingAccessState({
    appStatusState,
    billingState,
    connectionAccountState,
    selectionState,
  });
  const requestDraft = useSelectedRequestDraft(selectionState.selected);

  const { currentAuthToken, sdk } = useMobileApiClient({
    activeConnectionID: activeConnectionIdentity.activeConnectionID,
    clerkTokenProvider,
    connectionTokens: connectionAccountState.connectionTokens,
    runtimeAuthConfig: connectionAccountState.runtimeAuthConfig,
    savedAccounts: connectionAccountState.savedAccounts,
    selectedWorkspaceID: connectionAccountState.selectedWorkspaceID,
    serverURL: connectionAccountState.serverURL,
    token: connectionAccountState.token,
  });

  const privateEncryption = usePrivateEncryptionStatus({
    currentAuthToken,
    deviceID: connectionAccountState.deviceID,
    savedAccounts: connectionAccountState.savedAccounts,
    selectedWorkspaceID: connectionAccountState.selectedWorkspaceID,
    serverURL: connectionAccountState.serverURL,
    settingsLoaded: appStatusState.settingsLoaded,
    setDeviceID: connectionAccountState.setDeviceID,
    setSavedAccounts: connectionAccountState.setSavedAccounts,
  });

  useAgentTickDiagnosticsContextBinding({
    activeConnectionIdentity,
    activityState,
    appStatusState,
    billingAccessState,
    billingState,
    clerkDiagnostics: { clerkDebugState, clerkSessionToken },
    connectionAccountState,
    navigationState,
    runtimePresentation: { choiceInteractionMode, confirmBeforeSubmit, optionPlacement },
    selectionState,
  });

  const connectionManagement = useAgentTickConnectionManagement({
    activeConnectionIdentity,
    activityState,
    appStatusState,
    clerkSessionToken,
    connectionAccountState,
    currentAuthToken,
    navigationState,
    onForgetClerkSession,
    runtimeRefs,
  });

  const billingController = useAgentTickBillingController({
    appStatusState,
    billingAccessState,
    billingState,
    connectionAccountState,
    sdk,
    selectionState,
  });

  const { showDebugHostedExpiryWarning } = useHostedExpiryWarning(billingState.personalBillingStatus);

  const realtimeActivityController = useAgentTickRealtimeActivityController({
    activityState,
    appStatusState,
    billingController,
    connectionAccountState,
    navigationState,
    notificationTargetState,
    runtimeRefs,
    sdk,
    selectionState,
    sessionStackDashboard,
  });

  useAgentTickDiagnosticsFlushBinding({
    appStatusState,
    billingAccessState,
    billingState,
    connectionAccountState,
    navigationState,
    sdk,
    selectionState,
  });

  const requestHandlingActions = useAgentTickRequestHandlingActions({
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
  });

  const settingsActions = useAgentTickSettingsActions({
    activeConnectionIdentity,
    activityState,
    appStatusState,
    billingAccessState,
    billingController,
    billingState,
    clerkControls: { onForgetClerkSession },
    clerkSessionToken,
    clerkSignedIn,
    connectionAccountState,
    connectionManagement,
    currentAuthToken,
    navigationState,
    notificationTargetState,
    onRuntimeAuthConfig,
    realtimeActivityController,
    runtimeRefs,
    sdk,
    selectionState,
  });

  const viewProps = buildAgentTickAppViewPropsFromState({
    activityState,
    appStatusState,
    billingAccessState,
    billingController,
    billingState,
    clerkControls: { onAddClerkAccount },
    connectionAccountState,
    connectionManagement,
    localeInputs: { activeLocale, localePreference, onLocalePreferenceChange },
    navigationState,
    realtimeActivityController,
    privateEncryption,
    requestDraft,
    requestHandlingActions,
    runtimePresentation: { choiceInteractionMode, confirmBeforeSubmit },
    selectionState,
    sessionStackDashboard,
    sessionStackPersistence,
    settingsActions,
    showDebugHostedExpiryWarning,
  });

  return <AgentTickAppView {...viewProps} />;

}


