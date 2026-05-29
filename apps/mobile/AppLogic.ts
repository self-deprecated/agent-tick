import type { PersonalBillingStatus } from "@self-deprecated/agent-tick-shared";
import type { SessionDetail, SessionSummary } from "@self-deprecated/agent-tick-sdk";
import { mobileConnectionCredentialKey, normalizeServerURL, savedMobileAccountID, type SavedMobileAccount } from "./mobileAuth";

export type Screen = "requests" | "history" | "settings" | "scanner";

type CurrentSavedAccountContext = {
  authProvider?: string;
  clerkSessionID?: string | null;
  currentAccountProfile?: { userId?: string | null; email?: string | null } | null;
  deviceID?: string;
  selectedWorkspaceID?: string;
  serverURL: string;
};

export function currentSavedAccounts(accounts: SavedMobileAccount[], current: CurrentSavedAccountContext): SavedMobileAccount[] {
  return accounts.filter((account) => isCurrentSavedAccount(account, current));
}

export function isCurrentSavedAccount(account: SavedMobileAccount, current: CurrentSavedAccountContext): boolean {
  if (account.authProvider !== current.authProvider || normalizeServerURL(account.serverURL) !== normalizeServerURL(current.serverURL)) return false;
  if (account.authProvider === "clerk") {
    if (account.clerkSessionID && current.clerkSessionID) return account.clerkSessionID === current.clerkSessionID;
    if (account.clerkSessionID && !current.clerkSessionID) return false;
    if (account.userID && current.currentAccountProfile?.userId) return account.userID === current.currentAccountProfile.userId;
    if (account.email && current.currentAccountProfile?.email) return account.email.trim().toLowerCase() === current.currentAccountProfile.email.trim().toLowerCase();
    return false;
  }
  if (account.deviceID && current.deviceID) return account.deviceID === current.deviceID;
  return Boolean(account.workspaceID && account.workspaceID === current.selectedWorkspaceID);
}

type HostedAccountDeletionCleanupContext = {
  serverURL: string;
  deletedUserID?: string | null;
  deletedEmail?: string | null;
  deletedClerkSessionID?: string | null;
};

export function hostedAccountDeletionLocalCleanup(accounts: SavedMobileAccount[], deletion: HostedAccountDeletionCleanupContext) {
  const removedAccounts = accounts.filter((account) => isDeletedHostedAccount(account, deletion));
  const removedAccountIDs = new Set(removedAccounts.map((account) => account.id));
  const credentialKeys = new Set<string>();

  for (const account of removedAccounts) {
    if (account.credentialRef) credentialKeys.add(account.credentialRef);
    credentialKeys.add(mobileConnectionCredentialKey(account.id));
  }

  const deletedUserID = deletion.deletedUserID?.trim();
  if (deletedUserID) {
    credentialKeys.add(mobileConnectionCredentialKey(savedMobileAccountID({
      serverURL: deletion.serverURL,
      authProvider: "clerk",
      userID: deletedUserID,
      clerkSessionID: deletion.deletedClerkSessionID || undefined,
    })));
    credentialKeys.add(mobileConnectionCredentialKey(savedMobileAccountID({
      serverURL: deletion.serverURL,
      authProvider: "clerk",
      userID: deletedUserID,
    })));
  }

  return {
    remainingAccounts: accounts.filter((account) => !removedAccountIDs.has(account.id)),
    removedAccounts,
    removedAccountIDs,
    credentialKeys: Array.from(credentialKeys),
  };
}

function isDeletedHostedAccount(account: SavedMobileAccount, deletion: HostedAccountDeletionCleanupContext): boolean {
  if (account.authProvider !== "clerk" || normalizeServerURL(account.serverURL) !== normalizeServerURL(deletion.serverURL)) return false;
  const deletedUserID = deletion.deletedUserID?.trim();
  const deletedEmail = deletion.deletedEmail?.trim().toLowerCase();
  if (deletedUserID && account.userID?.trim() === deletedUserID) return true;
  if (deletedEmail && account.email?.trim().toLowerCase() === deletedEmail) return true;
  return Boolean(account.clerkSessionID && deletion.deletedClerkSessionID && account.clerkSessionID === deletion.deletedClerkSessionID);
}

