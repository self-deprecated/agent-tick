import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POSTGRES_MIGRATIONS } from '../src/postgresMigrations.js';
import { REQUIRED_EVOLVED_COLUMNS } from '../src/requiredColumns.js';

const expectedCurrentTables = [
  'agent_tokens',
  'approval_device_keys',
  'approval_devices',
  'audit_events',
  'audience_channels',
  'audience_subscriptions',
  'auth_identities',
  'availability',
  'billing_identity_conflicts',
  'billing_products',
  'billing_purchase_attempts',
  'billing_receipt_owners',
  'billing_transactions',
  'device_pairing_codes',
  'event_tickets',
  'external_approver_invites',
  'external_approvers',
  'mobile_diagnostics',
  'personal_entitlements',
  'request_recipients',
  'request_waiter_tokens',
  'request_waiters',
  'requests',
  'responses',
  'routing_rule_recipients',
  'routing_rules',
  'status_update_recipients',
  'status_updates',
  'tool_activities',
  'tool_activity_recipients',
  'users',
  'workspace_members',
  'workspaces'
].sort();

const requiredHotPathIndexes = [
  'requests_pending_deadline_idx',
  'requests_audience_finalize_idx',
  'request_recipients_pending_count_idx',
  'device_pairing_codes_cleanup_idx',
  'event_tickets_cleanup_idx',
  'request_waiter_tokens_cleanup_idx'
].sort();

const intentionalTypeDifferences = new Set([
  'auth_identities.id',
  'audit_events.event_id',
  'users.email_verified',
  'workspaces.private_requests_required',
  'routing_rules.private_requests_required',
  'requests.allow_freeform_reply',
  'requests.is_test',
  'request_recipients.has_active_device',
  'responses.final',
  'status_updates.is_test',
  'billing_products.active'
]);

describe('current relational schema parity', () => {
  it('keeps SQLite and PostgreSQL current-schema table coverage aligned', () => {
    const { sqliteSchema, postgresSchema } = readSchemas();

    expect(tableNames(sqliteSchema)).toEqual(expectedCurrentTables);
    expect(tableNames(postgresSchema)).toEqual(expectedCurrentTables);
  });

  it('keeps SQLite and PostgreSQL current-schema columns aligned', () => {
    const { sqliteSchema, postgresSchema } = readSchemas();
    const sqliteTables = tableColumns(sqliteSchema);
    const postgresTables = tableColumns(postgresSchema);

    expect([...sqliteTables.keys()].sort()).toEqual(expectedCurrentTables);
    expect([...postgresTables.keys()].sort()).toEqual(expectedCurrentTables);

    for (const table of expectedCurrentTables) {
      const sqliteColumns = sqliteTables.get(table) ?? new Map();
      const postgresColumns = postgresTables.get(table) ?? new Map();
      expect([...postgresColumns.keys()].sort(), `${table} column names`).toEqual([...sqliteColumns.keys()].sort());
      for (const column of sqliteColumns.keys()) {
        const key = `${table}.${column}`;
        if (intentionalTypeDifferences.has(key)) continue;
        expect(normalizeColumn(postgresColumns.get(column)!), `${key} postgres type`).toEqual(normalizeColumn(sqliteColumns.get(column)!, key));
      }
    }
  });

  it('keeps required indexes and cleanup indexes in both schemas', () => {
    const { sqliteSchema, postgresSchema } = readSchemas();
    const sqliteIndexes = indexNames(sqliteSchema);
    const postgresIndexes = indexNames(postgresSchema);

    for (const indexName of requiredHotPathIndexes) {
      expect(sqliteIndexes, `SQLite missing ${indexName}`).toContain(indexName);
      expect(postgresIndexes, `Postgres missing ${indexName}`).toContain(indexName);
    }
    expect(postgresIndexes).toEqual(expect.arrayContaining(sqliteIndexes.filter((name) => !name.includes('sqlite_autoindex'))));
  });

  it('keeps migration metadata out of current-schema definitions', () => {
    const { sqliteSchema, postgresSchema } = readSchemas();
    expect(sqliteSchema).not.toMatch(/schema_migrations|ALTER TABLE|addColumnIfMissing/);
    expect(postgresSchema).not.toMatch(/schema_migrations|POSTGRES_MIGRATIONS|ALTER TABLE/);
  });

  it('keeps Postgres migrations ordered and uniquely identified', () => {
    const ids = POSTGRES_MIGRATIONS.map((migration) => migration.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^\d{8}_\d{4}_[a-z0-9_]+$/.test(id))).toBe(true);
  });

  it('registers every evolved column introduced by migrations in the compatibility gate', () => {
    // Prevents future drift: a column added via ALTER/ensureColumn but missing
    // from REQUIRED_EVOLVED_COLUMNS would slip past the readiness gate.
    const registered = new Set(REQUIRED_EVOLVED_COLUMNS.map((entry) => `${entry.table}.${entry.column}`));

    const postgresMigrations = fs.readFileSync(new URL('../src/postgresMigrations.ts', import.meta.url), 'utf8');
    const sqliteStore = fs.readFileSync(new URL('../src/sqlite/store.ts', import.meta.url), 'utf8');

    const evolved = new Set<string>();
    for (const match of postgresMigrations.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN IF NOT EXISTS\s+(\w+)/g)) {
      evolved.add(`${match[1]}.${match[2]}`);
    }
    for (const match of sqliteStore.matchAll(/this\.ensureColumn\(\s*'(\w+)'\s*,\s*'(\w+)'/g)) {
      evolved.add(`${match[1]}.${match[2]}`);
    }

    const unregistered = [...evolved].filter((column) => !registered.has(column));
    expect(unregistered, 'evolved columns missing from REQUIRED_EVOLVED_COLUMNS').toEqual([]);
  });
});

