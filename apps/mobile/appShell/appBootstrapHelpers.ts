import Constants from "expo-constants";

import { hostedServerURL, normalizeServerURL, selfHostedServerURLPreset } from "../mobileAuth";

export function currentMobileAppVersion(): string | undefined {
  return Constants.nativeApplicationVersion ?? Constants.expoConfig?.version ?? undefined;
}

export function selfHostedInitialURL(serverURL?: string) {
  const normalized = normalizeServerURL(serverURL ?? "");
  if (normalized !== hostedServerURL) return normalized;
  return selfHostedServerURLPreset;
}
