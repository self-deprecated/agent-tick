import AsyncStorage from "@react-native-async-storage/async-storage";

import { fetchRuntimeAuthConfig, normalizeServerURL, type RuntimeAuthConfig } from "../mobileAuth";

const runtimeAuthConfigCachePrefix = "agent-tick.runtimeAuthConfig.";

function runtimeAuthConfigCacheKey(serverURL: string): string {
  return `${runtimeAuthConfigCachePrefix}${encodeURIComponent(normalizeServerURL(serverURL))}`;
}

function normalizeRuntimeAuthConfig(value: unknown): RuntimeAuthConfig | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<RuntimeAuthConfig>;
  if (record.authProvider !== "clerk" && record.authProvider !== "local") return null;
  if (record.mode !== "single" && record.mode !== "clerk") return null;
  return {
    mode: record.mode,
    authProvider: record.authProvider,
    ...(typeof record.publicURL === "string" ? { publicURL: record.publicURL } : {}),
    ...(typeof record.clerkPublishableKey === "string" ? { clerkPublishableKey: record.clerkPublishableKey } : {}),
    ...(typeof record.testAuth === "boolean" ? { testAuth: record.testAuth } : {}),
    ...(record.mobile && typeof record.mobile === "object" ? { mobile: record.mobile } : {}),
  };
}

export async function cachedRuntimeAuthConfig(serverURL: string): Promise<RuntimeAuthConfig | null> {
  const stored = await AsyncStorage.getItem(runtimeAuthConfigCacheKey(serverURL));
  if (!stored) return null;
  try {
    return normalizeRuntimeAuthConfig(JSON.parse(stored));
  } catch {
    return null;
  }
}

async function cacheRuntimeAuthConfig(serverURL: string, authConfig: RuntimeAuthConfig): Promise<void> {
  await AsyncStorage.setItem(runtimeAuthConfigCacheKey(serverURL), JSON.stringify(authConfig));
}

export async function writeRuntimeAuthConfigCache(serverURL: string, authConfig: RuntimeAuthConfig): Promise<void> {
  await cacheRuntimeAuthConfig(serverURL, authConfig);
}

export async function fetchRuntimeAuthConfigIfAvailable(serverURL: string): Promise<RuntimeAuthConfig | null> {
  try {
    const authConfig = await fetchRuntimeAuthConfig(serverURL);
    await cacheRuntimeAuthConfig(serverURL, authConfig);
    return authConfig;
  } catch {
    return await cachedRuntimeAuthConfig(serverURL);
  }
}
