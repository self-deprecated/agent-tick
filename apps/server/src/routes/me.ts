import type { FastifyInstance } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman } from '../auth/context.js';

export interface MeRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerMeRoutes(app: FastifyInstance, { config, store }: MeRoutesOptions): Promise<void> {
  app.get('/v1/me', async (request) => {
    const auth = await requireHuman(request, config, store);
    const userId = auth.userId ?? 'usr_default';
    const profile = await store.userProfile(userId);
    return {
      userId,
      ...(profile?.email ? { email: profile.email } : {}),
      ...(profile?.name ? { name: profile.name } : {}),
      ...(profile?.signInMethod ? { signInMethod: profile.signInMethod } : {}),
      authProvider: config.authProvider,
      source: auth.source,
      organizationId: auth.organizationId,
      role: auth.role ?? 'owner',
      memberships: await store.listOrganizationsForUser(userId)
    };
  });
}
