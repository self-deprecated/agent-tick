import type { Pool, PoolClient } from 'pg';
import { commaSeparated, stableAdvisoryLockId, type ConflictTarget, type RelationalDialect, type RelationalValue } from '../relational/dialect.js';
import type { RelationalExecutor, RelationalQueryResult } from '../relational/executor.js';
import { decodeJSON, encodeJSON } from '../relational/rows.js';

export const postgresDialect: RelationalDialect = {
  name: 'postgres',
  supportsReturning: true,
  placeholder: (position) => `$${position}`,
  placeholders: (count, startAt = 1) => Array.from({ length: count }, (_, index) => `$${startAt + index}`).join(', '),
  insertInto: (table, columns) => `INSERT INTO ${table}(${commaSeparated(columns)})`,
  onConflictDoNothing: (target?: ConflictTarget) => {
    if (target?.constraint) return `ON CONFLICT ON CONSTRAINT ${target.constraint} DO NOTHING`;
    if (target?.columns?.length) return `ON CONFLICT (${commaSeparated(target.columns)}) DO NOTHING`;
    return 'ON CONFLICT DO NOTHING';
  },
  returning: (columns) => `RETURNING ${commaSeparated(columns)}`,
  encodeJSON,
  decodeJSON,
  encodeBoolean: (value) => value,
  decodeBoolean: (value) => Boolean(value),
  timestampBefore: (column, placeholder) => `${column} < ${placeholder}`,
  limitOffset: (limitPlaceholder, offsetPlaceholder) => offsetPlaceholder ? `LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}` : `LIMIT ${limitPlaceholder}`,
  advisoryLockId: stableAdvisoryLockId
};

type PostgresConnection = Pool | PoolClient;

function isPool(connection: PostgresConnection): connection is Pool {
  return typeof (connection as Pool).connect === 'function';
}

export class PostgresExecutor implements RelationalExecutor {
  readonly dialect = postgresDialect;

  constructor(private readonly connection: PostgresConnection) {}

  async query<Row = unknown>(sql: string, params: RelationalValue[] = []): Promise<RelationalQueryResult<Row>> {
    const result = await this.connection.query(sql, params);
    const finalResult = Array.isArray(result) ? result.at(-1) : result;
    const rows = (finalResult?.rows ?? []) as Row[];
    return { rows, rowCount: finalResult?.rowCount ?? rows.length };
  }

  async transaction<T>(run: (executor: RelationalExecutor) => Promise<T>): Promise<T> {
    if (!isPool(this.connection)) {
      await this.connection.query('BEGIN');
      try {
        const result = await run(this);
        await this.connection.query('COMMIT');
        return result;
      } catch (error) {
        await this.connection.query('ROLLBACK');
        throw error;
      }
    }

    const client = await this.connection.connect();
    const executor = new PostgresExecutor(client);
    try {
      await client.query('BEGIN');
      const result = await run(executor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async withAdvisoryTransactionLock<T>(lockName: string, run: (executor: RelationalExecutor) => Promise<T>): Promise<T> {
    return this.transaction(async (executor) => {
      await executor.query('SELECT pg_advisory_xact_lock($1)', [this.dialect.advisoryLockId(lockName)]);
      return run(executor);
    });
  }
}
