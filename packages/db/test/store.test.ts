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
