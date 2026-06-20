import { AgentTickClient, type AuthConfig } from "@self-deprecated/agent-tick-sdk";

export type MobileAuthProvider = "local" | "clerk";
export type MobileConnectionAuthScheme = "clerk-bootstrap-mobile-token" | "mobile-token" | "personal-access-token" | "agent-token-bootstrap";

const defaultHostedServerURL = "https://app.agenttick.sh";

export const agentTickHostedServerURL = normalizeConfiguredServerURL(
  process.env.EXPO_PUBLIC_AGENT_TICK_HOSTED_SERVER_URL,
  defaultHostedServerURL,
);
export const hostedServerURL = agentTickHostedServerURL;
export const selfHostedServerURLPreset = process.env.EXPO_PUBLIC_AGENT_TICK_SELF_HOSTED_SERVER_URL?.trim() ?? "";
export const serverURLStorageKey = "agent-tick.serverURL";

export type MobileConnection = {
  id: string;
  serverURL: string;
  authProvider: MobileAuthProvider | string;
  authScheme: MobileConnectionAuthScheme;
  credentialRef: string;
  displayName: string;
  label: string;
  userID?: string;
  email?: string;
  signInMethod?: string;
  clerkSessionID?: string;
  workspaceID?: string;
  deviceID?: string;
  workspaces: Array<{ id: string; name: string; role?: string }>;
  capabilities: string[];
  createdAt: string;
  lastRefreshAt?: string;
  updatedAt: string;
};

export type SavedMobileAccount = Omit<MobileConnection, "authScheme" | "credentialRef" | "displayName" | "workspaces" | "capabilities" | "createdAt" | "lastRefreshAt"> & Partial<Pick<MobileConnection, "authScheme" | "credentialRef" | "displayName" | "workspaces" | "capabilities" | "createdAt" | "lastRefreshAt">>;

export type RuntimeAuthConfig = AuthConfig;

export async function fetchRuntimeAuthConfig(serverURL: string, fetchImpl: typeof fetch = fetch, policyOptions?: { allowInsecure?: boolean }): Promise<RuntimeAuthConfig> {
  const normalizedServerURL = normalizeServerURL(serverURL);
  const policyError = serverURLPolicyError(normalizedServerURL, policyOptions);
  if (policyError) throw new Error(policyError);
  return new AgentTickClient({ baseUrl: normalizedServerURL, fetch: fetchImpl }).getAuthConfig();
}

export function normalizeServerURL(value: string): string {
  return normalizeConfiguredServerURL(value, hostedServerURL);
}

/**
 * Coerces loose user input into a server URL by adding a scheme when missing.
 * Bare hostnames default to https:// (the production requirement); loopback
 * hosts (localhost / 127.0.0.1 / ::1) default to http:// for local dev.
 * Input that already includes a scheme is left untouched.
 */
export function coerceServerURLInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^(localhost(\.|:|\/|$)|127\.0\.0\.1(:|\/|$)|\[?::1\]?(:|\/|$))/i.test(trimmed)) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

/**
 * The http:// counterpart of an https:// URL, used as a fallback when the
 * https probe fails. Returns null for URLs that are not https (e.g. already
 * http, or loopback which coerce handles up front).
 */
export function httpVariantOf(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(normalizeServerURL(value));
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  parsed.protocol = "http:";
  return parsed.toString().replace(/\/$/, "");
}

/** True for plain-http non-loopback URLs — connections that need an explicit
 * insecure-connection confirmation before they are trusted. */
export function isInsecureServerURL(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(normalizeServerURL(value));
  } catch {
    return false;
  }
  return parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname);
}

export function serverURLPolicyError(value: string, options?: { allowInsecure?: boolean }): string | null {
  const normalized = normalizeServerURL(value);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return "Enter a valid Agent Tick server URL.";
  }

  if (parsed.protocol === "https:") return null;
  if (parsed.protocol !== "http:") return "Agent Tick server URLs must use HTTPS in production builds.";

  if (isLoopbackHost(parsed.hostname)) return null;
  // A non-loopback http URL is only allowed when the caller has already
  // obtained an explicit insecure-connection confirmation for it (e.g. the
  // user accepted the warning in the server picker).
  return options?.allowInsecure ? null : "Agent Tick server URLs must use HTTPS in production builds.";
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function normalizeConfiguredServerURL(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  return trimmed || fallback;
}

export function mobileSessionStorageKeys(serverURL: string) {
  const namespace = `agent-tick.session.${secureStoreKeyPart(normalizeServerURL(serverURL))}`;
  return {
    token: `${namespace}.token`,
    deviceID: `${namespace}.deviceID`,
    workspaceID: `${namespace}.workspaceID`,
    pushStatus: `${namespace}.pushStatus`,
    notificationsEnabled: `${namespace}.notificationsEnabled`,
  };
}

