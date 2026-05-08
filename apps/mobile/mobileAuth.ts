export type MobileAuthProvider = "local" | "clerk";

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

export function clerkTokenCacheKey(serverURL: string, publishableKey: string): string {
  return `agent-tick.clerk.${normalizeServerURL(serverURL)}.${publishableKey}`;
}