export type ConnectionWorkspaceClient = {
  listWorkspaces: () => Promise<Array<{ workspaceId?: string | null; id?: string | null }>>;
};

export async function resolveConnectionWorkspaceIDs(
  account: Pick<SavedMobileAccount, "authProvider" | "workspaceID" | "workspaces">,
  client?: ConnectionWorkspaceClient,
  fallbackWorkspaceID = "",
): Promise<Array<string | null>> {
  if (client) {
    try {
      const memberships = await client.listWorkspaces();
      const liveWorkspaceIDs = memberships
        .map((membership) => (membership.workspaceId || membership.id || "").trim())
        .filter(Boolean);
      if (liveWorkspaceIDs.length > 0) return Array.from(new Set(liveWorkspaceIDs));
    } catch {
      // Fall back to saved connection metadata when an older/self-hosted server
      // cannot list workspace memberships for this credential.
    }
  }

  const savedWorkspaceIDs = (account.workspaces ?? [])
    .map((workspace) => workspace.id.trim())
    .filter(Boolean);
  if (savedWorkspaceIDs.length > 0) return Array.from(new Set(savedWorkspaceIDs));

  const fallback = (account.workspaceID || fallbackWorkspaceID).trim();
  return [fallback || null];
}

export async function loadConnectionWorkspaceValues<T>(
  workspaceIDs: Array<string | null>,
  loadWorkspace: (workspaceID: string | null) => Promise<T>,
): Promise<{ values: Array<{ workspaceID: string | null; value: T }>; failedCount: number }> {
  const results = await Promise.allSettled(workspaceIDs.map(async (workspaceID) => ({
    workspaceID,
    value: await loadWorkspace(workspaceID),
  })));
  return {
    values: results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
    failedCount: results.filter((result) => result.status === "rejected").length,
  };
}

export function flattenConnectionWorkspaceActivities<TAccount>(
  account: TAccount,
  workspaceValues: Array<{ workspaceID: string | null; value: { activity: unknown[]; requests: unknown[]; workspaceMemberCount?: number; sessions?: unknown[] } }>,
): Array<{ account: TAccount; workspaceID: string | null; activity: unknown[]; requests: unknown[]; workspaceMemberCount?: number; sessions: unknown[] }> {
  return workspaceValues.map(({ workspaceID, value }) => ({
    account,
    workspaceID,
    activity: value.activity,
    requests: value.requests,
    ...(value.workspaceMemberCount === undefined ? {} : { workspaceMemberCount: value.workspaceMemberCount }),
    sessions: value.sessions ?? [],
  }));
}

export type MobileSessionKeyInput = {
  sessionId: string;
  connectionID?: string | null;
  workspaceID?: string | null;
};

export function mobileSessionKey(input: MobileSessionKeyInput): string {
  const sessionId = input.sessionId.trim();
  const connectionID = input.connectionID?.trim();
  const workspaceID = input.workspaceID?.trim();
  if (!connectionID && !workspaceID) return sessionId;
  return [connectionID || "current", workspaceID || "default", sessionId].map(encodeMobileSessionKeyPart).join(":");
}

export function isMobileSessionDetailFresh(summary: Pick<SessionSummary, "updatedAt" | "latestActivity">, detail?: Pick<SessionDetail, "summary"> | null): boolean {
  if (!detail) return false;
  return mobileSessionFreshnessKey(summary) === mobileSessionFreshnessKey(detail.summary);
}

function mobileSessionFreshnessKey(summary: Pick<SessionSummary, "updatedAt" | "latestActivity">): string {
  return [summary.updatedAt, summary.latestActivity.id, summary.latestActivity.createdAt].join(":");
}

function encodeMobileSessionKeyPart(value: string): string {
  return encodeURIComponent(value).replace(/%/g, "~");
}

