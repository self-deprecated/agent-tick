import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requirePrivilegedHuman } from '../auth/context.js';

const CreateAgentTokenSchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.string()).optional()
});

export interface AgentTokenRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerAgentTokenRoutes(app: FastifyInstance, { config, store }: AgentTokenRoutesOptions): Promise<void> {
  app.get('/v1/agent-tokens', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    return store.listAgentTokens(auth.organizationId);
  });

  app.post('/v1/agent-tokens', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    const input = CreateAgentTokenSchema.parse(request.body);
    return store.createAgentToken({
      name: input.name,
      organizationId: auth.organizationId,
      ...(input.scopes ? { scopes: input.scopes } : {}),
      ...(auth.userId ? { ownerUserId: auth.userId } : {})
    });
  });

  app.post('/v1/agent-tokens/:id/revoke', async (request, reply) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    const { id } = request.params as { id: string };
    const token = store.revokeAgentToken(id, auth.organizationId);
    if (!token) return reply.status(404).send({ error: { code: 'not_found', message: 'Agent token not found', requestId: request.id } });
    return token;
  });
}
