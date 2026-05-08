import type { FastifyInstance } from 'fastify';
import { CreateOrganizationInviteSchema } from '@agent-tick/shared';
import type { AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman, requirePrivilegedHuman, type AuthContext } from '../auth/context.js';

export interface InviteRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerInviteRoutes(app: FastifyInstance, { config, store }: InviteRoutesOptions): Promise<void> {
  app.get('/v1/organization-invites', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    requireOrganizationAdmin(auth);
    return store.listOrganizationInvites(auth.organizationId);
  });

  app.post('/v1/organization-invites', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    requireOrganizationAdmin(auth);
    const input = CreateOrganizationInviteSchema.parse(request.body);
    assertCanCreateInvite(auth, input.role, input.approvalRequired);
    return store.createOrganizationInvite({
      organizationId: auth.organizationId,
      userId: auth.userId ?? 'usr_default',
      role: input.role,
      approvalRequired: input.approvalRequired,
      maxUses: input.maxUses,
      ...(input.teamIds ? { teamIds: input.teamIds } : {}),
      ...(config.publicURL ? { publicURL: config.publicURL } : {}),
      ...(input.label ? { label: input.label } : {}),
      ...(input.email ? { email: input.email } : {}),
      ...(input.domain ? { domain: input.domain } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {})
    });
  });

  app.post('/v1/organization-invites/:id/revoke', async (request, reply) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    requireOrganizationAdmin(auth);
    const { id } = request.params as { id: string };
    const invite = store.revokeOrganizationInvite(id, auth.organizationId, auth.userId ?? 'usr_default');
    if (!invite) return reply.status(404).send({ error: { code: 'not_found', message: 'Invite not found', requestId: request.id } });
    return invite;
  });

  app.get('/v1/me/organization-membership-requests', async (request) => {
    const auth = await requireHuman(request, config, store);
    return store.listOrganizationMembershipRequestsForUser(auth.userId ?? 'usr_default');
  });

  app.get('/v1/organization-membership-requests', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    requireOrganizationAdmin(auth);
    return store.listOrganizationMembershipRequests(auth.organizationId);
  });

  app.post('/v1/organization-membership-requests/:id/approve', async (request, reply) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    requireOrganizationAdmin(auth);
    const { id } = request.params as { id: string };
    const result = store.approveOrganizationMembershipRequest(id, auth.organizationId, auth.userId ?? 'usr_default');
    if (!result) return reply.status(404).send({ error: { code: 'not_found', message: 'Membership request not found', requestId: request.id } });
    return result;
  });

  app.post('/v1/organization-membership-requests/:id/reject', async (request, reply) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    requireOrganizationAdmin(auth);
    const { id } = request.params as { id: string };
    const result = store.rejectOrganizationMembershipRequest(id, auth.organizationId, auth.userId ?? 'usr_default');
    if (!result) return reply.status(404).send({ error: { code: 'not_found', message: 'Membership request not found', requestId: request.id } });
    return result;
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

function requireOrganizationAdmin(auth: AuthContext): void {
  if (auth.role === 'owner' || auth.role === 'admin') return;
  const error = new Error('Organization admin role required') as Error & { statusCode: number; code: string };
  error.statusCode = 403;
  error.code = 'forbidden';
  throw error;
}

function assertCanCreateInvite(auth: AuthContext, role: string, approvalRequired: boolean): void {
  if ((role === 'admin' || role === 'owner') && auth.role !== 'owner') {
    const error = new Error('Only organization owners can create admin invites') as Error & { statusCode: number; code: string };
    error.statusCode = 403;
    error.code = 'forbidden';
    throw error;
  }
  if (!approvalRequired && auth.role !== 'owner') {
    const error = new Error('Only organization owners can create auto-approved invites') as Error & { statusCode: number; code: string };
    error.statusCode = 403;
    error.code = 'forbidden';
    throw error;
  }
}
