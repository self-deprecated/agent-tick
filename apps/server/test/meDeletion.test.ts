import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AgentTickStore } from '@agent-tick/db';

vi.mock('../src/auth/clerk.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/auth/clerk.js')>();
  return { ...actual, deleteClerkUser: vi.fn(actual.deleteClerkUser) };
});

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { deleteClerkUser } from '../src/auth/clerk.js';
import { mintMobileSession } from '../src/auth/mobileSession.js';

let app: FastifyInstance | undefined;
let store: AgentTickStore | undefined;

afterEach(async () => {
  await app?.close();
  store?.close();
  app = undefined;
  store = undefined;
  vi.mocked(deleteClerkUser).mockReset();
});

function testStore(): AgentTickStore {
  const next = AgentTickStore.open({ databaseURL: ':memory:' });
  next.migrate();
  next.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
  store = next;
  return next;
}

describe('hosted account deletion failure handling', () => {
  it('does not partially delete local hosted data when Clerk deletion fails', async () => {
    const localStore = testStore();
    const config = loadConfig({
      AGENT_TICK_MODE: 'clerk',
      AGENT_TICK_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
      AGENT_TICK_CLERK_SECRET_KEY: 'sk_test_secret',
      AGENT_TICK_SESSION_SECRET: 'test-session-secret'
    });
    app = await buildApp({ config, store: localStore });
    const identity = localStore.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_clerk_fail', email: 'fail@example.com', emailVerified: true, name: 'Failure Case' }, '2026-05-08T06:00:00.000Z');
    const token = mintMobileSession({
      source: 'clerk',
      isHuman: true,
      userId: identity.userId,
      workspaceId: identity.workspaceId,
      role: identity.role,
      provider: 'clerk',
      providerIssuer: 'https://clerk.example',
      providerSubject: 'user_clerk_fail'
    }, config);
    const agent = localStore.createAgentToken({ workspaceId: identity.workspaceId, creatorUserId: identity.userId, label: 'Pi' }, '2026-05-08T06:01:00.000Z');
    const request = localStore.createRequest({ workspaceId: identity.workspaceId, agentTokenId: agent.agentTokenId, userId: identity.userId, requester: { name: 'Pi' }, requestType: 'sanction', title: 'Keep me' }, '2026-05-08T06:02:00.000Z');
    const status = localStore.createStatusUpdate({ workspaceId: identity.workspaceId, agentTokenId: agent.agentTokenId, userId: identity.userId, message: 'Keep status', state: 'working' }, '2026-05-08T06:03:00.000Z');
    localStore.registerDevice({ userId: identity.userId, deviceName: 'iPhone', expoPushToken: 'ExponentPushToken[fail]' }, '2026-05-08T06:04:00.000Z');
    vi.mocked(deleteClerkUser).mockRejectedValueOnce(new Error('Clerk deletion failed'));

    const response = await app.inject({ method: 'DELETE', url: '/v1/me', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(500);
    expect(vi.mocked(deleteClerkUser)).toHaveBeenCalledWith('user_clerk_fail', config);
    expect(localStore.getRequestForWorkspace(request.id, identity.workspaceId)).toMatchObject({ id: request.id, title: 'Keep me' });
    expect(localStore.getStatusUpdate(status.statusId, identity.workspaceId)).toMatchObject({ statusId: status.statusId, message: 'Keep status' });
    expect(localStore.verifyAgentToken(agent.token)).toMatchObject({ agentTokenId: agent.agentTokenId });
    expect(localStore.listDevicesForUser(identity.userId)).toEqual([expect.objectContaining({ expoPushToken: 'ExponentPushToken[fail]' })]);
    expect(localStore.db.prepare('SELECT revoked_at FROM users WHERE id = ?').get(identity.userId)).toEqual({ revoked_at: null });
    expect(localStore.db.prepare('SELECT COUNT(*) AS count FROM auth_identities WHERE user_id = ?').get(identity.userId)).toEqual({ count: 1 });

    vi.mocked(deleteClerkUser).mockResolvedValueOnce(undefined);
    const retry = await app.inject({ method: 'DELETE', url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ status: 'deleted', userId: identity.userId, clerkUserDeleted: true });
    expect(localStore.getRequestForWorkspace(request.id, identity.workspaceId)).toBeNull();
    expect(localStore.getStatusUpdate(status.statusId, identity.workspaceId)).toBeNull();
    expect(localStore.verifyAgentToken(agent.token)).toBeNull();
    expect(localStore.db.prepare('SELECT COUNT(*) AS count FROM auth_identities WHERE user_id = ?').get(identity.userId)).toEqual({ count: 0 });
  });
});
