import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { CreateApprovalRequestSchema, RespondApprovalRequestSchema } from '@agent-tick/shared';
import type { AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireAuth, requireHuman } from '../auth/context.js';

export interface ApprovalRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerApprovalRoutes(app: FastifyInstance, { config, store }: ApprovalRoutesOptions): Promise<void> {
  app.get('/v1/approval-requests', async (request) => {
    const auth = await requireAuth(request, config, store);
    return store.listApprovalRequests(auth.organizationId);
  });

  app.post('/v1/approval-requests', async (request) => {
    const auth = await requireAuth(request, config, store);
    const input = CreateApprovalRequestSchema.parse(request.body);
    return store.createApprovalRequest({
      ...input,
      organizationId: auth.organizationId,
      ...(auth.agentId ? { agentId: auth.agentId } : {}),
      ...(auth.isHuman && auth.userId ? { userId: auth.userId } : {})
    });
  });

  app.get('/v1/approval-requests/:id', async (request, reply) => {
    await requireAuth(request, config, store);
    const { id } = request.params as { id: string };
    const approval = store.getApprovalRequest(id);
    if (!approval) return reply.status(404).send({ error: { code: 'not_found', message: 'Approval request not found', requestId: request.id } });
    return approval;
  });

  app.post('/v1/approval-requests/:id/responses', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const { id } = request.params as { id: string };
    const input = RespondApprovalRequestSchema.parse(request.body);
    const approval = store.respondToApprovalRequest(id, input, auth.userId ?? 'usr_default');
    if (!approval) return reply.status(404).send({ error: { code: 'not_found', message: 'Approval request not found', requestId: request.id } });
    return approval;
  });

  app.post('/v1/approval-requests/:id/abandon', async (request, reply) => {
    const auth = await requireAuth(request, config, store);
    const { id } = request.params as { id: string };
    const approval = store.abandonApprovalRequest(id, auth.agentId ?? auth.userId ?? 'unknown');
    if (!approval) return reply.status(404).send({ error: { code: 'not_found', message: 'Approval request not found', requestId: request.id } });
    return approval;
  });

  app.get('/v1/approval-requests/:id/wait', async (request, reply) => {
    await requireAuth(request, config, store);
    const { id } = request.params as { id: string };
    const timeoutMs = timeoutFromQuery(request.query);
    const deadline = Date.now() + timeoutMs;
    let approval = store.getApprovalRequest(id);
    if (!approval) return reply.status(404).send({ error: { code: 'not_found', message: 'Approval request not found', requestId: request.id } });

    while (approval.status === 'pending' && Date.now() < deadline) {
      await sleep(Math.min(250, Math.max(25, deadline - Date.now())));
      approval = store.getApprovalRequest(id);
      if (!approval) return reply.status(404).send({ error: { code: 'not_found', message: 'Approval request not found', requestId: request.id } });
    }

    return { request: approval, terminal: approval.status !== 'pending' };
  });
}

function timeoutFromQuery(query: unknown): number {
  const value = (query as { timeoutMs?: string | number | undefined }).timeoutMs;
  const parsed = Number(value ?? 30_000);
  if (!Number.isFinite(parsed) || parsed < 0) return 30_000;
  return Math.min(parsed, 300_000);
}
