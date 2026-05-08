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

  it('creates local organizations for a user and lists memberships', () => {
    store = AgentTickStore.open({ databaseURL: ':memory:' });
    store.migrate();
    store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');

    const created = store.createOrganizationForUser('usr_default', 'Production');
    const memberships = store.listOrganizationsForUser('usr_default');

    expect(created).toMatchObject({ name: 'Production', userId: 'usr_default', role: 'owner' });
    expect(memberships.map((membership) => membership.organizationId)).toContain(created.organizationId);
    expect(store.organizationMembershipForUser('usr_default', created.organizationId)).toMatchObject({ role: 'owner' });
    expect(store.listOrganizationMembers(created.organizationId)).toEqual([created]);

    const project = store.createProject({ organizationId: created.organizationId, userId: 'usr_default', name: 'Mobile App' });
    expect(project).toMatchObject({ organizationId: created.organizationId, name: 'Mobile App', slug: 'mobile-app' });
    expect(store.createProject({ organizationId: created.organizationId, userId: 'usr_default', name: 'Mobile App' }).slug).toBe('mobile-app-2');
    expect(store.listProjects(created.organizationId).map((entry) => entry.projectId)).toContain(project.projectId);

    const team = store.createTeam({ organizationId: created.organizationId, userId: 'usr_default', name: 'Platform' });
    expect(team).toMatchObject({ organizationId: created.organizationId, name: 'Platform', slug: 'platform', userId: 'usr_default', role: 'owner' });
    expect(store.createTeam({ organizationId: created.organizationId, userId: 'usr_default', name: 'Platform' }).slug).toBe('platform-2');
    expect(store.listTeams(created.organizationId).map((entry) => entry.teamId)).toContain(team.teamId);
    expect(store.listTeamMembers(team.teamId)).toEqual([team]);

    const policy = store.createPolicy({
      organizationId: created.organizationId,
      userId: 'usr_default',
      name: 'Production quorum',
      projectId: project.projectId,
      teamId: team.teamId,
      requiredApprovals: 2
    });
    expect(policy).toMatchObject({ name: 'Production quorum', projectId: project.projectId, teamId: team.teamId, requiredApprovals: 2, enabled: true });
    expect(store.listPolicies(created.organizationId)).toEqual([policy]);

    const invite = store.createOrganizationInvite({
      organizationId: created.organizationId,
      userId: 'usr_default',
      label: 'Teammate',
      role: 'admin',
      teamIds: [team.teamId],
      email: 'bob@example.com',
      publicURL: 'https://tick.example.com'
    });
    expect(invite.token).toMatch(/^invite_/);
    expect(invite.url).toBe(`https://tick.example.com/invite/${invite.token}`);
    expect(JSON.stringify(store.db.prepare('SELECT * FROM organization_invites').all())).not.toContain(invite.token);
    expect(invite.teamIds).toEqual([team.teamId]);
    const preview = store.previewInvite(invite.token!);
    expect(preview).toMatchObject({ organizationName: 'Production', role: 'admin', approvalRequired: true });
    expect(preview).not.toHaveProperty('organizationId');
    expect(preview).not.toHaveProperty('teamIds');
    expect(preview).not.toHaveProperty('email');
    const bob = store.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_bob', email: 'bob@example.com', emailVerified: true, name: 'Bob' });
    const accepted = store.acceptInvite(invite.token!, bob.userId);
    expect(accepted).toMatchObject({ status: 'pending_approval', membership: { organizationId: created.organizationId, userId: bob.userId, role: 'admin', status: 'pending_approval' } });
    expect(store.organizationMembershipForUser(bob.userId, created.organizationId)).toBeNull();
    expect(store.listOrganizationsForUser(bob.userId).map((membership) => membership.organizationId)).not.toContain(created.organizationId);
    const [pendingRequest] = store.listOrganizationMembershipRequests(created.organizationId);
    expect(pendingRequest).toMatchObject({ inviteId: invite.inviteId, userId: bob.userId, requestedRole: 'admin', requestedTeamIds: [team.teamId], status: 'pending_approval' });
    const approvedRequest = store.approveOrganizationMembershipRequest(pendingRequest!.requestId, created.organizationId, 'usr_default');
    expect(approvedRequest).toMatchObject({ requestId: pendingRequest!.requestId, status: 'approved', decidedByUserId: 'usr_default' });
    expect(store.organizationMembershipForUser(bob.userId, created.organizationId)).toMatchObject({ role: 'admin' });
    expect(store.listTeamMembers(team.teamId)).toEqual(expect.arrayContaining([expect.objectContaining({ userId: bob.userId, role: 'member' })]));
    const teamMember = store.upsertTeamMember({ organizationId: created.organizationId, actorUserId: 'usr_default', teamId: team.teamId, userId: bob.userId, role: 'lead' });
    expect(teamMember).toMatchObject({ teamId: team.teamId, userId: bob.userId, role: 'lead' });
    const removedTeamMember = store.removeTeamMember({ organizationId: created.organizationId, actorUserId: 'usr_default', teamId: team.teamId, userId: bob.userId });
    expect(removedTeamMember).toMatchObject({ teamId: team.teamId, userId: bob.userId, role: 'lead' });
    expect(store.listTeamMembers(team.teamId).map((member) => member.userId)).not.toContain(bob.userId);
    expect(() => store!.removeTeamMember({ organizationId: created.organizationId, actorUserId: 'usr_default', teamId: team.teamId, userId: 'usr_default' })).toThrow(/last team owner/i);
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

    const revoked = store.revokeAgentToken(credential.agentId, DEFAULT_ORGANIZATION_ID, '2026-05-08T00:00:00.000Z');
    expect(revoked).toMatchObject({ agentId: credential.agentId, revokedAt: '2026-05-08T00:00:00.000Z' });
    expect(store.verifyAgentToken(credential.token)).toBeNull();
    expect(store.listAuditEvents(DEFAULT_ORGANIZATION_ID).map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['agent_token.revoked', 'agent_token.created'])
    );
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

  it('records heartbeat and availability state', () => {
    store = AgentTickStore.open({ databaseURL: ':memory:' });
    store.migrate();
    store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');

    const heartbeat = store.recordHeartbeat('usr_default', DEFAULT_ORGANIZATION_ID, '2026-05-08T00:00:01.000Z');
    expect(heartbeat).toMatchObject({ state: 'available', lastSeenAt: '2026-05-08T00:00:01.000Z' });

    const availability = store.setAvailability('usr_default', DEFAULT_ORGANIZATION_ID, 'busy', '2026-05-08T00:00:02.000Z');
    expect(availability).toMatchObject({ state: 'busy', lastSeenAt: '2026-05-08T00:00:02.000Z' });
  });

  it('creates short-lived event tickets without storing plaintext tickets', () => {
    store = AgentTickStore.open({ databaseURL: ':memory:' });
    store.migrate();
    store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');

    const ticket = store.createEventTicket(
      { source: 'agent', organizationId: DEFAULT_ORGANIZATION_ID, agentId: 'agt_123', ttlSeconds: 30 },
      '2026-05-08T00:00:00.000Z'
    );

    expect(ticket.ticket).toMatch(/^evt_/);
    expect(JSON.stringify(store.db.prepare('SELECT * FROM event_tickets').all())).not.toContain(ticket.ticket);
    expect(store.verifyEventTicket(ticket.ticket, '2026-05-08T00:00:10.000Z')).toMatchObject({ organizationId: DEFAULT_ORGANIZATION_ID, agentId: 'agt_123' });
    expect(store.verifyEventTicket(ticket.ticket, '2026-05-08T00:01:00.000Z')).toBeNull();
  });

  it('pairs single-mode devices with short-lived pairing codes', () => {
    store = AgentTickStore.open({ databaseURL: ':memory:' });
    store.migrate();
    store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');

    const pairing = store.createPairingToken('usr_default', DEFAULT_ORGANIZATION_ID, '2026-05-08T00:00:00.000Z');
    const credential = store.pairDeviceWithCode(pairing.token, 'iPhone', 'ios', '2026-05-08T00:01:00.000Z');

    expect(credential?.token).toMatch(/^device_/);
    expect(JSON.stringify(store.db.prepare('SELECT * FROM devices').all())).not.toContain(credential?.token);
    expect(store.verifyDeviceToken(credential!.token)).toMatchObject({ userId: 'usr_default', organizationId: DEFAULT_ORGANIZATION_ID });
    expect(store.pairDeviceWithCode(pairing.token, 'Replay', 'ios')).toBeNull();
  });

  it('cleans expired event tickets and pairing codes', () => {
    store = AgentTickStore.open({ databaseURL: ':memory:' });
    store.migrate();
    store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');

    store.createEventTicket({ source: 'agent', organizationId: DEFAULT_ORGANIZATION_ID, agentId: 'agt_expired', ttlSeconds: 1 }, '2026-05-08T00:00:00.000Z');
    store.createEventTicket({ source: 'agent', organizationId: DEFAULT_ORGANIZATION_ID, agentId: 'agt_active', ttlSeconds: 60 }, '2026-05-08T00:00:00.000Z');
    store.createPairingToken('usr_default', DEFAULT_ORGANIZATION_ID, '2026-05-08T00:00:00.000Z', 1);
    store.createPairingToken('usr_default', DEFAULT_ORGANIZATION_ID, '2026-05-08T00:00:00.000Z', 60);

    const result = store.cleanupExpiredSecrets('2026-05-08T00:00:06.000Z');

    expect(result).toEqual({ eventTickets: 1, pairingCodes: 1 });
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM event_tickets').get()).toEqual({ count: 1 });
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM pairing_codes').get()).toEqual({ count: 1 });
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
    expect(store.listPushDevicesForOrganization(DEFAULT_ORGANIZATION_ID)).toEqual([expect.objectContaining({ deviceId: second.deviceId, expoPushToken: 'ExponentPushToken[abc]' })]);
  });

  it('abandons pending approval requests', () => {
    store = AgentTickStore.open({ databaseURL: ':memory:' });
    store.migrate();
    store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');

    const request = store.createApprovalRequest({
      requester: { name: 'agent', agentId: 'agent_test' },
      title: 'Deploy?'
    });

    const abandoned = store.abandonApprovalRequest(request.id, 'agent_test');
    expect(abandoned).toMatchObject({ id: request.id, status: 'abandoned' });
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

  it('keeps policy-backed approvals pending until quorum is met', () => {
    store = AgentTickStore.open({ databaseURL: ':memory:' });
    store.migrate();
    store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
    store.db.prepare('INSERT INTO users(id, email, email_verified, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('usr_second', 'second@example.com', 1, 'Second', '2026-05-08T00:00:00.000Z', '2026-05-08T00:00:00.000Z');
    const policy = store.createPolicy({
      organizationId: DEFAULT_ORGANIZATION_ID,
      userId: 'usr_default',
      name: 'Two approvers',
      requiredApprovals: 2
    });
    const request = store.createApprovalRequest({
      requester: { name: 'agent', agentId: 'agent_test' },
      title: 'Deploy?',
      metadata: { defaultApprovalPolicy: policy.policyId }
    });

    const firstVote = store.respondToApprovalRequest(request.id, { choiceId: 'approve' }, 'usr_default');
    expect(firstVote).toMatchObject({ status: 'pending', policyProgress: { requiredApprovals: 2, receivedApprovals: 1, currentUserHasVoted: true } });
    expect(firstVote?.response).toBeUndefined();

    const secondVote = store.respondToApprovalRequest(request.id, { choiceId: 'approve' }, 'usr_second');
    expect(secondVote).toMatchObject({ status: 'responded', response: { choiceId: 'approve' }, policyProgress: { receivedApprovals: 2, waitingFor: 0 } });
  });

  it('scopes approval request lookup and mutation to organizations', () => {
    store = AgentTickStore.open({ databaseURL: ':memory:' });
    store.migrate();
    store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
    const otherOrg = store.createOrganizationForUser('usr_default', 'Other');

    const request = store.createApprovalRequest({
      organizationId: DEFAULT_ORGANIZATION_ID,
      requester: { name: 'agent', agentId: 'agent_test' },
      title: 'Deploy?'
    });

    expect(store.getApprovalRequestForOrganization(request.id, DEFAULT_ORGANIZATION_ID)).toMatchObject({ id: request.id });
    expect(store.getApprovalRequestForOrganization(request.id, otherOrg.organizationId)).toBeNull();
    expect(store.respondToApprovalRequestForOrganization(request.id, otherOrg.organizationId, { choiceId: 'approve' })).toBeNull();
    expect(store.abandonApprovalRequestForOrganization(request.id, otherOrg.organizationId, 'agent_test')).toBeNull();
    expect(store.getApprovalRequest(request.id)).toMatchObject({ status: 'pending' });
  });
});
