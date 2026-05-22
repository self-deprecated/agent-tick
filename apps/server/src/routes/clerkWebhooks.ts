import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';

export interface ClerkWebhookRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerClerkWebhookRoutes(app: FastifyInstance, { config, store }: ClerkWebhookRoutesOptions): Promise<void> {
  app.post('/v1/clerk/webhooks', async (request, reply) => {
    if (!config.testAuth) verifySvixSignature(request, config);
    const event = request.body as { type?: string; data?: Record<string, unknown> };
    if (!event?.type || !event.data) return reply.status(400).send({ error: { code: 'bad_request', message: 'Invalid Clerk webhook payload', requestId: request.id } });
    await processClerkEvent(store, config, event.type, event.data);
    return { processed: true };
  });
}

async function processClerkEvent(store: AgentTickStore, config: ServerConfig, type: string, data: Record<string, unknown>): Promise<void> {
  const issuer = clerkIssuer(config);
  if (type === 'user.created' || type === 'user.updated') {
    await store.upsertClerkUser(clerkProfileFromUser(data, issuer));
    return;
  }
  if (type === 'user.deleted') {
    const subject = stringField(data.id);
    if (!subject) return;
    const userId = await store.userIdForClerkSubject(issuer, subject);
    if (userId) await store.revokeUserAccess(userId);
    return;
  }
  if (type === 'organization.created' || type === 'organization.updated') {
    const clerkOrganizationId = stringField(data.id);
    if (!clerkOrganizationId) return;
    await store.upsertClerkWorkspace(clerkOrganizationId, workspaceNameFromClerkOrganization(data));
    return;
  }
  if (type === 'organization.deleted') {
    const clerkOrganizationId = stringField(data.id);
    if (!clerkOrganizationId) return;
    const workspace = await store.workspaceByClerkOrganizationId(clerkOrganizationId);
    if (workspace) await store.deleteWorkspaceData(workspace.workspaceId);
    return;
  }
  if (type === 'organizationMembership.created' || type === 'organizationMembership.updated') {
    await upsertMembership(store, config, data);
    return;
  }
  if (type === 'organizationMembership.deleted') {
    const clerkOrganizationId = clerkOrgIdFromMembership(data);
    const membershipId = stringField(data.id);
    const subject = clerkUserIdFromMembership(data);
    if (clerkOrganizationId) await store.removeClerkWorkspaceMember(clerkOrganizationId, membershipId ?? subject ?? '');
  }
}

async function upsertMembership(store: AgentTickStore, config: ServerConfig, data: Record<string, unknown>): Promise<void> {
  const clerkOrganizationId = clerkOrgIdFromMembership(data);
  const subject = clerkUserIdFromMembership(data);
  if (!clerkOrganizationId || !subject) return;
  const org = objectField(data.organization) ?? {};
  await store.upsertClerkWorkspace(clerkOrganizationId, workspaceNameFromClerkOrganization(org));
  let userId = await store.userIdForClerkSubject(clerkIssuer(config), subject);
  if (!userId) {
    const publicUser = objectField(data.public_user_data) ?? objectField(data.user) ?? { id: subject };
    userId = await store.upsertClerkUser(clerkProfileFromUser({ ...publicUser, id: subject }, clerkIssuer(config)));
  }
  await store.upsertClerkWorkspaceMember(clerkOrganizationId, stringField(data.id), userId, mapClerkRole(stringField(data.role)));
}

function verifySvixSignature(request: FastifyRequest, config: ServerConfig): void {
  const secret = config.clerkWebhookSecret;
  if (!secret) throw httpError(503, 'not_configured', 'Clerk webhook secret is not configured');
  const id = header(request, 'svix-id');
  const timestamp = header(request, 'svix-timestamp');
  const signature = header(request, 'svix-signature');
  if (!id || !timestamp || !signature) throw httpError(401, 'not_authenticated', 'Missing Clerk webhook signature');
  const body = JSON.stringify(request.body ?? {});
  const signedContent = `${id}.${timestamp}.${body}`;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(signedContent).digest('base64');
  const signatures = Array.from(signature.matchAll(/v1[,=]([^,\s]+)/g), (match) => match[1]).filter((value): value is string => Boolean(value));
  if (!signatures.some((candidate) => safeEqual(candidate, expected))) throw httpError(401, 'not_authenticated', 'Invalid Clerk webhook signature');
}

function clerkProfileFromUser(data: Record<string, unknown>, issuer: string) {
  const subject = stringField(data.id) ?? stringField(data.user_id) ?? 'unknown';
  const email = primaryEmail(data);
  return {
    issuer,
    subject,
    email: email || `${subject}@unknown.invalid`,
    emailVerified: Boolean(email),
    name: [stringField(data.first_name), stringField(data.last_name)].filter(Boolean).join(' ') || stringField(data.username) || email || subject,
    authMethod: 'Clerk'
  };
}

function primaryEmail(data: Record<string, unknown>): string | undefined {
  const direct = stringField(data.email_address) ?? stringField(data.email);
  if (direct) return direct;
  const primaryId = stringField(data.primary_email_address_id);
  const emails = arrayField(data.email_addresses);
  const primary = emails.find((entry) => stringField(entry.id) === primaryId) ?? emails[0];
  return primary ? stringField(primary.email_address) ?? stringField(primary.email) : undefined;
}

function clerkOrgIdFromMembership(data: Record<string, unknown>): string | undefined {
  return stringField(data.organization_id) ?? stringField(objectField(data.organization)?.id);
}

function clerkUserIdFromMembership(data: Record<string, unknown>): string | undefined {
  return stringField(data.user_id) ?? stringField(objectField(data.public_user_data)?.user_id) ?? stringField(objectField(data.user)?.id);
}

function workspaceNameFromClerkOrganization(data: Record<string, unknown>): string {
  return stringField(data.name) ?? stringField(data.slug) ?? 'Shared Workspace';
}

function mapClerkRole(role: string | undefined): 'owner' | 'admin' | 'member' {
  const normalized = role?.replace(/^org:/, '').toLowerCase();
  if (normalized === 'owner') return 'owner';
  if (normalized === 'admin') return 'admin';
  return 'member';
}

function clerkIssuer(config: ServerConfig): string {
  const publishableKey = config.clerkPublishableKey;
  if (publishableKey?.startsWith('pk_')) {
    const encoded = publishableKey.split('_').slice(2).join('_');
    try {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8').replace(/\$$/, '');
      if (decoded) return `https://${decoded}`;
    } catch {
      // Use fallback below.
    }
  }
  return 'clerk';
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function objectField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function arrayField(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(objectField(entry))) : [];
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function httpError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
