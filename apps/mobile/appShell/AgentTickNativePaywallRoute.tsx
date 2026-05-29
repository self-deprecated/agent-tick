import { Linking } from "react-native";

import type { Screen } from "../AppLogic";
import type { PaywallConfig, StoreProduct } from "../purchases";
import { NativePaywallGate } from "./NativePaywallGate";

type MaybePromise<T> = T | Promise<T>;

type AgentTickNativePaywallRouteProps = {
  appPaywallKey: string;
  hasAnyAppAccessEntitlement: boolean;
  nativePaywallVisible: boolean;
  paywallConfig: PaywallConfig | null;
  paywallPlacement: PaywallConfig["placement"];
  paywallPurchaseUnavailable: boolean;
  paywallPurchaseUnavailableMessage?: string;
  purchaseLifetimeUnlock: () => MaybePromise<void>;
  restorePurchases: () => MaybePromise<void>;
  setDebugPaywallVisible: (visible: boolean) => void;
  setPaywallDismissedKey: (key: string) => void;
  setScreen: (screen: Screen) => void;
  startTrial: () => MaybePromise<void>;
  storeProducts: StoreProduct[];
  subscribeHostedPersonal: (period: "monthly" | "yearly") => MaybePromise<void>;
};

export function AgentTickNativePaywallRoute({
  appPaywallKey,
  hasAnyAppAccessEntitlement,
  nativePaywallVisible,
  paywallConfig,
  paywallPlacement,
  paywallPurchaseUnavailable,
  paywallPurchaseUnavailableMessage,
  purchaseLifetimeUnlock,
  restorePurchases,
  setDebugPaywallVisible,
  setPaywallDismissedKey,
  setScreen,
  startTrial,
  storeProducts,
  subscribeHostedPersonal,
}: AgentTickNativePaywallRouteProps) {
  return (
    <NativePaywallGate
      visible={nativePaywallVisible}
      config={paywallConfig?.placement === paywallPlacement ? paywallConfig : null}
      products={storeProducts}
      onStartTrial={() => {
        setDebugPaywallVisible(false);
        void startTrial();
      }}
      onBuyLifetimeUnlock={() => {
        setDebugPaywallVisible(false);
        void purchaseLifetimeUnlock();
      }}
      onSubscribeHostedPersonal={(period) => {
        setDebugPaywallVisible(false);
        void subscribeHostedPersonal(period);
      }}
      onDismiss={() => {
        setDebugPaywallVisible(false);
        setPaywallDismissedKey(appPaywallKey);
      }}
      onRestorePurchases={() => {
        setDebugPaywallVisible(false);
        void restorePurchases();
      }}
      onOpenTerms={() => void Linking.openURL("https://agenttick.sh/terms")}
      onOpenPrivacy={() => void Linking.openURL("https://agenttick.sh/privacy")}
      onViewAppAccess={() => {
        setDebugPaywallVisible(false);
        setPaywallDismissedKey(appPaywallKey);
        setScreen("settings");
      }}
      purchaseUnavailable={paywallPurchaseUnavailable}
      showTrialOffer={!hasAnyAppAccessEntitlement}
      purchaseUnavailableMessage={paywallPurchaseUnavailableMessage}
    />
  );
}
