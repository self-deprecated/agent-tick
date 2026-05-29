import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID, type AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { WorkspaceMemberKind, WorkspaceType } from '@self-deprecated/agent-tick-shared';
import type { ServerConfig } from '../config.js';
import { verifyClerkSession } from './clerk.js';
import { verifyMobileSession } from './mobileSession.js';

export type AuthSource = 'loopback' | 'admin' | 'agent' | 'device' | 'mobile' | 'clerk';

export interface AuthContext {
  source: AuthSource;
  isHuman: boolean;
  userId?: string;
  workspaceId: string;
  workspaceType?: WorkspaceType;
  role?: string;
  memberKind?: WorkspaceMemberKind;
  agentTokenId?: string;
  agentTokenLabel?: string;
  creatorUserId?: string;
  routingRuleId?: string;
  deviceId?: string;
  provider?: 'clerk';
  providerIssuer?: string;
  providerSubject?: string;
  sessionId?: string;
}

export async function authenticateRequest(request: FastifyRequest, config: ServerConfig, store: AgentTickStore): Promise<AuthContext | null> {
  const bearer = bearerToken(request.headers.authorization);

  if (config.mode === 'single' && bearer && config.adminToken && timingSafeEqualString(bearer, config.adminToken)) {
    return applySelectedWorkspace(request, store, { source: 'admin', isHuman: true, userId: DEFAULT_USER_ID, workspaceId: DEFAULT_WORKSPACE_ID, workspaceType: 'personal', role: 'owner', memberKind: 'internal' });
  }

  if (bearer?.startsWith('agent_')) {
    const agent = await store.verifyAgentToken(bearer);
    if (!agent) return null;
    return {
      source: 'agent',
      isHuman: false,
      agentTokenId: agent.agentTokenId,
      agentTokenLabel: agent.label,
      ...(agent.creatorUserId ? { creatorUserId: agent.creatorUserId } : {}),
      ...(agent.routingRuleId ? { routingRuleId: agent.routingRuleId } : {}),
      workspaceId: agent.workspaceId,
      workspaceType: agent.workspaceType
    };
  }

  if (config.mode === 'single' && bearer?.startsWith('device_')) {
    const device = await store.verifyDeviceToken(bearer);
    if (!device) return null;
    return applySelectedWorkspace(request, store, { source: 'device', isHuman: true, userId: device.userId, workspaceId: device.workspaceId, role: 'owner', memberKind: 'internal', deviceId: device.deviceId });
  }

  if (config.mode === 'single' && !config.adminToken && !bearer && isLoopback(request.ip)) {
    return applySelectedWorkspace(request, store, { source: 'loopback', isHuman: true, userId: DEFAULT_USER_ID, workspaceId: DEFAULT_WORKSPACE_ID, workspaceType: 'personal', role: 'owner', memberKind: 'internal' });
  }

  if (config.testAuth && bearer?.startsWith('test_')) {
    const subject = bearer.slice('test_'.length) || 'user';
    const emailHeader = request.headers['x-agent-tick-test-email'];
    const nameHeader = request.headers['x-agent-tick-test-name'];
    const email = (Array.isArray(emailHeader) ? emailHeader[0] : emailHeader) || `${subject}@example.test`;
    const name = (Array.isArray(nameHeader) ? nameHeader[0] : nameHeader) || subject;
    const identity = await store.loginOrCreateClerkIdentity({ issuer: 'agent-tick-test', subject, email, emailVerified: true, name });
    return applySelectedWorkspace(request, store, {
      source: 'clerk',
      isHuman: true,
      userId: identity.userId,
      workspaceId: identity.workspaceId,
      workspaceType: identity.workspaceType,
      role: identity.role,
      memberKind: identity.memberKind,
      provider: 'clerk',
      providerIssuer: 'agent-tick-test',
      providerSubject: subject
    });
  }

  if (config.mode === 'clerk' && bearer) {
    const mobileAuth = await verifyMobileSession(bearer, config, store);
    if (mobileAuth) return applySelectedWorkspace(request, store, mobileAuth);
    const clerkAuth = await verifyClerkSession(bearer, config, store);
    return clerkAuth ? applySelectedWorkspace(request, store, clerkAuth) : null;
  }

  return null;
}

export async function requireAuth(request: FastifyRequest, config: ServerConfig, store: AgentTickStore): Promise<AuthContext> {
  const auth = await authenticateRequest(request, config, store);
  if (!auth) throw httpError(401, 'not_authenticated', 'Authentication required');
  return auth;
}

export async function requireHuman(request: FastifyRequest, config: ServerConfig, store: AgentTickStore): Promise<AuthContext> {
  const auth = await requireAuth(request, config, store);
  if (!auth.isHuman) throw httpError(403, 'forbidden', 'Human authentication required');
  return auth;
}

export async function requirePrivilegedHuman(request: FastifyRequest, config: ServerConfig, store: AgentTickStore): Promise<AuthContext> {
  const auth = await requireHuman(request, config, store);
  if (auth.source === 'device' || auth.source === 'mobile') throw httpError(403, 'forbidden', 'Dashboard or Clerk session required');
  return auth;
}

export async function requireInternalWorkspaceMember(request: FastifyRequest, config: ServerConfig, store: AgentTickStore): Promise<AuthContext> {
  const auth = await requireHuman(request, config, store);
  if (auth.memberKind === 'external_approver') throw httpError(403, 'forbidden', 'Internal Workspace member required');
  return auth;
}

export async function requireWorkspaceAdmin(request: FastifyRequest, config: ServerConfig, store: AgentTickStore): Promise<AuthContext> {
  const auth = await requirePrivilegedHuman(request, config, store);
  if (auth.memberKind === 'external_approver') throw httpError(403, 'forbidden', 'Internal Workspace admin required');
  if (auth.role !== 'owner' && auth.role !== 'admin') throw httpError(403, 'forbidden', 'Workspace Owner or Admin role required');
  return auth;
}

async function applySelectedWorkspace(request: FastifyRequest, store: AgentTickStore, auth: AuthContext): Promise<AuthContext> {
  if (!auth.isHuman || !auth.userId) return auth;
  const targetWorkspaceId = selectedWorkspace(request) ?? auth.workspaceId;
  const membership = await store.workspaceMembershipForUser(auth.userId, targetWorkspaceId);
  if (!membership) throw httpError(403, 'forbidden', 'User is not a member of the selected Workspace');
  return { ...auth, workspaceId: membership.workspaceId, workspaceType: membership.workspaceType, role: membership.role, memberKind: membership.memberKind };
}

function selectedWorkspace(request: FastifyRequest): string | undefined {
  const header = request.headers['x-agent-tick-workspace-id'];
  return Array.isArray(header) ? header[0] : header;
}

function bearerToken(header: string | undefined): string | null {
  const [scheme, token] = header?.split(/\s+/, 2) ?? [];
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function httpError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
