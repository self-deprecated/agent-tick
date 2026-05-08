import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CreateApprovalRequestSchema, RespondApprovalRequestSchema } from '@agent-tick/shared';
import type { AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import type { ApprovalNotifier } from '../services/notifications.js';
import { authenticateRequest, requireAuth, requireHuman } from '../auth/context.js';

export interface ApprovalRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
  notifier?: ApprovalNotifier;
}

export async function registerApprovalRoutes(app: FastifyInstance, { config, store, notifier }: ApprovalRoutesOptions): Promise<void> {
  app.get('/v1/approval-requests', async (request) => {
    const auth = await requireHuman(request, config, store);
    return store.listApprovalRequests(auth.organizationId, auth.userId);
  });

  app.post('/v1/approval-requests', async (request) => {
    const auth = await requireAuth(request, config, store);
    const input = CreateApprovalRequestSchema.parse(request.body);
    const approval = store.createApprovalRequest({
      ...input,
      requester: {
        ...input.requester,
        ...(auth.agentId ? { agentId: auth.agentId } : {}),
        ...(auth.projectId && !input.requester.projectId ? { projectId: auth.projectId } : {})
      },
      metadata: {
        ...(input.metadata ?? {}),
        ...(auth.teamId ? { teamId: auth.teamId } : {}),
        ...(auth.defaultApprovalPolicy ? { defaultApprovalPolicy: auth.defaultApprovalPolicy } : {})
      },
      organizationId: auth.organizationId,
      ...(auth.agentId ? { agentId: auth.agentId } : {}),
      ...(auth.isHuman && auth.userId ? { userId: auth.userId } : {})
    });
    notifier?.notifyApprovalCreated(approval).catch((error) => request.log.error({ err: error, approvalId: approval.id }, 'approval notification failed'));
    return {
      request: approval,
      ...(auth.agentId ? { waiter: store.createApprovalWaiterToken(approval.id, approval.organizationId ?? auth.organizationId, auth.agentId, approval.expiresAt) } : {})
    };
  });

  app.get('/v1/approval-requests/:id', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const { id } = request.params as { id: string };
    const approval = store.getApprovalRequestForOrganization(id, auth.organizationId, auth.userId);
    if (!approval) return reply.status(404).send({ error: { code: 'not_found', message: 'Approval request not found', requestId: request.id } });
    return approval;
  });

  app.post('/v1/approval-requests/:id/responses', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const { id } = request.params as { id: string };
    const input = RespondApprovalRequestSchema.parse(request.body);
    const approval = store.respondToApprovalRequestForOrganization(id, auth.organizationId, input, auth.userId ?? 'usr_default');
    if (!approval) return reply.status(404).send({ error: { code: 'not_found', message: 'Approval request not found', requestId: request.id } });
    return approval;
  });

  app.post('/v1/approval-requests/:id/abandon', async (request, reply) => {
    const auth = await requireAuth(request, config, store);
    const { id } = request.params as { id: string };
    const existing = store.getApprovalRequestForOrganization(id, auth.organizationId);
    if (!existing) return reply.status(404).send({ error: { code: 'not_found', message: 'Approval request not found', requestId: request.id } });
    if (auth.agentId && existing.requester.agentId !== auth.agentId) {
      return reply.status(403).send({ error: { code: 'forbidden', message: 'Agent tokens can only abandon requests they created', requestId: request.id } });
    }
    const approval = store.abandonApprovalRequestForOrganization(id, auth.organizationId, auth.agentId ?? auth.userId ?? 'unknown');
    if (!approval) return reply.status(404).send({ error: { code: 'not_found', message: 'Approval request not found', requestId: request.id } });
    return approval;
  });

  app.get('/v1/approval-requests/:id/wait', async (request, reply) => {
    const { id } = request.params as { id: string };
    const waiter = waiterToken(request.headers.authorization);
    if (waiter) {
      const waiterAuth = store.verifyApprovalWaiterToken(waiter, id);
      if (!waiterAuth) return reply.status(401).send({ error: { code: 'not_authenticated', message: 'Invalid or expired waiter token', requestId: request.id } });
      return waitForApproval(request, reply, store, id, waiterAuth.organizationId);
    }

    const auth = await authenticateRequest(request, config, store);
    if (!auth || !auth.isHuman) {
      return reply.status(auth ? 403 : 401).send({ error: { code: auth ? 'forbidden' : 'not_authenticated', message: auth ? 'Human authentication or waiter token required' : 'Authentication required', requestId: request.id } });
    }
    return waitForApproval(request, reply, store, id, auth.organizationId, auth.userId);
  });
}

async function waitForApproval(request: FastifyRequest, reply: FastifyReply, store: AgentTickStore, id: string, organizationId: string, userId?: string) {
  const timeoutMs = timeoutFromQuery(request.query);
  const deadline = Date.now() + timeoutMs;
  let approval = store.getApprovalRequestForOrganization(id, organizationId, userId);
  if (!approval) return reply.status(404).send({ error: { code: 'not_found', message: 'Approval request not found', requestId: request.id } });

  while (approval.status === 'pending' && Date.now() < deadline) {
    await sleep(Math.min(250, Math.max(25, deadline - Date.now())));
    approval = store.getApprovalRequestForOrganization(id, organizationId, userId);
    if (!approval) return reply.status(404).send({ error: { code: 'not_found', message: 'Approval request not found', requestId: request.id } });
  }

  return { request: approval, terminal: approval.status !== 'pending' };
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
