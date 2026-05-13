import type { FastifyInstance } from 'fastify';
import { CreateOrganizationInviteSchema, type InviteEmailDelivery } from '@agent-tick/shared';
import type { AsyncAgentTickStore as AgentTickStore, OrganizationInviteRecord } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman, requirePrivilegedHuman, type AuthContext } from '../auth/context.js';
import type { InviteEmailSender } from '../services/inviteEmail.js';

export interface InviteRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
  inviteEmailSender: InviteEmailSender;
}

export async function registerInviteRoutes(app: FastifyInstance, { config, store, inviteEmailSender }: InviteRoutesOptions): Promise<void> {
  app.get('/v1/organization-invites', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    requireOrganizationAdmin(auth);
    return await store.listOrganizationInvites(auth.organizationId);
  });

  app.post('/v1/organization-invites', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    requireOrganizationAdmin(auth);
    const input = CreateOrganizationInviteSchema.parse(request.body);
    assertCanCreateInvite(auth, input.role, input.approvalRequired);
    const invite = await store.createOrganizationInvite({
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
    return input.email ? deliverInviteEmail({ invite, auth, store, inviteEmailSender }) : invite;
  });

  app.post('/v1/organization-invites/:id/revoke', async (request, reply) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    requireOrganizationAdmin(auth);
    const { id } = request.params as { id: string };
    const invite = await store.revokeOrganizationInvite(id, auth.organizationId, auth.userId ?? 'usr_default');
    if (!invite) return reply.status(404).send({ error: { code: 'not_found', message: 'Invite not found', requestId: request.id } });
    return invite;
  });

  app.post('/v1/organization-invites/:id/resend', async (request, reply) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    requireOrganizationAdmin(auth);
    const { id } = request.params as { id: string };
    const existing = await store.getOrganizationInvite(id);
    if (!existing || existing.organizationId !== auth.organizationId || existing.revokedAt) return reply.status(404).send({ error: { code: 'not_found', message: 'Invite not found', requestId: request.id } });
    assertCanCreateInvite(auth, existing.role, existing.approvalRequired);
    const invite = config.publicURL && config.inviteEmailWebhookURL && existing.email
      ? await store.rotateOrganizationInviteToken(id, auth.organizationId, auth.userId ?? 'usr_default', new Date().toISOString(), config.publicURL)
      : existing;
    if (!invite) return reply.status(404).send({ error: { code: 'not_found', message: 'Invite not found or inactive', requestId: request.id } });
    const delivered = await deliverInviteEmail({ invite, auth, store, inviteEmailSender });
    return { invite: withoutInviteSecret(delivered), delivery: delivered.emailDelivery };
  });

  app.get('/v1/me/organization-membership-requests', async (request) => {
    const auth = await requireHuman(request, config, store);
    return await store.listOrganizationMembershipRequestsForUser(auth.userId ?? 'usr_default');
  });

  app.get('/v1/organization-membership-requests', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    requireOrganizationAdmin(auth);
    return await store.listOrganizationMembershipRequests(auth.organizationId);
  });

  app.post('/v1/organization-membership-requests/:id/approve', async (request, reply) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    requireOrganizationAdmin(auth);
    const { id } = request.params as { id: string };
    const result = await store.approveOrganizationMembershipRequest(id, auth.organizationId, auth.userId ?? 'usr_default', new Date().toISOString(), activationLimits(config));
    if (!result) return reply.status(404).send({ error: { code: 'not_found', message: 'Membership request not found', requestId: request.id } });
    return result;
  });

  app.post('/v1/organization-membership-requests/:id/reject', async (request, reply) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    requireOrganizationAdmin(auth);
    const { id } = request.params as { id: string };
    const result = await store.rejectOrganizationMembershipRequest(id, auth.organizationId, auth.userId ?? 'usr_default');
    if (!result) return reply.status(404).send({ error: { code: 'not_found', message: 'Membership request not found', requestId: request.id } });
    return result;
  });

  app.get('/v1/invites/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const preview = await store.previewInvite(token);
    if (!preview) return reply.status(404).send({ error: { code: 'not_found', message: 'Invite not found or expired', requestId: request.id } });
    return preview;
  });

  app.post('/v1/invites/:token/accept', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const { token } = request.params as { token: string };
    const accepted = await store.acceptInvite(token, auth.userId ?? 'usr_default', new Date().toISOString(), activationLimits(config));
    if (!accepted) return reply.status(404).send({ error: { code: 'not_found', message: 'Invite not found or expired', requestId: request.id } });
    return accepted;
  });
}

async function deliverInviteEmail({ invite, auth, store, inviteEmailSender }: { invite: OrganizationInviteRecord; auth: AuthContext; store: AgentTickStore; inviteEmailSender: InviteEmailSender }): Promise<OrganizationInviteRecord & { emailDelivery: InviteEmailDelivery }> {
  let delivery: InviteEmailDelivery;
  try {
    delivery = await inviteEmailSender.sendInvite({ invite, organizationName: await store.organizationName(invite.organizationId), url: invite.url });
  } catch (error) {
    delivery = { status: 'failed', ...(invite.email ? { recipient: invite.email } : {}), message: error instanceof Error ? error.message : 'Invite email delivery failed' };
  }
  const recorded = await store.recordOrganizationInviteEmailDelivery(invite.inviteId, invite.organizationId, auth.userId ?? 'usr_default', delivery.status, delivery.status === 'failed' || delivery.status === 'skipped' ? delivery.message : undefined, delivery.sentAt ?? new Date().toISOString());
  return {
    ...invite,
    emailLastStatus: recorded?.emailLastStatus ?? delivery.status,
    emailLastSentAt: recorded?.emailLastSentAt,
    emailLastError: recorded?.emailLastError,
    emailDelivery: delivery
  };
}

function withoutInviteSecret(invite: OrganizationInviteRecord & { emailDelivery?: InviteEmailDelivery }): OrganizationInviteRecord {
  const { token: _token, url: _url, emailDelivery: _delivery, ...safeInvite } = invite;
  return safeInvite;
}

function activationLimits(config: ServerConfig): { maxActiveMembers?: number } {
  return config.maxActiveMembers === undefined ? {} : { maxActiveMembers: config.maxActiveMembers };
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
