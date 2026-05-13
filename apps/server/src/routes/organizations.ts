import type { FastifyInstance } from 'fastify';
import { CreateOrganizationSchema } from '@agent-tick/shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requirePrivilegedHuman } from '../auth/context.js';

export interface OrganizationRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerOrganizationRoutes(app: FastifyInstance, { config, store }: OrganizationRoutesOptions): Promise<void> {
  app.get('/v1/organizations', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    return await store.listOrganizationsForUser(auth.userId ?? 'usr_default');
  });

  app.post('/v1/organizations', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    const input = CreateOrganizationSchema.parse(request.body);
    return await store.createOrganizationForUser(auth.userId ?? 'usr_default', input.name);
  });

  app.get('/v1/organizations/:id/members', async (request, reply) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    const { id } = request.params as { id: string };
    const membership = await store.organizationMembershipForUser(auth.userId ?? 'usr_default', id);
    if (!membership) return reply.status(403).send({ error: { code: 'forbidden', message: 'User is not a member of this organization', requestId: request.id } });
    return await store.listOrganizationMembers(id);
  });
}
