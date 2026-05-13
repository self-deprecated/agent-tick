import type { FastifyInstance } from 'fastify';
import { CreateTeamSchema, UpsertTeamMemberSchema } from '@agent-tick/shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireOrganizationAdmin } from '../auth/context.js';

export interface TeamRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerTeamRoutes(app: FastifyInstance, { config, store }: TeamRoutesOptions): Promise<void> {
  app.get('/v1/teams', async (request) => {
    const auth = await requireOrganizationAdmin(request, config, store);
    return await store.listTeams(auth.organizationId);
  });

  app.post('/v1/teams', async (request) => {
    const auth = await requireOrganizationAdmin(request, config, store);
    const input = CreateTeamSchema.parse(request.body);
    return await store.createTeam({
      organizationId: auth.organizationId,
      userId: auth.userId ?? 'usr_default',
      name: input.name,
      ...(input.slug ? { slug: input.slug } : {}),
      ...(input.description ? { description: input.description } : {})
    });
  });

  app.get('/v1/teams/:id/members', async (request, reply) => {
    await requireOrganizationAdmin(request, config, store);
    const { id } = request.params as { id: string };
    const members = await store.listTeamMembers(id);
    if (members.length === 0) return reply.status(404).send({ error: { code: 'not_found', message: 'Team not found', requestId: request.id } });
    return members;
  });

  app.post('/v1/teams/:id/members', async (request) => {
    const auth = await requireOrganizationAdmin(request, config, store);
    const { id } = request.params as { id: string };
    const input = UpsertTeamMemberSchema.parse(request.body);
    return await store.upsertTeamMember({
      organizationId: auth.organizationId,
      actorUserId: auth.userId ?? 'usr_default',
      teamId: id,
      userId: input.userId,
      role: input.role
    });
  });

  app.delete('/v1/teams/:id/members/:userId', async (request, reply) => {
    const auth = await requireOrganizationAdmin(request, config, store);
    const { id, userId } = request.params as { id: string; userId: string };
    const removed = await store.removeTeamMember({
      organizationId: auth.organizationId,
      actorUserId: auth.userId ?? 'usr_default',
      teamId: id,
      userId
    });
    if (!removed) return reply.status(404).send({ error: { code: 'not_found', message: 'Team member not found', requestId: request.id } });
    return removed;
  });
}
