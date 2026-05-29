import type { ComponentProps } from "react";

import type { AgentTickNativePaywallRoute } from "./AgentTickNativePaywallRoute";
import type { useMobileSettingsActionsController } from "./useMobileSettingsActionsController";

type NativePaywallRouteProps = ComponentProps<typeof AgentTickNativePaywallRoute>;
type SettingsActions = Pick<
  ReturnType<typeof useMobileSettingsActionsController>,
  | "startTrial"
  | "purchaseLifetimeUnlock"
  | "restorePurchases"
  | "subscribeHostedPersonal"
>;

export type BuildAgentTickNativePaywallRoutePropsInput = {
  appPaywallKey: NativePaywallRouteProps["appPaywallKey"];
  hasAnyAppAccessEntitlement: NativePaywallRouteProps["hasAnyAppAccessEntitlement"];
  nativePaywallVisible: NativePaywallRouteProps["nativePaywallVisible"];
  paywallConfig: NativePaywallRouteProps["paywallConfig"];
  paywallPlacement: NativePaywallRouteProps["paywallPlacement"];
  paywallPurchaseUnavailable: NativePaywallRouteProps["paywallPurchaseUnavailable"];
  paywallPurchaseUnavailableMessage: NativePaywallRouteProps["paywallPurchaseUnavailableMessage"];
  setDebugPaywallVisible: NativePaywallRouteProps["setDebugPaywallVisible"];
  setPaywallDismissedKey: NativePaywallRouteProps["setPaywallDismissedKey"];
  setScreen: NativePaywallRouteProps["setScreen"];
  settingsActions: SettingsActions;
  storeProducts: NativePaywallRouteProps["storeProducts"];
};

export function buildAgentTickNativePaywallRouteProps({
  appPaywallKey,
  hasAnyAppAccessEntitlement,
  nativePaywallVisible,
  paywallConfig,
  paywallPlacement,
  paywallPurchaseUnavailable,
  paywallPurchaseUnavailableMessage,
  setDebugPaywallVisible,
  setPaywallDismissedKey,
  setScreen,
  settingsActions,
  storeProducts,
}: BuildAgentTickNativePaywallRoutePropsInput): NativePaywallRouteProps {
  const {
    purchaseLifetimeUnlock,
    restorePurchases,
    startTrial,
    subscribeHostedPersonal,
  } = settingsActions;

  return {
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
  };
}
