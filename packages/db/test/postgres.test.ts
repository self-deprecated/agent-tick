import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { DEFAULT_ORGANIZATION_ID, PostgresAgentTickStore } from '../src/index.js';

const databaseURL = process.env.AGENT_TICK_TEST_POSTGRES_URL;
const describePostgres = databaseURL ? describe : describe.skip;

let adminPool: Pool | undefined;
let store: PostgresAgentTickStore | undefined;
let schemaName: string | undefined;

beforeAll(async () => {
  if (!databaseURL) return;
  schemaName = `agent_tick_test_${randomUUID().replace(/-/g, '_')}`;
  adminPool = new Pool({ connectionString: databaseURL });
  await adminPool.query(`CREATE SCHEMA ${schemaName}`);
  store = PostgresAgentTickStore.open({
    databaseURL,
    poolConfig: { options: `-c search_path=${schemaName}` }
  });
});

afterAll(async () => {
  await store?.close();
  if (adminPool && schemaName) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await adminPool.end();
  }
});

describePostgres('PostgresAgentTickStore', () => {
  it('runs migrations and creates default tenant records', async () => {
    await store!.migrate('2026-05-08T00:00:00.000Z');
    await store!.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');

    const memberships = await store!.listOrganizationsForUser('usr_default');
    expect(memberships).toEqual([
      expect.objectContaining({ organizationId: DEFAULT_ORGANIZATION_ID, name: 'Personal', userId: 'usr_default', role: 'owner', status: 'active' })
    ]);
    expect(await store!.organizationSeatUsage(DEFAULT_ORGANIZATION_ID)).toEqual({ activeMembers: 1, pendingMembers: 0 });
  });

  it('creates organizations and records audit events', async () => {
    await store!.migrate('2026-05-08T00:00:00.000Z');
    await store!.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');

    const created = await store!.createOrganizationForUser('usr_default', 'Production', '2026-05-08T01:00:00.000Z');
    expect(created).toMatchObject({ name: 'Production', userId: 'usr_default', role: 'owner', status: 'active' });
    expect(await store!.organizationMembershipForUser('usr_default', created.organizationId)).toMatchObject({ role: 'owner' });
    expect(await store!.organizationMembershipForUserAnyStatus('usr_default', created.organizationId)).toMatchObject({ name: 'Production' });
    expect((await store!.listOrganizationMembers(created.organizationId)).map((member) => member.userId)).toEqual(['usr_default']);

    const [event] = await store!.listAuditEvents(created.organizationId);
    expect(event).toMatchObject({ organizationId: created.organizationId, userId: 'usr_default', eventType: 'organization.created', targetId: created.organizationId, payload: { name: 'Production' } });
    expect(await store!.listAuditEventsAfter(created.organizationId, event!.eventId - 1)).toEqual([event]);
  });

  it('manages devices and pairing codes', async () => {
    await store!.migrate('2026-05-08T00:00:00.000Z');
    await store!.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');

    const registered = await store!.registerDevice({ userId: 'usr_default', deviceName: 'iPhone', platform: 'ios', installationId: 'install_1', expoPushToken: 'ExponentPushToken[one]' }, '2026-05-08T02:06:00.000Z');
    expect(registered).toMatchObject({ userId: 'usr_default', name: 'iPhone', platform: 'ios', installationId: 'install_1', expoPushToken: 'ExponentPushToken[one]' });
    const updated = await store!.updateDevicePushToken(registered.deviceId, 'usr_default', 'ExponentPushToken[two]', '2026-05-08T02:07:00.000Z');
    expect(updated).toMatchObject({ deviceId: registered.deviceId, expoPushToken: 'ExponentPushToken[two]' });
    expect((await store!.listPushDevicesForUsers(['usr_default'])).map((device) => device.deviceId)).toContain(registered.deviceId);

    const pairing = await store!.createPairingToken('usr_default', DEFAULT_ORGANIZATION_ID, '2026-05-08T02:08:00.000Z');
    expect(pairing.token).toMatch(/^pair_/);
    const credential = await store!.pairDeviceWithCode(pairing.token, 'Android', 'android', '2026-05-08T02:08:30.000Z');
    expect(credential?.token).toMatch(/^device_/);
    expect(await store!.verifyDeviceToken(credential!.token)).toMatchObject({ source: 'device', deviceId: credential!.deviceId, userId: 'usr_default', organizationId: DEFAULT_ORGANIZATION_ID });
    expect(await store!.pairDeviceWithCode(pairing.token, 'Android again', 'android', '2026-05-08T02:09:00.000Z')).toBeNull();

    expect(await store!.unregisterDevice(registered.deviceId, 'usr_default', '2026-05-08T02:09:30.000Z')).toMatchObject({ deviceId: registered.deviceId, unregisteredAt: '2026-05-08T02:09:30.000Z' });
  });

  it('creates and verifies short-lived event and waiter tokens', async () => {
    await store!.migrate('2026-05-08T00:00:00.000Z');
    await store!.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');

    const eventTicket = await store!.createEventTicket({ source: 'dashboard', organizationId: DEFAULT_ORGANIZATION_ID, userId: 'usr_default', ttlSeconds: 30 }, '2026-05-08T02:10:00.000Z');
    expect(eventTicket.ticket).toMatch(/^evt_/);
    expect(JSON.stringify(await store!.listAuditEvents(DEFAULT_ORGANIZATION_ID))).not.toContain(eventTicket.ticket);
    expect(await store!.verifyEventTicket(eventTicket.ticket, '2026-05-08T02:10:01.000Z')).toMatchObject({ source: 'dashboard', organizationId: DEFAULT_ORGANIZATION_ID, userId: 'usr_default' });
    expect(await store!.verifyEventTicket(eventTicket.ticket, '2026-05-08T02:10:02.000Z')).toBeNull();

    const waiter = await store!.createApprovalWaiterToken('req_test', DEFAULT_ORGANIZATION_ID, 'agt_test', undefined, '2026-05-08T02:11:00.000Z');
    expect(waiter.token).toMatch(/^wait_/);
    expect(await store!.verifyApprovalWaiterToken(waiter.token, 'req_test', '2026-05-08T02:12:00.000Z')).toMatchObject({ requestId: 'req_test', organizationId: DEFAULT_ORGANIZATION_ID, agentId: 'agt_test' });
    expect(await store!.verifyApprovalWaiterToken(waiter.token, 'req_other', '2026-05-08T02:12:00.000Z')).toBeNull();
  });

  it('records availability, agent status updates, and mobile diagnostics', async () => {
    await store!.migrate('2026-05-08T00:00:00.000Z');
    await store!.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');

    const available = await store!.recordHeartbeat('usr_default', DEFAULT_ORGANIZATION_ID, '2026-05-08T03:00:00.000Z');
    expect(available).toMatchObject({ userId: 'usr_default', organizationId: DEFAULT_ORGANIZATION_ID, state: 'available', lastSeenAt: '2026-05-08T03:00:00.000Z' });
    expect(await store!.setAvailability('usr_default', DEFAULT_ORGANIZATION_ID, 'busy', '2026-05-08T03:01:00.000Z')).toMatchObject({ state: 'busy' });

    const first = await store!.createAgentStatusUpdate(
      { organizationId: DEFAULT_ORGANIZATION_ID, agentId: 'agt_test', agentName: 'Test Agent', threadId: 'thread_1', message: 'Working', state: 'running', metadata: { task: 'deploy' } },
      '2026-05-08T03:02:00.000Z'
    );
    await store!.createAgentStatusUpdate(
      { organizationId: DEFAULT_ORGANIZATION_ID, agentId: 'agt_test', agentName: 'Test Agent', threadId: 'thread_1', message: 'Done', state: 'complete' },
      '2026-05-08T03:03:00.000Z'
    );
    expect(await store!.getAgentStatusUpdate(first.statusId, DEFAULT_ORGANIZATION_ID)).toMatchObject({ statusId: first.statusId, metadata: { task: 'deploy' } });
    expect(await store!.listLatestAgentStatusUpdates(DEFAULT_ORGANIZATION_ID)).toEqual([expect.objectContaining({ threadId: 'thread_1', state: 'complete' })]);

    expect(
      await store!.recordMobileDiagnostics([
        { organizationId: DEFAULT_ORGANIZATION_ID, userId: 'usr_default', level: 'info', area: 'push', message: 'Registered', metadata: { platform: 'ios' }, createdAt: '2026-05-08T03:04:00.000Z' }
      ])
    ).toBe(1);
    expect(await store!.listMobileDiagnostics(DEFAULT_ORGANIZATION_ID)).toEqual([expect.objectContaining({ level: 'info', area: 'push', metadata: { platform: 'ios' } })]);
  });

  it('manages projects, teams, team members, policies, and agent tokens', async () => {
    await store!.migrate('2026-05-08T00:00:00.000Z');
    await store!.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');

    const org = await store!.createOrganizationForUser('usr_default', 'App Org', '2026-05-08T02:00:00.000Z');
    const project = await store!.createProject({ organizationId: org.organizationId, userId: 'usr_default', name: 'Mobile App' }, '2026-05-08T02:01:00.000Z');
    expect(project).toMatchObject({ organizationId: org.organizationId, name: 'Mobile App', slug: 'mobile-app' });
    expect((await store!.createProject({ organizationId: org.organizationId, userId: 'usr_default', name: 'Mobile App' })).slug).toBe('mobile-app-2');
    expect(await store!.projectBelongsToOrganization(project.projectId, org.organizationId)).toBe(true);

    const team = await store!.createTeam({ organizationId: org.organizationId, userId: 'usr_default', name: 'Platform' }, '2026-05-08T02:02:00.000Z');
    expect(team).toMatchObject({ organizationId: org.organizationId, name: 'Platform', slug: 'platform', userId: 'usr_default', role: 'owner' });
    expect((await store!.createTeam({ organizationId: org.organizationId, userId: 'usr_default', name: 'Platform' })).slug).toBe('platform-2');
    expect(await store!.teamBelongsToOrganization(team.teamId, org.organizationId)).toBe(true);

    await expect(store!.removeTeamMember({ organizationId: org.organizationId, actorUserId: 'usr_default', teamId: team.teamId, userId: 'usr_default' })).rejects.toThrow(/last team owner/i);

    const policy = await store!.createPolicy({ organizationId: org.organizationId, userId: 'usr_default', name: 'Release quorum', projectId: project.projectId, teamId: team.teamId, requiredApprovals: 2 });
    expect(policy).toMatchObject({ name: 'Release quorum', projectId: project.projectId, teamId: team.teamId, requiredApprovals: 2, enabled: true });
    expect(await store!.policyBelongsToOrganization(policy.policyId, org.organizationId)).toBe(true);

    const updated = await store!.updatePolicy({ organizationId: org.organizationId, userId: 'usr_default', policyId: policy.policyId, enabled: false, requiredApprovals: 3 });
    expect(updated).toMatchObject({ enabled: false, requiredApprovals: 3 });
    expect((await store!.listProjects(org.organizationId)).map((entry) => entry.projectId)).toContain(project.projectId);
    expect((await store!.listTeams(org.organizationId)).map((entry) => entry.teamId)).toContain(team.teamId);
    expect((await store!.listPolicies(org.organizationId)).map((entry) => entry.policyId)).toContain(policy.policyId);

    const credential = await store!.createAgentToken({ organizationId: org.organizationId, ownerUserId: 'usr_default', name: 'Deploy bot', projectId: project.projectId, teamId: team.teamId, defaultApprovalPolicy: policy.policyId }, '2026-05-08T02:03:00.000Z');
    expect(credential.token).toMatch(/^agent_/);
    expect(JSON.stringify(await store!.listAgentTokens(org.organizationId))).not.toContain(credential.token);
    expect(await store!.verifyAgentToken(credential.token, '2026-05-08T02:04:00.000Z')).toMatchObject({ source: 'agent', agentId: credential.agentId, organizationId: org.organizationId, projectId: project.projectId, teamId: team.teamId, defaultApprovalPolicy: policy.policyId });
    expect(await store!.revokeAgentToken(credential.agentId, org.organizationId, '2026-05-08T02:05:00.000Z')).toMatchObject({ agentId: credential.agentId, revokedAt: '2026-05-08T02:05:00.000Z' });
    expect(await store!.verifyAgentToken(credential.token)).toBeNull();
  });
});
