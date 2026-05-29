import { type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { Alert, Platform } from "react-native";
import { AgentTickClient, type MeResponse } from "@self-deprecated/agent-tick-sdk";
import { type PersonalBillingStatus } from "@self-deprecated/agent-tick-shared";

import { translateSource } from "@agent-tick/i18n";
import { hostedOriginPlatformManagementCopy, purchaseAvailabilityMessage } from "../mobileBillingCopy";
import { type RuntimeAuthConfig } from "../mobileAuth";
import {
  configureLocalStorePurchases,
  configurePurchases,
  getCustomerInfo,
  openSubscriptionManagement,
  purchaseProduct as purchaseStoreProduct,
  restorePurchases as restoreStorePurchases,
  trial7DayPurchaseFromCustomerInfo,
  type ProductKey,
} from "../purchases";
import { apiCode } from "./mobileActivityHelpers";
import { mobileInstallationID } from "./mobileNotificationHelpers";

type RefreshPersonalBilling = (options?: { configureStore?: boolean }) => Promise<PersonalBillingStatus | null>;
type RefreshStoreEntitlements = (options?: { identifyHostedUser?: boolean }) => Promise<boolean>;

type UseMobilePurchaseActionsOptions = {
  currentAccountProfile: MeResponse | null;
  personalBillingStatus: PersonalBillingStatus | null;
  purchaseAccountReady: boolean;
  purchaseInFlightRef: MutableRefObject<ProductKey | null>;
  refreshPersonalBilling: RefreshPersonalBilling;
  refreshStoreEntitlements: RefreshStoreEntitlements;
  runtimeAuthProvider?: RuntimeAuthConfig["authProvider"];
  sdk: AgentTickClient;
  setPurchaseInFlightProductKey: Dispatch<SetStateAction<ProductKey | null>>;
};

export function useMobilePurchaseActions({
  currentAccountProfile,
  personalBillingStatus,
  purchaseAccountReady,
  purchaseInFlightRef,
  refreshPersonalBilling,
  refreshStoreEntitlements,
  runtimeAuthProvider,
  sdk,
  setPurchaseInFlightProductKey,
}: UseMobilePurchaseActionsOptions): {
  startTrial: () => Promise<void>;
  purchaseLifetimeUnlock: () => Promise<void>;
  restorePurchases: () => Promise<void>;
  linkPurchasesToHostedAccount: () => Promise<void>;
  subscribeHostedPersonal: (period: "monthly" | "yearly") => Promise<void>;
  manageSubscription: () => void;
} {
  const requireStorePurchasesAvailable = () => {
    if (Platform.OS !== "ios" && Platform.OS !== "android") {
      Alert.alert("Purchases unavailable", "In-app purchases are only available on iOS and Android.");
      return false;
    }
    return true;
  };

  const requireHostedPurchaseAccount = () => {
    if (runtimeAuthProvider !== "clerk" || !currentAccountProfile?.userId) {
      Alert.alert(
        translateSource("Sign in required"),
        translateSource("Sign in to hosted Agent Tick to link purchases to routing, push, history, and billing."),
      );
      return false;
    }
    return requireStorePurchasesAvailable();
  };

  const runPurchaseFlow = async (productKey: ProductKey, successTitle: string) => {
    const trialPurchase = productKey === "trial_7_day";
    const lifetimePurchase = productKey === "lifetime_unlock";
    const hostedPurchase = productKey === "hosted_personal_monthly" || productKey === "hosted_personal_yearly";
    if (!requireStorePurchasesAvailable()) {
      return;
    }
    if (purchaseInFlightRef.current) {
      Alert.alert(translateSource("Purchase unavailable"), translateSource("A purchase is already in progress. Wait a few minutes, then try again."));
      return;
    }
    if ((trialPurchase || hostedPurchase) && !requireHostedPurchaseAccount()) {
      return;
    }
    const platform = Platform.OS === "ios" ? "ios" : "android";
    const accountBoundPurchase = trialPurchase || hostedPurchase;
    purchaseInFlightRef.current = productKey;
    setPurchaseInFlightProductKey(productKey);
    let purchaseAttemptId: string | undefined;
    const cancelPurchaseAttempt = async () => {
      if (!accountBoundPurchase || !purchaseAttemptId) return;
      await sdk.cancelPurchaseAttempt({ productKey, purchaseAttemptId }).catch(() => undefined);
    };
    try {
      const latest = accountBoundPurchase ? await refreshPersonalBilling({ configureStore: false }) : null;
      const availability = latest?.purchaseAvailability[productKey];
      if (availability && !availability.allowed) {
        Alert.alert("Purchase unavailable", purchaseAvailabilityMessage(availability.reason, availability.originPlatform));
        return;
      }
      if (accountBoundPurchase) {
        const preflight = await sdk.preflightPurchase({ productKey, platform });
        purchaseAttemptId = preflight.purchaseAttemptId;
        await configurePurchases(currentAccountProfile!.userId);
      } else {
        await configureLocalStorePurchases(await mobileInstallationID());
      }
      const result = await purchaseStoreProduct(productKey);
      if (result.cancelled) {
        await cancelPurchaseAttempt();
        return;
      }
      const localLifetimeActive = await refreshStoreEntitlements({ identifyHostedUser: accountBoundPurchase });
      const customerInfo = await getCustomerInfo().catch(() => ({}));
      const localTrial = trial7DayPurchaseFromCustomerInfo(customerInfo);
      const confirmed = accountBoundPurchase ? await refreshPersonalBilling({ configureStore: false }) : null;
      const entitlementActive = trialPurchase
        ? Boolean(confirmed?.activeEntitlements.trial7Day.active || localTrial.active)
        : lifetimePurchase
          ? Boolean(localLifetimeActive || confirmed?.activeEntitlements.lifetimeUnlock.active || confirmed?.entitlement.appUnlockedAt)
          : Boolean(confirmed?.activeEntitlements.hostedPersonal.active);
      Alert.alert(
        translateSource(successTitle),
        entitlementActive
          ? trialPurchase
            ? translateSource("Trial started. Responses are unlocked for 7 days.")
            : lifetimePurchase
              ? translateSource("Purchase confirmed. Self-hosted Lifetime access is active for this app-store account.")
              : translateSource("Purchase confirmed. Hosted service is active.")
          : translateSource("Purchase received. Hosted access may take a moment to sync.")
      );
    } catch (err) {
      await cancelPurchaseAttempt();
      const message = err instanceof Error ? err.message : translateSource("Could not complete purchase");
      Alert.alert(translateSource("Purchase failed"), purchaseAvailabilityMessage(apiCode(err), undefined, message));
    } finally {
      purchaseInFlightRef.current = null;
      setPurchaseInFlightProductKey(null);
    }
  };

  const startTrial = async () => {
    await runPurchaseFlow("trial_7_day", "7-day Trial");
  };

  const purchaseLifetimeUnlock = async () => {
    await runPurchaseFlow("lifetime_unlock", "Self-hosted Lifetime");
  };

  const restorePurchases = async () => {
    if (!requireStorePurchasesAvailable()) return;
    try {
      await configureLocalStorePurchases(await mobileInstallationID());
      await restoreStorePurchases();
      const localLifetimeActive = await refreshStoreEntitlements({ identifyHostedUser: false });
      const customerInfo = await getCustomerInfo().catch(() => ({}));
      const localTrial = trial7DayPurchaseFromCustomerInfo(customerInfo);
      const status = purchaseAccountReady ? await refreshPersonalBilling({ configureStore: false }) : null;
      const hostedRestored = Boolean(status?.activeEntitlements.hostedPersonal.active);
      const trialRestored = Boolean(status?.activeEntitlements.trial7Day.active || localTrial.active);
      const lifetimeRestored = Boolean(localLifetimeActive || status?.activeEntitlements.lifetimeUnlock.active || status?.entitlement.appUnlockedAt);
      Alert.alert(
        translateSource("Restore purchases"),
        hostedRestored
          ? translateSource("Store purchases were restored and hosted service is active for this Agent Tick account.")
          : lifetimeRestored
            ? translateSource("Self-hosted Lifetime access was restored for this app-store account. Self-hosted Agent Tick responses are unlocked.")
            : trialRestored
              ? translateSource("The 7-day Trial purchase was restored. Responses are unlocked if the trial window is still active.")
              : translateSource("Restore completed, but no active entitlement was found for this app-store account.")
      );
    } catch (err) {
      Alert.alert(translateSource("Restore failed"), err instanceof Error ? err.message : translateSource("Could not restore purchases"));
    }
  };

  const linkPurchasesToHostedAccount = async () => {
    if (!requireHostedPurchaseAccount() || !currentAccountProfile?.userId) return;
    try {
      await configurePurchases(currentAccountProfile.userId);
      await restoreStorePurchases();
      const [localLifetimeActive, status] = await Promise.all([
        refreshStoreEntitlements({ identifyHostedUser: true }),
        refreshPersonalBilling({ configureStore: false }),
      ]);
      const serverLinked = Boolean(status?.activeEntitlements.trial7Day.active || status?.activeEntitlements.lifetimeUnlock.active || status?.activeEntitlements.hostedPersonal.active || status?.entitlement.appUnlockedAt);
      const hasIdentityConflict = Boolean(status?.billingConflicts?.some((conflict) => conflict.code === "receipt_owned_by_another_account"));
      Alert.alert(
        translateSource("Link purchases"),
        hasIdentityConflict
          ? translateSource("Store subscription found, but it is linked to another Agent Tick account.")
          : serverLinked
            ? translateSource("Purchases are linked to this hosted Agent Tick account.")
            : localLifetimeActive
              ? translateSource("Purchase restore succeeded locally. Agent Tick may still be waiting for the store entitlement to sync to this hosted account.")
              : translateSource("Link completed, but no active purchases were found for this app-store account."),
      );
    } catch (err) {
      Alert.alert(translateSource("Link purchases failed"), err instanceof Error ? err.message : translateSource("Could not link purchases"));
    }
  };

  const subscribeHostedPersonal = async (period: "monthly" | "yearly") => {
    await runPurchaseFlow(period === "yearly" ? "hosted_personal_yearly" : "hosted_personal_monthly", "Hosted service");
  };

  const manageSubscription = () => {
    const originPlatform = personalBillingStatus?.activeEntitlements.hostedPersonal.originPlatform;
    if (originPlatform && originPlatform !== "unknown" && originPlatform !== Platform.OS) {
      Alert.alert(
        "Manage subscription",
        hostedOriginPlatformManagementCopy(originPlatform, Platform.OS),
      );
      return;
    }
    void openSubscriptionManagement().catch((err) => {
      const label = Platform.OS === "ios" ? "Apple subscriptions" : Platform.OS === "android" ? "Google Play subscriptions" : "your app store subscriptions";
      Alert.alert("Manage subscription", err instanceof Error ? err.message : `Manage or cancel Hosted service from ${label}.`);
    });
  };

  return {
    startTrial,
    purchaseLifetimeUnlock,
    restorePurchases,
    linkPurchasesToHostedAccount,
    subscribeHostedPersonal,
    manageSubscription,
  };
}