export function requestLoadConnectionStatus(input: {
  successfulConnectionCount: number;
  fallbackAttempted: boolean;
  fallbackSucceeded: boolean;
}): "connected" | "disconnected" {
  return input.successfulConnectionCount > 0 || (input.fallbackAttempted && input.fallbackSucceeded)
    ? "connected"
    : "disconnected";
}

export function shouldFallbackToBootstrapHistory(input: {
  savedAccountCount: number;
  connectionResultSummaries: Array<{ status: "fulfilled"; failedCount: number; valueCount: number } | { status: "rejected" }>;
  connectionHistoryCount: number;
}): boolean {
  if (input.connectionHistoryCount > 0) return false;
  if (input.savedAccountCount === 0) return true;
  return input.connectionResultSummaries.every((result) => result.status === "fulfilled" && result.failedCount === 0 && result.valueCount === 0);
}

export type RealtimeErrorDecision = {
  disableRealtime: boolean;
  diagnosticMessage: "long_poll_unavailable" | "long_poll_auth_failed" | "stream_error";
};

export function realtimeErrorDecision(status?: number): RealtimeErrorDecision {
  if (status === 404) return { disableRealtime: true, diagnosticMessage: "long_poll_unavailable" };
  if (status === 401 || status === 403) return { disableRealtime: true, diagnosticMessage: "long_poll_auth_failed" };
  return { disableRealtime: false, diagnosticMessage: "stream_error" };
}

export type MobileUpdatePolicy = {
  minimumSupportedVersion?: string;
  updateURL?: string;
  message?: string;
};

export type MobileUpdateStatus =
  | { supported: true }
  | { supported: false; minimumSupportedVersion: string; currentVersion?: string; updateURL?: string; message: string };

export function mobileUpdateStatus(policy: MobileUpdatePolicy | null | undefined, currentVersion: string | null | undefined): MobileUpdateStatus {
  const minimumSupportedVersion = policy?.minimumSupportedVersion?.trim();
  if (!minimumSupportedVersion) return { supported: true };
  const comparison = compareAppVersions(currentVersion, minimumSupportedVersion);
  if (comparison === null || comparison >= 0) return { supported: true };
  return {
    supported: false,
    minimumSupportedVersion,
    ...(currentVersion?.trim() ? { currentVersion: currentVersion.trim() } : {}),
    ...(policy?.updateURL ? { updateURL: policy.updateURL } : {}),
    message: policy?.message?.trim() || "This version of Agent Tick is no longer supported. Update the app to continue."
  };
}

export function compareAppVersions(currentVersion: string | null | undefined, minimumSupportedVersion: string | null | undefined): number | null {
  const current = appVersionParts(currentVersion);
  const minimum = appVersionParts(minimumSupportedVersion);
  if (!current || !minimum) return null;
  const length = Math.max(current.length, minimum.length);
  for (let index = 0; index < length; index += 1) {
    const left = current[index] ?? 0;
    const right = minimum[index] ?? 0;
    if (left !== right) return left > right ? 1 : -1;
  }
  return 0;
}

function appVersionParts(value: string | null | undefined): number[] | null {
  const core = value?.trim().split(/[+-]/, 1)[0];
  if (!core) return null;
  const match = core.match(/\d+(?:\.\d+)*/);
  if (!match) return null;
  return match[0].split(".").map((part) => Number(part));
}

export const NATIVE_APP_TRIAL_DAYS = 7;
export const BILLING_ACCESS_GRACE_MS = 5_000;

export type NativeAppEntitlementInput = {
  now: Date;
  trialStartedAt?: string | null;
  trialPurchased?: boolean;
  lifetimeUnlocked?: boolean;
  hostedSubscriptionActive?: boolean;
};

export type NativeAppEntitlementState = {
  trialStartedAt?: string;
  trialEndsAt?: string;
  trialRemainingMs: number;
  trialActive: boolean;
  trialPurchased: boolean;
  lifetimeUnlocked: boolean;
  hostedSubscriptionActive: boolean;
  appResponsesUnlocked: boolean;
  selfHostedResponsesUnlocked: boolean;
  hostedResponsesUnlocked: boolean;
  readOnly: boolean;
};

