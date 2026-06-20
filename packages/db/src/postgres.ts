import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient, type PoolConfig, type QueryConfig, type QueryResult, type QueryResultRow } from 'pg';
import type { RelationalExecutor } from './relational/executor.js';
import { PostgresExecutor } from './postgres/dialect.js';
import { POSTGRES_MIGRATIONS } from './postgresMigrations.js';
import { POSTGRES_SCHEMA } from './postgresSchema.js';
import { REQUIRED_EVOLVED_COLUMNS, computeSchemaCompatibility } from './requiredColumns.js';
import type { SchemaCompatibilityResult } from './store/types.js';

export interface PostgresStoreOptions {
  databaseURL: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
}

/**
 * PostgreSQL connection foundation for the Agent Tick store.
 *
 * migrate() installs the current table/index baseline and then applies any
 * ordered Postgres migrations that repair existing databases from earlier
 * baselines. New schema changes should update POSTGRES_SCHEMA and append a
 * migration to POSTGRES_MIGRATIONS when existing deployments need ALTERs.
 */
interface TransactionContext {
  client: PoolClient;
  afterCommit: Array<() => void>;
}

export class PostgresStoreConnection {
  protected readonly pool: Pool;
  private readonly rootPool: Pool;
  private readonly transactionContext = new AsyncLocalStorage<TransactionContext>();

  constructor(options: PostgresStoreOptions) {
    this.rootPool = options.pool ?? new Pool({ connectionString: options.databaseURL, ...(options.poolConfig ?? {}) });
    this.pool = this.transactionAwarePool(this.rootPool);
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  /**
   * Read-only schema compatibility check. Verifies every required evolved
   * column exists in `information_schema.columns` for the active schema without
   * mutating anything. Returns `schema_mismatch` with the missing columns when
   * the deployed schema lags the running code.
   */
  async verifySchemaCompatibility(): Promise<SchemaCompatibilityResult> {
    if (REQUIRED_EVOLVED_COLUMNS.length === 0) return { ok: true };
    const placeholders = REQUIRED_EVOLVED_COLUMNS.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(', ');
    const params = REQUIRED_EVOLVED_COLUMNS.flatMap((entry) => [entry.table, entry.column]);
    const result = await this.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND (table_name, column_name) IN (${placeholders})`,
      params
    );
    const present = new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`));
    return computeSchemaCompatibility(present);
  }

  async migrate(now = new Date().toISOString()): Promise<void> {
    const executor = new PostgresExecutor(this.rootPool);
    await executor.withAdvisoryTransactionLock('agent_tick_schema_setup', async (lockedExecutor) => {
      await lockedExecutor.query(POSTGRES_SCHEMA);
      await applyPostgresMigrations(lockedExecutor, now);
    });
  }

  async close(): Promise<void> {
    await this.rootPool.end();
  }

  afterCommit(run: () => void): void {
    const context = this.transactionContext.getStore();
    if (!context) {
      run();
      return;
    }
    context.afterCommit.push(run);
  }

  protected async transaction<T>(run: () => Promise<T>): Promise<T> {
    const activeContext = this.transactionContext.getStore();
    if (activeContext) return run();

    const client = await this.rootPool.connect();
    const context: TransactionContext = { client, afterCommit: [] };
    try {
      await client.query('BEGIN');
      const result = await this.transactionContext.run(context, run);
      await client.query('COMMIT');
      for (const callback of context.afterCommit) callback();
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private transactionAwarePool(pool: Pool): Pool {
    return new Proxy(pool, {
      get: (target, property, receiver) => {
        if (property === 'query') return this.query.bind(this);
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  }

  private query<R extends QueryResultRow = QueryResultRow>(queryTextOrConfig: string | QueryConfig<unknown[]>, values?: unknown[]): Promise<QueryResult<R>> {
    const target = this.transactionContext.getStore()?.client ?? this.rootPool;
    return values === undefined
      ? target.query<R>(queryTextOrConfig as QueryConfig<unknown[]>)
      : target.query<R>(queryTextOrConfig as string, values);
  }
}

async function applyPostgresMigrations(executor: RelationalExecutor, now: string): Promise<void> {
  await executor.query(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
)
`);

  const applied = await executor.query<{ id: string }>('SELECT id FROM schema_migrations');
  const appliedIds = new Set(applied.rows.map((row) => row.id));
  const seenIds = new Set<string>();

  for (const migration of POSTGRES_MIGRATIONS) {
    if (seenIds.has(migration.id)) throw new Error(`Duplicate Postgres migration id: ${migration.id}`);
    seenIds.add(migration.id);
    if (appliedIds.has(migration.id)) continue;

    await executor.query(migration.sql);
    await executor.query('INSERT INTO schema_migrations(id, applied_at) VALUES ($1, $2)', [migration.id, now]);
  }
}

export function isPostgresDatabaseURL(databaseURL: string | undefined): boolean {
  return Boolean(databaseURL?.startsWith('postgres://') || databaseURL?.startsWith('postgresql://'));
}
