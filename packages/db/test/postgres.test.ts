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
});