export function mobileSessionStorageKeyList(serverURL: string): string[] {
  const keys = mobileSessionStorageKeys(serverURL);
  return [keys.token, keys.deviceID, keys.workspaceID, keys.pushStatus, keys.notificationsEnabled];
}

export function savedMobileAccountID(input: Pick<SavedMobileAccount, "serverURL" | "authProvider"> & { userID?: string; email?: string; clerkSessionID?: string; workspaceID?: string; deviceID?: string }) {
  const serverURL = normalizeServerURL(input.serverURL);
  const scope = input.authProvider === "clerk"
    ? input.clerkSessionID?.trim() || input.userID?.trim() || input.email?.trim().toLowerCase() || "default"
    : input.userID?.trim() || input.email?.trim().toLowerCase() || input.workspaceID?.trim() || input.deviceID?.trim() || "default";
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
      id: typeof account.id === "string" && account.id ? account.id : savedMobileAccountID({ serverURL, authProvider, userID: account.userID, email: account.email, workspaceID: account.workspaceID, deviceID: account.deviceID }),
      serverURL,
      authProvider,
      authScheme: isMobileConnectionAuthScheme(account.authScheme) ? account.authScheme : defaultAuthSchemeForProvider(authProvider),
      credentialRef: typeof account.credentialRef === "string" && isSecureStoreKey(account.credentialRef) ? account.credentialRef : mobileConnectionCredentialKey(typeof account.id === "string" && account.id ? account.id : savedMobileAccountID({ serverURL, authProvider, userID: account.userID, email: account.email, workspaceID: account.workspaceID, deviceID: account.deviceID })),
      displayName: typeof account.displayName === "string" && account.displayName ? account.displayName : typeof account.label === "string" && account.label ? account.label : accountLabel({ serverURL, authProvider, email: account.email, signInMethod: account.signInMethod, workspaceID: account.workspaceID, deviceID: account.deviceID }),
      label: typeof account.label === "string" && account.label ? account.label : typeof account.displayName === "string" && account.displayName ? account.displayName : accountLabel({ serverURL, authProvider, email: account.email, signInMethod: account.signInMethod, workspaceID: account.workspaceID, deviceID: account.deviceID }),
      workspaces: normalizeConnectionWorkspaces(account.workspaces),
      capabilities: Array.isArray(account.capabilities) ? account.capabilities.filter((capability): capability is string => typeof capability === "string" && capability.length > 0) : [],
      createdAt: typeof account.createdAt === "string" && account.createdAt ? account.createdAt : typeof account.updatedAt === "string" && account.updatedAt ? account.updatedAt : new Date(0).toISOString(),
      updatedAt: typeof account.updatedAt === "string" && account.updatedAt ? account.updatedAt : new Date(0).toISOString(),
      ...(typeof account.userID === "string" && account.userID ? { userID: account.userID } : {}),
      ...(typeof account.email === "string" && account.email ? { email: account.email } : {}),
      ...(typeof account.signInMethod === "string" && account.signInMethod ? { signInMethod: account.signInMethod } : {}),
      ...(typeof account.clerkSessionID === "string" && account.clerkSessionID ? { clerkSessionID: account.clerkSessionID } : {}),
      ...(typeof account.workspaceID === "string" && account.workspaceID ? { workspaceID: account.workspaceID } : {}),
      ...(typeof account.deviceID === "string" && account.deviceID ? { deviceID: account.deviceID } : {}),
    };
    return [normalized];
  });
}

export type SavedMobileAccountInput = Omit<Partial<SavedMobileAccount>, "id" | "updatedAt"> & Pick<SavedMobileAccount, "serverURL" | "authProvider"> & { updatedAt?: string };

export function upsertSavedMobileAccount(accounts: SavedMobileAccount[], input: SavedMobileAccountInput) {
  const account = buildSavedMobileAccount(input);
  return [account, ...accounts.filter((candidate) => !sameSavedAccount(candidate, account))].slice(0, 12);
}

export function upsertSavedMobileAccountIfChanged(accounts: SavedMobileAccount[], input: SavedMobileAccountInput) {
  const comparisonAccount = buildSavedMobileAccount(input);
  const existing = accounts.find((candidate) => sameSavedAccount(candidate, comparisonAccount));
  const stableComparisonAccount = buildSavedMobileAccount({
    ...input,
    ...(existing?.createdAt ? { createdAt: existing.createdAt } : {}),
    ...(existing?.updatedAt ? { updatedAt: existing.updatedAt } : {}),
  });
  const wouldKeepOrdering = accounts[0] && sameSavedAccount(accounts[0], stableComparisonAccount);
  if (existing && wouldKeepOrdering && savedMobileAccountFingerprint(existing) === savedMobileAccountFingerprint(stableComparisonAccount)) {
    return accounts;
  }
  return [comparisonAccount, ...accounts.filter((candidate) => !sameSavedAccount(candidate, comparisonAccount))].slice(0, 12);
}

