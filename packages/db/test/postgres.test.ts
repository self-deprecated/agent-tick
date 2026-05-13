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

  it('manages projects, teams, team members, and policies', async () => {
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
  });
});
