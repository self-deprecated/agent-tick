import { afterEach, describe, expect, it } from 'vitest';
import { AgentTickStore, DEFAULT_ORGANIZATION_ID } from '../src/index.js';

let store: AgentTickStore | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
});

describe('AgentTickStore', () => {
  it('runs migrations and creates default tenant records', () => {
    store = AgentTickStore.open({ databaseURL: ':memory:' });
    store.migrate();
    store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');

    const org = store.db.prepare('SELECT id, name FROM organizations WHERE id = ?').get(DEFAULT_ORGANIZATION_ID);
    expect(org).toEqual({ id: DEFAULT_ORGANIZATION_ID, name: 'Personal' });
  });

  it('creates and verifies agent tokens by hash', () => {
    store = AgentTickStore.open({ databaseURL: ':memory:' });
    store.migrate();
    store.ensureSingleTenantDefaults();

    const credential = store.createAgentToken({ name: 'test agent' });
    expect(credential.token).toMatch(/^agent_/);
    expect(JSON.stringify(store.db.prepare('SELECT * FROM agent_tokens').all())).not.toContain(credential.token);

    const auth = store.verifyAgentToken(credential.token);
    expect(auth).toMatchObject({ agentId: credential.agentId, organizationId: DEFAULT_ORGANIZATION_ID });
    expect(store.verifyAgentToken('agent_wrong')).toBeNull();
  });

  it('maps Clerk identities to local users by issuer and subject', () => {
    store = AgentTickStore.open({ databaseURL: ':memory:' });
    store.migrate();
    store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');

    const first = store.loginOrCreateClerkIdentity({
      issuer: 'https://example.clerk.accounts.dev',
      subject: 'user_123',
      email: 'Alice@Example.com',
      emailVerified: true,
      name: 'Alice'
    });
    const second = store.loginOrCreateClerkIdentity({
      issuer: 'https://example.clerk.accounts.dev',
      subject: 'user_123',
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice Updated'
    });

    expect(first.userId).toMatch(/^usr_/);
    expect(second.userId).toBe(first.userId);
    expect(second.organizationId).toBe(first.organizationId);
  });

  it('requires explicit linking on Clerk email collisions', () => {
    store = AgentTickStore.open({ databaseURL: ':memory:' });
    store.migrate();
    store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
    store.db.prepare('UPDATE users SET email = ? WHERE id = ?').run('alice@example.com', 'usr_default');

    expect(() =>
      store!.loginOrCreateClerkIdentity({
        issuer: 'https://other.clerk.accounts.dev',
        subject: 'user_456',
        email: 'alice@example.com',
        emailVerified: true,
        name: 'Alice'
      })
    ).toThrow(/identity linking/i);
  });

  it('registers devices and moves duplicate push tokens', () => {
    store = AgentTickStore.open({ databaseURL: ':memory:' });
    store.migrate();
    store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');

    const first = store.registerDevice({
      userId: 'usr_default',
      organizationId: DEFAULT_ORGANIZATION_ID,
      deviceName: 'iPhone',
      installationId: 'install-1',
      expoPushToken: 'ExponentPushToken[abc]'
    });
    const second = store.registerDevice({
      userId: 'usr_default',
      organizationId: DEFAULT_ORGANIZATION_ID,
      deviceName: 'iPad',
      installationId: 'install-2',
      expoPushToken: 'ExponentPushToken[abc]'
    });

    const devices = store.listDevicesForUser('usr_default');
    expect(devices.find((device) => device.deviceId === first.deviceId)?.expoPushToken).toBeUndefined();
    expect(devices.find((device) => device.deviceId === second.deviceId)?.expoPushToken).toBe('ExponentPushToken[abc]');
  });

  it('creates and responds to approval requests', () => {
    store = AgentTickStore.open({ databaseURL: ':memory:' });
    store.migrate();
    store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');

    const request = store.createApprovalRequest({
      requester: { name: 'agent', agentId: 'agent_test' },
      title: 'Deploy?'
    });

    expect(request.status).toBe('pending');
    expect(request.choices.map((choice) => choice.id)).toEqual(['approve', 'reject']);

    const responded = store.respondToApprovalRequest(request.id, { choiceId: 'approve' });
    expect(responded).toMatchObject({ id: request.id, status: 'responded', response: { choiceId: 'approve' } });
  });
});
