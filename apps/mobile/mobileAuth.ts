export type MobileAuthProvider = "local" | "clerk";

export const serverURLStorageKey = "agent-tick.serverURL";

export type RuntimeAuthConfig = {
  mode: "single" | "clerk" | string;
  authProvider: MobileAuthProvider | string;
  publicURL?: string;
  clerkPublishableKey?: string;
};

export async function fetchRuntimeAuthConfig(serverURL: string, fetchImpl: typeof fetch = fetch): Promise<RuntimeAuthConfig> {
  const base = normalizeServerURL(serverURL);
  const response = await fetchImpl(`${base}/v1/auth/config`);
  if (!response.ok) {
    throw new Error(`Server returned ${response.status}`);
  }
  const body = (await response.json()) as RuntimeAuthConfig;
  return {
    mode: body.mode,
    authProvider: body.authProvider,
    publicURL: body.publicURL,
    clerkPublishableKey: body.clerkPublishableKey,
  };
}

export function normalizeServerURL(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || "http://localhost:8787";
}

export function mobileSessionStorageKeys(serverURL: string) {
  const namespace = `agent-tick.session.${encodeURIComponent(normalizeServerURL(serverURL))}`;
  return {
    token: `${namespace}.token`,
    deviceID: `${namespace}.deviceID`,
    organizationID: `${namespace}.organizationID`,
    pushStatus: `${namespace}.pushStatus`,
  };
}

export function mobileSessionStorageKeyList(serverURL: string): string[] {
  const keys = mobileSessionStorageKeys(serverURL);
  return [keys.token, keys.deviceID, keys.organizationID, keys.pushStatus];
}

export function clerkTokenCacheKey(serverURL: string, publishableKey: string): string {
  return `agent-tick.clerk.${normalizeServerURL(serverURL)}.${publishableKey}`;
}
