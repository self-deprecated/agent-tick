import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import { BillingPurchaseAttemptCancelRequestSchema, BillingPurchasePreflightRequestSchema, BillingTrialStartRequestSchema, PersonalBillingUpdateSchema } from '@self-deprecated/agent-tick-shared';
import type { ServerConfig } from '../config.js';
import { requireHuman, requirePrivilegedHuman, type AuthContext } from '../auth/context.js';
import {
  billingError,
  billingProducts,
  cancelPurchaseAttempt,
  getPersonalBillingStatus,
  normalizeRevenueCatEvent,
  normalizeRevenueCatTransferEvent,
  preflightPurchase,
  recordRevenueCatTransfer,
  startNativeTrial,
  recordVerifiedTransaction,
  recomputePersonalEntitlement,
  type BillingProductKey
} from '../services/billing.js';

export interface BillingRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerBillingRoutes(app: FastifyInstance, { config, store }: BillingRoutesOptions): Promise<void> {
  app.get('/v1/billing/products', async () => ({ products: await billingProducts(store) }));

  app.get('/v1/billing/personal', async (request) => {
    const auth = await requireHuman(request, config, store);
    return getPersonalBillingStatus(store, personalUserId(auth), config);
  });

  app.post('/v1/billing/personal', async (request) => {
    const auth = await requireHuman(request, config, store);
    const userId = personalUserId(auth);
    const now = new Date();
    const input = PersonalBillingUpdateSchema.parse(request.body);

    if (input.event !== 'delete_account_data' && !config.testAuth && !config.billingTestMode && !await allowsBillingDevGrant(config, store, auth, input.event)) {
      throw billingError(403, 'billing_test_mode_required', 'Production purchase grants require verified App Store, Play, or billing-provider events');
    }

    const current = await recomputePersonalEntitlement(store, userId, now);
    if (input.event === 'delete_account_data') {
      await store.deleteHostedPersonalData(userId, auth.workspaceId, now.toISOString());
    } else if (input.event === 'app_purchase') {
      const unlockedAt = current.appUnlockedAt ?? now.toISOString();
      await store.updatePersonalEntitlement({ userId, appUnlockedAt: unlockedAt }, now.toISOString());
    } else if (input.event === 'subscribe_monthly' || input.event === 'subscribe_yearly') {
      const days = input.event === 'subscribe_yearly' ? 365 : 31;
      await store.updatePersonalEntitlement({ userId, hostedSubscriptionEndsAt: addDays(now, days), hostedSubscriptionCanceledAt: null }, now.toISOString());
    } else if (input.event === 'cancel_subscription') {
      await store.updatePersonalEntitlement({ userId, hostedSubscriptionCanceledAt: now.toISOString() }, now.toISOString());
    }
    return getPersonalBillingStatus(store, userId, config, now);
  });

  app.post('/v1/billing/purchases/preflight', async (request) => {
    const auth = await requireHuman(request, config, store);
    const input = BillingPurchasePreflightRequestSchema.parse(request.body);
    return preflightPurchase(store, config, personalUserId(auth), input.platform, input.productKey as BillingProductKey);
  });

  app.post('/v1/billing/purchases/start-trial', async (request) => {
    const auth = await requireHuman(request, config, store);
    const input = BillingTrialStartRequestSchema.parse(request.body);
    return startNativeTrial(store, config, personalUserId(auth), input.platform);
  });

  app.post('/v1/billing/purchases/cancel', async (request) => {
    const auth = await requireHuman(request, config, store);
    const input = BillingPurchaseAttemptCancelRequestSchema.parse(request.body);
    const canceled = await cancelPurchaseAttempt(store, personalUserId(auth), input.productKey as BillingProductKey, input.purchaseAttemptId);
    return { canceled };
  });

