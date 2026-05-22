import type { FastifyInstance } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman } from '../auth/context.js';

export interface ActivityRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerActivityRoutes(app: FastifyInstance, { config, store }: ActivityRoutesOptions): Promise<void> {
  app.get('/v1/activity', async (request) => {
    const auth = await requireHuman(request, config, store);
    return store.listActivityForUser(auth.userId ?? 'usr_default', workspaceFilter(request.query, auth.workspaceId), limitFromQuery(request.query));
  });

  app.get('/v1/activity/history', async (request) => {
    const auth = await requireHuman(request, config, store);
    return store.listActivityForUser(auth.userId ?? 'usr_default', workspaceFilter(request.query, auth.workspaceId), limitFromQuery(request.query, 100));
  });

  app.get('/v1/activity/pending-count', async (request) => {
    const auth = await requireHuman(request, config, store);
    return { pendingRequests: await store.pendingRequestCountForUser(auth.userId ?? 'usr_default', workspaceFilter(request.query, auth.workspaceId)) };
  });
}

function workspaceFilter(query: unknown, fallback: string): string | undefined {
  const value = (query as { workspaceId?: unknown }).workspaceId;
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function limitFromQuery(query: unknown, defaultLimit = 50): number {
  const value = (query as { limit?: unknown }).limit;
  const parsed = Number(value ?? defaultLimit);
  if (!Number.isFinite(parsed)) return defaultLimit;
  return Math.min(Math.max(Math.trunc(parsed), 1), 200);
}
