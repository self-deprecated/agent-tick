import type { FastifyInstance } from 'fastify';
import { CreateAgentStatusUpdateSchema } from '@agent-tick/shared';
import type { AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireAuth, requireHuman } from '../auth/context.js';

export interface StatusRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerStatusRoutes(app: FastifyInstance, { config, store }: StatusRoutesOptions): Promise<void> {
  app.get('/v1/status-updates', async (request) => {
    const auth = await requireHuman(request, config, store);
    const limit = limitFromQuery(request.query);
    return store.listLatestAgentStatusUpdates(auth.organizationId, limit);
  });

  app.post('/v1/status-updates', async (request) => {
    const auth = await requireAuth(request, config, store);
    const input = CreateAgentStatusUpdateSchema.parse(request.body);
    return store.createAgentStatusUpdate({
      ...input,
      organizationId: auth.organizationId,
      agentId: auth.agentId ?? auth.userId ?? 'human',
      agentName: auth.agentName ?? (auth.source === 'loopback' ? 'Local admin' : 'Agent'),
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
