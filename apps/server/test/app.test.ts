import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AgentTickStore } from '@agent-tick/db';
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

describe('server skeleton', () => {
  it('serves health checks', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('serves public auth config for single mode', async () => {
    app = await buildApp({
      config: loadConfig({ AGENT_TICK_MODE: 'single', AGENT_TICK_PUBLIC_URL: 'https://tick.example.com' }),
      store: testStore()
    });
    const response = await app.inject({ method: 'GET', url: '/v1/auth/config' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: 'single',
      authProvider: 'local',
      publicURL: 'https://tick.example.com'
    });
  });

  it('serves public auth config for clerk mode without exposing secret key', async () => {
    app = await buildApp({
      config: loadConfig({
        AGENT_TICK_MODE: 'clerk',
        AGENT_TICK_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
        AGENT_TICK_CLERK_SECRET_KEY: 'sk_test_secret'
      }),
      store: testStore()
    });
    const response = await app.inject({ method: 'GET', url: '/v1/auth/config' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: 'clerk',
      authProvider: 'clerk',
      clerkPublishableKey: 'pk_test_123'
    });
    expect(JSON.stringify(response.json())).not.toContain('sk_test_secret');
  });

  it('requires Clerk keys in clerk mode config', () => {
    expect(() => loadConfig({ AGENT_TICK_MODE: 'clerk' })).toThrow(/CLERK_PUBLISHABLE_KEY/);
  });

  it('rejects invalid Clerk bearer tokens in clerk mode', async () => {
    app = await buildApp({
      config: loadConfig({
        AGENT_TICK_MODE: 'clerk',
        AGENT_TICK_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
        AGENT_TICK_CLERK_SECRET_KEY: 'sk_test_secret'
      }),
      store: testStore()
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer invalid.jwt.token' }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'not_authenticated' } });
  });

  it('returns structured 404 errors for API misses', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });
    const response = await app.inject({ method: 'GET', url: '/v1/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'not_found', message: 'Not found' } });
  });

  it('rate limits auth-sensitive token endpoints', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });
    let response = await app.inject({ method: 'GET', url: '/v1/invites/not-a-real-token' });
    expect(response.statusCode).toBe(404);
    for (let index = 0; index < 30; index += 1) {
      response = await app.inject({ method: 'GET', url: '/v1/invites/not-a-real-token' });
    }
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(response.json()).toMatchObject({ error: { code: 'rate_limited' } });
  });

  it('lists and selects local organizations for human requests', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });

    const createOrg = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Production' } });
    expect(createOrg.statusCode).toBe(200);
    const organizationId = createOrg.json().organizationId as string;

    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { 'x-agent-tick-organization-id': organizationId } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ organizationId, role: 'owner' });

    const members = await app.inject({ method: 'GET', url: `/v1/organizations/${organizationId}/members` });
    expect(members.statusCode).toBe(200);
    expect(members.json()).toEqual([expect.objectContaining({ organizationId, userId: 'usr_default', role: 'owner' })]);

    const project = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { 'x-agent-tick-organization-id': organizationId },
      payload: { name: 'Mobile App' }
    });
    expect(project.statusCode).toBe(200);
    expect(project.json()).toMatchObject({ organizationId, name: 'Mobile App', slug: 'mobile-app' });

    const projects = await app.inject({ method: 'GET', url: '/v1/projects', headers: { 'x-agent-tick-organization-id': organizationId } });
    expect(projects.statusCode).toBe(200);
    expect(projects.json()).toEqual([expect.objectContaining({ projectId: project.json().projectId })]);

    const team = await app.inject({
      method: 'POST',
      url: '/v1/teams',
      headers: { 'x-agent-tick-organization-id': organizationId },
      payload: { name: 'Platform' }
    });
    expect(team.statusCode).toBe(200);
    expect(team.json()).toMatchObject({ organizationId, name: 'Platform', slug: 'platform', userId: 'usr_default', role: 'owner' });

    const teams = await app.inject({ method: 'GET', url: '/v1/teams', headers: { 'x-agent-tick-organization-id': organizationId } });
    expect(teams.statusCode).toBe(200);
    expect(teams.json()).toEqual([expect.objectContaining({ teamId: team.json().teamId })]);

    const teamMembers = await app.inject({ method: 'GET', url: `/v1/teams/${team.json().teamId}/members`, headers: { 'x-agent-tick-organization-id': organizationId } });
    expect(teamMembers.statusCode).toBe(200);
    expect(teamMembers.json()).toEqual([expect.objectContaining({ teamId: team.json().teamId, userId: 'usr_default' })]);

    store!.db.prepare('INSERT INTO users(id, email, email_verified, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('usr_teammate', 'teammate@example.com', 1, 'Teammate', '2026-05-08T00:00:00.000Z', '2026-05-08T00:00:00.000Z');
    store!.db.prepare('INSERT INTO organization_memberships(organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(organizationId, 'usr_teammate', 'member', '2026-05-08T00:00:00.000Z', '2026-05-08T00:00:00.000Z');
    const addedTeamMember = await app.inject({
      method: 'POST',
      url: `/v1/teams/${team.json().teamId}/members`,
      headers: { 'x-agent-tick-organization-id': organizationId },
      payload: { userId: 'usr_teammate', role: 'lead' }
    });
    expect(addedTeamMember.statusCode).toBe(200);
    expect(addedTeamMember.json()).toMatchObject({ teamId: team.json().teamId, userId: 'usr_teammate', role: 'lead' });

    const removedTeamMember = await app.inject({
      method: 'DELETE',
      url: `/v1/teams/${team.json().teamId}/members/usr_teammate`,
      headers: { 'x-agent-tick-organization-id': organizationId }
    });
    expect(removedTeamMember.statusCode).toBe(200);
    expect(removedTeamMember.json()).toMatchObject({ teamId: team.json().teamId, userId: 'usr_teammate', role: 'lead' });

    const policy = await app.inject({
      method: 'POST',
      url: '/v1/policies',
      headers: { 'x-agent-tick-organization-id': organizationId },
      payload: { name: 'Production quorum', projectId: project.json().projectId, teamId: team.json().teamId, requiredApprovals: 2 }
    });
    expect(policy.statusCode).toBe(200);
    expect(policy.json()).toMatchObject({ organizationId, name: 'Production quorum', requiredApprovals: 2, enabled: true });

    const policies = await app.inject({ method: 'GET', url: '/v1/policies', headers: { 'x-agent-tick-organization-id': organizationId } });
    expect(policies.statusCode).toBe(200);
    expect(policies.json()).toEqual([expect.objectContaining({ policyId: policy.json().policyId })]);

    const scopedAgent = await app.inject({
      method: 'POST',
      url: '/v1/agent-tokens',
      headers: { 'x-agent-tick-organization-id': organizationId },
      payload: { name: 'scoped agent', projectId: project.json().projectId, teamId: team.json().teamId, defaultApprovalPolicy: policy.json().policyId }
    });
    expect(scopedAgent.statusCode).toBe(200);
    expect(scopedAgent.json()).toMatchObject({ organizationId, projectId: project.json().projectId, teamId: team.json().teamId, defaultApprovalPolicy: policy.json().policyId });

    const scopedApproval = await app.inject({
      method: 'POST',
      url: '/v1/approval-requests',
      headers: { authorization: `Bearer ${scopedAgent.json().token}` },
      payload: { requester: { name: 'scoped agent' }, title: 'Deploy scoped project?' }
    });
    expect(scopedApproval.statusCode).toBe(200);
    expect(scopedApproval.json()).toMatchObject({ requester: { projectId: project.json().projectId }, metadata: { teamId: team.json().teamId, defaultApprovalPolicy: policy.json().policyId } });

    const invite = await app.inject({
      method: 'POST',
      url: '/v1/organization-invites',
      headers: { 'x-agent-tick-organization-id': organizationId },
      payload: { label: 'Teammate', role: 'admin', email: 'teammate@example.com' }
    });
    expect(invite.statusCode).toBe(200);
    expect(invite.json()).toMatchObject({ organizationId, role: 'admin', usedCount: 0 });
    expect(invite.json().token).toMatch(/^invite_/);

    const invites = await app.inject({ method: 'GET', url: '/v1/organization-invites', headers: { 'x-agent-tick-organization-id': organizationId } });
    expect(invites.statusCode).toBe(200);
    expect(invites.json()).toEqual([expect.objectContaining({ inviteId: invite.json().inviteId })]);
    expect(JSON.stringify(invites.json())).not.toContain(invite.json().token);

    const preview = await app.inject({ method: 'GET', url: `/v1/invites/${encodeURIComponent(invite.json().token)}` });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ organizationId, organizationName: 'Production', role: 'admin' });

    const revoked = await app.inject({ method: 'POST', url: `/v1/organization-invites/${invite.json().inviteId}/revoke`, headers: { 'x-agent-tick-organization-id': organizationId }, payload: {} });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ inviteId: invite.json().inviteId, revokedAt: expect.any(String) });

    const forbidden = await app.inject({ method: 'GET', url: '/v1/me', headers: { 'x-agent-tick-organization-id': 'org_missing' } });
    expect(forbidden.statusCode).toBe(403);
  });

  it('creates an agent token and uses it to create an approval request', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });

    const tokenResponse = await app.inject({ method: 'POST', url: '/v1/agent-tokens', payload: { name: 'agent' } });
    expect(tokenResponse.statusCode).toBe(200);
    const token = tokenResponse.json().token as string;
    const agentId = tokenResponse.json().agentId as string;

    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/approval-requests',
      headers: { authorization: `Bearer ${token}` },
      payload: { requester: { name: 'agent' }, title: 'Deploy?' }
    });
    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toMatchObject({ title: 'Deploy?', status: 'pending' });

    const revokeResponse = await app.inject({ method: 'POST', url: `/v1/agent-tokens/${agentId}/revoke`, payload: {} });
    expect(revokeResponse.statusCode).toBe(200);
    expect(revokeResponse.json()).toMatchObject({ agentId, revokedAt: expect.any(String) });

    const deniedResponse = await app.inject({
      method: 'POST',
      url: '/v1/approval-requests',
      headers: { authorization: `Bearer ${token}` },
      payload: { requester: { name: 'agent' }, title: 'Deploy again?' }
    });
    expect(deniedResponse.statusCode).toBe(401);

    const auditResponse = await app.inject({ method: 'GET', url: '/v1/audit-events?limit=5' });
    expect(auditResponse.statusCode).toBe(200);
    expect(auditResponse.json().map((event: { eventType: string }) => event.eventType)).toContain('agent_token.revoked');
  });

  it('accepts heartbeat and availability updates', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });

    const heartbeat = await app.inject({ method: 'POST', url: '/v1/heartbeat', payload: { client: 'mobile' } });
    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.json()).toMatchObject({ status: 'ok', state: 'available' });

    const availability = await app.inject({ method: 'POST', url: '/v1/availability', payload: { state: 'busy' } });
    expect(availability.statusCode).toBe(200);
    expect(availability.json()).toMatchObject({ state: 'busy' });
  });

  it('issues short-lived event tickets instead of using bearer tokens in event query strings', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });
    const tokenResponse = await app.inject({ method: 'POST', url: '/v1/agent-tokens', payload: { name: 'agent' } });
    const token = tokenResponse.json().token as string;

    const ticketResponse = await app.inject({
      method: 'POST',
      url: '/v1/events/ticket',
      headers: { authorization: `Bearer ${token}` },
      payload: {}
    });
    expect(ticketResponse.statusCode).toBe(200);
    expect(ticketResponse.json().ticket).toMatch(/^evt_/);

    const events = await app.inject({ method: 'GET', url: `/v1/events?ticket=${encodeURIComponent(ticketResponse.json().ticket)}` });
    expect(events.statusCode).toBe(200);
    expect(events.headers['content-type']).toContain('text/event-stream');
    expect(events.body).toContain('event: ready');

    const invalid = await app.inject({ method: 'GET', url: '/v1/events?ticket=bad' });
    expect(invalid.statusCode).toBe(401);
  });

  it('pairs single-mode devices and accepts device tokens for mobile requests', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });

    const pairing = await app.inject({ method: 'POST', url: '/v1/pairing-tokens', payload: {} });
    expect(pairing.statusCode).toBe(200);

    const pair = await app.inject({
      method: 'POST',
      url: '/v1/devices/pair',
      payload: { token: pairing.json().token, deviceName: 'iPhone', platform: 'ios' }
    });
    expect(pair.statusCode).toBe(200);
    expect(pair.json().token).toMatch(/^device_/);

    const list = await app.inject({
      method: 'GET',
      url: '/v1/approval-requests',
      headers: { authorization: `Bearer ${pair.json().token}` }
    });
    expect(list.statusCode).toBe(200);

    const createAgentToken = await app.inject({
      method: 'POST',
      url: '/v1/agent-tokens',
      headers: { authorization: `Bearer ${pair.json().token}` },
      payload: { name: 'bad' }
    });
    expect(createAgentToken.statusCode).toBe(403);
  });

  it('registers devices for the authenticated human user', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/devices/register',
      payload: {
        deviceName: 'iPhone',
        platform: 'ios',
        installationId: 'install-1',
        expoPushToken: 'ExponentPushToken[abc]'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().deviceId).toMatch(/^dev_/);
  });

  it('allows an agent to abandon its approval request', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });
    const tokenResponse = await app.inject({ method: 'POST', url: '/v1/agent-tokens', payload: { name: 'agent' } });
    const token = tokenResponse.json().token as string;
    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/approval-requests',
      headers: { authorization: `Bearer ${token}` },
      payload: { requester: { name: 'agent' }, title: 'Deploy?' }
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/approval-requests/${createResponse.json().id}/abandon`,
      headers: { authorization: `Bearer ${token}` },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'abandoned' });
  });

  it('scopes approval request detail and mutation routes to the authenticated organization and owning agent', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });
    const otherOrg = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Other' } });
    const otherOrganizationId = otherOrg.json().organizationId as string;

    const ownerTokenResponse = await app.inject({ method: 'POST', url: '/v1/agent-tokens', payload: { name: 'owner agent' } });
    const ownerToken = ownerTokenResponse.json().token as string;
    const requestResponse = await app.inject({
      method: 'POST',
      url: '/v1/approval-requests',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { requester: { name: 'owner agent' }, title: 'Deploy?' }
    });
    const requestId = requestResponse.json().id as string;

    const otherOrgTokenResponse = await app.inject({
      method: 'POST',
      url: '/v1/agent-tokens',
      headers: { 'x-agent-tick-organization-id': otherOrganizationId },
      payload: { name: 'other org agent' }
    });
    const otherOrgToken = otherOrgTokenResponse.json().token as string;
    const otherOrgGet = await app.inject({
      method: 'GET',
      url: `/v1/approval-requests/${requestId}`,
      headers: { authorization: `Bearer ${otherOrgToken}` }
    });
    expect(otherOrgGet.statusCode).toBe(404);

    const otherOrgWait = await app.inject({
      method: 'GET',
      url: `/v1/approval-requests/${requestId}/wait?timeoutMs=0`,
      headers: { authorization: `Bearer ${otherOrgToken}` }
    });
    expect(otherOrgWait.statusCode).toBe(404);

    const otherOrgHumanRespond = await app.inject({
      method: 'POST',
      url: `/v1/approval-requests/${requestId}/responses`,
      headers: { 'x-agent-tick-organization-id': otherOrganizationId },
      payload: { choiceId: 'approve' }
    });
    expect(otherOrgHumanRespond.statusCode).toBe(404);

    const peerTokenResponse = await app.inject({ method: 'POST', url: '/v1/agent-tokens', payload: { name: 'peer agent' } });
    const peerAbandon = await app.inject({
      method: 'POST',
      url: `/v1/approval-requests/${requestId}/abandon`,
      headers: { authorization: `Bearer ${peerTokenResponse.json().token}` },
      payload: {}
    });
    expect(peerAbandon.statusCode).toBe(403);

    const ownerAbandon = await app.inject({
      method: 'POST',
      url: `/v1/approval-requests/${requestId}/abandon`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {}
    });
    expect(ownerAbandon.statusCode).toBe(200);
    expect(ownerAbandon.json()).toMatchObject({ status: 'abandoned' });
  });

  it('allows a human admin to respond to an approval request', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });
    const tokenResponse = await app.inject({ method: 'POST', url: '/v1/agent-tokens', payload: { name: 'agent' } });
    const token = tokenResponse.json().token as string;
    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/approval-requests',
      headers: { authorization: `Bearer ${token}` },
      payload: { requester: { name: 'agent' }, title: 'Deploy?' }
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/approval-requests/${createResponse.json().id}/responses`,
      payload: { choiceId: 'approve' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });
  });
});
