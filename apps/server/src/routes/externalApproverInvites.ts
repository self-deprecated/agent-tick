import type { FastifyInstance } from 'fastify';
import { CreateExternalApproverInviteSchema } from '@self-deprecated/agent-tick-shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman, requireWorkspaceAdmin } from '../auth/context.js';

export interface ExternalApproverInviteRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerExternalApproverInviteRoutes(app: FastifyInstance, { config, store }: ExternalApproverInviteRoutesOptions): Promise<void> {
  app.post('/v1/workspaces/:id/external-approver-invites', async (request, reply) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    const { id } = request.params as { id: string };
    if (id !== auth.workspaceId) return reply.status(403).send({ error: { code: 'forbidden', message: 'Select the Workspace before creating invites', requestId: request.id } });
    const input = CreateExternalApproverInviteSchema.parse(request.body ?? {});
    return store.createExternalApproverInvite({
      workspaceId: id,
      createdByUserId: auth.userId ?? 'usr_default',
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.externalSubject ? { externalSubject: input.externalSubject } : {}),
      ...(input.externalApproverId ? { externalApproverId: input.externalApproverId } : {}),
      expiresInMinutes: input.expiresInMinutes,
      ...(config.publicURL ? { publicURL: config.publicURL } : {})
    });
  });

  app.get('/v1/external-approver-invites/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const invite = await store.getExternalApproverInviteByToken(token);
    if (!invite) return reply.status(404).send({ error: { code: 'not_found', message: 'External Approver invite not found', requestId: request.id } });
    return invite;
  });

  app.post('/v1/external-approver-invites/:token/accept', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const { token } = request.params as { token: string };
    const membership = await store.acceptExternalApproverInvite(token, auth.userId ?? 'usr_default');
    if (!membership) return reply.status(404).send({ error: { code: 'not_found', message: 'External Approver invite not found', requestId: request.id } });
    return membership;
  });

  app.post('/v1/external-approver-invites/:inviteId/revoke', async (request, reply) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    const { inviteId } = request.params as { inviteId: string };
    const invite = await store.revokeExternalApproverInvite(inviteId, auth.workspaceId);
    if (!invite) return reply.status(404).send({ error: { code: 'not_found', message: 'External Approver invite not found', requestId: request.id } });
    return invite;
  });

  app.post('/v1/workspaces/:id/external-approver-invites/:inviteId/revoke', async (request, reply) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    const { id, inviteId } = request.params as { id: string; inviteId: string };
    if (id !== auth.workspaceId) return reply.status(403).send({ error: { code: 'forbidden', message: 'Select the Workspace before revoking invites', requestId: request.id } });
    const invite = await store.revokeExternalApproverInvite(inviteId, id);
    if (!invite) return reply.status(404).send({ error: { code: 'not_found', message: 'External Approver invite not found', requestId: request.id } });
    return invite;
  });
}
