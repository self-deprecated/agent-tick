import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CreateRequestSchema, RespondRequestSchema } from '@agent-tick/shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import type { RequestNotifier } from '../services/notifications.js';
import { authenticateRequest, requireAuth, requireHuman } from '../auth/context.js';
import { requireHostedPersonalResponse, requireHostedPersonalRouting } from '../services/personalEntitlements.js';

export interface RequestRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
  notifier?: RequestNotifier;
}

export async function registerRequestRoutes(app: FastifyInstance, { config, store, notifier }: RequestRoutesOptions): Promise<void> {
  app.get('/v1/requests', async (request) => {
    const auth = await requireHuman(request, config, store);
    return store.listRequestsForUser(auth.userId ?? 'usr_default', workspaceFilter(request.query, auth.workspaceId));
  });

  app.post('/v1/requests', async (request) => {
    const auth = await requireAuth(request, config, store);
    await requireHostedPersonalRouting(config, store, auth);
    const input = CreateRequestSchema.parse(request.body);
    const created = await store.createRequest({
      ...input,
      requester: {
        ...input.requester,
        ...(auth.agentTokenId ? { agentTokenId: auth.agentTokenId } : {})
      },
      workspaceId: auth.workspaceId,
      ...(auth.agentTokenId ? { agentTokenId: auth.agentTokenId } : {}),
      ...(auth.routingRuleId ? { routingRuleId: auth.routingRuleId } : {}),
      ...(auth.isHuman && auth.userId ? { userId: auth.userId } : {})
    });
    notifier?.notifyRequestCreated(created)
      .then(() => request.log.info({ requestId: created.id }, 'request notification processed'))
      .catch((error) => request.log.error({ err: error, requestId: created.id }, 'request notification failed'));
    return {
      request: created,
      ...(auth.agentTokenId ? { waiter: await store.createRequestWaiterToken(created.id, created.workspaceId, auth.agentTokenId, created.deadline) } : {})
    };
  });

  app.get('/v1/requests/:id', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const { id } = request.params as { id: string };
    const record = await store.getRequestForWorkspace(id, auth.workspaceId, auth.userId);
    if (!record) return reply.status(404).send({ error: { code: 'not_found', message: 'Request not found', requestId: request.id } });
    return record;
  });

  app.post('/v1/requests/:id/responses', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    await requireHostedPersonalResponse(config, store, auth);
    const { id } = request.params as { id: string };
    const input = RespondRequestSchema.parse(request.body);
    const record = await store.respondToRequestForWorkspace(id, auth.workspaceId, input, auth.userId ?? 'usr_default');
    if (!record) return reply.status(404).send({ error: { code: 'not_found', message: 'Request not found', requestId: request.id } });
    return record;
  });

  app.post('/v1/requests/:id/abandon', async (request, reply) => {
    const auth = await requireAuth(request, config, store);
    const { id } = request.params as { id: string };
    const existing = await store.getRequestForWorkspace(id, auth.workspaceId);
    if (!existing) return reply.status(404).send({ error: { code: 'not_found', message: 'Request not found', requestId: request.id } });
    if (auth.agentTokenId && existing.agentTokenId !== auth.agentTokenId) {
      return reply.status(403).send({ error: { code: 'forbidden', message: 'Agent Tokens can only resolve Requests they created', requestId: request.id } });
    }
    return store.abandonRequestForWorkspace(id, auth.workspaceId, auth.agentTokenId ?? auth.userId ?? 'unknown');
  });

  app.get('/v1/requests/:id/wait', async (request, reply) => {
    const { id } = request.params as { id: string };
    const waiter = waiterToken(request.headers.authorization);
    if (waiter) {
      const waiterAuth = await store.verifyRequestWaiterToken(waiter, id);
      if (!waiterAuth) return reply.status(401).send({ error: { code: 'not_authenticated', message: 'Invalid or expired waiter token', requestId: request.id } });
      return waitForRequest(request, reply, store, id, waiterAuth.workspaceId);
    }

    const auth = await authenticateRequest(request, config, store);
    if (!auth || !auth.isHuman) {
      return reply.status(auth ? 403 : 401).send({ error: { code: auth ? 'forbidden' : 'not_authenticated', message: auth ? 'Human authentication or waiter token required' : 'Authentication required', requestId: request.id } });
    }
    return waitForRequest(request, reply, store, id, auth.workspaceId, auth.userId);
  });
}

async function waitForRequest(request: FastifyRequest, reply: FastifyReply, store: AgentTickStore, id: string, workspaceId: string, userId?: string) {
  const timeoutMs = timeoutFromQuery(request.query);
  const deadline = Date.now() + timeoutMs;
  let record = await store.getRequestForWorkspace(id, workspaceId, userId);
  if (!record) return reply.status(404).send({ error: { code: 'not_found', message: 'Request not found', requestId: request.id } });

  while (record.status === 'pending' && Date.now() < deadline) {
    await sleep(Math.min(250, Math.max(25, deadline - Date.now())));
    record = await store.getRequestForWorkspace(id, workspaceId, userId);
    if (!record) return reply.status(404).send({ error: { code: 'not_found', message: 'Request not found', requestId: request.id } });
  }
  return { request: record, terminal: record.status !== 'pending' };
}

function timeoutFromQuery(query: unknown): number {
  const value = (query as { timeoutMs?: string | number | undefined }).timeoutMs;
  const parsed = Number(value ?? 30_000);
  if (!Number.isFinite(parsed) || parsed < 0) return 30_000;
  return Math.min(parsed, 300_000);
}

function waiterToken(header: string | undefined): string | null {
  const [scheme, token] = header?.split(/\s+/, 2) ?? [];
  if (scheme?.toLowerCase() !== 'bearer' || !token?.startsWith('wait_')) return null;
  return token.trim();
}

function workspaceFilter(query: unknown, fallback: string): string | undefined {
  const value = (query as { workspaceId?: unknown }).workspaceId;
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
