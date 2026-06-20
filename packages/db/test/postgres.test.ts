import { describe, expect, it } from 'vitest';
import { postgresTestDatabaseURL, withPostgresSchemaHarness } from './postgresHarness.js';

const describePostgres = postgresTestDatabaseURL ? describe : describe.skip;
const postgresSuiteName = postgresTestDatabaseURL
  ? 'Postgres workspace schema baseline'
  : 'Postgres workspace schema baseline (set AGENT_TICK_TEST_POSTGRES_URL to run)';

describePostgres(postgresSuiteName, () => {
  it('installs the current schema and tracks Postgres migrations idempotently', async () => {
    await withPostgresSchemaHarness(async ({ adminPool, schemaName, store }) => {
      await store.migrate('2026-05-08T00:00:00.000Z');
      await store.migrate('2026-05-08T00:00:01.000Z');
      const result = await adminPool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('schema_migrations', 'workspaces', 'workspace_members', 'routing_rules', 'requests', 'responses', 'status_updates') ORDER BY table_name`,
        [schemaName]
      );
      expect(result.rows.map((row) => row.table_name)).toEqual(['requests', 'responses', 'routing_rules', 'schema_migrations', 'status_updates', 'workspace_members', 'workspaces']);

      const waiterId = await adminPool.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'request_waiter_tokens' AND column_name = 'waiter_id'`,
        [schemaName]
      );
      expect(waiterId.rows).toEqual([{ is_nullable: 'NO' }]);

      const migrations = await adminPool.query(
        `SELECT id, applied_at FROM ${schemaName}.schema_migrations ORDER BY id`
      );
      expect(migrations.rows).toEqual([
        { id: '20260616_0001_workspace_private_requests', applied_at: '2026-05-08T00:00:00.000Z' },
        { id: '20260616_0002_private_activity_payloads', applied_at: '2026-05-08T00:00:00.000Z' }
      ]);
    });
  });

  it('repairs existing Postgres tables with current evolved columns', async () => {
    await withPostgresSchemaHarness(async ({ adminPool, schemaName, store }) => {
      await adminPool.query(`
        CREATE TABLE ${schemaName}.workspaces (
          workspace_id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK(type IN ('personal', 'shared')),
          name TEXT NOT NULL,
          clerk_organization_id TEXT UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE ${schemaName}.routing_rules (
          routing_rule_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES ${schemaName}.workspaces(workspace_id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          required_response_mode TEXT NOT NULL DEFAULT 'any_one',
          required_response_count INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      await store.migrate('2026-06-16T00:00:00.000Z');

      const columns = await adminPool.query(
        `SELECT table_name, column_name, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = $1
            AND (table_name, column_name) IN (('workspaces', 'responses_entitled_until'), ('workspaces', 'private_requests_required'), ('routing_rules', 'private_requests_required'))
          ORDER BY table_name, column_name`,
        [schemaName]
      );
      expect(columns.rows).toEqual([
        { table_name: 'routing_rules', column_name: 'private_requests_required', is_nullable: 'NO', column_default: 'false' },
        { table_name: 'workspaces', column_name: 'private_requests_required', is_nullable: 'NO', column_default: 'false' },
        { table_name: 'workspaces', column_name: 'responses_entitled_until', is_nullable: 'YES', column_default: null }
      ]);
    });
  });

  it('repairs existing Postgres activity tables with private payload columns', async () => {
    await withPostgresSchemaHarness(async ({ adminPool, schemaName, store }) => {
      await adminPool.query(`
        CREATE TABLE ${schemaName}.schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
        INSERT INTO ${schemaName}.schema_migrations(id, applied_at) VALUES ('20260616_0001_workspace_private_requests', '2026-06-16T00:00:00.000Z');

        CREATE TABLE ${schemaName}.requests (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          agent_token_id TEXT,
          routing_rule_id TEXT,
          session_id TEXT,
          session_metadata_json TEXT NOT NULL DEFAULT '{}',
          requester_json TEXT NOT NULL,
          request_type TEXT NOT NULL,
          delivery_kind TEXT NOT NULL DEFAULT 'routed_members',
          response_policy TEXT NOT NULL DEFAULT 'quorum',
          audience_channel_id TEXT,
          closes_at TEXT,
          tie_policy TEXT,
          aggregate_result_json TEXT,
          title TEXT NOT NULL,
          body TEXT,
          command TEXT,
          choices_json TEXT NOT NULL,
          questions_json TEXT NOT NULL DEFAULT '[]',
          default_choice TEXT,
          allow_freeform_reply BOOLEAN NOT NULL DEFAULT false,
          deadline TEXT,
          risk TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL,
          required_response_count INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          responded_at TEXT,
          response_json TEXT,
          final_choice_id TEXT,
          is_test BOOLEAN NOT NULL DEFAULT false,
          test_label TEXT
        );

        CREATE TABLE ${schemaName}.status_updates (
          status_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          agent_token_id TEXT,
          routing_rule_id TEXT,
          thread_id TEXT,
          session_id TEXT,
          session_metadata_json TEXT NOT NULL DEFAULT '{}',
          message TEXT NOT NULL,
          state TEXT NOT NULL,
          next_step TEXT,
          host TEXT,
          working_directory TEXT,
          client_name TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          is_test BOOLEAN NOT NULL DEFAULT false,
          test_label TEXT
        );
      `);

      await store.migrate('2026-06-16T00:00:01.000Z');

      const columns = await adminPool.query(
        `SELECT table_name, column_name, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = $1
            AND (table_name, column_name) IN (
              ('requests', 'content_mode'),
              ('requests', 'encrypted_payload_json'),
              ('requests', 'private_recipient_version'),
              ('requests', 'private_unavailable_recipients_json'),
              ('status_updates', 'content_mode'),
              ('status_updates', 'encrypted_payload_json'),
              ('status_updates', 'private_recipient_version'),
              ('status_updates', 'context_usage_json')
            )
          ORDER BY table_name, column_name`,
        [schemaName]
      );
      expect(columns.rows).toEqual([
        { table_name: 'requests', column_name: 'content_mode', is_nullable: 'NO', column_default: "'plain'::text" },
        { table_name: 'requests', column_name: 'encrypted_payload_json', is_nullable: 'YES', column_default: null },
        { table_name: 'requests', column_name: 'private_recipient_version', is_nullable: 'YES', column_default: null },
        { table_name: 'requests', column_name: 'private_unavailable_recipients_json', is_nullable: 'NO', column_default: "'[]'::text" },
        { table_name: 'status_updates', column_name: 'content_mode', is_nullable: 'NO', column_default: "'plain'::text" },
        { table_name: 'status_updates', column_name: 'context_usage_json', is_nullable: 'NO', column_default: "'{}'::text" },
        { table_name: 'status_updates', column_name: 'encrypted_payload_json', is_nullable: 'YES', column_default: null },
        { table_name: 'status_updates', column_name: 'private_recipient_version', is_nullable: 'YES', column_default: null }
      ]);

      const migrations = await adminPool.query(
        `SELECT id, applied_at FROM ${schemaName}.schema_migrations ORDER BY id`
      );
      expect(migrations.rows).toEqual([
        { id: '20260616_0001_workspace_private_requests', applied_at: '2026-06-16T00:00:00.000Z' },
        { id: '20260616_0002_private_activity_payloads', applied_at: '2026-06-16T00:00:01.000Z' }
      ]);
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
      expect(tables.rows.map((row) => row.table_name)).toContain('schema_migrations');

      const migrations = await adminPool.query(
        `SELECT id, COUNT(*)::int AS count FROM ${schemaName}.schema_migrations GROUP BY id ORDER BY id`
      );
      expect(migrations.rows).toEqual([
        { id: '20260616_0001_workspace_private_requests', count: 1 },
        { id: '20260616_0002_private_activity_payloads', count: 1 }
      ]);

      const duplicateIndexes = await adminPool.query(
        `SELECT indexname, COUNT(*)::int AS count FROM pg_indexes WHERE schemaname = $1 GROUP BY indexname HAVING COUNT(*) > 1`,
        [schemaName]
      );
      expect(duplicateIndexes.rows).toEqual([]);
    });
  });

  it('reports schema_mismatch when required evolved columns are missing', async () => {
    await withPostgresSchemaHarness(async ({ adminPool, schemaName, store }) => {
      await store.migrate('2026-06-16T00:00:00.000Z');

      // Simulate a deployment whose schema lags the running code: the tables
      // exist and `SELECT 1` pings succeed, but evolved Activity columns were
      // never applied. Writes against these fail with Postgres 42703.
      await adminPool.query(`ALTER TABLE ${schemaName}.requests DROP COLUMN content_mode`);
      await adminPool.query(`ALTER TABLE ${schemaName}.status_updates DROP COLUMN context_usage_json`);

      const result = await store.verifySchemaCompatibility();
      expect(result).toEqual({
        ok: false,
        code: 'schema_mismatch',
        missing: expect.arrayContaining([
          { table: 'requests', column: 'content_mode' },
          { table: 'status_updates', column: 'context_usage_json' }
        ])
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // The private Activity write path is always covered by the gate.
        const tables = result.missing.map((entry) => `${entry.table}.${entry.column}`);
        expect(tables).toEqual(expect.arrayContaining(['requests.content_mode', 'status_updates.context_usage_json']));
        // It must not expose SQL internals, only a safe code.
        expect(result.code).toBe('schema_mismatch');
      }
    });
  });

  it('reports compatibility after the full migration baseline is applied', async () => {
    await withPostgresSchemaHarness(async ({ store }) => {
      await store.migrate('2026-06-16T00:00:00.000Z');
      await expect(store.verifySchemaCompatibility()).resolves.toEqual({ ok: true });
    });
  });

  it('write-path canary passes on a healthy schema and leaves no rows behind', async () => {
    await withPostgresSchemaHarness(async ({ adminPool, schemaName, store }) => {
      await store.migrate('2026-06-16T00:00:00.000Z');
      await expect(store.runActivityWriteCanary('2026-06-16T00:00:00.000Z')).resolves.toEqual({ ok: true });
      // Rolled back: no canary rows persist in user-facing Activity tables.
      const statusCount = await adminPool.query(`SELECT COUNT(*)::int AS n FROM ${schemaName}.status_updates WHERE test_label = $1`, ['Agent Tick write-path canary']);
      const requestCount = await adminPool.query(`SELECT COUNT(*)::int AS n FROM ${schemaName}.requests WHERE test_label = $1`, ['Agent Tick write-path canary']);
      expect(statusCount.rows[0].n).toBe(0);
      expect(requestCount.rows[0].n).toBe(0);
    });
  });

  it('write-path canary reports schema_mismatch when a required Activity column is missing', async () => {
    await withPostgresSchemaHarness(async ({ adminPool, schemaName, store }) => {
      await store.migrate('2026-06-16T00:00:00.000Z');
      await adminPool.query(`ALTER TABLE ${schemaName}.requests DROP COLUMN content_mode`);
      await expect(store.runActivityWriteCanary('2026-06-16T00:00:00.000Z')).resolves.toEqual({ ok: false, code: 'schema_mismatch' });
    });
  });
});
