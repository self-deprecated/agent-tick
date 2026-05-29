import { translateSource } from "@agent-tick/i18n";
import type { PersonalBillingStatus } from "@self-deprecated/agent-tick-shared";

import {
  billingAccessCheckPending,
  billingAccessGraceWindowActive,
  bufferedNativeResponseAccess,
  hostedPersonalActive,
  nativeAppEntitlement,
  nativePaywallAutoDisplayKey,
  responseReadOnlyState,
  type NativeAppEntitlementGrant,
} from "../AppLogic";
import { requestUsesHostedServer } from "../mobileBillingCopy";
import { hostedServerURL, normalizeServerURL, type RuntimeAuthConfig } from "../mobileAuth";
import type { CustomerInfo, ProductKey } from "../purchases";
import type { MobileRequest } from "../requests";

export function useMobileBillingAccessState({
  billingAccessGraceNowMs,
  billingAccessGraceStartedAtMs,
  connectedBillingAccountCount,
  connectedBillingEntitlementGrant,
  connectedBillingSettled,
  currentAccountEmail,
  currentAccountUserID,
  debugPaywallVisible,
  hasRequestAuth,
  localStoreHostedSubscriptionActive,
  localStoreLifetimeUnlocked,
  localStoreTrialPurchased,
  localStoreTrialStartedAt,
  firstRealResponseBeforePaywallPending,
  paywallDismissedKey,
  personalBillingSettled,
  personalBillingStatus,
  purchaseInFlightProductKey,
  revenueCatAppUserID,
  runtimeAuthProvider,
  selected,
  serverURL,
  settingsLoaded,
  storeCustomerInfo,
  storeEntitlementsSettled,
}: {
  billingAccessGraceNowMs: number;
  billingAccessGraceStartedAtMs: number | null;
  connectedBillingAccountCount: number;
  connectedBillingEntitlementGrant: NativeAppEntitlementGrant;
  connectedBillingSettled: boolean;
  currentAccountEmail?: string;
  currentAccountUserID?: string;
  debugPaywallVisible: boolean;
  hasRequestAuth: boolean;
  localStoreHostedSubscriptionActive: boolean;
  localStoreLifetimeUnlocked: boolean;
  localStoreTrialPurchased: boolean;
  localStoreTrialStartedAt: string | null;
  firstRealResponseBeforePaywallPending: boolean;
  paywallDismissedKey: string;
  personalBillingSettled: boolean;
  personalBillingStatus: PersonalBillingStatus | null;
  purchaseInFlightProductKey: ProductKey | null;
  revenueCatAppUserID: string | null;
  runtimeAuthProvider?: RuntimeAuthConfig["authProvider"];
  selected?: MobileRequest;
  serverURL: string;
  settingsLoaded: boolean;
  storeCustomerInfo: CustomerInfo | null;
  storeEntitlementsSettled: boolean;
}) {
  const nativeEntitlement = nativeAppEntitlement({
    now: new Date(),
    trialStartedAt: personalBillingStatus?.activeEntitlements.trial7Day.purchasedAt ?? connectedBillingEntitlementGrant.trialStartedAt ?? localStoreTrialStartedAt,
    trialPurchased: Boolean(localStoreTrialPurchased || connectedBillingEntitlementGrant.trialPurchased || personalBillingStatus?.activeEntitlements.trial7Day.purchasedAt || personalBillingStatus?.purchaseAvailability.trial_7_day.reason === "trial_already_started"),
    lifetimeUnlocked: Boolean(localStoreLifetimeUnlocked || connectedBillingEntitlementGrant.lifetimeUnlocked || personalBillingStatus?.activeEntitlements.lifetimeUnlock.active || personalBillingStatus?.entitlement.appUnlockedAt),
    hostedSubscriptionActive: Boolean(connectedBillingEntitlementGrant.hostedSubscriptionActive || personalBillingStatus?.activeEntitlements.hostedPersonal.active),
  });
  const isHostedAccount = normalizeServerURL(serverURL) === normalizeServerURL(hostedServerURL);
  const selectedRequestHosted = selected ? requestUsesHostedServer(selected, serverURL) : isHostedAccount;
  const billingAccessPending = billingAccessCheckPending({
    settingsLoaded,
    hasRequestAuth,
    personalBillingSettled,
    connectedBillingSettled,
    connectedBillingAccountCount,
  });
  const billingAccessGraceActive = billingAccessGraceWindowActive({
    billingCheckPending: billingAccessPending,
    graceStartedAtMs: billingAccessGraceStartedAtMs,
    nowMs: billingAccessGraceNowMs,
  });
  const responseAccess = bufferedNativeResponseAccess({ nativeEntitlement, billingAccessGraceActive });
  const appResponsesReadOnly = responseAccess.appResponsesReadOnly;
  const hasAnyAppAccessEntitlement = Boolean(nativeEntitlement.trialPurchased || nativeEntitlement.lifetimeUnlocked || nativeEntitlement.hostedSubscriptionActive);
  const hostedPersonalCurrentlyActive = Boolean(nativeEntitlement.hostedSubscriptionActive || (personalBillingStatus ? personalBillingStatus.hostedPersonal.lifecycle === "active" : hostedPersonalActive(nativeEntitlement)));
  const entitlementSourceDiagnostics = [
    `Agent Tick: ${currentAccountUserID ?? "not signed in"}${currentAccountEmail ? ` · ${currentAccountEmail}` : ""}`,
    `RevenueCat appUserID: ${revenueCatAppUserID ?? storeCustomerInfo?.appUserID ?? "unknown"}`,
    `RevenueCat originalAppUserId: ${storeCustomerInfo?.originalAppUserId ?? "unknown"}`,
    `Local store: trial=${localStoreTrialPurchased ? "purchased" : "none"}${localStoreTrialStartedAt ? ` @ ${localStoreTrialStartedAt}` : ""}, lifetime=${localStoreLifetimeUnlocked ? "active" : "inactive"}, hosted=${localStoreHostedSubscriptionActive ? "active (diagnostic only)" : "inactive"}`,
    `Server hosted: ${personalBillingStatus?.hostedPersonal.lifecycle ?? "unknown"}, responses=${personalBillingStatus?.hostedPersonal.responsesEnabled === true ? "yes" : "no"}, routing=${personalBillingStatus?.hostedPersonal.routingEnabled === true ? "yes" : "no"}, push=${personalBillingStatus?.hostedPersonal.pushEnabled === true ? "yes" : "no"}`,
    `Decision: self-hosted=${nativeEntitlement.selfHostedResponsesUnlocked ? "unlocked" : "read-only"}, hosted=${responseAccess.hostedResponsesUnlocked ? "unlocked" : "read-only"}`,
  ];
  const selectedRequestSharedWorkspace = selected?.workspaceType === "shared";
  const selectedRequestWorkspaceResponsesEntitled = selected?.workspaceResponsesEntitled === true;
  const firstRealResponseBeforePaywallAllowed = Boolean(
    selected &&
    !selected.isTest &&
    !selectedRequestSharedWorkspace &&
    !hasAnyAppAccessEntitlement &&
    firstRealResponseBeforePaywallPending,
  );
  const responseReadOnly = responseReadOnlyState({
    appResponsesReadOnly,
    hostedRequest: selectedRequestHosted,
    hostedResponsesUnlocked: responseAccess.hostedResponsesUnlocked,
    sharedWorkspace: selectedRequestSharedWorkspace,
    workspaceResponsesEntitled: selectedRequestWorkspaceResponsesEntitled,
    requestIsTest: selected?.isTest,
    firstRealResponseBeforePaywallAllowed,
  });
  const responseAppReadOnly = responseReadOnly.appReadOnly;
  const hostedReadOnly = responseReadOnly.hostedReadOnly;
  const appAccessSettled = settingsLoaded && storeEntitlementsSettled && !billingAccessPending && !billingAccessGraceActive;
  const appPaywallKey = nativePaywallAutoDisplayKey({ nativeEntitlement, appAccessSettled, billingAccessGraceActive });
  const purchaseAccountReady = runtimeAuthProvider === "clerk" && Boolean(currentAccountUserID);
  const lifetimeAvailability = personalBillingStatus?.purchaseAvailability.lifetime_unlock;
  const paywallPurchaseUnavailable = Boolean(purchaseInFlightProductKey || (purchaseAccountReady && !personalBillingStatus));
  const paywallPurchaseUnavailableMessage = purchaseInFlightProductKey
    ? translateSource("A purchase is already in progress. Wait a few minutes, then try again.")
    : !personalBillingStatus
      ? translateSource("Purchases are still loading. Try again in a moment or open App access for details.")
      : undefined;
  const paywallVisible = Boolean(debugPaywallVisible || (appPaywallKey && paywallDismissedKey !== appPaywallKey));
  const nativePaywallVisible = paywallVisible;

  return {
    appAccessSettled,
    appPaywallKey,
    appResponsesReadOnly,
    billingAccessGraceActive,
    billingAccessPending,
    entitlementSourceDiagnostics,
    hasAnyAppAccessEntitlement,
    hostedPersonalCurrentlyActive,
    hostedReadOnly,
    firstRealResponseBeforePaywallAllowed,
    isHostedAccount,
    lifetimeAvailability,
    nativeEntitlement,
    nativePaywallVisible,
    paywallPurchaseUnavailable,
    paywallPurchaseUnavailableMessage,
    paywallVisible,
    purchaseAccountReady,
    responseAccess,
    responseAppReadOnly,
    responseReadOnly,
    selectedRequestHosted,
    selectedRequestSharedWorkspace,
    selectedRequestWorkspaceResponsesEntitled,
  };
}
