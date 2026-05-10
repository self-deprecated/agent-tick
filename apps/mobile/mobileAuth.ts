export type MobileAuthProvider = "local" | "clerk";

export const agentTickHostedServerURL = "https://agenttick.sh";
export const hostedServerURL = agentTickHostedServerURL;
export const selfHostedServerURLPreset = process.env.EXPO_PUBLIC_AGENT_TICK_SELF_HOSTED_SERVER_URL?.trim() ?? "";
export const serverURLStorageKey = "agent-tick.serverURL";
export const mobileAccountsStorageKey = "agent-tick.mobileAccounts";

export type SavedMobileAccount = {
  id: string;
  serverURL: string;
  authProvider: MobileAuthProvider | string;
  label: string;
  email?: string;
  signInMethod?: string;
  organizationID?: string;
  deviceID?: string;
  updatedAt: string;
};

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
  return trimmed || hostedServerURL;
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

export function savedMobileAccountID(input: Pick<SavedMobileAccount, "serverURL" | "authProvider"> & { organizationID?: string; deviceID?: string }) {
  const serverURL = normalizeServerURL(input.serverURL);
  const scope = input.organizationID?.trim() || input.deviceID?.trim() || "default";
  return `${input.authProvider}:${serverURL}:${scope}`;
}

export function normalizeSavedMobileAccounts(value: unknown): SavedMobileAccount[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const account = entry as Partial<SavedMobileAccount>;
    const serverURL = typeof account.serverURL === "string" ? normalizeServerURL(account.serverURL) : "";
    const authProvider = typeof account.authProvider === "string" ? account.authProvider : "";
    if (!serverURL || !authProvider) return [];
    const normalized: SavedMobileAccount = {
      id: typeof account.id === "string" && account.id ? account.id : savedMobileAccountID({ serverURL, authProvider, organizationID: account.organizationID, deviceID: account.deviceID }),
      serverURL,
      authProvider,
      label: typeof account.label === "string" && account.label ? account.label : accountLabel({ serverURL, authProvider, organizationID: account.organizationID, deviceID: account.deviceID }),
      updatedAt: typeof account.updatedAt === "string" && account.updatedAt ? account.updatedAt : new Date(0).toISOString(),
      ...(typeof account.email === "string" && account.email ? { email: account.email } : {}),
      ...(typeof account.signInMethod === "string" && account.signInMethod ? { signInMethod: account.signInMethod } : {}),
      ...(typeof account.organizationID === "string" && account.organizationID ? { organizationID: account.organizationID } : {}),
      ...(typeof account.deviceID === "string" && account.deviceID ? { deviceID: account.deviceID } : {}),
    };
    return [normalized];
  });
}

export function upsertSavedMobileAccount(accounts: SavedMobileAccount[], input: Omit<SavedMobileAccount, "id" | "updatedAt"> & { updatedAt?: string }) {
  const account: SavedMobileAccount = {
    ...input,
    serverURL: normalizeServerURL(input.serverURL),
    id: savedMobileAccountID(input),
    label: input.label || accountLabel(input),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
  return [account, ...accounts.filter((candidate) => candidate.id !== account.id)].slice(0, 12);
}

function accountLabel(input: Pick<SavedMobileAccount, "serverURL" | "authProvider"> & { email?: string; signInMethod?: string; organizationID?: string; deviceID?: string }) {
  if (input.authProvider === "clerk") return input.signInMethod ? `${input.signInMethod} account` : input.email ? "Account" : "agenttick.sh";
  return input.deviceID ? `${normalizeServerURL(input.serverURL)} · ${input.deviceID}` : normalizeServerURL(input.serverURL);
}

export function clerkTokenCacheKey(serverURL: string, publishableKey: string): string {
  return `agent-tick.clerk.${normalizeServerURL(serverURL)}.${publishableKey}`;
}
