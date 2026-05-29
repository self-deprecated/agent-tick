import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AgentTickStore, DEFAULT_WORKSPACE_ID } from '@agent-tick/db';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let app: FastifyInstance | undefined;
let store: AgentTickStore | undefined;

afterEach(async () => {
  await app?.close();
  store?.close();
  app = undefined;
  store = undefined;
});

function testStore(): AgentTickStore {
  const next = AgentTickStore.open({ databaseURL: ':memory:' });
  next.migrate();
  next.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
  store = next;
  return next;
}

async function buildSingle(localStore = testStore()) {
  app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: localStore });
  return app;
}

describe('server Workspace routing API', () => {
  it('parses PostgreSQL pool tuning config', () => {
    expect(loadConfig({
      AGENT_TICK_MODE: 'single',
      AGENT_TICK_POSTGRES_POOL_MAX: '12',
      AGENT_TICK_POSTGRES_POOL_IDLE_TIMEOUT_MS: '30000',
      AGENT_TICK_POSTGRES_POOL_CONNECTION_TIMEOUT_MS: '5000',
      AGENT_TICK_POSTGRES_STATEMENT_TIMEOUT_MS: '45000',
      AGENT_TICK_POSTGRES_QUERY_TIMEOUT_MS: '40000'
    })).toMatchObject({
      postgresPoolMax: 12,
      postgresPoolIdleTimeoutMs: 30000,
      postgresPoolConnectionTimeoutMs: 5000,
      postgresStatementTimeoutMs: 45000,
      postgresQueryTimeoutMs: 40000
    });
  });

  it('serves health, well-known app association, and public auth config', async () => {
    const server = await buildSingle();
    expect((await server.inject({ method: 'GET', url: '/healthz' })).json()).toMatchObject({ status: 'ok', version: '1.1.0' });
    const association = await server.inject({ method: 'GET', url: '/.well-known/apple-app-site-association' });
    expect(association.headers['content-type']).toContain('application/json');
    expect(association.json()).toEqual({ webcredentials: { apps: ['2559B88H6C.ai.selfdeprecated.agenttick'] } });
    expect((await server.inject({ method: 'GET', url: '/v1/auth/config' })).json()).toEqual({ mode: 'single', authProvider: 'local' });
  });

  it('serves mobile update policy in public auth config when configured', async () => {
    app = await buildApp({
      config: loadConfig({
        AGENT_TICK_MODE: 'single',
        AGENT_TICK_MOBILE_MINIMUM_SUPPORTED_VERSION: '0.2.0',
        AGENT_TICK_MOBILE_UPDATE_URL: 'https://apps.apple.com/app/id123',
        AGENT_TICK_MOBILE_UPDATE_MESSAGE: 'Update Agent Tick to continue.'
      }),
      store: testStore()
    });

    expect((await app.inject({ method: 'GET', url: '/v1/auth/config' })).json()).toMatchObject({
      mobile: {
        minimumSupportedVersion: '0.2.0',
        updateURL: 'https://apps.apple.com/app/id123',
        message: 'Update Agent Tick to continue.'
      }
    });
  });

  it('exchanges test Clerk login tokens for mobile sessions with Workspace context', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'clerk', AGENT_TICK_TEST_AUTH: '1', AGENT_TICK_SESSION_SECRET: 'test-session-secret' }), store: testStore() });
    const exchange = await app.inject({ method: 'POST', url: '/v1/auth/mobile-session', payload: { clerkToken: 'test_mobile_user' } });
    expect(exchange.statusCode).toBe(200);
    expect(exchange.json()).toMatchObject({ token: expect.stringMatching(/^ey/), userId: expect.stringMatching(/^usr_/), workspaceId: expect.stringMatching(/^wsp_/), role: 'owner' });

    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${exchange.json().token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ userId: exchange.json().userId, workspaceId: exchange.json().workspaceId, role: 'owner' });
  });

  it('deletes a Clerk-backed account and revokes hosted access', async () => {
    const localStore = testStore();
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'clerk', AGENT_TICK_TEST_AUTH: '1', AGENT_TICK_SESSION_SECRET: 'test-session-secret' }), store: localStore });
    const exchange = await app.inject({ method: 'POST', url: '/v1/auth/mobile-session', payload: { clerkToken: 'test_delete_user' } });
    const { token, userId, workspaceId } = exchange.json() as { token: string; userId: string; workspaceId: string };
    localStore.registerDevice({ userId, deviceName: 'iPhone', expoPushToken: 'ExponentPushToken[test]' });
    const agent = localStore.createAgentToken({ workspaceId, creatorUserId: userId, label: 'Pi' });
    const request = localStore.createRequest({ workspaceId, agentTokenId: agent.agentTokenId, requester: { name: 'Pi' }, requestType: 'sanction', title: 'delete me' });
    const status = localStore.createStatusUpdate({ workspaceId, agentTokenId: agent.agentTokenId, message: 'working', state: 'working' });

    const deleted = await app.inject({ method: 'DELETE', url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ status: 'deleted', userId, clerkUserDeleted: false });
    expect(localStore.verifyAgentToken(agent.token)).toBeNull();
    expect(localStore.getRequestForWorkspace(request.id, workspaceId)).toBeNull();
    expect(localStore.getStatusUpdate(status.statusId, workspaceId)).toBeNull();
    const deviceRow = localStore.db.prepare('SELECT unregistered_at, expo_push_token, token_hash FROM approval_devices WHERE user_id = ?').get(userId) as { unregistered_at: string | null; expo_push_token: string | null; token_hash: string | null };
    expect(deviceRow).toMatchObject({ unregistered_at: expect.any(String), expo_push_token: null, token_hash: null });
    expect(localStore.listDevicesForUser(userId)).toEqual([]);
    expect(localStore.userProfile(userId)).toMatchObject({ userId });
    expect(localStore.db.prepare('SELECT COUNT(*) AS count FROM auth_identities WHERE user_id = ?').get(userId)).toEqual({ count: 0 });
    expect((localStore.db.prepare('SELECT revoked_at FROM users WHERE id = ?').get(userId) as { revoked_at: string | null }).revoked_at).toEqual(expect.any(String));
    expect((localStore.db.prepare('SELECT hosted_data_deleted_at FROM personal_entitlements WHERE user_id = ?').get(userId) as { hosted_data_deleted_at: string | null }).hosted_data_deleted_at).toEqual(expect.any(String));

    const afterDelete = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(afterDelete.statusCode).toBe(401);
  });

  it('reports onboarding mobile readiness only for push-ready devices', async () => {
    const localStore = testStore();
    const server = await buildSingle(localStore);

    localStore.registerDevice({ userId: 'usr_default', deviceName: 'iPhone without push' });
    const noPush = await server.inject({ method: 'GET', url: '/v1/onboarding' });
    expect(noPush.statusCode).toBe(200);
    expect(noPush.json()).toMatchObject({ hasMobileDevice: false, activeMobileDeviceCount: 0 });

    localStore.registerDevice({ userId: 'usr_default', deviceName: 'iPhone with push', expoPushToken: 'ExponentPushToken[ready]' });
    const pushReady = await server.inject({ method: 'GET', url: '/v1/onboarding' });
    expect(pushReady.statusCode).toBe(200);
    expect(pushReady.json()).toMatchObject({ hasMobileDevice: true, activeMobileDeviceCount: 1 });
  });

  it('lists Personal Workspace and creates Shared Workspaces', async () => {
    const server = await buildSingle();
    expect((await server.inject({ method: 'GET', url: '/v1/workspaces' })).json()).toEqual([expect.objectContaining({ workspaceId: DEFAULT_WORKSPACE_ID, type: 'personal', name: 'Personal', role: 'owner' })]);

    const created = await server.inject({ method: 'POST', url: '/v1/workspaces', payload: { name: 'Production' } });
    expect(created.statusCode).toBe(200);
    const workspaceId = created.json().workspaceId as string;
    expect(created.json()).toMatchObject({ workspaceId, type: 'shared', name: 'Production', role: 'owner' });

    const members = await server.inject({ method: 'GET', url: `/v1/workspaces/${workspaceId}/members`, headers: { 'x-agent-tick-workspace-id': workspaceId } });
    expect(members.statusCode).toBe(200);
    expect(members.json()).toEqual([expect.objectContaining({ workspaceId, userId: 'usr_default', role: 'owner' })]);
  });

  it('previews Routing Rule readiness and audits unhealthy route saves', async () => {
    const localStore = testStore();
    const server = await buildSingle(localStore);
    const created = await server.inject({ method: 'POST', url: '/v1/workspaces', payload: { name: 'Routes' } });
    const workspaceId = created.json().workspaceId as string;
    const rule = await server.inject({ method: 'POST', url: '/v1/routing-rules', headers: { 'x-agent-tick-workspace-id': workspaceId }, payload: { workspaceId, name: 'Release approvals', recipientUserIds: ['usr_default'], requiredResponseMode: 'any_one', requiredResponseCount: 1 } });
    expect(rule.statusCode).toBe(200);

    const preview = await server.inject({ method: 'POST', url: '/v1/routing-preview', headers: { 'x-agent-tick-workspace-id': workspaceId }, payload: { workspaceId, routingRuleId: rule.json().routingRuleId } });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ status: 'unhealthy', selectedRecipientCount: 1, pushReadyRecipientCount: 0, unhealthyReasons: expect.arrayContaining(['no_push_ready_recipients']) });
    expect(preview.json().recipients[0]).toMatchObject({ selected: true, readiness: 'needs_push_ready_device' });
    expect(preview.json()).not.toHaveProperty('title');

    const audit = await server.inject({ method: 'GET', url: '/v1/audit-events', headers: { 'x-agent-tick-workspace-id': workspaceId } });
    expect(audit.json()).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'routing_rule.unhealthy_saved', targetId: rule.json().routingRuleId })]));
  });

  it('lists Workspace Members with Availability for Members tab readiness', async () => {
    const localStore = testStore();
    const server = await buildSingle(localStore);
    const created = await server.inject({ method: 'POST', url: '/v1/workspaces', payload: { name: 'Team' } });
    const workspaceId = created.json().workspaceId as string;
    localStore.setAvailability('usr_default', workspaceId, 'busy', '2026-05-08T00:05:00.000Z');

    const members = await server.inject({ method: 'GET', url: `/v1/workspaces/${workspaceId}/members`, headers: { 'x-agent-tick-workspace-id': workspaceId } });
    expect(members.statusCode).toBe(200);
    expect(members.json()).toEqual([
      expect.objectContaining({ workspaceId, userId: 'usr_default', role: 'owner', availabilityState: 'busy' })
    ]);
  });

  it('lets fresh Personal Workspace Agent Tokens create activity and does not persist the app-local first response server-side', async () => {
    const localStore = testStore();
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'clerk', AGENT_TICK_TEST_AUTH: '1', AGENT_TICK_SESSION_SECRET: 'test-session-secret' }), store: localStore });
    const exchange = await app.inject({ method: 'POST', url: '/v1/auth/mobile-session', payload: { clerkToken: 'test_inactive_hosted_user' } });
    const { token, userId, workspaceId } = exchange.json() as { token: string; userId: string; workspaceId: string };
    const credential = localStore.createAgentToken({ workspaceId, creatorUserId: userId, label: 'Pi' });

    const status = await app.inject({ method: 'POST', url: '/v1/status-updates', headers: { authorization: `Bearer ${credential.token}` }, payload: { message: 'Setting up', state: 'working' } });
    const created = await app.inject({ method: 'POST', url: '/v1/requests', headers: { authorization: `Bearer ${credential.token}` }, payload: { requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?' } });
    const firstResponse = await app.inject({ method: 'POST', url: `/v1/requests/${created.json().request.id}/responses`, headers: { authorization: `Bearer ${token}` }, payload: { choiceId: 'approve' } });
    const second = await app.inject({ method: 'POST', url: '/v1/requests', headers: { authorization: `Bearer ${credential.token}` }, payload: { requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy again?' } });
    const secondResponse = await app.inject({ method: 'POST', url: `/v1/requests/${second.json().request.id}/responses`, headers: { authorization: `Bearer ${token}` }, payload: { choiceId: 'approve' } });

    expect(status.statusCode).toBe(200);
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ request: { status: 'pending', workspaceId } });
    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });
    expect(second.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });
    expect(localStore.verifyAgentToken(credential.token)).toMatchObject({ agentTokenId: credential.agentTokenId, creatorUserId: userId });
  });

  it('routes Personal Workspace Status Updates and Requests to the sole human', async () => {
    const localStore = testStore();
    const credential = localStore.createAgentToken({ label: 'Pi' });
    const server = await buildSingle(localStore);

    const status = await server.inject({ method: 'POST', url: '/v1/status-updates', headers: { authorization: `Bearer ${credential.token}` }, payload: { message: 'Running tests', state: 'working', threadId: 'host:/repo' } });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Running tests', recipientUserIds: ['usr_default'] });

    const created = await server.inject({ method: 'POST', url: '/v1/requests', headers: { authorization: `Bearer ${credential.token}` }, payload: { requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?' } });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ request: { workspaceId: DEFAULT_WORKSPACE_ID, status: 'pending', recipients: [expect.objectContaining({ userId: 'usr_default' })] }, waiter: { token: expect.stringMatching(/^wait_/), waiterId: expect.stringMatching(/^waiter_/), leaseExpiresAt: expect.any(String) } });

    const count = await server.inject({ method: 'GET', url: '/v1/activity/pending-count' });
    expect(count.json()).toEqual({ pendingRequests: 1 });
    const responded = await server.inject({ method: 'POST', url: `/v1/requests/${created.json().request.id}/responses`, payload: { choiceId: 'approve' } });
    expect(responded.statusCode).toBe(200);
    expect(responded.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });

    const history = await server.inject({ method: 'GET', url: '/v1/activity/history' });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toEqual([
      expect.objectContaining({ kind: 'request', id: created.json().request.id, request: expect.objectContaining({ status: 'responded' }) }),
      expect.objectContaining({ kind: 'status_update', id: status.json().statusId })
    ]);
  });

  it('exposes derived Session summaries and timeline detail', async () => {
    const localStore = testStore();
    const credential = localStore.createAgentToken({ label: 'Pi' }, '2026-05-08T00:00:00.000Z');
    const server = await buildSingle(localStore);

    const explicitStatus = localStore.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Started validation', state: 'working', sessionId: 'run_explicit', session: { title: 'Release validation' }, clientName: 'Pi', host: 'lattice', workingDirectory: '/repo' }, '2026-05-08T00:01:00.000Z');
    const explicitRequest = localStore.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi', host: 'lattice', workingDirectory: '/repo', clientName: 'Pi' }, requestType: 'sanction', title: 'Approve deploy?', sessionId: 'run_explicit' }, '2026-05-08T00:02:00.000Z');
    const explicitWaiter = localStore.createRequestWaiterToken(explicitRequest.id, DEFAULT_WORKSPACE_ID, credential.agentTokenId, '2099-01-01T00:00:00.000Z', '2098-01-01T00:02:30.000Z');
    localStore.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Finished but still awaiting approval', state: 'done', sessionId: 'run_explicit' }, '2026-05-08T00:03:00.000Z');
    const syntheticOne = localStore.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Legacy one', state: 'working', clientName: 'Legacy CLI', host: 'lattice', workingDirectory: '/same-cwd' }, '2026-05-08T01:00:00.000Z');
    const syntheticTwo = localStore.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Legacy two', state: 'blocked', clientName: 'Legacy CLI', host: 'lattice', workingDirectory: '/same-cwd' }, '2026-05-08T01:10:00.000Z');
    localStore.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Legacy next run', state: 'working', clientName: 'Legacy CLI', host: 'lattice', workingDirectory: '/same-cwd' }, '2026-05-08T02:00:00.000Z');

    const summaries = await server.inject({ method: 'GET', url: '/v1/sessions' });
    expect(summaries.statusCode).toBe(200);
    const body = summaries.json() as Array<{ sessionId: string; title: string; state: string; pendingRequestCount: number; latestActivity: { id: string; preview: string; agentWaiter?: { state: string; waiterId?: string } }; pendingRequests?: Array<{ id: string; agentWaiter?: { state: string; waiterId?: string } }>; sourceLabels: string[] }>;
    const explicit = body.find((session) => session.title === 'Release validation')!;
    expect(explicit).toMatchObject({ state: 'needs-input', pendingRequestCount: 1, latestActivity: { id: explicitRequest.id, preview: 'Approve deploy?', agentWaiter: { state: 'waiting', waiterId: explicitWaiter.waiterId } }, pendingRequests: [{ id: explicitRequest.id, agentWaiter: { state: 'waiting', waiterId: explicitWaiter.waiterId } }] });
    expect(explicit.sourceLabels).toContain('Pi');
    expect(body.filter((session) => session.title.startsWith('Legacy'))).toHaveLength(2);
    expect(body.find((session) => session.title === 'Legacy two')).toMatchObject({ state: 'blocked', pendingRequestCount: 0 });

    const detail = await server.inject({ method: 'GET', url: `/v1/sessions/${explicit.sessionId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ summary: { title: 'Release validation', state: 'needs-input' } });
    expect(detail.json().timeline.map((item: { id: string }) => item.id)).toEqual([explicitStatus.statusId, explicitRequest.id, expect.stringMatching(/^stat_/)]);

    const syntheticDetail = await server.inject({ method: 'GET', url: `/v1/sessions/${body.find((session) => session.title === 'Legacy two')!.sessionId}` });
    expect(syntheticDetail.json().timeline.map((item: { id: string }) => item.id)).toEqual([syntheticOne.statusId, syntheticTwo.statusId]);
  });

  it('exposes Request waiter liveness in Session summaries and details', async () => {
    const localStore = testStore();
    const credential = localStore.createAgentToken({ label: 'Pi' }, '2026-05-08T00:00:00.000Z');
    const server = await buildSingle(localStore);
    const cases = [
      { title: 'Waiting waiter', state: 'waiting', deadline: '2099-01-01T00:00:00.000Z', now: '2098-01-01T00:01:00.000Z' },
      { title: 'Stale waiter', state: 'stale', deadline: '2099-01-01T00:00:00.000Z', now: '2026-05-08T00:01:00.000Z' },
      { title: 'Expired waiter', state: 'expired', deadline: undefined, now: '2026-05-08T00:01:00.000Z' },
      { title: 'Stopped waiter', state: 'stopped', deadline: '2099-01-01T00:00:00.000Z', now: '2026-05-08T00:01:00.000Z' },
      { title: 'Errored waiter', state: 'errored', deadline: '2099-01-01T00:00:00.000Z', now: '2026-05-08T00:01:00.000Z' }
    ] as const;

    for (const entry of cases) {
      const request = localStore.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi', clientName: 'Pi', host: 'lattice' }, requestType: 'steering', title: entry.title, sessionId: `run_${entry.state}` }, '2026-05-08T00:00:00.000Z');
      const waiter = localStore.createRequestWaiterToken(request.id, DEFAULT_WORKSPACE_ID, credential.agentTokenId, entry.deadline, entry.now);
      if (entry.state === 'stopped') localStore.stopRequestWaiter(waiter.waiterId, 'shutdown', '2026-05-08T00:02:00.000Z');
      if (entry.state === 'errored') localStore.markRequestWaiterError(waiter.waiterId, 'network.down', 'Network down', '2026-05-08T00:02:00.000Z');
    }

    const summaries = await server.inject({ method: 'GET', url: '/v1/sessions?limit=100' });
    expect(summaries.statusCode).toBe(200);
    const body = summaries.json() as Array<{ sessionId: string; title: string; state: string; latestActivity: { agentWaiter?: { state: string } }; pendingRequests?: Array<{ agentWaiter?: { state: string } }> }>;
    for (const entry of cases) {
      const summary = body.find((session) => session.title === entry.title)!;
      expect(summary).toMatchObject({ state: 'needs-input', latestActivity: { agentWaiter: { state: entry.state } }, pendingRequests: [{ agentWaiter: { state: entry.state } }] });
      const detail = await server.inject({ method: 'GET', url: `/v1/sessions/${summary.sessionId}` });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({ summary: { pendingRequests: [{ agentWaiter: { state: entry.state } }] }, timeline: [{ request: { agentWaiter: { state: entry.state } } }] });
    }
  });

  it('validates mirrored Request waiter liveness through Session APIs and wait responses', async () => {
    const localStore = testStore();
    const credential = localStore.createAgentToken({ label: 'Pi' }, '2026-05-08T00:00:00.000Z');
    const server = await buildSingle(localStore);
    const activeRequest = localStore.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi', host: 'lattice', workingDirectory: '/repo', clientName: 'Pi' }, requestType: 'steering', title: 'Choose active mirrored answer', sessionId: 'run_active_mirror' }, '2026-05-08T00:01:00.000Z');
    const activeWaiter = localStore.createRequestWaiterToken(activeRequest.id, DEFAULT_WORKSPACE_ID, credential.agentTokenId, '2099-01-01T00:00:00.000Z');
    const staleRequest = localStore.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi', host: 'lattice', workingDirectory: '/repo', clientName: 'Pi' }, requestType: 'steering', title: 'Choose stale mirrored answer', sessionId: 'run_stale_mirror' }, '2026-05-08T00:02:00.000Z');
    localStore.createRequestWaiterToken(staleRequest.id, DEFAULT_WORKSPACE_ID, credential.agentTokenId, '2099-01-01T00:00:00.000Z', '2026-05-08T00:02:00.000Z');
    const expiredRequest = localStore.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi', host: 'lattice', workingDirectory: '/repo', clientName: 'Pi' }, requestType: 'steering', title: 'Choose expired mirrored answer', sessionId: 'run_expired_mirror' }, '2026-05-08T00:03:00.000Z');
    localStore.createRequestWaiterToken(expiredRequest.id, DEFAULT_WORKSPACE_ID, credential.agentTokenId, undefined, '2026-05-08T00:03:00.000Z');
    const stoppedRequest = localStore.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi', host: 'lattice', workingDirectory: '/repo', clientName: 'Pi' }, requestType: 'steering', title: 'Choose stopped mirrored answer', sessionId: 'run_stopped_mirror' }, '2026-05-08T00:04:00.000Z');
    const stoppedWaiter = localStore.createRequestWaiterToken(stoppedRequest.id, DEFAULT_WORKSPACE_ID, credential.agentTokenId, '2099-01-01T00:00:00.000Z');
    localStore.stopRequestWaiter(stoppedWaiter.waiterId, 'local_answer');
    const erroredRequest = localStore.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi', host: 'lattice', workingDirectory: '/repo', clientName: 'Pi' }, requestType: 'steering', title: 'Choose errored mirrored answer', sessionId: 'run_errored_mirror' }, '2026-05-08T00:05:00.000Z');
    const erroredWaiter = localStore.createRequestWaiterToken(erroredRequest.id, DEFAULT_WORKSPACE_ID, credential.agentTokenId, '2099-01-01T00:00:00.000Z');
    localStore.markRequestWaiterError(erroredWaiter.waiterId, 'pi_wait_failed', 'Invalid or expired waiter token');

    const summaries = await server.inject({ method: 'GET', url: '/v1/sessions?limit=100' });
    expect(summaries.statusCode).toBe(200);
    const byTitle = new Map((summaries.json() as Array<{ sessionId: string; title: string; state: string; latestActivity: { agentWaiter?: { state: string } }; pendingRequests?: Array<{ agentWaiter?: { state: string } }> }>).map((session) => [session.title, session]));
    expect(byTitle.get('Choose active mirrored answer')).toMatchObject({ state: 'needs-input', latestActivity: { agentWaiter: { state: 'waiting' } }, pendingRequests: [{ agentWaiter: { state: 'waiting' } }] });
    expect(byTitle.get('Choose stale mirrored answer')).toMatchObject({ state: 'needs-input', latestActivity: { agentWaiter: { state: 'stale' } }, pendingRequests: [{ agentWaiter: { state: 'stale' } }] });
    expect(byTitle.get('Choose expired mirrored answer')).toMatchObject({ state: 'needs-input', latestActivity: { agentWaiter: { state: 'expired' } }, pendingRequests: [{ agentWaiter: { state: 'expired' } }] });
    expect(byTitle.get('Choose stopped mirrored answer')).toMatchObject({ state: 'needs-input', latestActivity: { agentWaiter: { state: 'stopped' } }, pendingRequests: [{ agentWaiter: { state: 'stopped' } }] });
    expect(byTitle.get('Choose errored mirrored answer')).toMatchObject({ state: 'needs-input', latestActivity: { agentWaiter: { state: 'errored' } }, pendingRequests: [{ agentWaiter: { state: 'errored' } }] });

    const activeResponse = await server.inject({ method: 'POST', url: `/v1/requests/${activeRequest.id}/responses`, payload: { choiceId: 'option_a' } });
    expect(activeResponse.statusCode).toBe(200);
    const wait = await server.inject({ method: 'GET', url: `/v1/requests/${activeRequest.id}/wait?timeoutMs=0`, headers: { authorization: `Bearer ${activeWaiter.token}` } });
    expect(wait.statusCode).toBe(200);
    expect(wait.json()).toMatchObject({ terminal: true, request: { id: activeRequest.id, status: 'responded', response: { choiceId: 'option_a' } } });

    for (const request of [staleRequest, expiredRequest, stoppedRequest, erroredRequest]) {
      const response = await server.inject({ method: 'POST', url: `/v1/requests/${request.id}/responses`, payload: { choiceId: 'cancel' } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: request.id, status: 'responded', response: { choiceId: 'cancel' } });
    }
  });

  it('groups legacy sessionless Activity with explicit Sessions from the same source during migration', async () => {
    const localStore = testStore();
    const credential = localStore.createAgentToken({ label: 'Agent on lattice' }, '2026-05-08T00:00:00.000Z');
    const server = await buildSingle(localStore);

    const started = localStore.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Started mixed run', state: 'working', sessionId: 'run_mixed', session: { title: 'Mixed migration run' }, clientName: 'Pi', host: 'lattice', workingDirectory: '/repo' }, '2026-05-08T00:01:00.000Z');
    const legacyRequest = localStore.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi', host: 'lattice', workingDirectory: '/repo', clientName: 'Pi' }, requestType: 'sanction', title: 'Approve mixed run?' }, '2026-05-08T00:02:00.000Z');
    const done = localStore.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Finished mixed run', state: 'done', sessionId: 'run_mixed', clientName: 'Pi', host: 'lattice', workingDirectory: '/repo' }, '2026-05-08T00:03:00.000Z');
    const nextRun = localStore.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Next run stays separate', state: 'working', sessionId: 'run_next', session: { title: 'Next run' }, clientName: 'Pi', host: 'lattice', workingDirectory: '/repo' }, '2026-05-08T01:00:00.000Z');

    const summaries = await server.inject({ method: 'GET', url: '/v1/sessions?limit=100' });
    expect(summaries.statusCode).toBe(200);
    const body = summaries.json() as Array<{ sessionId: string; title: string; pendingRequestCount: number }>;
    expect(body.filter((session) => session.title === 'Mixed migration run')).toHaveLength(1);
    expect(body.find((session) => session.title === 'Approve mixed run?')).toBeUndefined();
    const mixed = body.find((session) => session.title === 'Mixed migration run')!;
    expect(mixed.pendingRequestCount).toBe(1);

    const detail = await server.inject({ method: 'GET', url: `/v1/sessions/${mixed.sessionId}?limit=100` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().timeline.map((item: { id: string }) => item.id)).toEqual([started.statusId, legacyRequest.id, done.statusId]);
    expect(detail.json().timeline.map((item: { id: string }) => item.id)).not.toContain(nextRun.statusId);
  });

  it('groups sessionless Request and Status Update source labels by stable source metadata', async () => {
    const localStore = testStore();
    const credential = localStore.createAgentToken({ label: 'Agent on lattice' }, '2026-05-08T00:00:00.000Z');
    const server = await buildSingle(localStore);

    const status = localStore.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Legacy started', state: 'working', clientName: 'Pi', host: 'lattice', workingDirectory: '/repo' }, '2026-05-08T00:01:00.000Z');
    const legacyRequest = localStore.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi', host: 'lattice', workingDirectory: '/repo', clientName: 'Pi' }, requestType: 'sanction', title: 'Approve legacy run?' }, '2026-05-08T00:02:00.000Z');

    const summaries = await server.inject({ method: 'GET', url: '/v1/sessions?limit=100' });
    expect(summaries.statusCode).toBe(200);
    const legacy = (summaries.json() as Array<{ sessionId: string; title: string }>).find((session) => session.title === 'Approve legacy run?')!;
    const detail = await server.inject({ method: 'GET', url: `/v1/sessions/${legacy.sessionId}?limit=100` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().timeline.map((item: { id: string }) => item.id)).toEqual([status.statusId, legacyRequest.id]);
  });

  it('proves cross-surface Session flow fixtures stay grouped through response and history', async () => {
    const localStore = testStore();
    const credential = localStore.createAgentToken({ label: 'Pi' }, '2026-05-08T00:00:00.000Z');
    const server = await buildSingle(localStore);

    const status = localStore.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Run one started', state: 'working', sessionId: 'run_one', session: { title: 'Run one' }, clientName: 'Pi', host: 'lattice', workingDirectory: '/repo' }, '2026-05-08T00:01:00.000Z');
    const request = localStore.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi', host: 'lattice', workingDirectory: '/repo', clientName: 'Pi' }, requestType: 'sanction', title: 'Approve run one?', sessionId: 'run_one' }, '2026-05-08T00:02:00.000Z');
    const done = localStore.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Run one complete', state: 'done', sessionId: 'run_one', clientName: 'Pi', host: 'lattice', workingDirectory: '/repo' }, '2026-05-08T00:03:00.000Z');
    localStore.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Run two started', state: 'working', sessionId: 'run_two', session: { title: 'Run two' }, clientName: 'Pi', host: 'lattice', workingDirectory: '/repo' }, '2026-05-08T00:04:00.000Z');
    localStore.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Legacy synthetic one', state: 'working', clientName: 'Legacy CLI', host: 'lattice', workingDirectory: '/legacy' }, '2026-05-08T00:10:00.000Z');
    localStore.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Legacy synthetic two', state: 'waiting', clientName: 'Legacy CLI', host: 'lattice', workingDirectory: '/legacy' }, '2026-05-08T00:11:00.000Z');

    const response = await server.inject({ method: 'POST', url: `/v1/requests/${request.id}/responses`, payload: { choiceId: 'approve' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });

    const summaries = await server.inject({ method: 'GET', url: '/v1/sessions?limit=100' });
    expect(summaries.statusCode).toBe(200);
    const body = summaries.json() as Array<{ sessionId: string; title: string; pendingRequestCount: number }>;
    expect(body.filter((session) => session.title === 'Run one')).toHaveLength(1);
    expect(body.filter((session) => session.title === 'Run two')).toHaveLength(1);
    const runOne = body.find((session) => session.title === 'Run one')!;
    expect(runOne.pendingRequestCount).toBe(0);
    expect(body.find((session) => session.title === 'Legacy synthetic two')).toBeTruthy();

    const detail = await server.inject({ method: 'GET', url: `/v1/sessions/${runOne.sessionId}?limit=100` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().timeline.map((item: { id: string }) => item.id)).toEqual([status.statusId, request.id, done.statusId]);
    expect(detail.json().timeline[1].request.response).toMatchObject({ choiceId: 'approve' });

    const history = await server.inject({ method: 'GET', url: '/v1/activity/history?limit=100' });
    expect(history.statusCode).toBe(200);
    expect(history.json().map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([status.statusId, request.id, done.statusId]));
  });

  it('reports fresh Shared Workspace billing separately from personal Solo billing', async () => {
    const localStore = testStore();
    const identity = localStore.loginOrCreateClerkIdentity({ issuer: 'agent-tick-test', subject: 'shared_billing_owner', email: 'shared-billing-owner@example.test', emailVerified: true, name: 'Shared Billing Owner' }, '2026-05-08T00:30:00.000Z');
    const shared = localStore.createSharedWorkspaceForUser(identity.userId, 'Fresh Workspace', '2026-05-08T00:31:00.000Z');
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'clerk', AGENT_TICK_TEST_AUTH: '1', AGENT_TICK_SESSION_SECRET: 'test-session-secret' }), store: localStore });

    const personalBilling = await app.inject({ method: 'GET', url: '/v1/billing', headers: { authorization: 'Bearer test_shared_billing_owner' } });
    expect(personalBilling.statusCode).toBe(200);
    expect(personalBilling.json()).toMatchObject({ workspaceType: 'personal', plan: 'solo' });

    const sharedBilling = await app.inject({ method: 'GET', url: '/v1/billing', headers: { authorization: 'Bearer test_shared_billing_owner', 'x-agent-tick-workspace-id': shared.workspaceId } });
    expect(sharedBilling.statusCode).toBe(200);
    expect(sharedBilling.json()).toMatchObject({
      workspaceId: shared.workspaceId,
      workspaceType: 'shared',
      plan: 'shared-workspace',
      entitlement: { responsesEnabled: false, status: 'inactive' },
      usage: { activeMembers: 1, pendingMembers: 0 }
    });
  });

  it('requires active Shared Workspace billing before Shared Workspace Agent Tokens can create activity', async () => {
    const localStore = testStore();
    const identity = localStore.loginOrCreateClerkIdentity({ issuer: 'agent-tick-test', subject: 'shared_owner', email: 'shared-owner@example.test', emailVerified: true, name: 'Shared Owner' }, '2026-05-08T00:30:00.000Z');
    const shared = localStore.createSharedWorkspaceForUser(identity.userId, 'Unpaid Workspace', '2026-05-08T00:31:00.000Z');
    const rule = localStore.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Owner approvals', recipientUserIds: [identity.userId], requiredResponseMode: 'any_one' }, '2026-05-08T00:32:00.000Z');
    const credential = localStore.createAgentToken({ workspaceId: shared.workspaceId, creatorUserId: identity.userId, label: 'Shared bot', routingRuleId: rule.routingRuleId }, '2026-05-08T00:33:00.000Z');
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'clerk', AGENT_TICK_TEST_AUTH: '1', AGENT_TICK_SESSION_SECRET: 'test-session-secret' }), store: localStore });

    const created = await app.inject({ method: 'POST', url: '/v1/requests', headers: { authorization: `Bearer ${credential.token}` }, payload: { requester: { name: 'Shared bot' }, requestType: 'sanction', title: 'Shared action?' } });
    expect(created.statusCode).toBe(402);
    expect(created.json()).toMatchObject({ error: { code: 'workspace_billing_inactive' } });
  });

  it('does not apply personal hosted entitlement gates to entitled Shared Workspace Agent Tokens', async () => {
    const localStore = testStore();
    const identity = localStore.loginOrCreateClerkIdentity({ issuer: 'agent-tick-test', subject: 'paid_shared_owner', email: 'paid-shared-owner@example.test', emailVerified: true, name: 'Paid Shared Owner' }, '2026-05-08T00:30:00.000Z');
    const shared = localStore.createSharedWorkspaceForUser(identity.userId, 'Paid Workspace', '2026-05-08T00:31:00.000Z');
    localStore.updateWorkspaceEntitlement(shared.workspaceId, { responsesEntitledUntil: '2099-06-08T00:31:00.000Z' }, '2026-05-08T00:31:30.000Z');
    const rule = localStore.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Owner approvals', recipientUserIds: [identity.userId], requiredResponseMode: 'any_one' }, '2026-05-08T00:32:00.000Z');
    const credential = localStore.createAgentToken({ workspaceId: shared.workspaceId, creatorUserId: identity.userId, label: 'Shared bot', routingRuleId: rule.routingRuleId }, '2026-05-08T00:33:00.000Z');
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'clerk', AGENT_TICK_TEST_AUTH: '1', AGENT_TICK_SESSION_SECRET: 'test-session-secret' }), store: localStore });

    const created = await app.inject({ method: 'POST', url: '/v1/requests', headers: { authorization: `Bearer ${credential.token}` }, payload: { requester: { name: 'Shared bot' }, requestType: 'sanction', title: 'Shared action?' } });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ request: { workspaceId: shared.workspaceId, workspaceResponsesEntitled: true, title: 'Shared action?' } });
  });

  it('requires Routing Rule assignment before Shared Workspace Agent Tokens can create activity', async () => {
    const server = await buildSingle();
    const workspace = await server.inject({ method: 'POST', url: '/v1/workspaces', payload: { name: 'Production' } });
    const workspaceId = workspace.json().workspaceId as string;
    const token = await server.inject({ method: 'POST', url: '/v1/agent-tokens', headers: { 'x-agent-tick-workspace-id': workspaceId }, payload: { workspaceId, label: 'Deploy bot' } });

    const unrouted = await server.inject({ method: 'POST', url: '/v1/status-updates', headers: { authorization: `Bearer ${token.json().token}` }, payload: { message: 'Ready', state: 'done' } });
    expect(unrouted.statusCode).toBe(409);
    expect(unrouted.json()).toMatchObject({ error: { code: 'routing_required' } });

    const rule = await server.inject({ method: 'POST', url: '/v1/routing-rules', headers: { 'x-agent-tick-workspace-id': workspaceId }, payload: { workspaceId, name: 'Release', recipientUserIds: ['usr_default'], requiredResponseMode: 'any_one' } });
    expect(rule.statusCode).toBe(200);
    await server.inject({ method: 'PATCH', url: `/v1/agent-tokens/${token.json().agentTokenId}`, headers: { 'x-agent-tick-workspace-id': workspaceId }, payload: { routingRuleId: rule.json().routingRuleId } });

    const routed = await server.inject({ method: 'POST', url: '/v1/status-updates', headers: { authorization: `Bearer ${token.json().token}` }, payload: { message: 'Ready', state: 'done' } });
    expect(routed.statusCode).toBe(200);
    expect(routed.json()).toMatchObject({ workspaceId, routingRuleId: rule.json().routingRuleId, recipientUserIds: ['usr_default'] });
  });

  it('creates Audience Channels and lets humans subscribe', async () => {
    const localStore = testStore();
    const server = await buildSingle(localStore);
    const workspace = await server.inject({ method: 'POST', url: '/v1/workspaces', payload: { name: 'Public dev' } });
    const workspaceId = workspace.json().workspaceId as string;
    const channel = await server.inject({ method: 'POST', url: '/v1/audience-channels', headers: { 'x-agent-tick-workspace-id': workspaceId }, payload: { workspaceId, name: 'Roadmap', slug: 'roadmap', visibility: 'public' } });
    expect(channel.statusCode).toBe(200);
    expect(channel.json()).toMatchObject({ channelId: expect.stringMatching(/^aud_/), workspaceId, name: 'Roadmap', visibility: 'public', status: 'active' });

    const audience = localStore.loginOrCreateClerkIdentity({ issuer: 'agent-tick-test', subject: 'audience_user', email: 'audience-user@example.test', emailVerified: true, name: 'Audience User' });
    const audienceDevice = localStore.pairDeviceWithCode(localStore.createPairingToken(audience.userId, audience.workspaceId).token, 'Audience phone', 'ios')!;
    const subscribed = await server.inject({ method: 'POST', url: `/v1/audience-channels/${channel.json().channelId}/subscribe`, headers: { authorization: `Bearer ${audienceDevice.token}` } });
    expect(subscribed.statusCode).toBe(200);
    expect(subscribed.json()).toMatchObject({ channelId: channel.json().channelId, userId: audience.userId, status: 'active' });

    const credential = localStore.createAgentToken({ workspaceId, label: 'Roadmap bot' });
    const created = await server.inject({ method: 'POST', url: '/v1/requests', headers: { authorization: `Bearer ${credential.token}` }, payload: { requester: { name: 'Roadmap bot' }, requestType: 'steering', deliveryKind: 'audience_channel', audienceChannelId: channel.json().channelId, responsePolicy: 'deadline_plurality', closesAt: '2099-01-01T00:00:00.000Z', title: 'What next?' } });
    expect(created.statusCode).toBe(200);
    const listed = await server.inject({ method: 'GET', url: '/v1/audience-requests', headers: { authorization: `Bearer ${audienceDevice.token}` } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([expect.objectContaining({ id: created.json().request.id, deliveryKind: 'audience_channel' })]);

    const response = await server.inject({ method: 'POST', url: `/v1/audience-requests/${created.json().request.id}/responses`, headers: { authorization: `Bearer ${audienceDevice.token}` }, payload: { choiceId: 'option_a' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: created.json().request.id, status: 'pending', responses: [expect.objectContaining({ userId: audience.userId, choiceId: 'option_a' })] });
  });

  it('provisions External Approvers through convenience APIs', async () => {
    const localStore = testStore();
    const server = await buildSingle(localStore);
    const workspace = await server.inject({ method: 'POST', url: '/v1/workspaces', payload: { name: 'Legal AI' } });
    const workspaceId = workspace.json().workspaceId as string;
    const approver = await server.inject({ method: 'POST', url: '/v1/external-approvers', headers: { 'x-agent-tick-workspace-id': workspaceId }, payload: { displayName: 'Client', externalSubject: 'client_123' } });
    expect(approver.statusCode).toBe(200);
    expect(approver.json()).toMatchObject({ externalApproverId: expect.stringMatching(/^xapp_/), workspaceId, displayName: 'Client', externalSubject: 'client_123' });

    const invite = await server.inject({ method: 'POST', url: `/v1/external-approvers/${approver.json().externalApproverId}/invite`, headers: { 'x-agent-tick-workspace-id': workspaceId } });
    expect(invite.statusCode).toBe(200);
    expect(invite.json()).toMatchObject({ externalApproverId: approver.json().externalApproverId, workspaceId, token: expect.stringMatching(/^xinv_/) });

    const client = localStore.loginOrCreateClerkIdentity({ issuer: 'agent-tick-test', subject: 'client_convenience', email: 'client-convenience@example.test', emailVerified: true, name: 'Client User' });
    const clientDevice = localStore.pairDeviceWithCode(localStore.createPairingToken(client.userId, client.workspaceId).token, 'Client phone', 'ios')!;
    const accepted = await server.inject({ method: 'POST', url: `/v1/external-approver-invites/${encodeURIComponent(invite.json().token)}/accept`, headers: { authorization: `Bearer ${clientDevice.token}` } });
    expect(accepted.statusCode).toBe(200);

    const credential = await server.inject({ method: 'POST', url: `/v1/external-approvers/${approver.json().externalApproverId}/agent-token`, headers: { 'x-agent-tick-workspace-id': workspaceId } });
    expect(credential.statusCode).toBe(200);
    expect(credential.json()).toMatchObject({ token: expect.stringMatching(/^agent_/), workspaceId, boundRecipientUserId: client.userId, routingRuleId: expect.stringMatching(/^rul_/) });

    const status = await server.inject({ method: 'GET', url: `/v1/external-approvers/${approver.json().externalApproverId}/status`, headers: { 'x-agent-tick-workspace-id': workspaceId } });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ connected: true, routeReady: true, userId: client.userId, agentTokenId: credential.json().agentTokenId });
  });

  it('creates and accepts External Approver invite links', async () => {
    const localStore = testStore();
    const server = await buildSingle(localStore);
    const workspace = await server.inject({ method: 'POST', url: '/v1/workspaces', payload: { name: 'Legal AI' } });
    const workspaceId = workspace.json().workspaceId as string;
    const invite = await server.inject({ method: 'POST', url: `/v1/workspaces/${workspaceId}/external-approver-invites`, headers: { 'x-agent-tick-workspace-id': workspaceId }, payload: { displayName: 'Client', externalSubject: 'client_123', expiresInMinutes: 5 } });
    expect(invite.statusCode).toBe(200);
    expect(invite.json()).toMatchObject({ inviteId: expect.stringMatching(/^xinv_/), workspaceId, workspaceName: 'Legal AI', token: expect.stringMatching(/^xinv_/), deepLink: expect.stringContaining('xinv_') });

    const preview = await server.inject({ method: 'GET', url: `/v1/external-approver-invites/${encodeURIComponent(invite.json().token)}` });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ workspaceId, workspaceName: 'Legal AI', displayName: 'Client', externalSubject: 'client_123' });

    const client = localStore.loginOrCreateClerkIdentity({ issuer: 'agent-tick-test', subject: 'client_user', email: 'client-user@example.test', emailVerified: true, name: 'Client User' });
    const clientDevice = localStore.pairDeviceWithCode(localStore.createPairingToken(client.userId, client.workspaceId).token, 'Client phone', 'ios')!;
    const accepted = await server.inject({ method: 'POST', url: `/v1/external-approver-invites/${encodeURIComponent(invite.json().token)}/accept`, headers: { authorization: `Bearer ${clientDevice.token}` } });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ workspaceId, userId: client.userId, role: 'member', memberKind: 'external_approver' });
    expect(localStore.workspaceMembershipForUser(client.userId, workspaceId)).toMatchObject({ memberKind: 'external_approver' });
  });

  it('rejects Agent Token creation when body Workspace differs from the selected Workspace', async () => {
    const localStore = testStore();
    const server = await buildSingle(localStore);
    const first = await server.inject({ method: 'POST', url: '/v1/workspaces', payload: { name: 'First' } });
    const second = await server.inject({ method: 'POST', url: '/v1/workspaces', payload: { name: 'Second' } });
    const firstWorkspaceId = first.json().workspaceId as string;
    const secondWorkspaceId = second.json().workspaceId as string;

    const mismatch = await server.inject({
      method: 'POST',
      url: '/v1/agent-tokens',
      headers: { 'x-agent-tick-workspace-id': firstWorkspaceId },
      payload: { workspaceId: secondWorkspaceId, label: 'Cross-workspace bot' }
    });

    expect(mismatch.statusCode).toBe(403);
    expect(mismatch.json()).toMatchObject({ error: { code: 'forbidden' } });
    expect(localStore.listAgentTokens(firstWorkspaceId)).toEqual([]);
    expect(localStore.listAgentTokens(secondWorkspaceId)).toEqual([]);

    const sameWorkspace = await server.inject({
      method: 'POST',
      url: '/v1/agent-tokens',
      headers: { 'x-agent-tick-workspace-id': firstWorkspaceId },
      payload: { workspaceId: firstWorkspaceId, label: 'First bot' }
    });
    expect(sameWorkspace.statusCode).toBe(200);
    expect(sameWorkspace.json()).toMatchObject({ workspaceId: firstWorkspaceId, label: 'First bot' });
    expect(localStore.listAgentTokens(firstWorkspaceId)).toEqual([expect.objectContaining({ agentTokenId: sameWorkspace.json().agentTokenId })]);
    expect(localStore.listAgentTokens(secondWorkspaceId)).toEqual([]);
  });

  it('scopes Request detail and wait visibility to routed recipients or Workspace admins', async () => {
    const localStore = testStore();
    const shared = localStore.createSharedWorkspaceForUser('usr_default', 'Production');
    const recipient = localStore.addWorkspaceMemberByEmail(shared.workspaceId, 'recipient@example.com', 'member');
    const nonRouted = localStore.addWorkspaceMemberByEmail(shared.workspaceId, 'nonrouted@example.com', 'member');
    const admin = localStore.addWorkspaceMemberByEmail(shared.workspaceId, 'admin@example.com', 'admin');
    const rule = localStore.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Recipient only', recipientUserIds: [recipient.userId], requiredResponseMode: 'any_one' });
    const credential = localStore.createAgentToken({ workspaceId: shared.workspaceId, label: 'Deploy bot', routingRuleId: rule.routingRuleId });
    const created = localStore.createRequest({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, requester: { name: 'Deploy bot' }, requestType: 'sanction', title: 'Deploy?' });
    const waiter = localStore.createRequestWaiterToken(created.id, shared.workspaceId, credential.agentTokenId);
    const server = await buildSingle(localStore);

    const ownerDetail = await server.inject({ method: 'GET', url: `/v1/requests/${created.id}`, headers: { 'x-agent-tick-workspace-id': shared.workspaceId } });
    expect(ownerDetail.statusCode).toBe(200);
    expect(ownerDetail.json()).toMatchObject({ id: created.id, title: 'Deploy?' });

    const recipientDevice = localStore.pairDeviceWithCode(localStore.createPairingToken(recipient.userId, shared.workspaceId).token, 'Recipient phone', 'ios')!;
    const recipientDetail = await server.inject({ method: 'GET', url: `/v1/requests/${created.id}`, headers: { authorization: `Bearer ${recipientDevice.token}`, 'x-agent-tick-workspace-id': shared.workspaceId } });
    expect(recipientDetail.statusCode).toBe(200);
    expect(recipientDetail.json()).toMatchObject({ id: created.id, title: 'Deploy?' });

    const adminDevice = localStore.pairDeviceWithCode(localStore.createPairingToken(admin.userId, shared.workspaceId).token, 'Admin phone', 'ios')!;
    const adminDetail = await server.inject({ method: 'GET', url: `/v1/requests/${created.id}`, headers: { authorization: `Bearer ${adminDevice.token}`, 'x-agent-tick-workspace-id': shared.workspaceId } });
    expect(adminDetail.statusCode).toBe(200);
    expect(adminDetail.json()).toMatchObject({ id: created.id, title: 'Deploy?' });

    const nonRoutedDevice = localStore.pairDeviceWithCode(localStore.createPairingToken(nonRouted.userId, shared.workspaceId).token, 'Non-routed phone', 'ios')!;
    const deniedDetail = await server.inject({ method: 'GET', url: `/v1/requests/${created.id}`, headers: { authorization: `Bearer ${nonRoutedDevice.token}`, 'x-agent-tick-workspace-id': shared.workspaceId } });
    expect(deniedDetail.statusCode).toBe(404);

    const deniedWait = await server.inject({ method: 'GET', url: `/v1/requests/${created.id}/wait?timeoutMs=0`, headers: { authorization: `Bearer ${nonRoutedDevice.token}`, 'x-agent-tick-workspace-id': shared.workspaceId } });
    expect(deniedWait.statusCode).toBe(404);

    const deniedResponse = await server.inject({ method: 'POST', url: `/v1/requests/${created.id}/responses`, headers: { authorization: `Bearer ${nonRoutedDevice.token}`, 'x-agent-tick-workspace-id': shared.workspaceId }, payload: { choiceId: 'approve' } });
    expect(deniedResponse.statusCode).toBe(404);

    const waiterWait = await server.inject({ method: 'GET', url: `/v1/requests/${created.id}/wait?timeoutMs=0`, headers: { authorization: `Bearer ${waiter.token}` } });
    expect(waiterWait.statusCode).toBe(200);
    expect(waiterWait.json()).toMatchObject({ request: { id: created.id, title: 'Deploy?', agentWaiter: { waiterId: waiter.waiterId, state: 'waiting' } }, terminal: false });
    const waiterRow = localStore.db.prepare('SELECT last_seen_at, lease_expires_at FROM request_waiters WHERE waiter_id = ?').get(waiter.waiterId) as { last_seen_at: string; lease_expires_at: string };
    expect(Date.parse(waiterRow.lease_expires_at)).toBeGreaterThan(Date.parse(waiterRow.last_seen_at));

    const adminResponse = await server.inject({ method: 'POST', url: `/v1/requests/${created.id}/responses`, headers: { authorization: `Bearer ${adminDevice.token}`, 'x-agent-tick-workspace-id': shared.workspaceId }, payload: { choiceId: 'approve' } });
    expect(adminResponse.statusCode).toBe(403);
    expect(adminResponse.json()).toMatchObject({ error: { code: 'not_routed_recipient' } });
  });

  it('lets waiter credentials stop or error only their associated Request waiter', async () => {
    const localStore = testStore();
    const credential = localStore.createAgentToken({ label: 'Pi' }, '2026-05-08T00:00:00.000Z');
    const request = localStore.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?' }, '2026-05-08T00:01:00.000Z');
    const waiterA = localStore.createRequestWaiterToken(request.id, DEFAULT_WORKSPACE_ID, credential.agentTokenId, '2099-01-01T00:00:00.000Z', '2026-05-08T00:01:10.000Z');
    const waiterB = localStore.createRequestWaiterToken(request.id, DEFAULT_WORKSPACE_ID, credential.agentTokenId, '2099-01-01T00:00:00.000Z', '2026-05-08T00:01:20.000Z');
    const otherRequest = localStore.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi' }, requestType: 'sanction', title: 'Other?' }, '2026-05-08T00:02:00.000Z');
    const server = await buildSingle(localStore);

    const missingAuth = await server.inject({ method: 'POST', url: `/v1/requests/${request.id}/waiter/stop`, payload: { reason: 'local_answer' } });
    expect(missingAuth.statusCode).toBe(401);

    const wrongRequest = await server.inject({ method: 'POST', url: `/v1/requests/${otherRequest.id}/waiter/stop`, headers: { authorization: `Bearer ${waiterA.token}` }, payload: { reason: 'local_answer' } });
    expect(wrongRequest.statusCode).toBe(401);

    const stopped = await server.inject({ method: 'POST', url: `/v1/requests/${request.id}/waiter/stop`, headers: { authorization: `Bearer ${waiterA.token}` }, payload: { reason: 'local_answer' } });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json()).toMatchObject({ id: request.id, status: 'pending', agentWaiter: { state: 'stale', waiterId: waiterB.waiterId } });

    const stoppedAgain = await server.inject({ method: 'POST', url: `/v1/requests/${request.id}/waiter/stop`, headers: { authorization: `Bearer ${waiterA.token}` }, payload: { reason: 'shutdown' } });
    expect(stoppedAgain.statusCode).toBe(200);
    expect(localStore.db.prepare('SELECT state, stop_reason FROM request_waiters WHERE waiter_id = ?').get(waiterA.waiterId)).toEqual({ state: 'stopped', stop_reason: 'local_answer' });
    expect(localStore.db.prepare('SELECT state, stop_reason FROM request_waiters WHERE waiter_id = ?').get(waiterB.waiterId)).toEqual({ state: 'waiting', stop_reason: null });

    const responded = await server.inject({ method: 'POST', url: `/v1/requests/${request.id}/responses`, payload: { choiceId: 'approve' } });
    expect(responded.statusCode).toBe(200);
    expect(responded.json()).toMatchObject({ status: 'responded' });

    const errored = await server.inject({ method: 'POST', url: `/v1/requests/${request.id}/waiter/error`, headers: { authorization: `Bearer ${waiterB.token}` }, payload: { code: 'wait_failed.network', message: 'network down' } });
    expect(errored.statusCode).toBe(200);
    expect(errored.json()).toMatchObject({ status: 'responded', agentWaiter: { state: 'errored', waiterId: waiterB.waiterId, errorCode: 'wait_failed.network', errorMessage: 'network down' } });

    const erroredAgain = await server.inject({ method: 'POST', url: `/v1/requests/${request.id}/waiter/error`, headers: { authorization: `Bearer ${waiterB.token}` }, payload: { code: 'other.failure', message: 'other' } });
    expect(erroredAgain.statusCode).toBe(200);
    expect(erroredAgain.json()).toMatchObject({ status: 'responded', agentWaiter: { state: 'errored', errorCode: 'wait_failed.network', errorMessage: 'network down' } });
  });

  it('rejects query Workspace overrides when the user is no longer a Workspace member', async () => {
    const localStore = testStore();
    const shared = localStore.createSharedWorkspaceForUser('usr_default', 'Production');
    const removed = localStore.addWorkspaceMemberByEmail(shared.workspaceId, 'removed@example.com', 'member');
    const removedDevice = localStore.pairDeviceWithCode(localStore.createPairingToken(removed.userId, shared.workspaceId).token, 'Removed phone', 'ios')!;
    const rule = localStore.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Removed recipient', recipientUserIds: [removed.userId], requiredResponseMode: 'any_one' });
    const credential = localStore.createAgentToken({ workspaceId: shared.workspaceId, label: 'Deploy bot', routingRuleId: rule.routingRuleId });
    localStore.createStatusUpdate({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, message: 'Build finished', state: 'done' });
    localStore.createRequest({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, requester: { name: 'Deploy bot' }, requestType: 'sanction', title: 'Deploy?' });
    localStore.removeWorkspaceMember(shared.workspaceId, removed.userId);
    const server = await buildSingle(localStore);
    const authHeaders = { authorization: `Bearer ${removedDevice.token}` };

    const sessions = await server.inject({ method: 'GET', url: `/v1/sessions?workspaceId=${encodeURIComponent(shared.workspaceId)}`, headers: authHeaders });
    const requests = await server.inject({ method: 'GET', url: `/v1/requests?workspaceId=${encodeURIComponent(shared.workspaceId)}`, headers: authHeaders });
    const activity = await server.inject({ method: 'GET', url: `/v1/activity?workspaceId=${encodeURIComponent(shared.workspaceId)}`, headers: authHeaders });

    expect(sessions.statusCode).toBe(403);
    expect(requests.statusCode).toBe(403);
    expect(activity.statusCode).toBe(403);
  });

  it('keeps External Approver API access scoped to routed Requests', async () => {
    const localStore = testStore();
    const shared = localStore.createSharedWorkspaceForUser('usr_default', 'Legal AI');
    const external = localStore.addWorkspaceMemberByEmail(shared.workspaceId, 'client@example.com', 'member', undefined, 'external_approver');
    const rule = localStore.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Client only', recipientUserIds: [external.userId], requiredResponseMode: 'any_one', requiredResponseCount: 1 });
    const credential = localStore.createAgentToken({ workspaceId: shared.workspaceId, label: 'Legal AI for client', routingRuleId: rule.routingRuleId });
    const request = localStore.createRequest({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, requester: { name: 'Legal AI' }, requestType: 'sanction', title: 'Send filing?' });
    const externalDevice = localStore.pairDeviceWithCode(localStore.createPairingToken(external.userId, shared.workspaceId).token, 'Client phone', 'ios')!;
    const server = await buildSingle(localStore);
    const authHeaders = { authorization: `Bearer ${externalDevice.token}`, 'x-agent-tick-workspace-id': shared.workspaceId };

    const members = await server.inject({ method: 'GET', url: `/v1/workspaces/${shared.workspaceId}/members`, headers: authHeaders });
    expect(members.statusCode).toBe(403);
    expect(members.json()).toMatchObject({ error: { code: 'forbidden' } });

    const routingRules = await server.inject({ method: 'GET', url: '/v1/routing-rules', headers: authHeaders });
    expect(routingRules.statusCode).toBe(403);
    expect(routingRules.json()).toMatchObject({ error: { code: 'forbidden' } });

    const agentTokens = await server.inject({ method: 'GET', url: '/v1/agent-tokens', headers: authHeaders });
    expect(agentTokens.statusCode).toBe(403);
    expect(agentTokens.json()).toMatchObject({ error: { code: 'forbidden' } });

    const detail = await server.inject({ method: 'GET', url: `/v1/requests/${request.id}`, headers: authHeaders });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id: request.id, title: 'Send filing?' });

    const response = await server.inject({ method: 'POST', url: `/v1/requests/${request.id}/responses`, headers: authHeaders, payload: { choiceId: 'approve' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });
  });

  it('tracks quorum Responses for routed Shared Workspace Requests', async () => {
    const localStore = testStore();
    const shared = localStore.createSharedWorkspaceForUser('usr_default', 'Production');
    const bob = localStore.addWorkspaceMemberByEmail(shared.workspaceId, 'bob@example.com');
    const charlie = localStore.addWorkspaceMemberByEmail(shared.workspaceId, 'charlie@example.com');
    const rule = localStore.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Two humans', recipientUserIds: ['usr_default', bob.userId], requiredResponseMode: 'exact', requiredResponseCount: 2 });
    const credential = localStore.createAgentToken({ workspaceId: shared.workspaceId, label: 'Deploy bot', routingRuleId: rule.routingRuleId });
    const server = await buildSingle(localStore);

    const created = await server.inject({ method: 'POST', url: '/v1/requests', headers: { authorization: `Bearer ${credential.token}` }, payload: { requester: { name: 'Deploy bot' }, requestType: 'sanction', title: 'Deploy?' } });
    expect(created.statusCode).toBe(200);
    const requestId = created.json().request.id as string;

    const charlieDevice = localStore.createPairingToken(charlie.userId, shared.workspaceId);
    const charliePaired = localStore.pairDeviceWithCode(charlieDevice.token, 'Charlie phone', 'ios')!;
    const notRouted = await server.inject({ method: 'POST', url: `/v1/requests/${requestId}/responses`, headers: { authorization: `Bearer ${charliePaired.token}`, 'x-agent-tick-workspace-id': shared.workspaceId }, payload: { choiceId: 'approve' } });
    expect(notRouted.statusCode).toBe(404);
    expect(notRouted.json()).toMatchObject({ error: { code: 'not_found' } });

    const first = await server.inject({ method: 'POST', url: `/v1/requests/${requestId}/responses`, headers: { 'x-agent-tick-workspace-id': shared.workspaceId }, payload: { choiceId: 'approve' } });
    expect(first.json()).toMatchObject({ status: 'pending', quorum: { receivedResponseCount: 1, waitingFor: 1 } });

    const bobDevice = localStore.createPairingToken(bob.userId, shared.workspaceId);
    const paired = localStore.pairDeviceWithCode(bobDevice.token, 'Bob phone', 'ios')!;
    const final = await server.inject({ method: 'POST', url: `/v1/requests/${requestId}/responses`, headers: { authorization: `Bearer ${paired.token}`, 'x-agent-tick-workspace-id': shared.workspaceId }, payload: { choiceId: 'approve' } });
    expect(final.statusCode).toBe(200);
    expect(final.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });
  });

  it('allows hosted Personal web fallback responses and leaves first-response persistence to the app', async () => {
    const localStore = testStore();
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'clerk', AGENT_TICK_TEST_AUTH: '1', AGENT_TICK_SESSION_SECRET: 'test-session-secret' }), store: localStore });
    const webHeaders = { authorization: 'Bearer test_web_fallback' };
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: webHeaders });
    const { userId, workspaceId } = me.json() as { userId: string; workspaceId: string };
    const agent = localStore.createAgentToken({ workspaceId, creatorUserId: userId, label: 'Pi' });
    const request = localStore.createRequest({ workspaceId, agentTokenId: agent.agentTokenId, requester: { name: 'Pi' }, requestType: 'steering', title: 'Choose?', choices: [{ id: 'approve', label: 'Approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }] });

    const webResponse = await app.inject({ method: 'POST', url: `/v1/requests/${request.id}/responses`, headers: { ...webHeaders, 'x-agent-tick-response-surface': 'web-fallback' }, payload: { choiceId: 'approve' } });
    expect(webResponse.statusCode).toBe(200);
    expect(webResponse.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });

    const mobileSession = await app.inject({ method: 'POST', url: '/v1/auth/mobile-session', payload: { clerkToken: 'test_mobile_fallback' } });
    const mobileWorkspaceId = mobileSession.json().workspaceId as string;
    const mobileUserId = mobileSession.json().userId as string;
    const mobileAgent = localStore.createAgentToken({ workspaceId: mobileWorkspaceId, creatorUserId: mobileUserId, label: 'Pi' });
    const mobileRequest = localStore.createRequest({ workspaceId: mobileWorkspaceId, agentTokenId: mobileAgent.agentTokenId, requester: { name: 'Pi' }, requestType: 'steering', title: 'Choose?', choices: [{ id: 'approve', label: 'Approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }] });
    const mobileResponse = await app.inject({ method: 'POST', url: `/v1/requests/${mobileRequest.id}/responses`, headers: { authorization: `Bearer ${mobileSession.json().token}`, 'x-agent-tick-response-surface': 'web-fallback' }, payload: { choiceId: 'approve' } });
    expect(mobileResponse.statusCode).toBe(200);
    expect(mobileResponse.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });

    const secondMobileRequest = localStore.createRequest({ workspaceId: mobileWorkspaceId, agentTokenId: mobileAgent.agentTokenId, requester: { name: 'Pi' }, requestType: 'steering', title: 'Choose again?', choices: [{ id: 'approve', label: 'Approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }] });
    const secondMobileResponse = await app.inject({ method: 'POST', url: `/v1/requests/${secondMobileRequest.id}/responses`, headers: { authorization: `Bearer ${mobileSession.json().token}`, 'x-agent-tick-response-surface': 'web-fallback' }, payload: { choiceId: 'approve' } });
    expect(secondMobileResponse.statusCode).toBe(200);
    expect(secondMobileResponse.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });
  });

  it('suppresses redundant waiting Status Updates in derived Session timelines', async () => {
    const localStore = testStore();
    const request = localStore.createRequest({ requester: { name: 'Pi' }, requestType: 'steering', title: 'Choose?', sessionId: 'run_wait', choices: [{ id: 'approve', label: 'Approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }] }, '2026-05-08T00:00:00.000Z');
    localStore.createStatusUpdate({ workspaceId: request.workspaceId, message: 'Waiting for response', state: 'waiting', sessionId: 'run_wait' }, '2026-05-08T00:00:05.000Z');
    app = await buildSingle(localStore);

    const summaries = await app.inject({ method: 'GET', url: '/v1/sessions' });
    const sessionId = summaries.json()[0].sessionId as string;
    const detail = await app.inject({ method: 'GET', url: `/v1/sessions/${sessionId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().timeline.map((item: { kind: string }) => item.kind)).toEqual(['request']);
    expect(detail.json().summary.latestActivity).toMatchObject({ kind: 'request', id: request.id });
  });

  it('requires Owner or Admin role for Routing Rule Test Requests', async () => {
    const localStore = testStore();
    const shared = localStore.createSharedWorkspaceForUser('usr_default', 'Production');
    const member = localStore.addWorkspaceMemberByEmail(shared.workspaceId, 'member@example.com', 'member');
    const memberDevice = localStore.pairDeviceWithCode(localStore.createPairingToken(member.userId, shared.workspaceId).token, 'Member phone', 'ios')!;
    const rule = localStore.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Owner approvals', recipientUserIds: ['usr_default'], requiredResponseMode: 'any_one' });
    const server = await buildSingle(localStore);

    const denied = await server.inject({
      method: 'POST',
      url: '/v1/tests',
      headers: { authorization: `Bearer ${memberDevice.token}`, 'x-agent-tick-workspace-id': shared.workspaceId },
      payload: { workspaceId: shared.workspaceId, context: 'routing_rule', routingRuleId: rule.routingRuleId, kind: 'steering' }
    });

    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('creates first-party phone setup Test Requests before Agent Connection and strips agent-supplied test flags', async () => {
    const localStore = testStore();
    const notified: string[] = [];
    localStore.registerDevice({ userId: 'usr_default', deviceName: 'iPhone', expoPushToken: 'ExponentPushToken[setup]' });
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: localStore, notifier: { notifyRequestCreated: async (request) => { notified.push(request.id); } } });
    const server = app;

    const steering = await server.inject({ method: 'POST', url: '/v1/tests', payload: { kind: 'steering', context: 'setup' } });
    expect(steering.statusCode).toBe(200);
    expect(steering.json()).toMatchObject({ status: 'sent', kind: 'steering', id: expect.stringMatching(/^req_/) });
    expect(notified).toEqual([steering.json().id]);
    const detail = await server.inject({ method: 'GET', url: `/v1/requests/${steering.json().id}` });
    expect(detail.json()).toMatchObject({ title: 'Agent Tick steering test', requestType: 'steering', isTest: true, testLabel: 'Agent Tick setup test' });
    const response = await server.inject({ method: 'POST', url: `/v1/requests/${steering.json().id}/responses`, payload: { choiceId: 'option_a' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'responded', response: { choiceId: 'option_a' } });
    const status = await server.inject({ method: 'POST', url: '/v1/tests', payload: { kind: 'status', context: 'setup' } });
    const sanction = await server.inject({ method: 'POST', url: '/v1/tests', payload: { kind: 'sanction', context: 'setup' } });
    expect(status.statusCode).toBe(200);
    expect(sanction.statusCode).toBe(200);
    const sessions = await server.inject({ method: 'GET', url: '/v1/sessions' });
    const setupSession = sessions.json().find((session: { title: string }) => session.title === 'Agent Tick setup test');
    expect(setupSession).toMatchObject({ title: 'Agent Tick setup test' });
    const sessionDetail = await server.inject({ method: 'GET', url: `/v1/sessions/${setupSession.sessionId}` });
    expect(sessionDetail.json().timeline.map((item: { kind: string }) => item.kind).sort()).toEqual(['request', 'request', 'status_update']);

    const credential = localStore.createAgentToken({ label: 'Pi' });
    const production = await server.inject({ method: 'POST', url: '/v1/requests', headers: { authorization: `Bearer ${credential.token}` }, payload: { requester: { name: 'Pi' }, requestType: 'steering', title: 'Real work', isTest: true, testLabel: 'Forged test' } });
    expect(production.statusCode).toBe(200);
    expect(production.json().request).not.toMatchObject({ isTest: true });
  });

  it('mirrors Clerk Organization webhooks as Shared Workspaces', async () => {
    const localStore = testStore();
    const webhookSecret = `whsec_${Buffer.from('test-webhook-secret').toString('base64')}`;
    app = await buildApp({
      config: loadConfig({
        AGENT_TICK_MODE: 'clerk',
        AGENT_TICK_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
        AGENT_TICK_CLERK_SECRET_KEY: 'sk_test_secret',
        AGENT_TICK_CLERK_WEBHOOK_SECRET: webhookSecret
      }),
      store: localStore
    });

    const testUserEvent = { type: 'user.created', data: { id: 'user_test_payload_without_email' } };
    expect((await app.inject({ method: 'POST', url: '/v1/clerk/webhooks', headers: svixHeaders(testUserEvent, webhookSecret), payload: testUserEvent })).statusCode).toBe(200);
    expect(localStore.db.prepare('SELECT COUNT(*) AS count FROM auth_identities WHERE subject = ?').get('user_test_payload_without_email')).toEqual({ count: 0 });

    const userEvent = { type: 'user.created', data: { id: 'user_alice', first_name: 'Alice', last_name: 'Example', primary_email_address_id: 'email_1', email_addresses: [{ id: 'email_1', email_address: 'alice@example.com', verification: { status: 'verified' } }] } };
    expect((await app.inject({ method: 'POST', url: '/v1/clerk/webhooks', headers: svixHeaders(userEvent, webhookSecret), payload: userEvent })).statusCode).toBe(200);
    const aliceUserId = (localStore.db.prepare('SELECT user_id FROM auth_identities WHERE subject = ?').get('user_alice') as { user_id: string }).user_id;

    const bobUserEvent = { type: 'user.created', data: { id: 'user_bob', first_name: 'Bob', last_name: 'Delete', primary_email_address_id: 'email_2', email_addresses: [{ id: 'email_2', email_address: 'bob-delete@example.com', verification: { status: 'verified' } }] } };
    expect((await app.inject({ method: 'POST', url: '/v1/clerk/webhooks', headers: svixHeaders(bobUserEvent, webhookSecret), payload: bobUserEvent })).statusCode).toBe(200);
    const bobUserId = (localStore.db.prepare('SELECT user_id FROM auth_identities WHERE subject = ?').get('user_bob') as { user_id: string }).user_id;
    localStore.updatePersonalEntitlement({ userId: bobUserId, appUnlockedAt: '2026-05-08T02:00:00.000Z', hostedSubscriptionEndsAt: '2026-05-09T02:00:00.000Z' }, '2026-05-08T02:00:00.000Z');
    const bobPersonalWorkspaceId = localStore.defaultMembershipForUser(bobUserId).workspaceId;
    const userDeleted = { type: 'user.deleted', data: { id: 'user_bob' } };
    expect((await app.inject({ method: 'POST', url: '/v1/clerk/webhooks', headers: svixHeaders(userDeleted, webhookSecret), payload: userDeleted })).statusCode).toBe(200);
    expect(localStore.db.prepare('SELECT email, email_verified, revoked_at FROM users WHERE id = ?').get(bobUserId)).toMatchObject({ email: '', email_verified: 0, revoked_at: expect.any(String) });
    expect(localStore.db.prepare('SELECT COUNT(*) AS count FROM auth_identities WHERE user_id = ?').get(bobUserId)).toEqual({ count: 0 });
    expect(localStore.db.prepare('SELECT COUNT(*) AS count FROM workspaces WHERE workspace_id = ?').get(bobPersonalWorkspaceId)).toEqual({ count: 0 });

    const recreatedUserEvent = { type: 'user.created', data: { id: 'user_bob_recreated', first_name: 'Bob', last_name: 'Again', primary_email_address_id: 'email_2', email_addresses: [{ id: 'email_2', email_address: 'bob-delete@example.com', verification: { status: 'verified' } }] } };
    expect((await app.inject({ method: 'POST', url: '/v1/clerk/webhooks', headers: svixHeaders(recreatedUserEvent, webhookSecret), payload: recreatedUserEvent })).statusCode).toBe(200);
    const recreatedBobUserId = (localStore.db.prepare('SELECT user_id FROM auth_identities WHERE subject = ?').get('user_bob_recreated') as { user_id: string }).user_id;
    expect(recreatedBobUserId).not.toBe(bobUserId);
    expect(localStore.db.prepare('SELECT app_unlocked_at, hosted_subscription_ends_at FROM personal_entitlements WHERE user_id = ?').get(recreatedBobUserId)).toEqual({ app_unlocked_at: null, hosted_subscription_ends_at: null });

    const orgEvent = { type: 'organization.created', data: { id: 'org_clerk_1', name: 'Platform' } };
    expect((await app.inject({ method: 'POST', url: '/v1/clerk/webhooks', headers: svixHeaders(orgEvent, webhookSecret), payload: orgEvent })).statusCode).toBe(200);
    const memberEvent = { type: 'organizationMembership.created', data: { id: 'mem_1', role: 'org:admin', organization: { id: 'org_clerk_1', name: 'Platform' }, public_user_data: { user_id: 'user_alice', email_address: 'alice@example.com' } } };
    expect((await app.inject({ method: 'POST', url: '/v1/clerk/webhooks', headers: svixHeaders(memberEvent, webhookSecret), payload: memberEvent })).statusCode).toBe(200);

    const workspace = localStore.workspaceByClerkOrganizationId('org_clerk_1')!;
    expect(workspace).toMatchObject({ type: 'shared', name: 'Platform', clerkOrganizationId: 'org_clerk_1' });
    expect(localStore.workspaceMembershipForUser(aliceUserId, workspace.workspaceId)).toMatchObject({ role: 'admin' });

    const deleted = { type: 'organizationMembership.deleted', data: { id: 'mem_1', organization: { id: 'org_clerk_1' } } };
    expect((await app.inject({ method: 'POST', url: '/v1/clerk/webhooks', headers: svixHeaders(deleted, webhookSecret), payload: deleted })).statusCode).toBe(200);
    expect(localStore.workspaceMembershipForUser(aliceUserId, workspace.workspaceId)).toBeNull();
  });

  it('does not expose old approval/team/project/policy API aliases', async () => {
    const server = await buildSingle();
    for (const url of ['/v1/approval-requests', '/v1/organizations', '/v1/teams', '/v1/projects', '/v1/policies']) {
      expect((await server.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });
});

function svixHeaders(payload: unknown, secret: string): Record<string, string> {
  const id = `msg_${crypto.randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(payload);
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signature = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` };
}