function readSchemas(): { sqliteSchema: string; postgresSchema: string } {
  const sqliteStore = fs.readFileSync(new URL('../src/sqlite/store.ts', import.meta.url), 'utf8');
  const postgresSchema = fs.readFileSync(new URL('../src/postgresSchema.ts', import.meta.url), 'utf8');
  const sqliteSchema = sqliteStore.match(/const SQLITE_SCHEMA = `([\s\S]*?)`;/)?.[1] ?? '';
  return { sqliteSchema, postgresSchema };
}

function tableNames(schemaSQL: string): string[] {
  return [...schemaSQL.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z_][\w]*)/g)]
    .map((match) => match[1]!)
    .sort();
}

function tableColumns(schemaSQL: string): Map<string, Map<string, string>> {
  const tables = new Map<string, Map<string, string>>();
  for (const match of schemaSQL.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z_][\w]*)\s*\(([\s\S]*?)\);/g)) {
    const table = match[1]!;
    const body = match[2]!;
    const columns = new Map<string, string>();
    for (const line of body.split('\n').map((value) => value.trim().replace(/,$/, '')).filter(Boolean)) {
      if (/^(PRIMARY|UNIQUE|FOREIGN|CHECK)\b/i.test(line)) continue;
      const columnMatch = line.match(/^([a-zA-Z_][\w]*)\s+(.+)$/);
      if (!columnMatch) continue;
      columns.set(columnMatch[1]!, columnMatch[2]!);
    }
    tables.set(table, columns);
  }
  return tables;
}

function indexNames(schemaSQL: string): string[] {
  return [...schemaSQL.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX IF NOT EXISTS\s+([a-zA-Z_][\w]*)/g)]
    .map((match) => match[1]!)
    .sort();
}

function normalizeColumn(definition: string, key?: string): string {
  const normalized = definition
    .replace(/BIGINT GENERATED BY DEFAULT AS IDENTITY/i, 'INTEGER')
    .replace(/BOOLEAN/gi, 'INTEGER')
    .replace(/DEFAULT false/gi, 'DEFAULT 0')
    .replace(/DEFAULT true/gi, 'DEFAULT 1')
    .replace(/\s+/g, ' ')
    .trim();
  // SQLite spells auto-increment integer primary keys differently from Postgres identity columns.
  if (key === 'auth_identities.id' || key === 'audit_events.event_id') return 'INTEGER PRIMARY KEY';
  return normalized;
}