export type NativeAppEntitlementGrant = Omit<NativeAppEntitlementInput, "now">;

const DAY_MS = 24 * 60 * 60 * 1000;

export function billingStatusesNativeAppEntitlementGrant(statuses: Array<PersonalBillingStatus | null | undefined>): NativeAppEntitlementGrant {
  const grant: NativeAppEntitlementGrant = {};
  for (const status of statuses) {
    if (!status) continue;
    const trial = status.activeEntitlements.trial7Day;
    if (trial.purchasedAt) grant.trialPurchased = true;
    if (trial.active && trial.purchasedAt && !grant.trialStartedAt) grant.trialStartedAt = trial.purchasedAt;
    if (status.activeEntitlements.lifetimeUnlock.active || status.entitlement.appUnlockedAt) grant.lifetimeUnlocked = true;
    if (status.activeEntitlements.hostedPersonal.active) grant.hostedSubscriptionActive = true;
  }
  return grant;
}

export function trialEndsAt(trialStartedAt: string): string {
  return new Date(new Date(trialStartedAt).getTime() + NATIVE_APP_TRIAL_DAYS * DAY_MS).toISOString();
}

export function nativeAppEntitlement(input: NativeAppEntitlementInput): NativeAppEntitlementState {
  const trialStartedAt = input.trialStartedAt || undefined;
  const trialEnd = trialStartedAt ? trialEndsAt(trialStartedAt) : undefined;
  const trialRemainingMs = trialEnd ? Math.max(0, new Date(trialEnd).getTime() - input.now.getTime()) : 0;
  const trialActive = trialRemainingMs > 0;
  const trialPurchased = input.trialPurchased === true || Boolean(trialStartedAt);
  const lifetimeUnlocked = input.lifetimeUnlocked === true;
  const hostedSubscriptionActive = input.hostedSubscriptionActive === true;
  const appResponsesUnlocked = trialActive || lifetimeUnlocked || hostedSubscriptionActive;
  const selfHostedResponsesUnlocked = appResponsesUnlocked;
  const hostedResponsesUnlocked = trialActive || hostedSubscriptionActive;
  return {
    ...(trialStartedAt ? { trialStartedAt } : {}),
    ...(trialEnd ? { trialEndsAt: trialEnd } : {}),
    trialRemainingMs,
    trialActive,
    trialPurchased,
    lifetimeUnlocked,
    hostedSubscriptionActive,
    appResponsesUnlocked,
    selfHostedResponsesUnlocked,
    hostedResponsesUnlocked,
    readOnly: !appResponsesUnlocked,
  };
}

export function trialRemainingLabel(remainingMs: number): string {
  if (remainingMs <= 0) return "Trial ended";
  const days = Math.ceil(remainingMs / DAY_MS);
  return `${days} ${days === 1 ? "day" : "days"} left in trial`;
}

export function hostedPersonalActive(state: NativeAppEntitlementState): boolean {
  return state.trialActive || state.hostedSubscriptionActive;
}

export function billingAccessCheckPending(input: { settingsLoaded: boolean; hasRequestAuth: boolean; personalBillingSettled: boolean; connectedBillingSettled: boolean; connectedBillingAccountCount: number }): boolean {
  if (!input.settingsLoaded) return true;
  if (!input.hasRequestAuth) return false;
  if (!input.personalBillingSettled) return true;
  return input.connectedBillingAccountCount > 0 && !input.connectedBillingSettled;
}

export function billingAccessGraceWindowActive(input: { billingCheckPending: boolean; graceStartedAtMs: number | null; nowMs: number; graceMs?: number }): boolean {
  if (!input.billingCheckPending || input.graceStartedAtMs === null) return false;
  return input.nowMs - input.graceStartedAtMs < (input.graceMs ?? BILLING_ACCESS_GRACE_MS);
}

