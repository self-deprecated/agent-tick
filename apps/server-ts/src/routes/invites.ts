import type { FastifyInstance } from 'fastify';
import { CreateOrganizationInviteSchema } from '@agent-tick/shared';
import type { AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman, requirePrivilegedHuman } from '../auth/context.js';

export interface InviteRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerInviteRoutes(app: FastifyInstance, { config, store }: InviteRoutesOptions): Promise<void> {
  app.get('/v1/organization-invites', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    return store.listOrganizationInvites(auth.organizationId);
  });

  app.post('/v1/organization-invites', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    const input = CreateOrganizationInviteSchema.parse(request.body);
    return store.createOrganizationInvite({
      organizationId: auth.organizationId,
      userId: auth.userId ?? 'usr_default',
      role: input.role,
      maxUses: input.maxUses,
      ...(config.publicURL ? { publicURL: config.publicURL } : {}),
      ...(input.label ? { label: input.label } : {}),
      ...(input.email ? { email: input.email } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {})
    });
  });

  app.post('/v1/organization-invites/:id/revoke', async (request, reply) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    const { id } = request.params as { id: string };
    const invite = store.revokeOrganizationInvite(id, auth.organizationId, auth.userId ?? 'usr_default');
    if (!invite) return reply.status(404).send({ error: { code: 'not_found', message: 'Invite not found', requestId: request.id } });
    return invite;
  });

  app.get('/v1/invites/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const preview = store.previewInvite(token);
    if (!preview) return reply.status(404).send({ error: { code: 'not_found', message: 'Invite not found or expired', requestId: request.id } });
    return preview;
  });

  app.post('/v1/invites/:token/accept', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const { token } = request.params as { token: string };
    const accepted = store.acceptInvite(token, auth.userId ?? 'usr_default');
    if (!accepted) return reply.status(404).send({ error: { code: 'not_found', message: 'Invite not found or expired', requestId: request.id } });
    return accepted;
  });
}
