import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import { BillingPurchasePreflightRequestSchema } from '@agent-tick/shared';
import type { ServerConfig } from '../config.js';
import { requireHuman, requirePrivilegedHuman, type AuthContext } from '../auth/context.js';
import {
  billingError,
  billingProducts,
  getPersonalBillingStatus,
  normalizeRevenueCatEvent,
  preflightPurchase,
  recordVerifiedTransaction,
  type BillingProductKey
} from '../services/billing.js';

export interface BillingRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

const PersonalBillingUpdateSchema = z.object({
  event: z.enum(['app_purchase', 'activate_included_hosted_month', 'subscribe_monthly', 'subscribe_yearly', 'cancel_subscription', 'delete_account_data'])
});

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

    if (input.event !== 'delete_account_data' && !config.testAuth && !config.billingTestMode) {
      throw billingError(403, 'billing_test_mode_required', 'Production purchase grants require verified App Store, Play, or billing-provider events');
    }

    const current = await store.getOrStartPersonalEntitlement(userId, now.toISOString());
    if (input.event === 'delete_account_data') {
      await store.deleteHostedPersonalData(userId, auth.organizationId, now.toISOString());
    } else if (input.event === 'app_purchase') {
      await store.updatePersonalEntitlement({ userId, appUnlockedAt: current.appUnlockedAt ?? now.toISOString() }, now.toISOString());
    } else if (input.event === 'activate_included_hosted_month') {
      if (!current.appUnlockedAt) throw billingError(400, 'app_purchase_required', 'Lifetime app unlock is required before activating included hosted month');
      await store.updatePersonalEntitlement({ userId, includedHostedActivatedAt: current.includedHostedActivatedAt ?? now.toISOString() }, now.toISOString());
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

  app.post('/v1/billing/webhooks/revenuecat', async (request) => {
    verifyRevenueCatWebhook(request, config);
    const transaction = normalizeRevenueCatEvent(request.body);
    if (!transaction) return { processed: false, ignored: true };
    const result = await recordVerifiedTransaction(store, transaction);
    return { processed: true, transactionId: result.transaction.transactionId, created: result.created };
  });

  app.get('/v1/billing', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    requireOrganizationAdmin(auth);
    return {
      organizationId: auth.organizationId,
      plan: config.mode === 'clerk' ? 'solo' : 'self-hosted',
      limits: {
        ...(config.maxActiveMembers ? { seats: config.maxActiveMembers } : {})
      },
      usage: await store.organizationSeatUsage(auth.organizationId)
    };
  });
}

function addDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function personalUserId(auth: AuthContext): string {
  return auth.userId ?? auth.ownerUserId ?? 'usr_default';
}

function verifyRevenueCatWebhook(request: FastifyRequest, config: ServerConfig): void {
  const secret = config.revenueCatWebhookSecret?.trim();
  if (!secret) throw billingError(503, 'billing_webhook_not_configured', 'RevenueCat webhook secret is not configured');
  const header = request.headers.authorization;
  const authorization = Array.isArray(header) ? header[0] : header;
  const accepted = [secret, `Bearer ${secret}`];
  if (!authorization || !accepted.includes(authorization.trim())) throw billingError(401, 'not_authenticated', 'Invalid RevenueCat webhook authorization');
}

function requireOrganizationAdmin(auth: AuthContext): void {
  if (auth.role === 'owner' || auth.role === 'admin') return;
  const error = new Error('Organization admin role required') as Error & { statusCode: number; code: string };
  error.statusCode = 403;
  error.code = 'forbidden';
  throw error;
}
