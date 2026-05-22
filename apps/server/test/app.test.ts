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
  it('serves health and public auth config', async () => {
    const server = await buildSingle();
    expect((await server.inject({ method: 'GET', url: '/healthz' })).json()).toMatchObject({ status: 'ok' });
    expect((await server.inject({ method: 'GET', url: '/v1/auth/config' })).json()).toEqual({ mode: 'single', authProvider: 'local' });
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

  it('routes Personal Workspace Status Updates and Requests to the sole human', async () => {
    const localStore = testStore();
    const credential = localStore.createAgentToken({ label: 'Pi' });
    const server = await buildSingle(localStore);

    const status = await server.inject({ method: 'POST', url: '/v1/status-updates', headers: { authorization: `Bearer ${credential.token}` }, payload: { message: 'Running tests', state: 'working', threadId: 'host:/repo' } });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Running tests', recipientUserIds: ['usr_default'] });

    const created = await server.inject({ method: 'POST', url: '/v1/requests', headers: { authorization: `Bearer ${credential.token}` }, payload: { requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?' } });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ request: { workspaceId: DEFAULT_WORKSPACE_ID, status: 'pending', recipients: [expect.objectContaining({ userId: 'usr_default' })] }, waiter: { token: expect.stringMatching(/^wait_/) } });

    const count = await server.inject({ method: 'GET', url: '/v1/activity/pending-count' });
    expect(count.json()).toEqual({ pendingRequests: 1 });
    const responded = await server.inject({ method: 'POST', url: `/v1/requests/${created.json().request.id}/responses`, payload: { choiceId: 'approve' } });
    expect(responded.statusCode).toBe(200);
    expect(responded.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });
  });

  it('requires Routing Rule assignment before Shared Workspace Agent Tokens can create activity', async () => {
    const server = await buildSingle();
    const workspace = await server.inject({ method: 'POST', url: '/v1/workspaces', payload: { name: 'Production' } });
    const workspaceId = workspace.json().workspaceId as string;
    const token = await server.inject({ method: 'POST', url: '/v1/agent-tokens', headers: { 'x-agent-tick-workspace-id': workspaceId }, payload: { label: 'Deploy bot' } });

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
    expect(notRouted.statusCode).toBe(403);
    expect(notRouted.json()).toMatchObject({ error: { code: 'not_routed_recipient' } });

    const first = await server.inject({ method: 'POST', url: `/v1/requests/${requestId}/responses`, headers: { 'x-agent-tick-workspace-id': shared.workspaceId }, payload: { choiceId: 'approve' } });
    expect(first.json()).toMatchObject({ status: 'pending', quorum: { receivedResponseCount: 1, waitingFor: 1 } });

    const bobDevice = localStore.createPairingToken(bob.userId, shared.workspaceId);
    const paired = localStore.pairDeviceWithCode(bobDevice.token, 'Bob phone', 'ios')!;
    const final = await server.inject({ method: 'POST', url: `/v1/requests/${requestId}/responses`, headers: { authorization: `Bearer ${paired.token}`, 'x-agent-tick-workspace-id': shared.workspaceId }, payload: { choiceId: 'approve' } });
    expect(final.statusCode).toBe(200);
    expect(final.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });
  });

  it('creates fixed test activity through /v1/tests', async () => {
    const localStore = testStore();
    localStore.registerDevice({ userId: 'usr_default', deviceName: 'iPhone' });
    const credential = localStore.createAgentToken({ label: 'Pi' });
    const server = await buildSingle(localStore);
    await server.inject({ method: 'POST', url: '/v1/status-updates', headers: { authorization: `Bearer ${credential.token}` }, payload: { message: 'check-in', state: 'working' } });

    const steering = await server.inject({ method: 'POST', url: '/v1/tests', payload: { kind: 'steering', context: 'setup' } });
    expect(steering.statusCode).toBe(200);
    expect(steering.json()).toMatchObject({ status: 'sent', kind: 'steering', id: expect.stringMatching(/^req_/) });
    const detail = await server.inject({ method: 'GET', url: `/v1/requests/${steering.json().id}` });
    expect(detail.json()).toMatchObject({ title: 'Agent Tick steering test', isTest: true, testLabel: 'Agent Tick setup test' });
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

    const userEvent = { type: 'user.created', data: { id: 'user_alice', first_name: 'Alice', last_name: 'Example', primary_email_address_id: 'email_1', email_addresses: [{ id: 'email_1', email_address: 'alice@example.com' }] } };
    expect((await app.inject({ method: 'POST', url: '/v1/clerk/webhooks', headers: svixHeaders(userEvent, webhookSecret), payload: userEvent })).statusCode).toBe(200);
    const aliceUserId = (localStore.db.prepare('SELECT user_id FROM auth_identities WHERE subject = ?').get('user_alice') as { user_id: string }).user_id;

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
