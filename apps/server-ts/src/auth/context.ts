import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { DEFAULT_ORGANIZATION_ID, DEFAULT_USER_ID, type AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { verifyClerkSession } from './clerk.js';

export type AuthSource = 'loopback' | 'admin' | 'agent' | 'clerk';

export interface AuthContext {
  source: AuthSource;
  isHuman: boolean;
  userId?: string;
  organizationId: string;
  role?: string;
  agentId?: string;
  provider?: 'clerk';
  providerIssuer?: string;
  providerSubject?: string;
  sessionId?: string;
}

export async function authenticateRequest(request: FastifyRequest, config: ServerConfig, store: AgentTickStore): Promise<AuthContext | null> {
  const bearer = bearerToken(request.headers.authorization);
  if (bearer?.startsWith('agent_')) {
    const agent = store.verifyAgentToken(bearer);
    if (agent) {
      return {
        source: 'agent',
        isHuman: false,
        agentId: agent.agentId,
        organizationId: agent.organizationId
      };
    }
  }

  if (config.mode === 'single') {
    if (bearer && config.adminToken && timingSafeEqualString(bearer, config.adminToken)) {
      return {
        source: 'admin',
        isHuman: true,
        userId: DEFAULT_USER_ID,
        organizationId: selectedOrganization(request) ?? DEFAULT_ORGANIZATION_ID,
        role: 'owner'
      };
    }

    if (!config.adminToken && isLoopback(request.ip)) {
      return {
        source: 'loopback',
        isHuman: true,
        userId: DEFAULT_USER_ID,
        organizationId: selectedOrganization(request) ?? DEFAULT_ORGANIZATION_ID,
        role: 'owner'
      };
    }
  }

  if (config.mode === 'clerk' && bearer) {
    return verifyClerkSession(bearer, config, store);
  }

  return null;
}

export async function requireAuth(request: FastifyRequest, config: ServerConfig, store: AgentTickStore): Promise<AuthContext> {
  const auth = await authenticateRequest(request, config, store);
  if (!auth) {
    const error = new Error('Authentication required') as Error & { statusCode: number; code: string };
    error.statusCode = 401;
    error.code = 'not_authenticated';
    throw error;
  }
  return auth;
}

export async function requireHuman(request: FastifyRequest, config: ServerConfig, store: AgentTickStore): Promise<AuthContext> {
  const auth = await requireAuth(request, config, store);
  if (!auth.isHuman) {
    const error = new Error('Human authentication required') as Error & { statusCode: number; code: string };
    error.statusCode = 403;
    error.code = 'forbidden';
    throw error;
  }
  return auth;
}

function bearerToken(header: string | undefined): string | null {
  const [scheme, token] = header?.split(/\s+/, 2) ?? [];
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

function selectedOrganization(request: FastifyRequest): string | undefined {
  const header = request.headers['x-agent-tick-organization-id'];
  return Array.isArray(header) ? header[0] : header;
}

function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