export function bufferedNativeResponseAccess(input: { nativeEntitlement: Pick<NativeAppEntitlementState, "readOnly" | "hostedResponsesUnlocked">; billingAccessGraceActive: boolean }): { appResponsesReadOnly: boolean; hostedResponsesUnlocked: boolean } {
  return {
    appResponsesReadOnly: input.nativeEntitlement.readOnly && !input.billingAccessGraceActive,
    hostedResponsesUnlocked: input.nativeEntitlement.hostedResponsesUnlocked || input.billingAccessGraceActive,
  };
}

export function nativePaywallAutoDisplayKey(input: {
  nativeEntitlement: Pick<NativeAppEntitlementState, "readOnly" | "trialEndsAt">;
  appAccessSettled: boolean;
  billingAccessGraceActive: boolean;
}): string {
  if (!input.appAccessSettled || input.billingAccessGraceActive || !input.nativeEntitlement.readOnly) return "";
  // Do not auto-open the paywall for brand-new app access. Onboarding should
  // reach a first real Request response before introducing the Trial/paywall.
  return input.nativeEntitlement.trialEndsAt ?? "";
}

export function responseReadOnlyState(input: { appResponsesReadOnly: boolean; hostedRequest: boolean; hostedResponsesUnlocked: boolean; sharedWorkspace: boolean; workspaceResponsesEntitled: boolean; requestIsTest?: boolean; firstRealResponseBeforePaywallAllowed?: boolean }): { appReadOnly: boolean; hostedReadOnly: boolean; workspaceReadOnly: boolean; readOnly: boolean } {
  if (input.requestIsTest) return { appReadOnly: false, hostedReadOnly: false, workspaceReadOnly: false, readOnly: false };
  const personalPaywallBypass = !input.sharedWorkspace && input.firstRealResponseBeforePaywallAllowed === true;
  const workspaceReadOnly = input.sharedWorkspace && !input.workspaceResponsesEntitled;
  const appReadOnly = !input.sharedWorkspace && input.appResponsesReadOnly && !personalPaywallBypass;
  const hostedReadOnly = !input.sharedWorkspace && input.hostedRequest && !input.hostedResponsesUnlocked && !personalPaywallBypass;
  return { appReadOnly, hostedReadOnly, workspaceReadOnly, readOnly: appReadOnly || hostedReadOnly || workspaceReadOnly };
}

export type HostedUsageExpirySource = "trial" | "subscription" | "read_only_grace";

export type HostedUsageExpiry = {
  expiresAt: string;
  source: HostedUsageExpirySource;
  renewable: boolean;
};

export function hostedUsageExpiry(status: Pick<PersonalBillingStatus, "hostedPersonal" | "activeEntitlements">, now = new Date()): HostedUsageExpiry | null {
  const trial = status.activeEntitlements.trial7Day;
  if (trial.active && trial.expiresAt) {
    return { expiresAt: trial.expiresAt, source: "trial", renewable: false };
  }
  const subscription = status.activeEntitlements.hostedPersonal;
  if (subscription.active && subscription.expiresAt) {
    return { expiresAt: subscription.expiresAt, source: "subscription", renewable: subscription.willRenew === true };
  }

  const hosted = status.hostedPersonal;
  if (hosted.lifecycle === "active") {
    if (hosted.hostedSubscriptionEndsAt && new Date(hosted.hostedSubscriptionEndsAt).getTime() > now.getTime()) {
      return { expiresAt: hosted.hostedSubscriptionEndsAt, source: "subscription", renewable: false };
    }
    if (trial.active && new Date(hosted.trialEndsAt).getTime() > now.getTime()) {
      return { expiresAt: hosted.trialEndsAt, source: "trial", renewable: false };
    }
  }

  if (hosted.lifecycle === "read_only_grace" && hosted.readOnlyGraceEndsAt) {
    return { expiresAt: hosted.readOnlyGraceEndsAt, source: "read_only_grace", renewable: false };
  }
  return null;
}

