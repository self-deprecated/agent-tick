import { Platform } from "react-native";

import { translateSource } from "@agent-tick/i18n";
import { hostedServerURL, normalizeServerURL } from "./mobileAuth";
import type { StoreProduct, ProductKey } from "./purchases";
import type { MobileRequest } from "./requests";

export function priceForStoreProduct(products: StoreProduct[], productKey: ProductKey): string | undefined {
  return products.find((product) => product.productKey === productKey)?.priceString;
}

export function requestUsesHostedServer(request: MobileRequest, currentServerURL: string): boolean {
  const requestServerURL = request.connectionServerURL || currentServerURL;
  return normalizeServerURL(requestServerURL) === normalizeServerURL(hostedServerURL);
}

export function hostedOriginPlatformManagementCopy(originPlatform: string | undefined, currentPlatform: string): string {
  if (originPlatform === "ios") return translateSource("Hosted service is active via Apple. Manage it on iOS or in the App Store.");
  if (originPlatform === "android") {
    return currentPlatform === "ios"
      ? translateSource("Hosted service is active on another platform. Manage it on the platform where it was purchased.")
      : translateSource("Hosted service is active via Google. Manage it on Android or in Google Play.");
  }
  return translateSource("Hosted service is active on another app-store platform.");
}

export function purchaseAvailabilityMessage(reason: string | undefined, originPlatform?: string, fallback = translateSource("Purchase is not available right now.")): string {
  switch (reason) {
    case "already_unlocked":
      return translateSource("Lifetime app unlock is already active for this Agent Tick account.");
    case "already_subscribed":
      return translateSource("Hosted service is already active for this Agent Tick account.");
    case "active_on_other_platform":
      return hostedOriginPlatformManagementCopy(originPlatform, Platform.OS);
    case "purchase_in_progress":
      return translateSource("A purchase is already in progress. Wait a few minutes, then try again.");
    case "app_purchase_required":
      return translateSource("A qualifying app access purchase is required before this action.");
    case "trial_active":
      return translateSource("Hosted personal service is included during Trial.");
    case "trial_already_started":
      return translateSource("The 7-day Trial has already been started for this account.");
    case "billing_disabled":
      return translateSource("Purchases are not enabled on this server.");
    default:
      return fallback;
  }
}
