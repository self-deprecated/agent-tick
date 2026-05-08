import type { FastifyInstance } from 'fastify';
import { CreateTeamSchema } from '@agent-tick/shared';
import type { AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requirePrivilegedHuman } from '../auth/context.js';

export interface TeamRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerTeamRoutes(app: FastifyInstance, { config, store }: TeamRoutesOptions): Promise<void> {
  app.get('/v1/teams', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    return store.listTeams(auth.organizationId);
  });

  app.post('/v1/teams', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    const input = CreateTeamSchema.parse(request.body);
    return store.createTeam({
      organizationId: auth.organizationId,
      userId: auth.userId ?? 'usr_default',
      name: input.name,
      ...(input.slug ? { slug: input.slug } : {}),
      ...(input.description ? { description: input.description } : {})
    });
  });

  app.get('/v1/teams/:id/members', async (request, reply) => {
    await requirePrivilegedHuman(request, config, store);
    const { id } = request.params as { id: string };
    const members = store.listTeamMembers(id);
    if (members.length === 0) return reply.status(404).send({ error: { code: 'not_found', message: 'Team not found', requestId: request.id } });
    return members;
  });
}
