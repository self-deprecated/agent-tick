import { useMobileBillingController } from "./useMobileBillingController";
import type { useAgentTickAppState } from "./useAgentTickAppState";
import type { useMobileApiClient } from "./useMobileApiClient";
import type { useMobileBillingAccessState } from "./useMobileBillingAccessState";
import type { useMobileSelectionState } from "./useMobileSelectionState";

type AgentTickAppState = ReturnType<typeof useAgentTickAppState>;

type UseAgentTickBillingControllerInput = {
  appStatusState: AgentTickAppState["appStatusState"];
  billingAccessState: ReturnType<typeof useMobileBillingAccessState>;
  billingState: AgentTickAppState["billingState"];
  connectionAccountState: AgentTickAppState["connectionAccountState"];
  sdk: ReturnType<typeof useMobileApiClient>["sdk"];
  selectionState: ReturnType<typeof useMobileSelectionState>;
};

export function useAgentTickBillingController({
  appStatusState,
  billingAccessState,
  billingState,
  connectionAccountState,
  sdk,
  selectionState,
}: UseAgentTickBillingControllerInput) {
  return useMobileBillingController({
    connectedBillingAccounts: selectionState.connectedBillingAccounts,
    connectedBillingAccountsKey: selectionState.connectedBillingAccountsKey,
    connectionTokens: connectionAccountState.connectionTokens,
    currentAccountUserID: connectionAccountState.currentAccountProfile?.userId,
    hasRequestAuth: selectionState.hasRequestAuth,
    nativeEntitlement: billingAccessState.nativeEntitlement,
    paywallConfig: billingState.paywallConfig,
    paywallLoadSequence: billingState.paywallLoadSequence,
    paywallPlacement: billingState.paywallPlacement,
    paywallVisible: billingAccessState.paywallVisible,
    runtimeAuthProvider: connectionAccountState.runtimeAuthConfig?.authProvider,
    sdk,
    serverURL: connectionAccountState.serverURL,
    settingsLoaded: appStatusState.settingsLoaded,
    setBillingAccessGraceNowMs: billingState.setBillingAccessGraceNowMs,
    setBillingAccessGraceStartedAtMs: billingState.setBillingAccessGraceStartedAtMs,
    setConnectedBillingEntitlementGrant: billingState.setConnectedBillingEntitlementGrant,
    setConnectedBillingSettled: billingState.setConnectedBillingSettled,
    setDebugPaywallVisible: billingState.setDebugPaywallVisible,
    setDiagnosticsEventCount: appStatusState.setDiagnosticsEventCount,
    setLocalStoreHostedSubscriptionActive: billingState.setLocalStoreHostedSubscriptionActive,
    setLocalStoreLifetimeUnlocked: billingState.setLocalStoreLifetimeUnlocked,
    setLocalStoreTrialPurchased: billingState.setLocalStoreTrialPurchased,
    setLocalStoreTrialStartedAt: billingState.setLocalStoreTrialStartedAt,
    setPaywallConfig: billingState.setPaywallConfig,
    setPaywallLoading: billingState.setPaywallLoading,
    setPaywallPlacement: billingState.setPaywallPlacement,
    setPersonalBillingSettled: billingState.setPersonalBillingSettled,
    setPersonalBillingStatus: billingState.setPersonalBillingStatus,
    setRevenueCatAppUserID: billingState.setRevenueCatAppUserID,
    setStoreCustomerInfo: billingState.setStoreCustomerInfo,
    setStoreEntitlementsSettled: billingState.setStoreEntitlementsSettled,
    setStoreProducts: billingState.setStoreProducts,
  });
}
