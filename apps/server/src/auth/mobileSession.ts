import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import type { AuthContext } from './context.js';

const ALG = 'HS256';
const TYPE = 'agent-tick-mobile-session';
const ISSUER = 'agent-tick';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

interface MobileSessionClaims {
  typ: typeof TYPE;
  iss: typeof ISSUER;
  sub: string;
  iat: number;
  exp: number;
  clerkIssuer?: string;
  clerkSubject?: string;
  clerkSessionId?: string;
}

export function mintMobileSession(auth: AuthContext, config: ServerConfig, now = Math.floor(Date.now() / 1000)): string {
  if (!auth.userId) throw new Error('Cannot mint a mobile session without a user');
  const claims: MobileSessionClaims = {
    typ: TYPE,
    iss: ISSUER,
    sub: auth.userId,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    ...(auth.providerIssuer ? { clerkIssuer: auth.providerIssuer } : {}),
    ...(auth.providerSubject ? { clerkSubject: auth.providerSubject } : {}),
    ...(auth.sessionId ? { clerkSessionId: auth.sessionId } : {})
  };
  return signJWT({ ...claims }, sessionSecret(config));
}

export async function verifyMobileSession(token: string, config: ServerConfig, store: AgentTickStore, now = Math.floor(Date.now() / 1000)): Promise<AuthContext | null> {
  const claims = verifyJWT(token, sessionSecret(config));
  if (!claims || claims.typ !== TYPE || claims.iss !== ISSUER || typeof claims.sub !== 'string') return null;
  if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
  const membership = await store.defaultMembershipForUser(claims.sub);
  return {
    source: 'clerk',
    isHuman: true,
    userId: claims.sub,
    organizationId: membership.organizationId,
    role: membership.role,
    provider: 'clerk',
    ...(typeof claims.clerkIssuer === 'string' ? { providerIssuer: claims.clerkIssuer } : {}),
    ...(typeof claims.clerkSubject === 'string' ? { providerSubject: claims.clerkSubject } : {}),
    ...(typeof claims.clerkSessionId === 'string' ? { sessionId: claims.clerkSessionId } : {})
  };
}

function signJWT(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: ALG, typ: 'JWT' };
  const signingInput = `${base64UrlJSON(header)}.${base64UrlJSON(payload)}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

function verifyJWT(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signature] = parts as [string, string, string];
  const header = parseBase64UrlJSON(headerPart);
  if (!header || header.alg !== ALG) return null;
  const expected = createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  return parseBase64UrlJSON(payloadPart);
}

function base64UrlJSON(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function parseBase64UrlJSON(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sessionSecret(config: ServerConfig): string {
  const secret = config.sessionSecret || config.clerkSecretKey || config.adminToken;
  if (!secret) throw new Error('Agent Tick session secret is required');
  return secret;
}
