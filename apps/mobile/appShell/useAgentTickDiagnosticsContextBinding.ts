import type { AgentTickAppProps } from "./AgentTickAppProps";
import { useAgentTickDiagnosticsContext } from "./useAgentTickDiagnosticsContext";
import type { useActiveMobileConnectionIdentity } from "./useActiveMobileConnectionIdentity";
import type { useAgentTickAppState } from "./useAgentTickAppState";
import type { useMobileBillingAccessState } from "./useMobileBillingAccessState";
import type { useMobileSelectionState } from "./useMobileSelectionState";

type AgentTickAppState = ReturnType<typeof useAgentTickAppState>;

type RuntimePresentationOptions = {
  choiceInteractionMode: string;
  confirmBeforeSubmit: boolean;
  optionPlacement: string;
};

type UseAgentTickDiagnosticsContextBindingInput = {
  activeConnectionIdentity: ReturnType<typeof useActiveMobileConnectionIdentity>;
  activityState: AgentTickAppState["activityState"];
  appStatusState: AgentTickAppState["appStatusState"];
  billingAccessState: ReturnType<typeof useMobileBillingAccessState>;
  billingState: AgentTickAppState["billingState"];
  clerkDiagnostics: Pick<AgentTickAppProps, "clerkDebugState" | "clerkSessionToken">;
  connectionAccountState: AgentTickAppState["connectionAccountState"];
  navigationState: AgentTickAppState["navigationState"];
  runtimePresentation: RuntimePresentationOptions;
  selectionState: ReturnType<typeof useMobileSelectionState>;
};

export function useAgentTickDiagnosticsContextBinding({
  activeConnectionIdentity,
  activityState,
  appStatusState,
  billingAccessState,
  billingState,
  clerkDiagnostics,
  connectionAccountState,
  navigationState,
  runtimePresentation,
  selectionState,
}: UseAgentTickDiagnosticsContextBindingInput) {
  useAgentTickDiagnosticsContext({
    activeClerkSessionID: activeConnectionIdentity.activeClerkSessionID,
    appResponsesReadOnly: billingAccessState.appResponsesReadOnly,
    billingAccessGraceActive: billingAccessState.billingAccessGraceActive,
    choiceInteractionMode: runtimePresentation.choiceInteractionMode,
    clerkDebugState: clerkDiagnostics.clerkDebugState,
    clerkSessionToken: clerkDiagnostics.clerkSessionToken,
    confirmBeforeSubmit: runtimePresentation.confirmBeforeSubmit,
    connectedBillingEntitlementGrant: billingState.connectedBillingEntitlementGrant,
    connectedBillingSettled: billingState.connectedBillingSettled,
    connectionStatus: appStatusState.connectionStatus,
    currentAccountProfile: connectionAccountState.currentAccountProfile,
    deviceID: connectionAccountState.deviceID,
    error: appStatusState.error,
    hasRequestAuth: selectionState.hasRequestAuth,
    hostedReadOnly: billingAccessState.hostedReadOnly,
    menuOpen: navigationState.menuOpen,
    nativeEntitlement: billingAccessState.nativeEntitlement,
    nativePaywallVisible: billingAccessState.nativePaywallVisible,
    notificationStatus: appStatusState.notificationStatus,
    notificationsEnabled: appStatusState.notificationsEnabled,
    optionPlacement: runtimePresentation.optionPlacement,
    paywallLoading: billingState.paywallLoading,
    paywallVisible: billingAccessState.paywallVisible,
    personalBillingSettled: billingState.personalBillingSettled,
    personalBillingStatus: billingState.personalBillingStatus,
    pushStatus: appStatusState.pushStatus,
    requests: activityState.requests,
    responseReadOnly: billingAccessState.responseReadOnly,
    runtimeAuthConfig: connectionAccountState.runtimeAuthConfig,
    savedAccounts: connectionAccountState.savedAccounts,
    screen: navigationState.screen,
    selectedID: activityState.selectedID,
    selectedRequestHosted: billingAccessState.selectedRequestHosted,
    selectedRequestSharedWorkspace: billingAccessState.selectedRequestSharedWorkspace,
    selectedRequestWorkspaceResponsesEntitled: billingAccessState.selectedRequestWorkspaceResponsesEntitled,
    selectedSourceID: activityState.selectedSourceID,
    selectedWorkspaceID: connectionAccountState.selectedWorkspaceID,
    setDiagnosticsEventCount: appStatusState.setDiagnosticsEventCount,
    settingsLoaded: appStatusState.settingsLoaded,
    storeEntitlementsSettled: billingState.storeEntitlementsSettled,
    token: connectionAccountState.token,
    workspacesLength: connectionAccountState.workspaces.length,
  });
}
