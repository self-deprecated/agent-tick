import { createClerkClient, verifyToken } from '@clerk/backend';
import type { AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import type { AuthContext } from './context.js';

export async function verifyClerkSession(token: string, config: ServerConfig, store: AgentTickStore): Promise<AuthContext | null> {
  if (config.mode !== 'clerk' || !looksLikeJWT(token)) return null;

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

  const profile = await fetchClerkProfile(subject, config);
  const identity = store.loginOrCreateClerkIdentity({
    issuer,
    subject,
    email: profile.email,
    emailVerified: profile.emailVerified,
    name: profile.name
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

async function fetchClerkProfile(userId: string, config: ServerConfig): Promise<{ email: string; emailVerified: boolean; name: string }> {
  if (!config.clerkSecretKey) throw new Error('Clerk secret key is required');
  const clerk = createClerkClient({ secretKey: config.clerkSecretKey });
  const user = await clerk.users.getUser(userId);
  const primaryEmail = user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId) ?? user.emailAddresses[0];
  const email = primaryEmail?.emailAddress ?? '';
  const emailVerified = primaryEmail?.verification?.status === 'verified';
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || email || user.id;
  return { email, emailVerified, name };
}

function stringClaim(payload: unknown, claim: string): string | null {
  const value = (payload as Record<string, unknown>)[claim];
  return typeof value === 'string' && value.trim() ? value : null;
}

function looksLikeJWT(token: string): boolean {
  return token.split('.').length === 3;
}
