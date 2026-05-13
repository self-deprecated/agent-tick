import type { FastifyInstance } from 'fastify';
import { CreateAgentTokenSchema } from '@agent-tick/shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireOrganizationAdmin } from '../auth/context.js';

export interface AgentTokenRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerAgentTokenRoutes(app: FastifyInstance, { config, store }: AgentTokenRoutesOptions): Promise<void> {
  app.get('/v1/agent-tokens', async (request) => {
    const auth = await requireOrganizationAdmin(request, config, store);
    return await store.listAgentTokens(auth.organizationId);
  });

  app.post('/v1/agent-tokens', async (request) => {
    const auth = await requireOrganizationAdmin(request, config, store);
    const input = CreateAgentTokenSchema.parse(request.body);
    return await store.createAgentToken({
      name: input.name,
      organizationId: auth.organizationId,
      ...(input.scopes ? { scopes: input.scopes } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.teamId ? { teamId: input.teamId } : {}),
      ...(input.defaultApprovalPolicy ? { defaultApprovalPolicy: input.defaultApprovalPolicy } : {}),
      ...(auth.userId ? { ownerUserId: auth.userId } : {})
    });
  });

  app.post('/v1/agent-tokens/:id/revoke', async (request, reply) => {
    const auth = await requireOrganizationAdmin(request, config, store);
    const { id } = request.params as { id: string };
    const token = await store.revokeAgentToken(id, auth.organizationId);
    if (!token) return reply.status(404).send({ error: { code: 'not_found', message: 'Agent token not found', requestId: request.id } });
    return token;
  });
}
