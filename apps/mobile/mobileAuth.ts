export type MobileAuthProvider = "local" | "clerk";

const defaultHostedServerURL = "https://app.agenttick.sh";

export const agentTickHostedServerURL = normalizeConfiguredServerURL(
  process.env.EXPO_PUBLIC_AGENT_TICK_HOSTED_SERVER_URL,
  defaultHostedServerURL,
);
export const hostedServerURL = agentTickHostedServerURL;
export const selfHostedServerURLPreset = process.env.EXPO_PUBLIC_AGENT_TICK_SELF_HOSTED_SERVER_URL?.trim() ?? "";
export const serverURLStorageKey = "agent-tick.serverURL";
export const mobileAccountsStorageKey = "agent-tick.mobileAccounts";

export type SavedMobileAccount = {
  id: string;
  serverURL: string;
  authProvider: MobileAuthProvider | string;
  label: string;
  userID?: string;
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
  return normalizeConfiguredServerURL(value, hostedServerURL);
}

function normalizeConfiguredServerURL(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  return trimmed || fallback;
}

export function mobileSessionStorageKeys(serverURL: string) {
  const namespace = `agent-tick.session.${encodeURIComponent(normalizeServerURL(serverURL))}`;
  return {
    token: `${namespace}.token`,
    deviceID: `${namespace}.deviceID`,
    organizationID: `${namespace}.organizationID`,
    pushStatus: `${namespace}.pushStatus`,
    notificationsEnabled: `${namespace}.notificationsEnabled`,
  };
}

export function mobileSessionStorageKeyList(serverURL: string): string[] {
  const keys = mobileSessionStorageKeys(serverURL);
  return [keys.token, keys.deviceID, keys.organizationID, keys.pushStatus, keys.notificationsEnabled];
}

export function savedMobileAccountID(input: Pick<SavedMobileAccount, "serverURL" | "authProvider"> & { userID?: string; email?: string; organizationID?: string; deviceID?: string }) {
  const serverURL = normalizeServerURL(input.serverURL);
  const scope = input.authProvider === "clerk"
    ? input.userID?.trim() || input.email?.trim().toLowerCase() || "default"
    : input.userID?.trim() || input.email?.trim().toLowerCase() || input.organizationID?.trim() || input.deviceID?.trim() || "default";
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
      id: typeof account.id === "string" && account.id ? account.id : savedMobileAccountID({ serverURL, authProvider, userID: account.userID, email: account.email, organizationID: account.organizationID, deviceID: account.deviceID }),
      serverURL,
      authProvider,
      label: typeof account.label === "string" && account.label ? account.label : accountLabel({ serverURL, authProvider, email: account.email, signInMethod: account.signInMethod, organizationID: account.organizationID, deviceID: account.deviceID }),
      updatedAt: typeof account.updatedAt === "string" && account.updatedAt ? account.updatedAt : new Date(0).toISOString(),
      ...(typeof account.userID === "string" && account.userID ? { userID: account.userID } : {}),
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
  return [account, ...accounts.filter((candidate) => !sameSavedAccount(candidate, account))].slice(0, 12);
}

function sameSavedAccount(candidate: SavedMobileAccount, account: SavedMobileAccount) {
  if (candidate.id === account.id) return true;
  if (candidate.authProvider !== account.authProvider || normalizeServerURL(candidate.serverURL) !== normalizeServerURL(account.serverURL)) return false;
  if (account.authProvider !== "clerk") return false;

  const candidateUser = candidate.userID?.trim();
  const accountUser = account.userID?.trim();
  if (candidateUser && accountUser) return candidateUser === accountUser;

  const candidateEmail = candidate.email?.trim().toLowerCase();
  const accountEmail = account.email?.trim().toLowerCase();
  if (candidateEmail && accountEmail) return candidateEmail === accountEmail;

  // Older mobile builds used organization-scoped Clerk saved accounts. Treat those
  // as duplicates once we have a real user-scoped account so organizations do not
  // appear as separate accounts in the switcher.
  return Boolean((accountUser || accountEmail) && candidate.organizationID && !candidateUser && !candidateEmail);
}

function accountLabel(input: Pick<SavedMobileAccount, "serverURL" | "authProvider"> & { email?: string; signInMethod?: string; organizationID?: string; deviceID?: string }) {
  if (input.authProvider === "clerk") return input.signInMethod ? `${input.signInMethod} account` : input.email ? "Account" : "agenttick.sh";
  return input.deviceID ? `${normalizeServerURL(input.serverURL)} · ${input.deviceID}` : normalizeServerURL(input.serverURL);
}

export function mobileAccountSessionTokenKey(accountID: string): string {
  return `agent-tick.mobileAccountSession.${encodeURIComponent(accountID)}`;
}

export function clerkTokenCacheKey(serverURL: string, publishableKey: string): string {
  return `agent-tick.clerk.${normalizeServerURL(serverURL)}.${publishableKey}`;
}
