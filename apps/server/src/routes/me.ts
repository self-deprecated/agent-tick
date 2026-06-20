import type { FastifyInstance } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman } from '../auth/context.js';
import { deleteClerkUser } from '../auth/clerk.js';

export interface MeRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerMeRoutes(app: FastifyInstance, { config, store }: MeRoutesOptions): Promise<void> {
  app.get('/v1/me', async (request) => {
    const auth = await requireHuman(request, config, store);
    const userId = auth.userId ?? 'usr_default';
    const profile = await store.userProfile(userId);
    return {
      userId,
      ...(profile?.email ? { email: profile.email } : {}),
      ...(profile?.name ? { name: profile.name } : {}),
      ...(profile?.signInMethod ? { signInMethod: profile.signInMethod } : {}),
      authProvider: config.authProvider,
      source: auth.source,
      workspaceId: auth.workspaceId,
      workspaceType: auth.workspaceType ?? 'personal',
      role: auth.role ?? 'owner',
      memberKind: auth.memberKind ?? 'internal',
      memberships: await store.listWorkspacesForUser(userId),
      privateRequestsPolicy: config.privateRequestsPolicy
    };
  });

  app.delete('/v1/me', async (request) => {
    const auth = await requireHuman(request, config, store);
    const userId = auth.userId;
    if (!userId || auth.provider !== 'clerk' || !auth.providerSubject) {
      throw httpError(400, 'account_deletion_unavailable', 'Account deletion is available for signed-in Agent Tick hosted accounts');
    }

    const now = new Date().toISOString();
    const personalMembership = await store.defaultMembershipForUser(userId);

    let clerkUserDeleted = false;
    if (!config.testAuth) {
      await deleteClerkUser(auth.providerSubject, config);
      clerkUserDeleted = true;
    }

    await store.deleteHostedAccountData(userId, personalMembership.workspaceId, now);
    return { status: 'deleted' as const, userId, clerkUserDeleted };
  });
}

function httpError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
