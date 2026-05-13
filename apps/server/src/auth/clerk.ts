import { createClerkClient, verifyToken } from '@clerk/backend';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import type { AuthContext } from './context.js';

const CLERK_PROFILE_CACHE_TTL_MS = 60_000;
const clerkProfileCache = new Map<string, { expiresAt: number; profile: ClerkProfile }>();

type ClerkProfile = { email: string; emailVerified: boolean; name: string; authMethod?: string };

export function clearClerkProfileCacheForTests(): void {
  clerkProfileCache.clear();
}

export async function verifyClerkSession(token: string, config: ServerConfig, store: AgentTickStore): Promise<AuthContext | null> {
  if (config.mode !== 'clerk' || !looksLikeJWT(token)) return null;
  return verifyClerkSessionJwt(token, config, store);
}

export async function verifyClerkLoginToken(token: string, config: ServerConfig, store: AgentTickStore): Promise<AuthContext | null> {
  if (config.mode !== 'clerk') return null;
  if (config.testAuth && token.startsWith('test_')) {
    const subject = token.slice('test_'.length) || 'user';
    const identity = await store.loginOrCreateClerkIdentity({
      issuer: 'agent-tick-test',
      subject,
      email: `${subject}@example.test`,
      emailVerified: true,
      name: subject,
      authMethod: 'Test'
    });
    return {
      source: 'clerk',
      isHuman: true,
      userId: identity.userId,
      organizationId: identity.organizationId,
      role: identity.role,
      provider: 'clerk',
      providerIssuer: 'agent-tick-test',
      providerSubject: subject
    };
  }
  if (looksLikeJWT(token)) {
    const sessionAuth = await verifyClerkSessionJwt(token, config, store);
    if (sessionAuth) return sessionAuth;
  }
  return verifyClerkClientToken(token, config, store);
}

async function verifyClerkSessionJwt(token: string, config: ServerConfig, store: AgentTickStore): Promise<AuthContext | null> {
  let payload: unknown;
  try {
    payload = await verifyToken(token, {
      secretKey: config.clerkSecretKey,
      ...(config.clerkJwtKey ? { jwtKey: config.clerkJwtKey } : {}),
      ...(config.clerkAuthorizedParties.length ? { authorizedParties: config.clerkAuthorizedParties } : {})
    });
  } catch {
    return null;
  }

  const subject = stringClaim(payload, 'sub');
  const issuer = stringClaim(payload, 'iss');
  const sessionId = stringClaim(payload, 'sid');
  if (!subject || !issuer) return null;
  return authContextForClerkUser({ subject, issuer, sessionId, config, store });
}

async function verifyClerkClientToken(token: string, config: ServerConfig, store: AgentTickStore): Promise<AuthContext | null> {
  if (!config.clerkSecretKey) return null;
  try {
    const clerk = createClerkClient({ secretKey: config.clerkSecretKey });
    const client = await clerk.clients.verifyClient(token);
    const session = client.sessions.find((candidate) => candidate.id === client.lastActiveSessionId) ?? client.sessions[0];
    if (!session || session.status !== 'active') return null;
    return authContextForClerkUser({
      subject: session.userId,
      issuer: clerkIssuer(config),
      sessionId: session.id,
      config,
      store
    });
  } catch {
    return null;
  }
}

async function authContextForClerkUser({
  subject,
  issuer,
  sessionId,
  config,
  store
}: {
  subject: string;
  issuer: string;
  sessionId?: string | null;
  config: ServerConfig;
  store: AgentTickStore;
}): Promise<AuthContext | null> {
  const profile = await fetchClerkProfile(subject, config);
  const identity = await store.loginOrCreateClerkIdentity({
    issuer,
    subject,
    email: profile.email,
    emailVerified: profile.emailVerified,
    name: profile.name,
    ...(profile.authMethod ? { authMethod: profile.authMethod } : {})
  });

  return {
    source: 'clerk',
    isHuman: true,
    userId: identity.userId,
    organizationId: identity.organizationId,
    role: identity.role,
    provider: 'clerk',
    providerIssuer: issuer,
    providerSubject: subject,
    ...(sessionId ? { sessionId } : {})
  };
}

async function fetchClerkProfile(userId: string, config: ServerConfig): Promise<ClerkProfile> {
  if (!config.clerkSecretKey) throw new Error('Clerk secret key is required');
  const cacheKey = `${config.clerkSecretKey}:${userId}`;
  const cached = clerkProfileCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;

  const clerk = createClerkClient({ secretKey: config.clerkSecretKey });
  const user = await clerk.users.getUser(userId);
  const primaryEmail = user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId) ?? user.emailAddresses[0];
  const email = primaryEmail?.emailAddress ?? '';
  const emailVerified = primaryEmail?.verification?.status === 'verified';
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || email || user.id;
  const authMethod = clerkSignInMethod(user);
  const profile = { email, emailVerified, name, ...(authMethod ? { authMethod } : {}) };
  clerkProfileCache.set(cacheKey, { expiresAt: Date.now() + CLERK_PROFILE_CACHE_TTL_MS, profile });
  return profile;
}

function clerkSignInMethod(user: unknown): string | undefined {
  const record = user as Record<string, unknown>;
  const externalAccounts = Array.isArray(record.externalAccounts) ? record.externalAccounts : [];
  const external = externalAccounts.find((entry) => providerName((entry as Record<string, unknown>).provider));
  const provider = external ? providerName((external as Record<string, unknown>).provider) : undefined;
  if (provider) return provider;
  if (Array.isArray(record.phoneNumbers) && record.phoneNumbers.length > 0) return 'Phone';
  if (Array.isArray(record.emailAddresses) && record.emailAddresses.length > 0) return 'Email';
  return undefined;
}

function providerName(provider: unknown): string | undefined {
  if (typeof provider !== 'string' || !provider.trim()) return undefined;
  const normalized = provider.replace(/^oauth_/, '').replace(/^saml_/, '');
  const known: Record<string, string> = {
    apple: 'Apple',
    discord: 'Discord',
    facebook: 'Facebook',
    github: 'GitHub',
    gitlab: 'GitLab',
    google: 'Google',
    linkedin: 'LinkedIn',
    microsoft: 'Microsoft',
    slack: 'Slack',
    twitter: 'X'
  };
  return known[normalized] ?? normalized.split(/[_-]/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function stringClaim(payload: unknown, claim: string): string | null {
  const value = (payload as Record<string, unknown>)[claim];
  return typeof value === 'string' && value.trim() ? value : null;
}

function clerkIssuer(config: ServerConfig): string {
  const publishableKey = config.clerkPublishableKey;
  if (publishableKey?.startsWith('pk_')) {
    const encoded = publishableKey.split('_').slice(2).join('_');
    try {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8').replace(/\$$/, '');
      if (decoded) return `https://${decoded}`;
    } catch {
      // Fall through to a stable local issuer fallback.
    }
  }
  return 'clerk';
}

function looksLikeJWT(token: string): boolean {
  return token.split('.').length === 3;
}