export function hostedUsageExpiryWarning(status: Pick<PersonalBillingStatus, "hostedPersonal" | "activeEntitlements">, now = new Date(), warningWindowMs = 7 * DAY_MS): HostedUsageExpiry | null {
  const expiry = hostedUsageExpiry(status, now);
  if (!expiry || expiry.renewable) return null;
  const remainingMs = new Date(expiry.expiresAt).getTime() - now.getTime();
  return remainingMs > 0 && remainingMs <= warningWindowMs ? expiry : null;
}

export function formatHostedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export type EntitlementStatusCopy = {
  title: string;
  summary: string;
  appAccess: string;
  hostedAccess: string;
  paywall: string;
};

export function entitlementStatusCopy(state: Pick<NativeAppEntitlementState, "trialActive" | "trialPurchased" | "lifetimeUnlocked" | "readOnly" | "hostedSubscriptionActive" | "trialRemainingMs">): EntitlementStatusCopy {
  const remaining = trialRemainingLabel(state.trialRemainingMs);
  if (state.hostedSubscriptionActive && state.lifetimeUnlocked) {
    return {
      title: "Hosted service active",
      summary: "Your Hosted subscription and Self-hosted Lifetime unlock are active.",
      appAccess: "You can respond to Requests from hosted or self-hosted Agent Tick servers.",
      hostedAccess: "agenttick.sh routing, push, updates, and uptime are covered by your hosted subscription.",
      paywall: "Manage or cancel the hosted subscription from the app store when needed.",
    };
  }
  if (state.hostedSubscriptionActive) {
    return {
      title: "Hosted service active",
      summary: "Your Hosted subscription is active.",
      appAccess: "You can respond to hosted and self-hosted Requests while the subscription is active.",
      hostedAccess: "agenttick.sh routing, push, updates, and uptime are covered by your hosted subscription.",
      paywall: "Buy Self-hosted Lifetime only if you want self-hosted responses after the subscription ends.",
    };
  }
  if (state.lifetimeUnlocked) {
    return {
      title: "Self-hosted Lifetime active",
      summary: "Self-hosted Lifetime is active on this App Store account.",
      appAccess: "You can keep using the app with self-hosted servers without another app purchase.",
      hostedAccess: "Your hosted Agent Tick account is separate and still needs an active Trial or Hosted subscription for hosted service.",
      paywall: "Subscribe when you want first-party hosted routing, push, updates, and uptime.",
    };
  }
  if (state.trialActive) {
    return {
      title: "7-day Trial active",
      summary: remaining,
      appAccess: "Trial includes hosted and self-hosted responses.",
      hostedAccess: "Hosted routing and push are available until the trial ends.",
      paywall: "Subscribe to Hosted service or buy Self-hosted Lifetime before the trial ends to keep responding.",
    };
  }
  return {
    title: state.trialPurchased ? "Read-only after Trial" : "Read-only",
    summary: state.trialPurchased ? "Trial ended. Viewing, settings, purchase, and restore stay available." : "Viewing, settings, purchase, and restore are available. Responses require access.",
    appAccess: "Responses require an active 7-day Trial, Hosted subscription, or Self-hosted Lifetime unlock.",
    hostedAccess: "Hosted service requires an active 7-day Trial or Hosted subscription.",
    paywall: "Unlock responses to answer Requests again.",
  };
}

export type PairingPayload = {
  serverURL?: string;
  pairingCode?: string;
  mode?: "single" | "clerk" | string;
  authProvider?: "local" | "clerk" | string;
  workspaceId?: string;
  externalApproverInviteToken?: string;
};

export type SessionDeepLinkTarget = {
  sessionID: string;
  requestID?: string;
  statusUpdateID?: string;
  workspaceID?: string;
  serverURL?: string;
};

type NotificationResponseLike = {
  actionIdentifier?: string | null;
  notification?: {
    request?: {
      content?: {
        data?: unknown;
      } | null;
    } | null;
  } | null;
};

type NotificationDecision =
  | { kind: "open-session"; sessionID: string; requestID?: string; statusUpdateID?: string; connectionID?: string; workspaceID?: string }
  | { kind: "open"; requestID: string; connectionID?: string; workspaceID?: string };

type NotificationFallbackState = {
  notificationTargetID: string;
  selectedID: string;
  screen: Screen;
  sessionTarget?: SessionDeepLinkTarget;
};

