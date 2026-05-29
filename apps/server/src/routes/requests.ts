import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CreateRequestSchema, ReportRequestWaiterErrorSchema, RespondRequestSchema, StopRequestWaiterSchema, type RequestRecord } from '@self-deprecated/agent-tick-shared';
import { DEFAULT_REQUEST_WAITER_LEASE_MS, type AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import type { RequestNotifier } from '../services/notifications.js';
import type { WorkspaceEventBus } from '../services/eventBus.js';
import { authenticateRequest, requireAuth, requireHuman, type AuthContext } from '../auth/context.js';
import { requireResponseEntitlement, requireRoutingEntitlement } from '../services/workspaceEntitlements.js';

export interface RequestRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
  notifier?: RequestNotifier;
  eventBus?: WorkspaceEventBus;
}

export async function registerRequestRoutes(app: FastifyInstance, { config, store, notifier, eventBus }: RequestRoutesOptions): Promise<void> {
  app.get('/v1/requests', async (request) => {
    const auth = await requireHuman(request, config, store);
    return store.listRequestsForUser(auth.userId ?? 'usr_default', await workspaceFilter(request.query, store, auth), undefined, limitFromQuery(request.query));
  });

  app.post('/v1/requests', async (request) => {
    const auth = await requireAuth(request, config, store);
    await requireRoutingEntitlement(config, store, auth);
    const input = CreateRequestSchema.parse(request.body);
    const created = await store.createRequest({
      ...input,
      isTest: false,
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
    const record = await getRequestVisibleToHuman(store, id, auth);
    if (!record) return reply.status(404).send({ error: { code: 'not_found', message: 'Request not found', requestId: request.id } });
    return record;
  });

  app.post('/v1/requests/:id/responses', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const { id } = request.params as { id: string };
    const existing = await getRequestVisibleToHuman(store, id, auth);
    if (!existing) return reply.status(404).send({ error: { code: 'not_found', message: 'Request not found', requestId: request.id } });
    if (!existing.isTest && !isHostedWebFallbackResponse(request, config, auth, existing)) await requireResponseEntitlement(config, store, auth, existing);
    const input = RespondRequestSchema.parse(request.body);
    if (input.choiceId && !existing.choices.some((choice) => choice.id === input.choiceId)) {
      return reply.status(400).send({ error: { code: 'bad_request', message: 'Response choice is not valid for this Request', requestId: request.id } });
    }
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

  app.post('/v1/requests/:id/waiter/stop', async (request, reply) => {
    const { id } = request.params as { id: string };
    const waiterAuth = await requireWaiterTokenAuth(request, reply, store, id);
    if (!waiterAuth) return;
    const input = StopRequestWaiterSchema.parse(request.body);
    await store.stopRequestWaiter(waiterAuth.waiterId, input.reason);
    void eventBus?.publishWorkspaceEvent(waiterAuth.workspaceId);
    const record = await store.getRequestForWorkspace(id, waiterAuth.workspaceId);
    if (!record) return reply.status(404).send({ error: { code: 'not_found', message: 'Request not found', requestId: request.id } });
    return record;
  });

  app.post('/v1/requests/:id/waiter/error', async (request, reply) => {
    const { id } = request.params as { id: string };
    const waiterAuth = await requireWaiterTokenAuth(request, reply, store, id);
    if (!waiterAuth) return;
    const input = ReportRequestWaiterErrorSchema.parse(request.body);
    await store.markRequestWaiterError(waiterAuth.waiterId, input.code, input.message);
    void eventBus?.publishWorkspaceEvent(waiterAuth.workspaceId);
    const record = await store.getRequestForWorkspace(id, waiterAuth.workspaceId);
    if (!record) return reply.status(404).send({ error: { code: 'not_found', message: 'Request not found', requestId: request.id } });
    return record;
  });

  app.get('/v1/requests/:id/wait', async (request, reply) => {
    const { id } = request.params as { id: string };
    const waiter = waiterToken(request.headers.authorization);
    if (waiter) {
      const timeoutMs = timeoutFromQuery(request.query);
      const waiterAuth = await store.verifyRequestWaiterToken(waiter, id);
      if (!waiterAuth) return reply.status(401).send({ error: { code: 'not_authenticated', message: 'Invalid or expired waiter token', requestId: request.id } });
      await renewWaiterLease(store, waiterAuth.waiterId, timeoutMs);
      return waitForRequest(request, reply, store, id, waiterAuth.workspaceId, { allowWorkspaceRead: true, timeoutMs, waiterId: waiterAuth.waiterId, ...(eventBus ? { eventBus } : {}) });
    }

    const auth = await authenticateRequest(request, config, store);
    if (!auth || !auth.isHuman) {
      return reply.status(auth ? 403 : 401).send({ error: { code: auth ? 'forbidden' : 'not_authenticated', message: auth ? 'Human authentication or waiter token required' : 'Authentication required', requestId: request.id } });
    }
    return waitForRequest(request, reply, store, id, auth.workspaceId, { ...(auth.userId ? { userId: auth.userId } : {}), allowWorkspaceRead: canAuditWorkspaceRequests(auth), ...(eventBus ? { eventBus } : {}) });
  });
}

async function requireWaiterTokenAuth(request: FastifyRequest, reply: FastifyReply, store: AgentTickStore, id: string) {
  const waiter = waiterToken(request.headers.authorization);
  if (!waiter) {
    reply.status(401).send({ error: { code: 'not_authenticated', message: 'Waiter token required', requestId: request.id } });
    return null;
  }
  const waiterAuth = await store.verifyRequestWaiterToken(waiter, id);
  if (!waiterAuth) {
    reply.status(401).send({ error: { code: 'not_authenticated', message: 'Invalid or expired waiter token', requestId: request.id } });
    return null;
  }
  return waiterAuth;
}

async function getRequestVisibleToHuman(store: AgentTickStore, id: string, auth: AuthContext) {
  if (canAuditWorkspaceRequests(auth)) return store.getRequestForWorkspace(id, auth.workspaceId, auth.userId);
  const userId = auth.userId ?? 'usr_default';
  const record = await store.getRequestForUser(id, userId);
  return record?.workspaceId === auth.workspaceId ? record : null;
}

function canAuditWorkspaceRequests(auth: AuthContext): boolean {
  return auth.role === 'owner' || auth.role === 'admin';
}

function isHostedWebFallbackResponse(request: FastifyRequest, config: ServerConfig, auth: AuthContext, record: RequestRecord): boolean {
  const surface = request.headers['x-agent-tick-response-surface'];
  const requestedWebFallback = (Array.isArray(surface) ? surface[0] : surface) === 'web-fallback';
  return requestedWebFallback && config.mode === 'clerk' && auth.workspaceType === 'personal' && record.workspaceType === 'personal' && auth.source !== 'mobile' && auth.source !== 'device';
}

async function getRequestVisibleToWaiter(store: AgentTickStore, id: string, workspaceId: string, visibility: { userId?: string; allowWorkspaceRead?: boolean }) {
  if (visibility.allowWorkspaceRead) return store.getRequestForWorkspace(id, workspaceId, visibility.userId);
  const userId = visibility.userId ?? 'usr_default';
  const record = await store.getRequestForUser(id, userId);
  return record?.workspaceId === workspaceId ? record : null;
}

async function waitForRequest(request: FastifyRequest, reply: FastifyReply, store: AgentTickStore, id: string, workspaceId: string, visibility: { userId?: string; allowWorkspaceRead?: boolean; timeoutMs?: number; waiterId?: string; eventBus?: WorkspaceEventBus }) {
  const timeoutMs = visibility.timeoutMs ?? timeoutFromQuery(request.query);
  const deadline = Date.now() + timeoutMs;
  let record = await getRequestVisibleToWaiter(store, id, workspaceId, visibility);
  if (!record) return reply.status(404).send({ error: { code: 'not_found', message: 'Request not found', requestId: request.id } });

  const abortController = new AbortController();
  request.raw.once('close', () => abortController.abort());
  while (record.status === 'pending' && Date.now() < deadline && !abortController.signal.aborted) {
    const remainingMs = Math.max(0, deadline - Date.now());
    const fallbackPollMs = Math.min(30_000, Math.max(250, remainingMs));
    if (visibility.eventBus) await visibility.eventBus.waitForWorkspaceEvent(workspaceId, fallbackPollMs, abortController.signal);
    else await sleep(Math.min(250, Math.max(25, remainingMs)), undefined, { signal: abortController.signal }).catch(() => undefined);
    record = await getRequestVisibleToWaiter(store, id, workspaceId, visibility);
    if (!record) return reply.status(404).send({ error: { code: 'not_found', message: 'Request not found', requestId: request.id } });
  }
  if (visibility.waiterId && record.status === 'pending') await renewWaiterLease(store, visibility.waiterId, timeoutMs);
  return { request: record, terminal: record.status !== 'pending' };
}

async function renewWaiterLease(store: AgentTickStore, waiterId: string, timeoutMs: number): Promise<void> {
  const now = new Date().toISOString();
  const leaseMs = Math.max(DEFAULT_REQUEST_WAITER_LEASE_MS, timeoutMs + 10_000);
  await store.renewRequestWaiter(waiterId, new Date(Date.parse(now) + leaseMs).toISOString(), now);
}

function timeoutFromQuery(query: unknown): number {
  const value = (query as { timeoutMs?: string | number | undefined }).timeoutMs;
  const parsed = Number(value ?? 30_000);
  if (!Number.isFinite(parsed) || parsed < 0) return 30_000;
  return Math.min(parsed, 300_000);
}

function limitFromQuery(query: unknown): number {
  const value = (query as { limit?: string | number | undefined }).limit;
  const parsed = Number(value ?? 100);
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(Math.trunc(parsed), 1000);
}

function waiterToken(header: string | undefined): string | null {
  const [scheme, token] = header?.split(/\s+/, 2) ?? [];
  if (scheme?.toLowerCase() !== 'bearer' || !token?.startsWith('wait_')) return null;
  return token.trim();
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
