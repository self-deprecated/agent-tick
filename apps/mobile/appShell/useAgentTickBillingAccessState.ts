import type { useAgentTickAppState } from "./useAgentTickAppState";
import { useMobileBillingAccessState } from "./useMobileBillingAccessState";
import type { useMobileSelectionState } from "./useMobileSelectionState";

type AgentTickAppState = ReturnType<typeof useAgentTickAppState>;

type UseAgentTickBillingAccessStateInput = {
  appStatusState: AgentTickAppState["appStatusState"];
  billingState: AgentTickAppState["billingState"];
  connectionAccountState: AgentTickAppState["connectionAccountState"];
  selectionState: ReturnType<typeof useMobileSelectionState>;
};

export function useAgentTickBillingAccessState({
  appStatusState,
  billingState,
  connectionAccountState,
  selectionState,
}: UseAgentTickBillingAccessStateInput) {
  return useMobileBillingAccessState({
    billingAccessGraceNowMs: billingState.billingAccessGraceNowMs,
    billingAccessGraceStartedAtMs: billingState.billingAccessGraceStartedAtMs,
    connectedBillingAccountCount: selectionState.connectedBillingAccounts.length,
    connectedBillingEntitlementGrant: billingState.connectedBillingEntitlementGrant,
    connectedBillingSettled: billingState.connectedBillingSettled,
    currentAccountEmail: connectionAccountState.currentAccountProfile?.email,
    currentAccountUserID: connectionAccountState.currentAccountProfile?.userId,
    debugPaywallVisible: billingState.debugPaywallVisible,
    hasRequestAuth: selectionState.hasRequestAuth,
    localStoreHostedSubscriptionActive: billingState.localStoreHostedSubscriptionActive,
    localDevAppAccessUnlocked: billingState.localDevAppAccessUnlocked,
    localStoreLifetimeUnlocked: billingState.localStoreLifetimeUnlocked,
    localStoreTrialPurchased: billingState.localStoreTrialPurchased,
    localStoreTrialStartedAt: billingState.localStoreTrialStartedAt,
    firstRealResponseBeforePaywallPending: billingState.firstRealResponseBeforePaywallPending,
    paywallDismissedKey: billingState.paywallDismissedKey,
    personalBillingSettled: billingState.personalBillingSettled,
    personalBillingStatus: billingState.personalBillingStatus,
    purchaseInFlightProductKey: billingState.purchaseInFlightProductKey,
    revenueCatAppUserID: billingState.revenueCatAppUserID,
    runtimeAuthProvider: connectionAccountState.runtimeAuthConfig?.authProvider,
    selected: selectionState.selected,
    serverURL: connectionAccountState.serverURL,
    settingsLoaded: appStatusState.settingsLoaded,
    storeCustomerInfo: billingState.storeCustomerInfo,
    storeEntitlementsSettled: billingState.storeEntitlementsSettled,
  });
}
