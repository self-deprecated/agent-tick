import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback, useEffect } from "react";
import { Platform } from "react-native";
import { AgentTickClient } from "@self-deprecated/agent-tick-sdk";
import { type PersonalBillingStatus } from "@self-deprecated/agent-tick-shared";

import {
  BILLING_ACCESS_GRACE_MS,
  billingStatusesNativeAppEntitlementGrant,
  type NativeAppEntitlementGrant,
} from "../AppLogic";
import {
  configureLocalStorePurchases,
  configurePurchases,
  getCurrentRevenueCatAppUserID,
  getCustomerInfo,
  hostedSubscriptionActiveFromCustomerInfo,
  lifetimeUnlockActiveFromCustomerInfo,
  loadPaywallConfig,
  loadStoreProducts,
  setPurchaseCatalog,
  trial7DayPurchaseFromCustomerInfo,
  type CustomerInfo,
  type PaywallConfig,
  type PaywallPlacement,
  type StoreProduct,
} from "../purchases";
import {
  hostedServerURL,
  mobileConnectionCredentialKey,
  normalizeServerURL,
  type SavedMobileAccount,
} from "../mobileAuth";
import { diagnosticEvents, recordDiagnostic } from "../diagnostics";
import { getStoredConnectionToken } from "./mobileSessionClientHelpers";
import { mobileInstallationID } from "./mobileNotificationHelpers";

export type MobileBillingNativeEntitlement = {
  hostedSubscriptionActive: boolean;
  lifetimeUnlocked: boolean;
  trialActive: boolean;
};

