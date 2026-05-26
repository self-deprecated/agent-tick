import type { PersonalEntitlementRecord, AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import type { AuthContext } from '../auth/context.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PERSONAL_TRIAL_DAYS = 7;
const INCLUDED_HOSTED_MONTH_DAYS = 31;
const READ_ONLY_GRACE_DAYS = 30;

export type HostedPersonalLifecycle = 'active' | 'read_only_grace' | 'expired' | 'deleted';

export interface HostedPersonalStatus {
  lifecycle: HostedPersonalLifecycle;
  trialEndsAt: string;
  includedHostedEndsAt?: string;
  hostedSubscriptionEndsAt?: string;
  readOnlyGraceEndsAt?: string;
  responsesEnabled: boolean;
  routingEnabled: boolean;
  pushEnabled: boolean;
  historyRetentionDays: number;
}

export function addDays(value: string, days: number): string {
  return new Date(new Date(value).getTime() + days * DAY_MS).toISOString();
}

export function hostedPersonalStatus(record: PersonalEntitlementRecord, now = new Date()): HostedPersonalStatus {
  const nowMs = now.getTime();
  const trialEndsAt = addDays(record.trialStartedAt, PERSONAL_TRIAL_DAYS);
  const appUnlocked = Boolean(record.appUnlockedAt);
  const includedHostedEndsAt = appUnlocked && record.includedHostedActivatedAt ? addDays(record.includedHostedActivatedAt, INCLUDED_HOSTED_MONTH_DAYS) : undefined;
  const subscriptionEndsAt = appUnlocked ? record.hostedSubscriptionEndsAt : undefined;
  const subscriptionGraceEndsAt = subscriptionEndsAt ? addDays(subscriptionEndsAt, READ_ONLY_GRACE_DAYS) : undefined;
  const trialActive = new Date(trialEndsAt).getTime() > nowMs;
  const includedActive = includedHostedEndsAt ? new Date(includedHostedEndsAt).getTime() > nowMs : false;
  const subscriptionActive = subscriptionEndsAt ? new Date(subscriptionEndsAt).getTime() > nowMs : false;
  const graceActive = Boolean(appUnlocked && record.hostedSubscriptionCanceledAt && subscriptionEndsAt && subscriptionGraceEndsAt && new Date(subscriptionGraceEndsAt).getTime() > nowMs);

  if (record.hostedDataDeletedAt) {
    return { lifecycle: 'deleted', trialEndsAt, ...(includedHostedEndsAt ? { includedHostedEndsAt } : {}), ...(subscriptionEndsAt ? { hostedSubscriptionEndsAt: subscriptionEndsAt } : {}), ...(subscriptionGraceEndsAt ? { readOnlyGraceEndsAt: subscriptionGraceEndsAt } : {}), responsesEnabled: false, routingEnabled: false, pushEnabled: false, historyRetentionDays: 0 };
  }
  if (trialActive || includedActive || subscriptionActive) {
    return { lifecycle: 'active', trialEndsAt, ...(includedHostedEndsAt ? { includedHostedEndsAt } : {}), ...(subscriptionEndsAt ? { hostedSubscriptionEndsAt: subscriptionEndsAt } : {}), ...(subscriptionGraceEndsAt ? { readOnlyGraceEndsAt: subscriptionGraceEndsAt } : {}), responsesEnabled: true, routingEnabled: true, pushEnabled: true, historyRetentionDays: READ_ONLY_GRACE_DAYS };
  }
  if (graceActive) {
    return { lifecycle: 'read_only_grace', trialEndsAt, ...(includedHostedEndsAt ? { includedHostedEndsAt } : {}), ...(subscriptionEndsAt ? { hostedSubscriptionEndsAt: subscriptionEndsAt } : {}), ...(subscriptionGraceEndsAt ? { readOnlyGraceEndsAt: subscriptionGraceEndsAt } : {}), responsesEnabled: false, routingEnabled: true, pushEnabled: false, historyRetentionDays: READ_ONLY_GRACE_DAYS };
  }
  return { lifecycle: 'expired', trialEndsAt, ...(includedHostedEndsAt ? { includedHostedEndsAt } : {}), ...(subscriptionEndsAt ? { hostedSubscriptionEndsAt: subscriptionEndsAt } : {}), ...(subscriptionGraceEndsAt ? { readOnlyGraceEndsAt: subscriptionGraceEndsAt } : {}), responsesEnabled: false, routingEnabled: false, pushEnabled: false, historyRetentionDays: 0 };
}

export function hostedPersonalApplies(config: ServerConfig, auth: AuthContext): boolean {
  return config.mode === 'clerk' && Boolean(auth.userId || auth.creatorUserId);
}

export async function hostedPersonalForAuth(config: ServerConfig, store: AgentTickStore, auth: AuthContext, now = new Date()): Promise<HostedPersonalStatus | null> {
  if (!hostedPersonalApplies(config, auth)) return null;
  const userId = auth.userId ?? auth.creatorUserId;
  if (!userId) return null;
  const record = await store.getOrStartPersonalEntitlement(userId, now.toISOString());
  const status = hostedPersonalStatus(record, now);
  if (status.lifecycle === 'expired') await store.revokeAgentTokensForOwner(userId, now.toISOString());
  return status;
}

export async function requireHostedPersonalRouting(config: ServerConfig, store: AgentTickStore, auth: AuthContext): Promise<HostedPersonalStatus | null> {
  const status = await hostedPersonalForAuth(config, store, auth);
  if (!status || status.routingEnabled) return status;
  throw entitlementError('Hosted service is inactive. Renew or switch to self-hosted use.');
}

export async function requireHostedPersonalResponse(config: ServerConfig, store: AgentTickStore, auth: AuthContext): Promise<HostedPersonalStatus | null> {
  const status = await hostedPersonalForAuth(config, store, auth);
  if (!status || status.responsesEnabled) return status;
  throw entitlementError(status.lifecycle === 'read_only_grace' ? 'Hosted service is in read-only grace. Renew to respond.' : 'Hosted service is inactive. Renew or switch to self-hosted use.');
}

function entitlementError(message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = 402;
  error.code = 'hosted_personal_inactive';
  return error;
}
