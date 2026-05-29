import { useMobileDiagnosticsFlush } from "./useMobileDiagnosticsFlush";
import type { useAgentTickAppState } from "./useAgentTickAppState";
import type { useMobileApiClient } from "./useMobileApiClient";
import type { useMobileBillingAccessState } from "./useMobileBillingAccessState";
import type { useMobileSelectionState } from "./useMobileSelectionState";

type AgentTickAppState = ReturnType<typeof useAgentTickAppState>;

type UseAgentTickDiagnosticsFlushBindingInput = {
  appStatusState: AgentTickAppState["appStatusState"];
  billingAccessState: ReturnType<typeof useMobileBillingAccessState>;
  billingState: AgentTickAppState["billingState"];
  connectionAccountState: AgentTickAppState["connectionAccountState"];
  navigationState: AgentTickAppState["navigationState"];
  sdk: ReturnType<typeof useMobileApiClient>["sdk"];
  selectionState: ReturnType<typeof useMobileSelectionState>;
};

export function useAgentTickDiagnosticsFlushBinding({
  appStatusState,
  billingAccessState,
  billingState,
  connectionAccountState,
  navigationState,
  sdk,
  selectionState,
}: UseAgentTickDiagnosticsFlushBindingInput) {
  useMobileDiagnosticsFlush({
    appResponsesReadOnly: billingAccessState.appResponsesReadOnly,
    connectionStatus: appStatusState.connectionStatus,
    diagnosticsEnabled: appStatusState.diagnosticsEnabled,
    error: appStatusState.error,
    hasRequestAuth: selectionState.hasRequestAuth,
    hostedReadOnly: billingAccessState.hostedReadOnly,
    menuOpen: navigationState.menuOpen,
    nativePaywallVisible: billingAccessState.nativePaywallVisible,
    nativeEntitlementHostedResponsesUnlocked: billingAccessState.nativeEntitlement.hostedResponsesUnlocked,
    nativeEntitlementHostedSubscriptionActive: billingAccessState.nativeEntitlement.hostedSubscriptionActive,
    nativeEntitlementLifetimeUnlocked: billingAccessState.nativeEntitlement.lifetimeUnlocked,
    nativeEntitlementReadOnly: billingAccessState.nativeEntitlement.readOnly,
    nativeEntitlementTrialActive: billingAccessState.nativeEntitlement.trialActive,
    notificationStatus: appStatusState.notificationStatus,
    notificationsEnabled: appStatusState.notificationsEnabled,
    paywallLoading: billingState.paywallLoading,
    paywallVisible: billingAccessState.paywallVisible,
    personalBillingStatus: billingState.personalBillingStatus,
    pushStatus: appStatusState.pushStatus,
    runtimeAuthProvider: connectionAccountState.runtimeAuthConfig?.authProvider,
    savedAccounts: connectionAccountState.savedAccounts,
    screen: navigationState.screen,
    sdk,
    selectedRequestHosted: billingAccessState.selectedRequestHosted,
    serverURL: connectionAccountState.serverURL,
    settingsLoaded: appStatusState.settingsLoaded,
    setDiagnosticsEventCount: appStatusState.setDiagnosticsEventCount,
    setDiagnosticsLastSentAt: appStatusState.setDiagnosticsLastSentAt,
  });
}