export function useMobileBillingController({
  connectedBillingAccounts,
  connectedBillingAccountsKey,
  connectionTokens,
  currentAccountUserID,
  hasRequestAuth,
  nativeEntitlement,
  paywallConfig,
  paywallLoadSequence,
  paywallPlacement,
  paywallVisible,
  runtimeAuthProvider,
  sdk,
  serverURL,
  settingsLoaded,
  setBillingAccessGraceNowMs,
  setBillingAccessGraceStartedAtMs,
  setConnectedBillingEntitlementGrant,
  setConnectedBillingSettled,
  setDebugPaywallVisible,
  setDiagnosticsEventCount,
  setLocalStoreHostedSubscriptionActive,
  setLocalStoreLifetimeUnlocked,
  setLocalStoreTrialPurchased,
  setLocalStoreTrialStartedAt,
  setPaywallConfig,
  setPaywallLoading,
  setPaywallPlacement,
  setPersonalBillingSettled,
  setPersonalBillingStatus,
  setRevenueCatAppUserID,
  setStoreCustomerInfo,
  setStoreEntitlementsSettled,
  setStoreProducts,
}: {
  connectedBillingAccounts: SavedMobileAccount[];
  connectedBillingAccountsKey: string;
  connectionTokens: Record<string, string>;
  currentAccountUserID?: string;
  hasRequestAuth: boolean;
  nativeEntitlement: MobileBillingNativeEntitlement;
  paywallConfig: PaywallConfig | null;
  paywallLoadSequence: MutableRefObject<number>;
  paywallPlacement: PaywallPlacement;
  paywallVisible: boolean;
  runtimeAuthProvider?: string;
  sdk: AgentTickClient;
  serverURL: string;
  settingsLoaded: boolean;
  setBillingAccessGraceNowMs: Dispatch<SetStateAction<number>>;
  setBillingAccessGraceStartedAtMs: Dispatch<SetStateAction<number | null>>;
  setConnectedBillingEntitlementGrant: Dispatch<SetStateAction<NativeAppEntitlementGrant>>;
  setConnectedBillingSettled: Dispatch<SetStateAction<boolean>>;
  setDebugPaywallVisible: Dispatch<SetStateAction<boolean>>;
  setDiagnosticsEventCount: Dispatch<SetStateAction<number>>;
  setLocalStoreHostedSubscriptionActive: Dispatch<SetStateAction<boolean>>;
  setLocalStoreLifetimeUnlocked: Dispatch<SetStateAction<boolean>>;
  setLocalStoreTrialPurchased: Dispatch<SetStateAction<boolean>>;
  setLocalStoreTrialStartedAt: Dispatch<SetStateAction<string | null>>;
  setPaywallConfig: Dispatch<SetStateAction<PaywallConfig | null>>;
  setPaywallLoading: Dispatch<SetStateAction<boolean>>;
  setPaywallPlacement: Dispatch<SetStateAction<PaywallPlacement>>;
  setPersonalBillingSettled: Dispatch<SetStateAction<boolean>>;
  setPersonalBillingStatus: Dispatch<SetStateAction<PersonalBillingStatus | null>>;
  setRevenueCatAppUserID: Dispatch<SetStateAction<string | null>>;
  setStoreCustomerInfo: Dispatch<SetStateAction<CustomerInfo | null>>;
  setStoreEntitlementsSettled: Dispatch<SetStateAction<boolean>>;
  setStoreProducts: Dispatch<SetStateAction<StoreProduct[]>>;
}) {
  const refreshStoreEntitlements = useCallback(async (options?: { identifyHostedUser?: boolean }): Promise<boolean> => {
    if (Platform.OS !== "ios" && Platform.OS !== "android") {
      setStoreProducts([]);
      setLocalStoreLifetimeUnlocked(false);
      setStoreEntitlementsSettled(true);
      return false;
    }
    setStoreEntitlementsSettled(false);
    try {
      if (options?.identifyHostedUser && currentAccountUserID && runtimeAuthProvider === "clerk") {
        await configurePurchases(currentAccountUserID);
      } else {
        await configureLocalStorePurchases(await mobileInstallationID());
      }
      const [products, customerInfo, appUserID] = await Promise.all([
        loadStoreProducts().catch(() => []),
        getCustomerInfo().catch(() => ({})),
        getCurrentRevenueCatAppUserID().catch(() => null),
      ]);
      const lifetimeUnlocked = lifetimeUnlockActiveFromCustomerInfo(customerInfo);
      const trial = trial7DayPurchaseFromCustomerInfo(customerInfo);
      const hostedActive = hostedSubscriptionActiveFromCustomerInfo(customerInfo);
      setStoreProducts(products);
      setStoreCustomerInfo(customerInfo);
      setRevenueCatAppUserID(appUserID);
      setLocalStoreLifetimeUnlocked(lifetimeUnlocked);
      setLocalStoreTrialStartedAt(trial.active ? (trial.purchasedAt ?? null) : null);
      setLocalStoreTrialPurchased(trial.purchased);
      setLocalStoreHostedSubscriptionActive(hostedActive);
      return lifetimeUnlocked;
    } catch (err) {
      recordDiagnostic("warn", "billing", "store_entitlement_load_failed", { message: err instanceof Error ? err.message : String(err) });
      setDiagnosticsEventCount(diagnosticEvents().length);
      return false;
    } finally {
      setStoreEntitlementsSettled(true);
    }
  }, [currentAccountUserID, runtimeAuthProvider, setDiagnosticsEventCount, setLocalStoreHostedSubscriptionActive, setLocalStoreLifetimeUnlocked, setLocalStoreTrialPurchased, setLocalStoreTrialStartedAt, setRevenueCatAppUserID, setStoreCustomerInfo, setStoreEntitlementsSettled, setStoreProducts]);

  const refreshPersonalBilling = useCallback(async (options?: { configureStore?: boolean }): Promise<PersonalBillingStatus | null> => {
    if (!hasRequestAuth) {
      setPersonalBillingStatus(null);
      setPersonalBillingSettled(true);
      return null;
    }
    try {
      const status = await sdk.getPersonalBillingStatus();
      setPersonalBillingStatus(status);
      setPurchaseCatalog(status.products);
      if (options?.configureStore) {
        await refreshStoreEntitlements({ identifyHostedUser: true });
      }
      return status;
    } catch (err) {
      recordDiagnostic("warn", "billing", "personal_billing_load_failed", { message: err instanceof Error ? err.message : String(err) });
      setDiagnosticsEventCount(diagnosticEvents().length);
      setPersonalBillingStatus(null);
      return null;
    } finally {
      setPersonalBillingSettled(true);
    }
  }, [hasRequestAuth, refreshStoreEntitlements, sdk, setDiagnosticsEventCount, setPersonalBillingSettled, setPersonalBillingStatus]);

  const refreshConnectedBillingEntitlements = useCallback(async (): Promise<NativeAppEntitlementGrant> => {
    if (connectedBillingAccounts.length === 0) {
      setConnectedBillingEntitlementGrant({});
      setConnectedBillingSettled(true);
      return {};
    }
    try {
      const statuses = await Promise.all(connectedBillingAccounts.map(async (account) => {
        const connectionToken = connectionTokens[account.id] ?? (account.credentialRef ? connectionTokens[account.credentialRef] : undefined) ?? connectionTokens[mobileConnectionCredentialKey(account.id)] ?? await getStoredConnectionToken(account);
        if (!connectionToken) return null;
        const billingClient = new AgentTickClient({
          baseUrl: account.serverURL,
          tokenProvider: () => connectionToken,
          workspaceIdProvider: () => account.workspaceID || null,
        });
        return billingClient.getPersonalBillingStatus().catch(() => null);
      }));
      const grant = billingStatusesNativeAppEntitlementGrant(statuses);
      setConnectedBillingEntitlementGrant(grant);
      return grant;
    } finally {
      setConnectedBillingSettled(true);
    }
  }, [connectedBillingAccounts, connectionTokens, setConnectedBillingEntitlementGrant, setConnectedBillingSettled]);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (!hasRequestAuth) {
      setPersonalBillingSettled(true);
      setConnectedBillingSettled(true);
      setBillingAccessGraceStartedAtMs(null);
      return;
    }

    setPersonalBillingSettled(false);
    setConnectedBillingSettled(connectedBillingAccounts.length === 0);
    const startedAt = Date.now();
    setBillingAccessGraceStartedAtMs(startedAt);
    setBillingAccessGraceNowMs(startedAt);
    const timer = setTimeout(() => setBillingAccessGraceNowMs(Date.now()), BILLING_ACCESS_GRACE_MS);
    return () => clearTimeout(timer);
  }, [connectedBillingAccounts.length, connectedBillingAccountsKey, hasRequestAuth, serverURL, settingsLoaded, setBillingAccessGraceNowMs, setBillingAccessGraceStartedAtMs, setConnectedBillingSettled, setPersonalBillingSettled]);

  useEffect(() => {
    if (!settingsLoaded) return;
    void refreshConnectedBillingEntitlements();
  }, [refreshConnectedBillingEntitlements, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    void refreshStoreEntitlements({
      identifyHostedUser: runtimeAuthProvider === "clerk" && Boolean(currentAccountUserID),
    });
  }, [currentAccountUserID, refreshStoreEntitlements, runtimeAuthProvider, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded || !hasRequestAuth) {
      setPersonalBillingStatus(null);
      return;
    }
    void refreshPersonalBilling({ configureStore: false });
  }, [hasRequestAuth, refreshPersonalBilling, runtimeAuthProvider, settingsLoaded, setPersonalBillingStatus]);

  const refreshPaywall = useCallback(async (placement: PaywallPlacement) => {
    if (Platform.OS !== "ios" && Platform.OS !== "android") return;
    try {
      const activeServerMode = normalizeServerURL(serverURL) === normalizeServerURL(hostedServerURL) ? "hosted" : "self_hosted";
      const appAccessState = nativeEntitlement.hostedSubscriptionActive
        ? "hosted_active"
        : nativeEntitlement.lifetimeUnlocked
          ? "lifetime"
          : nativeEntitlement.trialActive
            ? "trial_active"
            : "read_only";
      const config = await loadPaywallConfig(placement, {
        setup_intent: placement === "hosted_gate" ? "hosted" : placement === "self_hosted_gate" ? "self_hosted" : "undecided",
        server_mode: activeServerMode,
        app_access_state: appAccessState,
      });
      setPaywallConfig(config);
      setStoreProducts(config.products);
      if (config.diagnostics) {
        recordDiagnostic("warn", "billing", "paywall_offering_fallback", { placement, message: config.diagnostics });
        setDiagnosticsEventCount(diagnosticEvents().length);
      }
    } catch (err) {
      recordDiagnostic("warn", "billing", "paywall_load_failed", { placement, message: err instanceof Error ? err.message : String(err) });
      setDiagnosticsEventCount(diagnosticEvents().length);
    }
  }, [nativeEntitlement.hostedSubscriptionActive, nativeEntitlement.lifetimeUnlocked, nativeEntitlement.trialActive, serverURL, setDiagnosticsEventCount, setPaywallConfig, setStoreProducts]);

  const showNativePaywall = useCallback((placement: PaywallPlacement) => {
    setPaywallPlacement(placement);
    setDebugPaywallVisible(true);
  }, [setDebugPaywallVisible, setPaywallPlacement]);

  useEffect(() => {
    const sequence = paywallLoadSequence.current + 1;
    paywallLoadSequence.current = sequence;
    if (!paywallVisible) {
      setPaywallLoading(false);
      return;
    }

    const hasCachedPaywall = paywallConfig?.placement === paywallPlacement && paywallConfig.products.length > 0;
    setPaywallLoading(!hasCachedPaywall);
    const fallbackTimer = setTimeout(() => {
      if (paywallLoadSequence.current === sequence) setPaywallLoading(false);
    }, 1000);

    void refreshPaywall(paywallPlacement).finally(() => {
      clearTimeout(fallbackTimer);
      if (paywallLoadSequence.current === sequence) setPaywallLoading(false);
    });

    return () => clearTimeout(fallbackTimer);
  }, [paywallPlacement, paywallVisible, refreshPaywall]);

  return { refreshConnectedBillingEntitlements, refreshStoreEntitlements, refreshPersonalBilling, showNativePaywall };
}
