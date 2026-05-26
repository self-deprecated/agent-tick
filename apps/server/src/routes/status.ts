import type { FastifyInstance } from 'fastify';
import { CreateStatusUpdateSchema } from '@self-deprecated/agent-tick-shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireAuth, requireHuman } from '../auth/context.js';
import { requireHostedPersonalRouting } from '../services/personalEntitlements.js';

export interface StatusRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerStatusRoutes(app: FastifyInstance, { config, store }: StatusRoutesOptions): Promise<void> {
  app.get('/v1/status-updates', async (request) => {
    const auth = await requireHuman(request, config, store);
    return store.listLatestStatusUpdates(auth.workspaceId, limitFromQuery(request.query));
  });

  app.post('/v1/status-updates', async (request) => {
    const auth = await requireAuth(request, config, store);
    await requireHostedPersonalRouting(config, store, auth);
    const input = CreateStatusUpdateSchema.parse(request.body);
    return store.createStatusUpdate({
      ...input,
      workspaceId: auth.workspaceId,
      ...(auth.agentTokenId ? { agentTokenId: auth.agentTokenId } : {}),
      ...(auth.agentTokenLabel ? { agentTokenLabel: auth.agentTokenLabel } : {}),
      ...(auth.routingRuleId ? { routingRuleId: auth.routingRuleId } : {}),
      ...(auth.userId ? { userId: auth.userId } : {})
    });
  });
}

function limitFromQuery(query: unknown): number {
  const value = (query as { limit?: unknown }).limit;
  const parsed = Number(value ?? 20);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}
