import { describe, expect, it } from 'vitest';
import { AgentTickStore } from '../src/index.js';

describe('SQLite schema migration compatibility', () => {
  it('backfills Private Request columns into existing current-schema tables', () => {
    const store = AgentTickStore.open({ databaseURL: ':memory:' });
    try {
      store.db.exec(`
        CREATE TABLE workspaces (
          workspace_id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK(type IN ('personal', 'shared')),
          name TEXT NOT NULL,
          clerk_organization_id TEXT UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE routing_rules (
          routing_rule_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          required_response_mode TEXT NOT NULL DEFAULT 'any_one',
          required_response_count INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE requests (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
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
          allow_freeform_reply INTEGER NOT NULL DEFAULT 0,
          deadline TEXT,
          risk TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL,
          required_response_count INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          responded_at TEXT,
          response_json TEXT,
          final_choice_id TEXT,
          is_test INTEGER NOT NULL DEFAULT 0,
          test_label TEXT
        );
      `);

      store.migrate();

      expect(columnNames(store, 'workspaces')).toEqual(expect.arrayContaining(['responses_entitled_until', 'private_requests_required']));
      expect(columnNames(store, 'routing_rules')).toContain('private_requests_required');
      expect(columnNames(store, 'requests')).toEqual(expect.arrayContaining(['content_mode', 'encrypted_payload_json', 'private_recipient_version', 'private_unavailable_recipients_json']));
    } finally {
      store.close();
    }
  });

  it('verifies schema compatibility after migrate and detects drift', () => {
    const store = AgentTickStore.open({ databaseURL: ':memory:' });
    try {
      store.migrate();
      // After the full-schema + ensureColumn path runs, the schema is current.
      expect(store.verifySchemaCompatibility()).toEqual({ ok: true });

      // Simulate drift: drop a required Activity column the running code needs.
      store.db.exec(`ALTER TABLE requests DROP COLUMN content_mode`);
      const result = store.verifySchemaCompatibility();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('schema_mismatch');
        expect(result.missing).toContainEqual({ table: 'requests', column: 'content_mode' });
      }
    } finally {
      store.close();
    }
  });

  it('write-path canary passes on a healthy schema and leaves no rows behind', () => {
    const store = AgentTickStore.open({ databaseURL: ':memory:' });
    try {
      store.migrate();
      store.ensureSingleTenantDefaults('2026-06-16T00:00:00.000Z');
      const result = store.runActivityWriteCanary('2026-06-16T00:00:00.000Z');
      expect(result).toEqual({ ok: true });
      // Rolled back: no canary rows persist in user-facing Activity tables.
      const statusCount = (store.db.prepare(`SELECT COUNT(*) AS n FROM status_updates WHERE test_label = ?`).get('Agent Tick write-path canary') as { n: number }).n;
      const requestCount = (store.db.prepare(`SELECT COUNT(*) AS n FROM requests WHERE test_label = ?`).get('Agent Tick write-path canary') as { n: number }).n;
      expect(statusCount).toBe(0);
      expect(requestCount).toBe(0);
    } finally {
      store.close();
    }
  });

  it('write-path canary reports schema_mismatch when a required Activity column is missing', () => {
    const store = AgentTickStore.open({ databaseURL: ':memory:' });
    try {
      store.migrate();
      store.db.exec(`ALTER TABLE status_updates DROP COLUMN content_mode`);
      const result = store.runActivityWriteCanary('2026-06-16T00:00:00.000Z');
      expect(result).toEqual({ ok: false, code: 'schema_mismatch' });
    } finally {
      store.close();
    }
  });
});

function columnNames(store: AgentTickStore, table: string): string[] {
  return (store.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name);
}
