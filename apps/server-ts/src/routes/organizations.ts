import type { FastifyInstance } from 'fastify';
import { CreateOrganizationSchema } from '@agent-tick/shared';
import type { AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman } from '../auth/context.js';

export interface OrganizationRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerOrganizationRoutes(app: FastifyInstance, { config, store }: OrganizationRoutesOptions): Promise<void> {
  app.get('/v1/organizations', async (request) => {
    const auth = await requireHuman(request, config, store);
    return store.listOrganizationsForUser(auth.userId ?? 'usr_default');
  });

  app.post('/v1/organizations', async (request) => {
    const auth = await requireHuman(request, config, store);
    const input = CreateOrganizationSchema.parse(request.body);
    return store.createOrganizationForUser(auth.userId ?? 'usr_default', input.name);
  });
}
