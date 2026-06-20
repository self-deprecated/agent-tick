import type { SchemaCompatibilityResult } from './store/types.js';

/**
 * Required evolved columns the running server code needs beyond the base
 * `CREATE TABLE` baseline. These are introduced by `ALTER TABLE ... ADD COLUMN`
 * migrations (see `POSTGRES_MIGRATIONS` / the SQLite `ensureColumn` path).
 *
 * They are the columns most at risk of drift: an existing deployment can have
 * tables from an older baseline but never have applied the migration that adds
 * them, so writes against them fail with a missing-column error (Postgres
 * `42703`) while a `SELECT 1` readiness ping still succeeds.
 *
 * When you add a new evolved column via a migration, add it here too. Both store
 * backends verify every entry below exists and report `schema_mismatch` with the
 * missing columns otherwise.
 *
 * Base columns defined directly in `CREATE TABLE` statements are intentionally
 * not listed: if a base table is missing entirely, writes and the readiness ping
 * already fail loudly. This registry focuses on the silent-drift case where the
 * table exists but a required column does not.
 *
 * Column/table names are identical across the Postgres and SQLite schemas, so a
 * single list covers both backends.
 */
export interface RequiredEvolvedColumn {
  table: string;
  column: string;
}

export const REQUIRED_EVOLVED_COLUMNS: readonly RequiredEvolvedColumn[] = [
  // 20260616_0001_workspace_private_requests
  { table: 'workspaces', column: 'responses_entitled_until' },
  { table: 'workspaces', column: 'private_requests_required' },
  { table: 'routing_rules', column: 'private_requests_required' },
  // 20260616_0002_private_activity_payloads (private Activity write path)
  { table: 'requests', column: 'content_mode' },
  { table: 'requests', column: 'encrypted_payload_json' },
  { table: 'requests', column: 'private_recipient_version' },
  { table: 'requests', column: 'private_unavailable_recipients_json' },
  { table: 'status_updates', column: 'content_mode' },
  { table: 'status_updates', column: 'encrypted_payload_json' },
  { table: 'status_updates', column: 'private_recipient_version' },
  { table: 'status_updates', column: 'context_usage_json' },
  // 20260616_0004_tool_activity_thread_id
  { table: 'tool_activities', column: 'thread_id' }
];

/**
 * Compute a compatibility result from the set of `"table.column"` strings that
 * the backend reports as present. Returns `{ ok: true }` when every required
 * evolved column is present, otherwise `schema_mismatch` with the missing ones.
 */
export function computeSchemaCompatibility(present: ReadonlySet<string>): SchemaCompatibilityResult {
  const missing = REQUIRED_EVOLVED_COLUMNS.filter((entry) => !present.has(`${entry.table}.${entry.column}`));
  return missing.length === 0
    ? { ok: true }
    : { ok: false, code: 'schema_mismatch', missing: missing.map((entry) => ({ table: entry.table, column: entry.column })) };
}