function buildSavedMobileAccount(input: SavedMobileAccountInput): SavedMobileAccount {
  const id = savedMobileAccountID(input);
  const label = input.label || accountLabel(input);
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  return {
    ...input,
    serverURL: normalizeServerURL(input.serverURL),
    id,
    authScheme: isMobileConnectionAuthScheme(input.authScheme) ? input.authScheme : defaultAuthSchemeForProvider(input.authProvider),
    credentialRef: typeof input.credentialRef === "string" && input.credentialRef ? input.credentialRef : mobileConnectionCredentialKey(id),
    displayName: typeof input.displayName === "string" && input.displayName ? input.displayName : label,
    label,
    workspaces: normalizeConnectionWorkspaces(input.workspaces),
    capabilities: Array.isArray(input.capabilities) ? input.capabilities.filter((capability): capability is string => typeof capability === "string" && capability.length > 0) : [],
    createdAt: typeof input.createdAt === "string" && input.createdAt ? input.createdAt : updatedAt,
    updatedAt,
  };
}

function savedMobileAccountFingerprint(account: SavedMobileAccount): string {
  return JSON.stringify({
    id: account.id,
    serverURL: normalizeServerURL(account.serverURL),
    authProvider: account.authProvider,
    authScheme: account.authScheme,
    credentialRef: account.credentialRef,
    displayName: account.displayName,
    label: account.label,
    workspaces: normalizeConnectionWorkspaces(account.workspaces),
    capabilities: account.capabilities ?? [],
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    userID: account.userID,
    email: account.email,
    signInMethod: account.signInMethod,
    clerkSessionID: account.clerkSessionID,
    workspaceID: account.workspaceID,
    deviceID: account.deviceID,
  });
}

function sameSavedAccount(candidate: SavedMobileAccount, account: SavedMobileAccount) {
  if (candidate.id === account.id) return true;
  if (candidate.authProvider !== account.authProvider || normalizeServerURL(candidate.serverURL) !== normalizeServerURL(account.serverURL)) return false;
  if (account.authProvider !== "clerk") return false;

  const candidateSession = candidate.clerkSessionID?.trim();
  const accountSession = account.clerkSessionID?.trim();
  if (candidateSession && accountSession) return candidateSession === accountSession;
  if (candidateSession || accountSession) return false;

  const candidateUser = candidate.userID?.trim();
  const accountUser = account.userID?.trim();
  if (candidateUser && accountUser) return candidateUser === accountUser;

  const candidateEmail = candidate.email?.trim().toLowerCase();
  const accountEmail = account.email?.trim().toLowerCase();
  if (candidateEmail && accountEmail) return candidateEmail === accountEmail;

  return false;
}

function accountLabel(input: Pick<SavedMobileAccount, "serverURL" | "authProvider"> & { email?: string; signInMethod?: string; workspaceID?: string; deviceID?: string }) {
  if (input.authProvider === "clerk") return input.signInMethod ? `${input.signInMethod} account` : input.email ? "Account" : "agenttick.sh";
  return input.deviceID ? `${normalizeServerURL(input.serverURL)} · ${input.deviceID}` : normalizeServerURL(input.serverURL);
}

function isMobileConnectionAuthScheme(value: unknown): value is MobileConnectionAuthScheme {
  return value === "clerk-bootstrap-mobile-token" || value === "mobile-token" || value === "personal-access-token" || value === "agent-token-bootstrap";
}

function defaultAuthSchemeForProvider(authProvider: string): MobileConnectionAuthScheme {
  return authProvider === "clerk" ? "clerk-bootstrap-mobile-token" : "mobile-token";
}

function normalizeConnectionWorkspaces(value: unknown): MobileConnection["workspaces"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((workspace) => {
    if (!workspace || typeof workspace !== "object") return [];
    const entry = workspace as { id?: unknown; name?: unknown; role?: unknown };
    if (typeof entry.id !== "string" || !entry.id) return [];
    return [{
      id: entry.id,
      name: typeof entry.name === "string" && entry.name ? entry.name : entry.id,
      ...(typeof entry.role === "string" && entry.role ? { role: entry.role } : {}),
    }];
  });
}

function secureStoreKeyPart(value: string): string {
  return Array.from(value, (character) => /[A-Za-z0-9.-]/.test(character) ? character : `_${character.charCodeAt(0).toString(16)}_`).join("");
}

function isSecureStoreKey(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

export function mobileConnectionCredentialKey(connectionID: string): string {
  return `agent-tick.mobileConnectionCredential.${secureStoreKeyPart(connectionID)}`;
}

export function clerkTokenCacheKey(serverURL: string, publishableKey: string): string {
  return `agent-tick.clerk.${secureStoreKeyPart(`${normalizeServerURL(serverURL)}.${publishableKey}`)}`;
}
