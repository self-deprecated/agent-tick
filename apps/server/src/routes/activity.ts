import type { FastifyInstance } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman, type AuthContext } from '../auth/context.js';
import { deriveSessionDetails, findSessionDetail } from '../services/sessions.js';

export interface ActivityRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerActivityRoutes(app: FastifyInstance, { config, store }: ActivityRoutesOptions): Promise<void> {
  app.get('/v1/activity', async (request) => {
    const auth = await requireHuman(request, config, store);
    return store.listActivityForUser(auth.userId ?? 'usr_default', await workspaceFilter(request.query, store, auth), limitFromQuery(request.query));
  });

  app.get('/v1/activity/history', async (request) => {
    const auth = await requireHuman(request, config, store);
    return store.listActivityForUser(auth.userId ?? 'usr_default', await workspaceFilter(request.query, store, auth), limitFromQuery(request.query, 100));
  });

  app.get('/v1/activity/pending-count', async (request) => {
    const auth = await requireHuman(request, config, store);
    return { pendingRequests: await store.pendingRequestCountForUser(auth.userId ?? 'usr_default', await workspaceFilter(request.query, store, auth)) };
  });

  app.get('/v1/sessions', async (request) => {
    const auth = await requireHuman(request, config, store);
    const activity = await store.listActivityForUser(auth.userId ?? 'usr_default', await workspaceFilter(request.query, store, auth), limitFromQuery(request.query, 200));
    return deriveSessionDetails(activity).map((detail) => detail.summary);
  });

  app.get('/v1/sessions/:id', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const { id } = request.params as { id: string };
    const activity = await store.listActivityForUser(auth.userId ?? 'usr_default', await workspaceFilter(request.query, store, auth), limitFromQuery(request.query, 200));
    const detail = findSessionDetail(activity, id);
    if (!detail) return reply.status(404).send({ error: { code: 'not_found', message: 'Session not found', requestId: request.id } });
    return detail;
  });
}

async function workspaceFilter(query: unknown, store: AgentTickStore, auth: AuthContext): Promise<string> {
  const value = (query as { workspaceId?: unknown }).workspaceId;
  const workspaceId = typeof value === 'string' && value.trim() ? value.trim() : auth.workspaceId;
  if (workspaceId !== auth.workspaceId && auth.userId) {
    const membership = await store.workspaceMembershipForUser(auth.userId, workspaceId);
    if (!membership) throw httpError(403, 'forbidden', 'User is not a member of the requested Workspace');
  }
  return workspaceId;
}

function httpError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function limitFromQuery(query: unknown, defaultLimit = 50): number {
  const value = (query as { limit?: unknown }).limit;
  const parsed = Number(value ?? defaultLimit);
  if (!Number.isFinite(parsed)) return defaultLimit;
  return Math.min(Math.max(Math.trunc(parsed), 1), 200);
}
