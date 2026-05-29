import type Database from 'better-sqlite3';
import { commaSeparated, stableAdvisoryLockId, type ConflictTarget, type RelationalDialect, type RelationalValue } from '../relational/dialect.js';
import type { RelationalExecutor, RelationalQueryResult } from '../relational/executor.js';
import { decodeJSON, encodeJSON } from '../relational/rows.js';

export const sqliteDialect: RelationalDialect = {
  name: 'sqlite',
  supportsReturning: true,
  placeholder: () => '?',
  placeholders: (count) => Array.from({ length: count }, () => '?').join(', '),
  insertInto: (table, columns) => `INSERT INTO ${table}(${commaSeparated(columns)})`,
  onConflictDoNothing: () => 'ON CONFLICT DO NOTHING',
  returning: (columns) => `RETURNING ${commaSeparated(columns)}`,
  encodeJSON,
  decodeJSON,
  encodeBoolean: (value) => (value ? 1 : 0),
  decodeBoolean: (value) => Boolean(value),
  timestampBefore: (column, placeholder) => `${column} < ${placeholder}`,
  limitOffset: (limitPlaceholder, offsetPlaceholder) => offsetPlaceholder ? `LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}` : `LIMIT ${limitPlaceholder}`,
  advisoryLockId: stableAdvisoryLockId
};

export class SQLiteExecutor implements RelationalExecutor {
  readonly dialect = sqliteDialect;

  constructor(private readonly db: Database.Database) {}

  async query<Row = unknown>(sql: string, params: RelationalValue[] = []): Promise<RelationalQueryResult<Row>> {
    const statement = this.db.prepare(sql);
    if (/^\s*(select|with|pragma)\b/i.test(sql)) {
      const rows = statement.all(...params) as Row[];
      return { rows, rowCount: rows.length };
    }
    const result = statement.run(...params);
    return { rows: [], rowCount: result.changes };
  }

  async transaction<T>(run: (executor: RelationalExecutor) => Promise<T>): Promise<T> {
    this.db.prepare('BEGIN').run();
    try {
      const result = await run(this);
      this.db.prepare('COMMIT').run();
      return result;
    } catch (error) {
      this.db.prepare('ROLLBACK').run();
      throw error;
    }
  }

  async withAdvisoryTransactionLock<T>(_lockName: string, run: (executor: RelationalExecutor) => Promise<T>): Promise<T> {
    return this.transaction(run);
  }
}
