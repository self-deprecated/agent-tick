import type { FastifyInstance } from 'fastify';
import { CreateAgentTokenSchema, UpdateAgentTokenSchema } from '@self-deprecated/agent-tick-shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireWorkspaceAdmin } from '../auth/context.js';

export interface AgentTokenRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerAgentTokenRoutes(app: FastifyInstance, { config, store }: AgentTokenRoutesOptions): Promise<void> {
  app.get('/v1/agent-tokens', async (request) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    return store.listAgentTokens(auth.workspaceId);
  });

  app.post('/v1/agent-tokens', async (request) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    const input = CreateAgentTokenSchema.parse(request.body);
    if (input.workspaceId && input.workspaceId !== auth.workspaceId) {
      throw httpError(403, 'forbidden', 'Agent Token Workspace must match the selected Workspace');
    }
    return store.createAgentToken({
      label: input.label,
      workspaceId: auth.workspaceId,
      ...(input.scopes ? { scopes: input.scopes } : {}),
      ...(input.routingRuleId !== undefined ? { routingRuleId: input.routingRuleId } : {}),
      ...(input.boundRecipientUserId !== undefined ? { boundRecipientUserId: input.boundRecipientUserId } : {}),
      ...(auth.userId ? { creatorUserId: auth.userId } : {})
    });
  });

  app.patch('/v1/agent-tokens/:id', async (request, reply) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    const { id } = request.params as { id: string };
    const input = UpdateAgentTokenSchema.parse(request.body);
    const token = await store.updateAgentToken(id, auth.workspaceId, input);
    if (!token) return reply.status(404).send({ error: { code: 'not_found', message: 'Agent Token not found', requestId: request.id } });
    return token;
  });

  app.post('/v1/agent-tokens/:id/revoke', async (request, reply) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    const { id } = request.params as { id: string };
    const token = await store.revokeAgentToken(id, auth.workspaceId);
    if (!token) return reply.status(404).send({ error: { code: 'not_found', message: 'Agent Token not found', requestId: request.id } });
    return token;
  });
}

function httpError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