  app.post('/v1/billing/webhooks/revenuecat', async (request) => {
    verifyRevenueCatWebhook(request, config);
    const transfer = normalizeRevenueCatTransferEvent(request.body);
    if (transfer) {
      const result = await recordRevenueCatTransfer(store, transfer);
      return { processed: result.processed, transfer: true, transferredTransactions: result.transferredTransactions, receiptOwnersTransferred: result.receiptOwnersTransferred };
    }
    const transaction = normalizeRevenueCatEvent(request.body);
    if (!transaction) return { processed: false, ignored: true };
    const result = await recordVerifiedTransaction(store, transaction);
    return { processed: true, transactionId: result.transaction?.transactionId, created: result.created, ...(result.conflict ? { conflict: result.conflict } : {}) };
  });

  app.get('/v1/billing', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    requireWorkspaceBillingAdmin(auth);
    const entitlement = await workspaceBillingEntitlement(store, auth);
    return {
      workspaceId: auth.workspaceId,
      ...(auth.workspaceType ? { workspaceType: auth.workspaceType } : {}),
      plan: workspaceBillingPlan(config, auth),
      limits: {
        ...(config.maxActiveMembers ? { seats: config.maxActiveMembers } : {})
      },
      usage: await store.workspaceSeatUsage(auth.workspaceId),
      ...(entitlement ? { entitlement } : {})
    };
  });
}

async function allowsBillingDevGrant(config: ServerConfig, store: AgentTickStore, auth: AuthContext, event: string): Promise<boolean> {
  if (event !== 'subscribe_monthly') return false;
  if (config.billingDevGrantEmailDomains.length === 0 || !auth.userId) return false;
  const profile = await store.userProfile(auth.userId);
  return emailDomainAllowedForBillingDevGrant(profile?.email, config.billingDevGrantEmailDomains);
}

export function emailDomainAllowedForBillingDevGrant(email: string | undefined, allowedDomains: string[]): boolean {
  const domain = email?.split('@').at(-1)?.trim().toLowerCase();
  if (!domain) return false;
  return allowedDomains.some((candidate) => {
    const allowed = candidate.trim().toLowerCase().replace(/^@+/, '');
    return allowed !== '' && (domain === allowed || domain.endsWith(`.${allowed}`));
  });
}

function addDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function personalUserId(auth: AuthContext): string {
  return auth.userId ?? auth.creatorUserId ?? 'usr_default';
}

function verifyRevenueCatWebhook(request: FastifyRequest, config: ServerConfig): void {
  const secret = config.revenueCatWebhookSecret?.trim();
  if (!secret) throw billingError(503, 'billing_webhook_not_configured', 'RevenueCat webhook secret is not configured');
  const header = request.headers.authorization;
  const authorization = Array.isArray(header) ? header[0] : header;
  const accepted = [secret, `Bearer ${secret}`];
  if (!authorization || !accepted.includes(authorization.trim())) throw billingError(401, 'not_authenticated', 'Invalid RevenueCat webhook authorization');
}

function workspaceBillingPlan(config: ServerConfig, auth: AuthContext): string {
  if (auth.workspaceType === 'shared') return 'shared-workspace';
  return config.hostedService && config.mode === 'clerk' ? 'solo' : 'self-hosted';
}

async function workspaceBillingEntitlement(store: AgentTickStore, auth: AuthContext): Promise<{ responsesEnabled: boolean; status: 'active' | 'inactive'; responsesEntitledUntil?: string } | null> {
  if (auth.workspaceType !== 'shared') return null;
  const membership = auth.userId ? await store.workspaceMembershipForUserAnyStatus(auth.userId, auth.workspaceId) : null;
  const responsesEntitledUntil = membership?.responsesEntitledUntil;
  const responsesEnabled = await store.workspaceResponsesEntitled(auth.workspaceId);
  return {
    responsesEnabled,
    status: responsesEnabled ? 'active' : 'inactive',
    ...(responsesEntitledUntil ? { responsesEntitledUntil } : {})
  };
}

function requireWorkspaceBillingAdmin(auth: AuthContext): void {
  if (auth.role === 'owner' || auth.role === 'admin') return;
  const error = new Error('Workspace Admin role required') as Error & { statusCode: number; code: string };
  error.statusCode = 403;
  error.code = 'forbidden';
  throw error;
}