export function parsePairingPayload(value: string): PairingPayload {
  try {
    const parsed = JSON.parse(value) as PairingPayload;
    return compactPairingPayload({
      serverURL: parsed.serverURL,
      pairingCode: parsed.pairingCode,
      mode: parsed.mode,
      authProvider: parsed.authProvider,
      workspaceId: parsed.workspaceId,
      externalApproverInviteToken: parsed.externalApproverInviteToken,
    });
  } catch {
    if (value.startsWith("pair_")) return { pairingCode: value };
    const urlPayload = parseAgentTickURLPayload(value);
    return urlPayload ? compactPairingPayload(urlPayload) : {};
  }
}

export function parseSessionDeepLinkTarget(value: string): SessionDeepLinkTarget | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const actionPath = agentTickURLActionPath(url);
  const sessionFromPath = /\/(?:activity|session|sessions)\/([^/?#]+)/.exec(actionPath)?.[1];
  const sessionID = url.searchParams.get("session") || url.searchParams.get("sessionId") || url.searchParams.get("sessionID") || sessionFromPath || undefined;
  if (!sessionID?.trim()) return null;
  const requestID = url.searchParams.get("request") || url.searchParams.get("requestId") || url.searchParams.get("requestID") || undefined;
  const statusUpdateID = url.searchParams.get("statusUpdate") || url.searchParams.get("statusUpdateId") || url.searchParams.get("statusUpdateID") || undefined;
  const workspaceID = url.searchParams.get("workspaceId") || url.searchParams.get("workspaceID") || url.searchParams.get("workspace") || undefined;
  const serverURL = url.protocol === "http:" || url.protocol === "https:" ? url.origin : url.searchParams.get("serverURL") || url.searchParams.get("server") || undefined;
  return compactSessionDeepLinkTarget({ sessionID: decodeURIComponent(sessionID), requestID: requestID ? decodeURIComponent(requestID) : undefined, statusUpdateID: statusUpdateID ? decodeURIComponent(statusUpdateID) : undefined, workspaceID: workspaceID ? decodeURIComponent(workspaceID) : undefined, serverURL });
}

export function webActivitySessionURL(baseURL: string, target: Pick<SessionDeepLinkTarget, "sessionID" | "requestID" | "workspaceID">): string {
  const url = new URL("/activity", normalizeServerURL(baseURL));
  url.searchParams.set("session", target.sessionID);
  if (target.requestID) url.searchParams.set("request", target.requestID);
  if (target.workspaceID) url.searchParams.set("workspaceId", target.workspaceID);
  return url.toString();
}

function parseAgentTickURLPayload(value: string): PairingPayload | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const serverURL = url.protocol === "http:" || url.protocol === "https:" ? url.origin : url.searchParams.get("serverURL") || url.searchParams.get("server") || undefined;
  const actionPath = agentTickURLActionPath(url);
  const inviteToken = url.searchParams.get("token") || url.searchParams.get("invite") || (/\/external-approver-invites\/([^/?#]+)/.exec(actionPath)?.[1]);
  if (inviteToken?.startsWith("xinv_") || actionPath.startsWith("/join-external-approver") || actionPath.startsWith("/external-approver-invites/")) {
    return {
      ...(serverURL ? { serverURL } : {}),
      externalApproverInviteToken: decodeURIComponent(inviteToken ?? ""),
    };
  }

  const pairingCode = url.searchParams.get("pairingCode") || url.searchParams.get("pairing_code") || (/\/(?:pair|pairing)\/([^/?#]+)/.exec(actionPath)?.[1]) || (url.searchParams.get("token")?.startsWith("pair_") ? url.searchParams.get("token") : null);
  if (pairingCode?.startsWith("pair_") || actionPath.startsWith("/pair") || actionPath.startsWith("/pairing")) {
    return {
      ...(serverURL ? { serverURL } : {}),
      pairingCode: decodeURIComponent(pairingCode ?? ""),
      ...(url.searchParams.get("workspaceId") ? { workspaceId: url.searchParams.get("workspaceId") ?? undefined } : {}),
    };
  }

  const workspaceId = url.searchParams.get("workspaceId") || url.searchParams.get("workspace_id") || undefined;
  const authProvider = url.searchParams.get("authProvider") || url.searchParams.get("auth_provider") || undefined;
  const mode = url.searchParams.get("mode") || undefined;
  if (serverURL && (workspaceId || authProvider || mode)) {
    return { serverURL, ...(workspaceId ? { workspaceId } : {}), ...(authProvider ? { authProvider } : {}), ...(mode ? { mode } : {}) };
  }

  return null;
}

function agentTickURLActionPath(url: URL): string {
  if (url.protocol === "agenttick:") {
    const hostPath = url.hostname ? `/${url.hostname}` : "";
    return `${hostPath}${url.pathname}` || "/";
  }
  return url.pathname || "/";
}

function compactPairingPayload(payload: PairingPayload): PairingPayload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, field]) => typeof field === "string" && field.trim()),
  ) as PairingPayload;
}

function compactSessionDeepLinkTarget(target: SessionDeepLinkTarget): SessionDeepLinkTarget {
  return Object.fromEntries(
    Object.entries(target).filter(([, field]) => typeof field === "string" && field.trim()),
  ) as SessionDeepLinkTarget;
}

export function notificationDecision(
  response: NotificationResponseLike,
): NotificationDecision | null {
  const data = response.notification?.request?.content?.data;
  const requestID = notificationRequestID(data);
  const sessionID = notificationSessionID(data);
  const statusUpdateID = notificationStatusUpdateID(data);
  if (!requestID && !sessionID && !statusUpdateID) {
    return null;
  }
  const connectionID = notificationConnectionID(data);
  const workspaceID = notificationWorkspaceID(data);
  if (sessionID) {
    return {
      kind: "open-session",
      sessionID,
      ...(requestID ? { requestID } : {}),
      ...(statusUpdateID ? { statusUpdateID } : {}),
      ...(connectionID ? { connectionID } : {}),
      ...(workspaceID ? { workspaceID } : {}),
    };
  }
  if (!requestID) return null;
  return { kind: "open", requestID, ...(connectionID ? { connectionID } : {}), ...(workspaceID ? { workspaceID } : {}) };
}

export function localNotificationRequestData(requestID: string, connectionID?: string, workspaceID?: string, sessionID?: string) {
  return { requestId: requestID, ...(connectionID ? { connectionID } : {}), ...(workspaceID ? { workspaceID } : {}), ...(sessionID ? { sessionID } : {}) };
}

export function notificationRequestID(data: unknown) {
  if (!data || typeof data !== "object") {
    return "";
  }
  const fields = data as Record<string, unknown>;
  for (const key of ["requestId", "requestID"]) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

export function notificationSessionID(data: unknown) {
  if (!data || typeof data !== "object") {
    return "";
  }
  const fields = data as Record<string, unknown>;
  for (const key of ["sessionID", "sessionId", "session"]) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

export function notificationStatusUpdateID(data: unknown) {
  if (!data || typeof data !== "object") {
    return "";
  }
  const fields = data as Record<string, unknown>;
  for (const key of ["statusUpdateID", "statusUpdateId", "statusId", "statusID"]) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

export function notificationConnectionID(data: unknown) {
  if (!data || typeof data !== "object") {
    return "";
  }
  const fields = data as Record<string, unknown>;
  for (const key of ["connectionID", "connectionId"]) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

export function notificationWorkspaceID(data: unknown) {
  if (!data || typeof data !== "object") {
    return "";
  }
  const fields = data as Record<string, unknown>;
  for (const key of ["workspaceID", "workspaceId"]) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

export function notificationFallbackState(
  requestID: string,
  sessionTarget?: SessionDeepLinkTarget,
): NotificationFallbackState {
  return {
    notificationTargetID: requestID,
    selectedID: requestID,
    screen: "requests",
    ...(sessionTarget ? { sessionTarget } : {}),
  };
}
