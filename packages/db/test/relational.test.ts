import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { postgresDialect } from '../src/postgres/dialect.js';
import { sqliteDialect, SQLiteExecutor } from '../src/sqlite/dialect.js';

describe('relational dialect helpers', () => {
  it('formats placeholders for SQLite and PostgreSQL', () => {
    expect(sqliteDialect.placeholder(1)).toBe('?');
    expect(sqliteDialect.placeholders(3)).toBe('?, ?, ?');
    expect(postgresDialect.placeholder(2)).toBe('$2');
    expect(postgresDialect.placeholders(3, 4)).toBe('$4, $5, $6');
  });

  it('maps JSON booleans conflicts returning timestamps and pagination', () => {
    expect(sqliteDialect.encodeJSON({ ok: true })).toBe('{"ok":true}');
    expect(postgresDialect.decodeJSON('{"ok":true}', {})).toEqual({ ok: true });
    expect(sqliteDialect.encodeBoolean(true)).toBe(1);
    expect(postgresDialect.encodeBoolean(false)).toBe(false);
    expect(sqliteDialect.onConflictDoNothing()).toBe('ON CONFLICT DO NOTHING');
    expect(postgresDialect.onConflictDoNothing({ columns: ['workspace_id', 'slug'] })).toBe('ON CONFLICT (workspace_id, slug) DO NOTHING');
    expect(sqliteDialect.returning(['id'])).toBe('RETURNING id');
    expect(postgresDialect.timestampBefore('created_at', '$1')).toBe('created_at < $1');
    expect(sqliteDialect.limitOffset('?', '?')).toBe('LIMIT ? OFFSET ?');
    expect(postgresDialect.advisoryLockId('cleanup')).toBe(sqliteDialect.advisoryLockId('cleanup'));
  });

  it('executes SQLite queries and transactions through the relational executor', async () => {
    const db = new Database(':memory:');
    try {
      const executor = new SQLiteExecutor(db);
      await executor.query('CREATE TABLE items(id TEXT PRIMARY KEY, active INTEGER NOT NULL)');
      await executor.transaction(async (tx) => {
        await tx.query('INSERT INTO items(id, active) VALUES (?, ?)', ['one', sqliteDialect.encodeBoolean(true)]);
      });
      const rows = await executor.query<{ id: string; active: number }>('SELECT * FROM items WHERE active = ?', [sqliteDialect.encodeBoolean(true)]);
      expect(rows.rows).toEqual([{ id: 'one', active: 1 }]);
      expect(rows.rowCount).toBe(1);
    } finally {
      db.close();
    }
  });
});
