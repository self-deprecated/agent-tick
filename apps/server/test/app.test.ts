import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AgentTickStore } from '@agent-tick/db';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createInviteEmailSender, type InviteEmailInput } from '../src/services/inviteEmail.js';

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

  it('parses optional active-member seat limits, retention cleanup windows, and rate limits', () => {
    const config = loadConfig({
      AGENT_TICK_MODE: 'single',
      AGENT_TICK_MAX_ACTIVE_MEMBERS: '10',
      AGENT_TICK_APPROVAL_NOTIFICATION_WEBHOOK_URL: 'https://hooks.example.com/approvals',
      AGENT_TICK_APPROVAL_RETENTION_DAYS: '90',
      AGENT_TICK_AUDIT_RETENTION_DAYS: '365',
      AGENT_TICK_UNREGISTERED_DEVICE_RETENTION_DAYS: '30',
      AGENT_TICK_EXPIRED_INVITE_RETENTION_DAYS: '14',
      AGENT_TICK_RETENTION_CLEANUP_INTERVAL_MINUTES: '15',
      AGENT_TICK_RATE_LIMIT_WINDOW_MS: '5000',
      AGENT_TICK_RATE_LIMIT_MAX_REQUESTS: '2'
    });
    expect(config.maxActiveMembers).toBe(10);
    expect(config.approvalNotificationWebhookURL).toBe('https://hooks.example.com/approvals');
    expect(config.approvalRetentionDays).toBe(90);
    expect(config.auditRetentionDays).toBe(365);
    expect(config.unregisteredDeviceRetentionDays).toBe(30);
    expect(config.expiredInviteRetentionDays).toBe(14);
    expect(config.retentionCleanupIntervalMinutes).toBe(15);
    expect(config.rateLimitWindowMs).toBe(5000);
    expect(config.rateLimitMaxRequests).toBe(2);
    expect(loadConfig({ AGENT_TICK_MODE: 'single', AGENT_TICK_MAX_ACTIVE_MEMBERS: '' }).maxActiveMembers).toBeUndefined();
    expect(loadConfig({ AGENT_TICK_MODE: 'single' }).retentionCleanupIntervalMinutes).toBe(60);
    expect(loadConfig({ AGENT_TICK_MODE: 'single' }).rateLimitWindowMs).toBe(60_000);
    expect(loadConfig({ AGENT_TICK_MODE: 'single' }).rateLimitMaxRequests).toBeUndefined();
  });

  it('requires Clerk keys in clerk mode config', () => {
    expect(() => loadConfig({ AGENT_TICK_MODE: 'clerk' })).toThrow(/CLERK_PUBLISHABLE_KEY/);
  });

  it('exchanges a verified Clerk login for an Agent Tick mobile session token', async () => {
    app = await buildApp({
      config: loadConfig({ AGENT_TICK_MODE: 'clerk', AGENT_TICK_TEST_AUTH: '1', AGENT_TICK_SESSION_SECRET: 'test-session-secret' }),
      store: testStore()
    });

    const exchange = await app.inject({
      method: 'POST',
      url: '/v1/auth/mobile-session',
      payload: { clerkToken: 'test_mobile_user' }
    });

    expect(exchange.statusCode).toBe(200);
    expect(exchange.json()).toMatchObject({
      token: expect.stringMatching(/^ey/),
      userId: expect.stringMatching(/^usr_/),
      organizationId: expect.stringMatching(/^org_/),
      role: 'owner'
    });

    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${exchange.json().token}` }
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ userId: exchange.json().userId, organizationId: exchange.json().organizationId, role: 'owner' });
  });

  it('accepts mobile diagnostics from an Agent Tick mobile session', async () => {
    app = await buildApp({
      config: loadConfig({ AGENT_TICK_MODE: 'clerk', AGENT_TICK_TEST_AUTH: '1', AGENT_TICK_SESSION_SECRET: 'test-session-secret' }),
      store: testStore()
    });

    const exchange = await app.inject({
      method: 'POST',
      url: '/v1/auth/mobile-session',
      payload: { clerkToken: 'test_mobile_user' }
    });
    const token = exchange.json().token as string;

    const response = await app.inject({
      method: 'POST',
      url: '/v1/mobile-diagnostics',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        platform: 'ios',
        connectionStatus: 'connected',
        currentScreen: 'settings',
        events: [{ level: 'error', area: 'notifications', message: 'native_exception', at: '2026-01-01T00:00:00.000Z' }]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: 1 });

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/mobile-diagnostics',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([
      expect.objectContaining({
        level: 'error',
        area: 'notifications',
        message: 'native_exception',
        metadata: expect.objectContaining({ currentScreen: 'settings' })
      })
    ]);
  });

  it('rejects invalid and tampered Agent Tick mobile sessions', async () => {
    app = await buildApp({
      config: loadConfig({ AGENT_TICK_MODE: 'clerk', AGENT_TICK_TEST_AUTH: '1', AGENT_TICK_SESSION_SECRET: 'test-session-secret' }),
      store: testStore()
    });

    const invalidExchange = await app.inject({
      method: 'POST',
      url: '/v1/auth/mobile-session',
      payload: { clerkToken: 'not-valid' }
    });
    expect(invalidExchange.statusCode).toBe(401);

    const exchange = await app.inject({
      method: 'POST',
      url: '/v1/auth/mobile-session',
      payload: { clerkToken: 'test_mobile_user' }
    });
    const token = exchange.json().token as string;
    const tamperedToken = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${tamperedToken}` }
    });
    expect(me.statusCode).toBe(401);
    expect(me.json()).toMatchObject({ error: { code: 'not_authenticated' } });
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

  it('applies configured rate limit ceilings to token endpoints', async () => {
    app = await buildApp({
      config: loadConfig({ AGENT_TICK_MODE: 'single', AGENT_TICK_RATE_LIMIT_MAX_REQUESTS: '2' }),
      store: testStore()
    });
    expect((await app.inject({ method: 'GET', url: '/v1/invites/not-a-real-token' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/invites/not-a-real-token' })).statusCode).toBe(404);
    const limited = await app.inject({ method: 'GET', url: '/v1/invites/not-a-real-token' });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: 'rate_limited' } });
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
    expect(scopedApproval.json()).toMatchObject({ request: { requester: { projectId: project.json().projectId }, metadata: { teamId: team.json().teamId, defaultApprovalPolicy: policy.json().policyId } }, waiter: { token: expect.stringMatching(/^wait_/) } });

    const invite = await app.inject({
      method: 'POST',
      url: '/v1/organization-invites',
      headers: { 'x-agent-tick-organization-id': organizationId },
      payload: { label: 'Teammate', role: 'admin', domain: 'Example.com' }
    });
    expect(invite.statusCode).toBe(200);
    expect(invite.json()).toMatchObject({ organizationId, role: 'admin', domain: 'example.com', usedCount: 0 });
    expect(invite.json().token).toMatch(/^invite_/);

    const invites = await app.inject({ method: 'GET', url: '/v1/organization-invites', headers: { 'x-agent-tick-organization-id': organizationId } });
    expect(invites.statusCode).toBe(200);
    expect(invites.json()).toEqual([expect.objectContaining({ inviteId: invite.json().inviteId, domain: 'example.com' })]);
    expect(JSON.stringify(invites.json())).not.toContain(invite.json().token);

    const preview = await app.inject({ method: 'GET', url: `/v1/invites/${encodeURIComponent(invite.json().token)}` });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ organizationName: 'Production', role: 'admin' });
    expect(preview.json()).not.toHaveProperty('organizationId');
    expect(preview.json()).not.toHaveProperty('teamIds');
    expect(preview.json()).not.toHaveProperty('email');
    expect(preview.json()).not.toHaveProperty('domain');

    const revoked = await app.inject({ method: 'POST', url: `/v1/organization-invites/${invite.json().inviteId}/revoke`, headers: { 'x-agent-tick-organization-id': organizationId }, payload: {} });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ inviteId: invite.json().inviteId, revokedAt: expect.any(String) });

    const forbidden = await app.inject({ method: 'GET', url: '/v1/me', headers: { 'x-agent-tick-organization-id': 'org_missing' } });
    expect(forbidden.statusCode).toBe(403);
  });

  it('requires organization admin roles for management routes', async () => {
    const db = testStore();
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: db });

    const now = '2026-05-08T00:00:00.000Z';
    const memberOrganizationId = 'org_member_only';
    db.db.prepare('INSERT INTO organizations(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(memberOrganizationId, 'Member Org', now, now);
    db.db
      .prepare('INSERT INTO organization_memberships(organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(memberOrganizationId, 'usr_default', 'member', now, now);

    const headers = { 'x-agent-tick-organization-id': memberOrganizationId };
    const managementRequests = [
      { method: 'GET', url: '/v1/agent-tokens' },
      { method: 'POST', url: '/v1/agent-tokens', payload: { name: 'release agent' } },
      { method: 'GET', url: '/v1/projects' },
      { method: 'POST', url: '/v1/projects', payload: { name: 'Release' } },
      { method: 'GET', url: '/v1/teams' },
      { method: 'POST', url: '/v1/teams', payload: { name: 'Release Team' } },
      { method: 'GET', url: '/v1/policies' },
      { method: 'POST', url: '/v1/policies', payload: { name: 'Release policy' } },
      { method: 'GET', url: '/v1/audit-events' }
    ] as const;

    for (const managementRequest of managementRequests) {
      const response = await app.inject({ ...managementRequest, headers });
      expect(response.statusCode, `${managementRequest.method} ${managementRequest.url}`).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'forbidden', message: 'Organization owner or admin role required' } });
    }

    const ownerAgentTokens = await app.inject({ method: 'GET', url: '/v1/agent-tokens' });
    expect(ownerAgentTokens.statusCode).toBe(200);
  });

  it('keeps invite acceptances pending until an organization admin approves them', async () => {
    const db = testStore();
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: db });

    const createOrg = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Production' } });
    const organizationId = createOrg.json().organizationId as string;
    const team = await app.inject({ method: 'POST', url: '/v1/teams', headers: { 'x-agent-tick-organization-id': organizationId }, payload: { name: 'On Call' } });
    const invite = await app.inject({
      method: 'POST',
      url: '/v1/organization-invites',
      headers: { 'x-agent-tick-organization-id': organizationId },
      payload: { label: 'Bob', role: 'admin', teamIds: [team.json().teamId], email: 'bob@example.com' }
    });
    const bob = db.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_bob', email: 'bob@example.com', emailVerified: true, name: 'Bob' });
    const pairing = db.createPairingToken(bob.userId, bob.organizationId);
    const bobDevice = db.pairDeviceWithCode(pairing.token, 'Bob phone', 'ios');

    const accepted = await app.inject({
      method: 'POST',
      url: `/v1/invites/${encodeURIComponent(invite.json().token)}/accept`,
      headers: { authorization: `Bearer ${bobDevice!.token}` },
      payload: {}
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ status: 'pending_approval', membership: { organizationId, role: 'admin', status: 'pending_approval' } });

    expect(db.organizationMembershipForUser(bob.userId, organizationId)).toBeNull();
    const revokedPendingInvite = await app.inject({ method: 'POST', url: `/v1/organization-invites/${invite.json().inviteId}/revoke`, headers: { 'x-agent-tick-organization-id': organizationId }, payload: {} });
    expect(revokedPendingInvite.statusCode).toBe(200);
    const membersWhilePending = await app.inject({ method: 'GET', url: `/v1/organizations/${organizationId}/members` });
    expect(membersWhilePending.statusCode).toBe(200);
    expect(membersWhilePending.json().map((member: { userId: string }) => member.userId)).not.toContain(bob.userId);

    const pending = await app.inject({ method: 'GET', url: '/v1/organization-membership-requests', headers: { 'x-agent-tick-organization-id': organizationId } });
    expect(pending.statusCode).toBe(200);
    expect(pending.json()).toEqual([expect.objectContaining({ userId: bob.userId, organizationName: 'Production', requestedRole: 'admin', requestedTeamIds: [team.json().teamId], inviteRevokedAt: expect.any(String), status: 'pending_approval' })]);

    const pendingForBob = await app.inject({ method: 'GET', url: '/v1/me/organization-membership-requests', headers: { authorization: `Bearer ${bobDevice!.token}` } });
    expect(pendingForBob.statusCode).toBe(200);
    expect(pendingForBob.json()).toEqual([expect.objectContaining({ requestId: pending.json()[0].requestId, organizationName: 'Production', inviteRevokedAt: expect.any(String), status: 'pending_approval' })]);

    const approved = await app.inject({ method: 'POST', url: `/v1/organization-membership-requests/${pending.json()[0].requestId}/approve`, headers: { 'x-agent-tick-organization-id': organizationId }, payload: {} });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: 'approved', decidedByUserId: 'usr_default' });

    const pendingForBobAfterApproval = await app.inject({ method: 'GET', url: '/v1/me/organization-membership-requests', headers: { authorization: `Bearer ${bobDevice!.token}` } });
    expect(pendingForBobAfterApproval.statusCode).toBe(200);
    expect(pendingForBobAfterApproval.json()).toEqual([]);

    expect(db.organizationMembershipForUser(bob.userId, organizationId)).toMatchObject({ role: 'admin' });
    expect(db.listTeamMembers(team.json().teamId)).toEqual(expect.arrayContaining([expect.objectContaining({ userId: bob.userId, role: 'member' })]));
    const membersAfterApproval = await app.inject({ method: 'GET', url: `/v1/organizations/${organizationId}/members` });
    expect(membersAfterApproval.statusCode).toBe(200);
    expect(membersAfterApproval.json()).toEqual(expect.arrayContaining([expect.objectContaining({ userId: bob.userId, role: 'admin', status: 'active' })]));
  });

  it('posts invite email webhook payloads when configured', async () => {
    const originalFetch = globalThis.fetch;
    const seen: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input, init) => {
      seen.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status: 202 });
    }) as typeof fetch;
    try {
      const sender = createInviteEmailSender(loadConfig({ AGENT_TICK_MODE: 'single', AGENT_TICK_INVITE_EMAIL_WEBHOOK_URL: 'https://mail.example.test/invites' }));
      await expect(sender.sendInvite({
        organizationName: 'Production',
        url: 'https://tick.example.com/invite/invite_secret',
        invite: {
          inviteId: 'inv_123',
          organizationId: 'org_123',
          label: 'Bob',
          role: 'member',
          approvalRequired: true,
          teamIds: [],
          email: 'bob@example.com',
          domain: undefined,
          expiresAt: undefined,
          maxUses: 1,
          usedCount: 0,
          emailLastStatus: undefined,
          emailLastSentAt: undefined,
          emailLastError: undefined,
          revokedAt: undefined,
          createdAt: '2026-05-08T00:00:00.000Z'
        }
      })).resolves.toMatchObject({ status: 'sent', recipient: 'bob@example.com' });
      expect(seen).toEqual([{ url: 'https://mail.example.test/invites', body: expect.objectContaining({ type: 'organization_invite', to: 'bob@example.com', url: 'https://tick.example.com/invite/invite_secret' }) }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('sends and resends exact-email invites through the configured email sender without exposing resend tokens', async () => {
    const deliveries: Array<{ inviteId: string; url: string | undefined; recipient: string | undefined }> = [];
    const db = testStore();
    app = await buildApp({
      config: loadConfig({ AGENT_TICK_MODE: 'single', AGENT_TICK_PUBLIC_URL: 'https://tick.example.com', AGENT_TICK_INVITE_EMAIL_WEBHOOK_URL: 'https://mail.example.test/invites' }),
      store: db,
      inviteEmailSender: {
        async sendInvite(input: InviteEmailInput) {
          deliveries.push({ inviteId: input.invite.inviteId, url: input.url, recipient: input.invite.email });
          return { status: 'sent', recipient: input.invite.email!, sentAt: '2026-05-08T00:00:00.000Z' };
        }
      }
    });

    const createOrg = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Production' } });
    const organizationId = createOrg.json().organizationId as string;
    const invite = await app.inject({
      method: 'POST',
      url: '/v1/organization-invites',
      headers: { 'x-agent-tick-organization-id': organizationId },
      payload: { label: 'Bob', role: 'member', email: 'bob@example.com' }
    });
    expect(invite.statusCode).toBe(200);
    expect(invite.json()).toMatchObject({ token: expect.stringMatching(/^invite_/), emailDelivery: { status: 'sent', recipient: 'bob@example.com' }, emailLastStatus: 'sent' });
    expect(deliveries).toEqual([{ inviteId: invite.json().inviteId, recipient: 'bob@example.com', url: `https://tick.example.com/invite/${encodeURIComponent(invite.json().token)}` }]);

    const resend = await app.inject({ method: 'POST', url: `/v1/organization-invites/${invite.json().inviteId}/resend`, headers: { 'x-agent-tick-organization-id': organizationId }, payload: {} });
    expect(resend.statusCode).toBe(200);
    expect(resend.json()).toMatchObject({ delivery: { status: 'sent', recipient: 'bob@example.com' }, invite: { inviteId: invite.json().inviteId, emailLastStatus: 'sent' } });
    expect(JSON.stringify(resend.json())).not.toContain('invite_');
    expect(deliveries).toHaveLength(2);
    expect(deliveries[1]!.url).toMatch(/^https:\/\/tick\.example\.com\/invite\/invite_/);
    expect(deliveries[1]!.url).not.toBe(deliveries[0]!.url);

    const oldPreview = await app.inject({ method: 'GET', url: `/v1/invites/${encodeURIComponent(invite.json().token)}` });
    expect(oldPreview.statusCode).toBe(404);
  });

  it('skips invite email delivery when no provider is configured', async () => {
    const db = testStore();
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single', AGENT_TICK_PUBLIC_URL: 'https://tick.example.com' }), store: db });

    const createOrg = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Production' } });
    const organizationId = createOrg.json().organizationId as string;
    const invite = await app.inject({
      method: 'POST',
      url: '/v1/organization-invites',
      headers: { 'x-agent-tick-organization-id': organizationId },
      payload: { label: 'Bob', role: 'member', email: 'bob@example.com' }
    });
    expect(invite.statusCode).toBe(200);
    expect(invite.json()).toMatchObject({ emailDelivery: { status: 'skipped', recipient: 'bob@example.com' }, emailLastStatus: 'skipped' });
    expect(invite.json().emailDelivery.message).toMatch(/not configured/i);
  });

  it('reports billing seat usage and enforces active-member limits for invite approvals', async () => {
    const db = testStore();
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single', AGENT_TICK_MAX_ACTIVE_MEMBERS: '1' }), store: db });

    const createOrg = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Limited' } });
    const organizationId = createOrg.json().organizationId as string;
    const invite = await app.inject({
      method: 'POST',
      url: '/v1/organization-invites',
      headers: { 'x-agent-tick-organization-id': organizationId },
      payload: { label: 'Bob', role: 'member' }
    });
    const bob = db.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_bob', email: 'bob@example.com', emailVerified: true, name: 'Bob' });
    const pairing = db.createPairingToken(bob.userId, bob.organizationId);
    const bobDevice = db.pairDeviceWithCode(pairing.token, 'Bob phone', 'ios');

    const accepted = await app.inject({
      method: 'POST',
      url: `/v1/invites/${encodeURIComponent(invite.json().token)}/accept`,
      headers: { authorization: `Bearer ${bobDevice!.token}` },
      payload: {}
    });
    expect(accepted.statusCode).toBe(200);

    const billing = await app.inject({ method: 'GET', url: '/v1/billing', headers: { 'x-agent-tick-organization-id': organizationId } });
    expect(billing.statusCode).toBe(200);
    expect(billing.json()).toEqual({ organizationId, plan: 'self-hosted', limits: { seats: 1 }, usage: { activeMembers: 1, pendingMembers: 1 } });

    const pending = await app.inject({ method: 'GET', url: '/v1/organization-membership-requests', headers: { 'x-agent-tick-organization-id': organizationId } });
    const approved = await app.inject({ method: 'POST', url: `/v1/organization-membership-requests/${pending.json()[0].requestId}/approve`, headers: { 'x-agent-tick-organization-id': organizationId }, payload: {} });
    expect(approved.statusCode).toBe(409);
    expect(approved.json()).toMatchObject({ error: { code: 'conflict', message: expect.stringMatching(/seat limit/i) } });
    expect(db.organizationMembershipForUser(bob.userId, organizationId)).toBeNull();
  });

  it('notifies registered push devices when an approval request is created', async () => {
    const notified: string[] = [];
    app = await buildApp({
      config: loadConfig({ AGENT_TICK_MODE: 'single' }),
      store: testStore(),
      notifier: {
        async notifyApprovalCreated(request) {
          notified.push(request.id);
        }
      }
    });

    const tokenResponse = await app.inject({ method: 'POST', url: '/v1/agent-tokens', payload: { name: 'agent' } });
    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/approval-requests',
      headers: { authorization: `Bearer ${tokenResponse.json().token}` },
      payload: { requester: { name: 'agent' }, title: 'Deploy?' }
    });

    expect(createResponse.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(notified).toEqual([createResponse.json().request.id]);
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
    expect(createResponse.json()).toMatchObject({ request: { title: 'Deploy?', status: 'pending', requester: { agentId } }, waiter: { token: expect.stringMatching(/^wait_/) } });

    const agentListDenied = await app.inject({
      method: 'GET',
      url: '/v1/approval-requests',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(agentListDenied.statusCode).toBe(403);

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

    const agentTicketDenied = await app.inject({
      method: 'POST',
      url: '/v1/events/ticket',
      headers: { authorization: `Bearer ${token}` },
      payload: {}
    });
    expect(agentTicketDenied.statusCode).toBe(403);

    const ticketResponse = await app.inject({
      method: 'POST',
      url: '/v1/events/ticket',
      payload: {}
    });
    expect(ticketResponse.statusCode).toBe(200);
    expect(ticketResponse.json().ticket).toMatch(/^evt_/);

    const events = await app.inject({ method: 'GET', url: `/v1/events?ticket=${encodeURIComponent(ticketResponse.json().ticket)}&lastEventId=0&once=1` });
    expect(events.statusCode).toBe(200);
    expect(events.headers['content-type']).toContain('text/event-stream');
    expect(events.body).toContain('event: ready');
    expect(events.body).toContain('event: audit');
    expect(events.body).toContain('agent_token.created');

    const invalid = await app.inject({ method: 'GET', url: '/v1/events?ticket=bad' });
    expect(invalid.statusCode).toBe(401);
  });

  it('long-polls audit event hints with normal auth headers', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });
    const tokenResponse = await app.inject({ method: 'POST', url: '/v1/agent-tokens', payload: { name: 'agent' } });
    const token = tokenResponse.json().token as string;

    const poll = await app.inject({ method: 'GET', url: '/v1/events/poll?lastEventId=0&timeoutMs=5000' });
    expect(poll.statusCode).toBe(200);
    expect(poll.json()).toMatchObject({ nextEventId: expect.any(Number) });
    expect(poll.json().events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'agent_token.created', targetId: expect.any(String) })
    ]));

    const latest = poll.json().nextEventId as number;
    const waiting = app.inject({ method: 'GET', url: `/v1/events/poll?lastEventId=${latest}&timeoutMs=5000` });
    await app.inject({
      method: 'POST',
      url: '/v1/approval-requests',
      headers: { authorization: `Bearer ${token}` },
      payload: { requester: { name: 'agent' }, title: 'Deploy?' }
    });
    const changed = await waiting;
    expect(changed.statusCode).toBe(200);
    expect(changed.json().events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'approval.created', targetId: expect.any(String) })
    ]));
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
      url: `/v1/approval-requests/${createResponse.json().request.id}/abandon`,
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
    const requestId = requestResponse.json().request.id as string;

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
    expect(otherOrgGet.statusCode).toBe(403);

    const otherOrgWait = await app.inject({
      method: 'GET',
      url: `/v1/approval-requests/${requestId}/wait?timeoutMs=0`,
      headers: { authorization: `Bearer ${otherOrgToken}` }
    });
    expect(otherOrgWait.statusCode).toBe(403);

    const ownerAgentWait = await app.inject({
      method: 'GET',
      url: `/v1/approval-requests/${requestId}/wait?timeoutMs=0`,
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    expect(ownerAgentWait.statusCode).toBe(403);

    const waiterWait = await app.inject({
      method: 'GET',
      url: `/v1/approval-requests/${requestId}/wait?timeoutMs=0`,
      headers: { authorization: `Bearer ${requestResponse.json().waiter.token}` }
    });
    expect(waiterWait.statusCode).toBe(200);
    expect(waiterWait.json()).toMatchObject({ terminal: false, request: { id: requestId, status: 'pending' } });

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
      url: `/v1/approval-requests/${createResponse.json().request.id}/responses`,
      payload: { choiceId: 'approve' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });
  });

  it('rejects responders outside a team-scoped approval policy', async () => {
    const db = testStore();
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: db });
    const org = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Production' } });
    const organizationId = org.json().organizationId as string;
    const team = await app.inject({ method: 'POST', url: '/v1/teams', headers: { 'x-agent-tick-organization-id': organizationId }, payload: { name: 'Release' } });
    const policy = await app.inject({ method: 'POST', url: '/v1/policies', headers: { 'x-agent-tick-organization-id': organizationId }, payload: { name: 'Release team', teamId: team.json().teamId, requiredApprovals: 1 } });
    const agent = await app.inject({ method: 'POST', url: '/v1/agent-tokens', headers: { 'x-agent-tick-organization-id': organizationId }, payload: { name: 'release agent', teamId: team.json().teamId, defaultApprovalPolicy: policy.json().policyId } });
    db.db.prepare('INSERT INTO users(id, email, email_verified, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('usr_teammate', 'teammate@example.com', 1, 'Teammate', '2026-05-08T00:00:00.000Z', '2026-05-08T00:00:00.000Z');
    db.db.prepare('INSERT INTO organization_memberships(organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(organizationId, 'usr_teammate', 'member', '2026-05-08T00:00:00.000Z', '2026-05-08T00:00:00.000Z');
    const pairing = db.createPairingToken('usr_teammate', organizationId, '2026-05-08T00:00:00.000Z');
    const device = db.pairDeviceWithCode(pairing.token, 'Teammate phone', 'ios', '2026-05-08T00:00:01.000Z');
    const approval = await app.inject({
      method: 'POST',
      url: '/v1/approval-requests',
      headers: { authorization: `Bearer ${agent.json().token}` },
      payload: { requester: { name: 'release agent' }, title: 'Deploy release?' }
    });

    const rejected = await app.inject({
      method: 'POST',
      url: `/v1/approval-requests/${approval.json().request.id}/responses`,
      headers: { authorization: `Bearer ${device!.token}` },
      payload: { choiceId: 'approve' }
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toMatchObject({ error: { code: 'forbidden' } });

    const accepted = await app.inject({
      method: 'POST',
      url: `/v1/approval-requests/${approval.json().request.id}/responses`,
      headers: { 'x-agent-tick-organization-id': organizationId },
      payload: { choiceId: 'approve' }
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });
  });
});
