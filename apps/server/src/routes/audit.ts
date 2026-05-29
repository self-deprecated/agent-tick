import type { FastifyInstance } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireWorkspaceAdmin } from '../auth/context.js';

export interface AuditRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerAuditRoutes(app: FastifyInstance, { config, store }: AuditRoutesOptions): Promise<void> {
  app.get('/v1/audit-events', async (request) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    const limit = limitFromQuery(request.query);
    return await store.listAuditEvents(auth.workspaceId, limit);
  });
}

function limitFromQuery(query: unknown): number {
  const value = (query as { limit?: string | number | undefined }).limit;
  const parsed = Number(value ?? 100);
  if (!Number.isFinite(parsed)) return 100;
  return parsed;
}
