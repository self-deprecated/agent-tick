import type { FastifyInstance } from 'fastify';
import { CreateToolActivitySchema } from '@self-deprecated/agent-tick-shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireAuth, type AuthContext } from '../auth/context.js';
import { requireRoutingEntitlement } from '../services/workspaceEntitlements.js';

export interface ToolActivityRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerToolActivityRoutes(app: FastifyInstance, { config, store }: ToolActivityRoutesOptions): Promise<void> {
  app.post('/v1/tool-activities', async (request) => {
    const auth = await requireAgent(request, config, store);
    await requireRoutingEntitlement(config, store, auth);
    const input = CreateToolActivitySchema.parse(request.body);
    return store.createToolActivity({
      ...input,
      workspaceId: auth.workspaceId,
      ...(auth.agentTokenId ? { agentTokenId: auth.agentTokenId } : {}),
      ...(auth.agentTokenLabel ? { agentTokenLabel: auth.agentTokenLabel } : {}),
      ...(auth.routingRuleId ? { routingRuleId: auth.routingRuleId } : {})
    });
  });
}

async function requireAgent(request: Parameters<typeof requireAuth>[0], config: ServerConfig, store: AgentTickStore): Promise<AuthContext> {
  const auth = await requireAuth(request, config, store);
  if (auth.source !== 'agent' || !auth.agentTokenId) throw httpError(403, 'forbidden', 'Agent Token authentication required');
  return auth;
}

function httpError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
