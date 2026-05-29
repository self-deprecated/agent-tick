import type { FastifyInstance } from 'fastify';
import { CreateExternalApproverSchema } from '@self-deprecated/agent-tick-shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireWorkspaceAdmin } from '../auth/context.js';

export async function registerExternalApproverRoutes(app: FastifyInstance, { config, store }: { config: ServerConfig; store: AgentTickStore }): Promise<void> {
  app.post('/v1/external-approvers', async (request) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    const input = CreateExternalApproverSchema.parse(request.body ?? {});
    return store.createExternalApprover(auth.workspaceId, input, auth.userId ?? 'usr_default');
  });

  app.get('/v1/external-approvers/:id/status', async (request, reply) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    const { id } = request.params as { id: string };
    const status = await store.getExternalApproverStatus(id, auth.workspaceId);
    if (!status) return reply.status(404).send({ error: { code: 'not_found', message: 'External Approver not found', requestId: request.id } });
    return status;
  });

  app.post('/v1/external-approvers/:id/invite', async (request, reply) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    const { id } = request.params as { id: string };
    const approver = await store.getExternalApprover(id, auth.workspaceId);
    if (!approver) return reply.status(404).send({ error: { code: 'not_found', message: 'External Approver not found', requestId: request.id } });
    return store.createExternalApproverInvite({
      workspaceId: auth.workspaceId,
      createdByUserId: auth.userId ?? 'usr_default',
      externalApproverId: id,
      ...(approver.displayName ? { displayName: approver.displayName } : {}),
      ...(approver.externalSubject ? { externalSubject: approver.externalSubject } : {}),
      ...(config.publicURL ? { publicURL: config.publicURL } : {})
    });
  });

  app.post('/v1/external-approvers/:id/agent-token', async (request, reply) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    const { id } = request.params as { id: string };
    const credential = await store.createExternalApproverAgentToken(id, auth.workspaceId, auth.userId ?? 'usr_default');
    if (!credential) return reply.status(409).send({ error: { code: 'conflict', message: 'External Approver must accept an invite before creating an Agent Token', requestId: request.id } });
    return credential;
  });
}
