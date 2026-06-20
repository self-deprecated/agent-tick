import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import { addDays, hostedPersonalStatus, PERSONAL_TRIAL_DAYS, type HostedPersonalStatus, type NativeTrialStatus, type RequestRecord } from '@self-deprecated/agent-tick-shared';
import type { ServerConfig } from '../config.js';
import type { AuthContext } from '../auth/context.js';

export function hostedPersonalApplies(config: ServerConfig, auth: AuthContext): boolean {
  return config.hostedService && config.mode === 'clerk' && auth.workspaceType === 'personal' && Boolean(auth.userId || auth.creatorUserId);
}

export async function hostedPersonalForAuth(config: ServerConfig, store: AgentTickStore, auth: AuthContext, now = new Date()): Promise<HostedPersonalStatus | null> {
  if (!hostedPersonalApplies(config, auth)) return null;
  const userId = auth.userId ?? auth.creatorUserId;
  if (!userId) return null;
  const record = await store.getOrStartPersonalEntitlement(userId, now.toISOString());
  const nativeTrial = await nativeTrialStatus(store, userId, now);
  return hostedPersonalStatus(record, now, { nativeTrial });
}

export async function requireHostedPersonalRouting(config: ServerConfig, store: AgentTickStore, auth: AuthContext): Promise<HostedPersonalStatus | null> {
  const status = await hostedPersonalForAuth(config, store, auth);
  if (!status || status.routingEnabled) return status;
  throw entitlementError('Hosted service is inactive. Renew or switch to self-hosted use.');
}

export async function requireHostedPersonalResponse(config: ServerConfig, store: AgentTickStore, auth: AuthContext, request?: Pick<RequestRecord, 'isTest'>): Promise<HostedPersonalStatus | null> {
  const status = await hostedPersonalForAuth(config, store, auth);
  if (!status || status.responsesEnabled) return status;
  // Fresh hosted Personal accounts get one app-local response before the mobile
  // app moves itself into read-only/App access mode. Do not persist that
  // allowance server-side: an app reset should make onboarding fresh again.
  if (!request?.isTest && status.lifecycle === 'fresh') return status;
  throw entitlementError(status.lifecycle === 'read_only_grace' ? 'Hosted service is in read-only grace. Renew to respond.' : 'Hosted service is inactive. Renew or switch to self-hosted use.');
}

async function nativeTrialStatus(store: AgentTickStore, userId: string, now: Date): Promise<NativeTrialStatus> {
  const trialTransactions = (await store.listBillingTransactionsForUser(userId))
    .filter((transaction) => transaction.entitlementKey === 'native_app_trial' && ['purchased', 'active', 'renewed', 'canceled', 'expired', 'refunded', 'revoked'].includes(transaction.status))
    .sort((left, right) => new Date(right.purchasedAt ?? right.createdAt).getTime() - new Date(left.purchasedAt ?? left.createdAt).getTime());
  const active = trialTransactions.find((transaction) => {
    if (!['purchased', 'active', 'renewed'].includes(transaction.status)) return false;
    const purchasedAt = transaction.purchasedAt ?? transaction.createdAt;
    return new Date(addDays(purchasedAt, PERSONAL_TRIAL_DAYS)).getTime() > now.getTime();
  });
  const newest = trialTransactions[0];
  const startedAt = (active ?? newest)?.purchasedAt ?? (active ?? newest)?.createdAt;
  return { active: Boolean(active), ...(startedAt ? { startedAt } : {}) };
}

function entitlementError(message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = 402;
  error.code = 'hosted_personal_inactive';
  return error;
}
