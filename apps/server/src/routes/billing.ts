import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman, requirePrivilegedHuman, type AuthContext } from '../auth/context.js';
import { hostedPersonalStatus } from '../services/personalEntitlements.js';

export interface BillingRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

const PersonalBillingUpdateSchema = z.object({
  event: z.enum(['app_purchase', 'activate_included_hosted_month', 'subscribe_monthly', 'subscribe_yearly', 'cancel_subscription', 'delete_account_data'])
});

export async function registerBillingRoutes(app: FastifyInstance, { config, store }: BillingRoutesOptions): Promise<void> {
  app.get('/v1/billing/personal', async (request) => {
    const auth = await requireHuman(request, config, store);
    const userId = auth.userId ?? 'usr_default';
    const entitlement = await store.getOrStartPersonalEntitlement(userId);
    return { entitlement, hostedPersonal: hostedPersonalStatus(entitlement) };
  });

  app.post('/v1/billing/personal', async (request) => {
    const auth = await requireHuman(request, config, store);
    const userId = auth.userId ?? 'usr_default';
    const now = new Date();
    const input = PersonalBillingUpdateSchema.parse(request.body);
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
    const entitlement = await store.getOrStartPersonalEntitlement(userId, now.toISOString());
    return { entitlement, hostedPersonal: hostedPersonalStatus(entitlement, now) };
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

function billingError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function requireOrganizationAdmin(auth: AuthContext): void {
  if (auth.role === 'owner' || auth.role === 'admin') return;
  const error = new Error('Organization admin role required') as Error & { statusCode: number; code: string };
  error.statusCode = 403;
  error.code = 'forbidden';
  throw error;
}
