import type { FastifyInstance } from 'fastify';
import type { AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman } from '../auth/context.js';

export interface MeRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerMeRoutes(app: FastifyInstance, { config, store }: MeRoutesOptions): Promise<void> {
  app.get('/v1/me', async (request) => {
    const auth = await requireHuman(request, config, store);
    return {
      userId: auth.userId ?? 'usr_default',
      authProvider: config.authProvider,
      source: auth.source,
      organizationId: auth.organizationId,
      role: auth.role ?? 'owner',
      memberships: [
        {
          organizationId: auth.organizationId,
          name: 'Personal',
          userId: auth.userId ?? 'usr_default',
          role: auth.role ?? 'owner',
          createdAt: new Date(0).toISOString()
        }
      ]
    };
  });
}
