import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Platform } from "react-native";
import type { PersonalBillingStatus } from "@self-deprecated/agent-tick-shared";

import type { NativeAppEntitlementGrant } from "../AppLogic";
import type {
  CustomerInfo,
  PaywallConfig,
  PaywallPlacement,
  ProductKey,
  StoreProduct,
} from "../purchases";

export const localDevAppAccessStorageKey = "agent-tick.dev.app-access-unlocked";

export function useMobileBillingState() {
  const [personalBillingStatus, setPersonalBillingStatus] = useState<PersonalBillingStatus | null>(null);
  const [personalBillingSettled, setPersonalBillingSettled] = useState(false);
  const [connectedBillingEntitlementGrant, setConnectedBillingEntitlementGrant] = useState<NativeAppEntitlementGrant>({});
  const [connectedBillingSettled, setConnectedBillingSettled] = useState(false);
  const [billingAccessGraceStartedAtMs, setBillingAccessGraceStartedAtMs] = useState<number | null>(() => Date.now());
  const [billingAccessGraceNowMs, setBillingAccessGraceNowMs] = useState(() => Date.now());
  const [storeProducts, setStoreProducts] = useState<StoreProduct[]>([]);
  const [paywallConfig, setPaywallConfig] = useState<PaywallConfig | null>(null);
  const [paywallPlacement, setPaywallPlacement] = useState<PaywallPlacement>("onboarding");
  const [localStoreTrialStartedAt, setLocalStoreTrialStartedAt] = useState<string | null>(null);
  const [localStoreTrialPurchased, setLocalStoreTrialPurchased] = useState(false);
  const [localStoreLifetimeUnlocked, setLocalStoreLifetimeUnlocked] = useState(false);
  const [localStoreHostedSubscriptionActive, setLocalStoreHostedSubscriptionActive] = useState(false);
  const [localDevAppAccessUnlocked, setLocalDevAppAccessUnlockedState] = useState(false);
  const [storeCustomerInfo, setStoreCustomerInfo] = useState<CustomerInfo | null>(null);
  const [revenueCatAppUserID, setRevenueCatAppUserID] = useState<string | null>(null);
  const [storeEntitlementsSettled, setStoreEntitlementsSettled] = useState(() => Platform.OS !== "ios" && Platform.OS !== "android");
  const [paywallDismissedKey, setPaywallDismissedKey] = useState("");
  const [firstRealResponseBeforePaywallPending, setFirstRealResponseBeforePaywallPending] = useState(true);
  const [debugPaywallVisible, setDebugPaywallVisible] = useState(false);
  const [paywallLoading, setPaywallLoading] = useState(false);
  const [purchaseInFlightProductKey, setPurchaseInFlightProductKey] = useState<ProductKey | null>(null);
  const paywallLoadSequence = useRef(0);
  const purchaseInFlightRef = useRef<ProductKey | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!__DEV__) {
      setLocalDevAppAccessUnlockedState(false);
      return () => { mounted = false; };
    }
    void AsyncStorage.getItem(localDevAppAccessStorageKey).then((value) => {
      if (mounted) setLocalDevAppAccessUnlockedState(value === "1");
    });
    return () => { mounted = false; };
  }, []);

  const setLocalDevAppAccessUnlocked: Dispatch<SetStateAction<boolean>> = useCallback((next) => {
    setLocalDevAppAccessUnlockedState((current) => {
      const requested = typeof next === "function" ? next(current) : next;
      const resolved = __DEV__ ? requested : false;
      void AsyncStorage.setItem(localDevAppAccessStorageKey, resolved ? "1" : "0");
      return resolved;
    });
  }, []);

  return {
    personalBillingStatus,
    setPersonalBillingStatus,
    personalBillingSettled,
    setPersonalBillingSettled,
    connectedBillingEntitlementGrant,
    setConnectedBillingEntitlementGrant,
    connectedBillingSettled,
    setConnectedBillingSettled,
    billingAccessGraceStartedAtMs,
    setBillingAccessGraceStartedAtMs,
    billingAccessGraceNowMs,
    setBillingAccessGraceNowMs,
    storeProducts,
    setStoreProducts,
    paywallConfig,
    setPaywallConfig,
    paywallPlacement,
    setPaywallPlacement,
    localStoreTrialStartedAt,
    setLocalStoreTrialStartedAt,
    localStoreTrialPurchased,
    setLocalStoreTrialPurchased,
    localStoreLifetimeUnlocked,
    setLocalStoreLifetimeUnlocked,
    localStoreHostedSubscriptionActive,
    setLocalStoreHostedSubscriptionActive,
    localDevAppAccessUnlocked,
    setLocalDevAppAccessUnlocked,
    storeCustomerInfo,
    setStoreCustomerInfo,
    revenueCatAppUserID,
    setRevenueCatAppUserID,
    storeEntitlementsSettled,
    setStoreEntitlementsSettled,
    paywallDismissedKey,
    setPaywallDismissedKey,
    firstRealResponseBeforePaywallPending,
    setFirstRealResponseBeforePaywallPending,
    debugPaywallVisible,
    setDebugPaywallVisible,
    paywallLoading,
    setPaywallLoading,
    purchaseInFlightProductKey,
    setPurchaseInFlightProductKey,
    paywallLoadSequence,
    purchaseInFlightRef,
  };
}
