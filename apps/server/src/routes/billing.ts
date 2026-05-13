import type { FastifyInstance } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requirePrivilegedHuman, type AuthContext } from '../auth/context.js';

export interface BillingRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerBillingRoutes(app: FastifyInstance, { config, store }: BillingRoutesOptions): Promise<void> {
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

function requireOrganizationAdmin(auth: AuthContext): void {
  if (auth.role === 'owner' || auth.role === 'admin') return;
  const error = new Error('Organization admin role required') as Error & { statusCode: number; code: string };
  error.statusCode = 403;
  error.code = 'forbidden';
  throw error;
}
