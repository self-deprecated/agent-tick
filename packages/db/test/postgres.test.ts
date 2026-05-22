import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresAgentTickStore } from '../src/index.js';

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
  store = PostgresAgentTickStore.open({ databaseURL, poolConfig: { options: `-c search_path=${schemaName}` } });
});

afterAll(async () => {
  await store?.close();
  if (adminPool && schemaName) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await adminPool.end();
  }
});

describePostgres('Postgres workspace schema baseline', () => {
  it('runs Workspace/Routing Rule migrations', async () => {
    await store!.migrate('2026-05-08T00:00:00.000Z');
    const result = await adminPool!.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('workspaces', 'workspace_members', 'routing_rules', 'requests', 'responses', 'status_updates') ORDER BY table_name`,
      [schemaName]
    );
    expect(result.rows.map((row) => row.table_name)).toEqual(['requests', 'responses', 'routing_rules', 'status_updates', 'workspace_members', 'workspaces']);
  });
});
