import { describe, expect, it } from 'vitest';
import { postgresTestDatabaseURL, withPostgresSchemaHarness } from './postgresHarness.js';

const describePostgres = postgresTestDatabaseURL ? describe : describe.skip;
const postgresSuiteName = postgresTestDatabaseURL
  ? 'Postgres workspace schema baseline'
  : 'Postgres workspace schema baseline (set AGENT_TICK_TEST_POSTGRES_URL to run)';

describePostgres(postgresSuiteName, () => {
  it('installs the current pre-launch schema idempotently', async () => {
    await withPostgresSchemaHarness(async ({ adminPool, schemaName, store }) => {
      await store.migrate('2026-05-08T00:00:00.000Z');
      await store.migrate('2026-05-08T00:00:01.000Z');
      const result = await adminPool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('schema_migrations', 'workspaces', 'workspace_members', 'routing_rules', 'requests', 'responses', 'status_updates') ORDER BY table_name`,
        [schemaName]
      );
      expect(result.rows.map((row) => row.table_name)).toEqual(['requests', 'responses', 'routing_rules', 'status_updates', 'workspace_members', 'workspaces']);

      const waiterId = await adminPool.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'request_waiter_tokens' AND column_name = 'waiter_id'`,
        [schemaName]
      );
      expect(waiterId.rows).toEqual([{ is_nullable: 'NO' }]);
    });
  });

  it('serializes concurrent current-schema setup for one schema', async () => {
    await withPostgresSchemaHarness(async ({ adminPool, schemaName, openStore, store }) => {
      const concurrentStore = openStore();
      await Promise.all([
        store.migrate('2026-05-08T00:00:00.000Z'),
        concurrentStore.migrate('2026-05-08T00:00:00.001Z')
      ]);

      const tables = await adminPool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
        [schemaName]
      );
      expect(tables.rows.map((row) => row.table_name)).toContain('requests');
      expect(tables.rows.map((row) => row.table_name)).not.toContain('schema_migrations');

      const duplicateIndexes = await adminPool.query(
        `SELECT indexname, COUNT(*)::int AS count FROM pg_indexes WHERE schemaname = $1 GROUP BY indexname HAVING COUNT(*) > 1`,
        [schemaName]
      );
      expect(duplicateIndexes.rows).toEqual([]);
    });
  });
});
