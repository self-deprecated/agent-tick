import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient, type PoolConfig, type QueryConfig, type QueryResult, type QueryResultRow } from 'pg';
import { PostgresExecutor } from './postgres/dialect.js';
import { POSTGRES_SCHEMA } from './postgresSchema.js';

export interface PostgresStoreOptions {
  databaseURL: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
}

/**
 * PostgreSQL connection foundation for the Agent Tick store.
 *
 * During the pre-launch reset window, migrate() means "ensure/install the
 * current schema" rather than "run historical migrations".
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

  async migrate(_now = new Date().toISOString()): Promise<void> {
    const executor = new PostgresExecutor(this.rootPool);
    await executor.withAdvisoryTransactionLock('agent_tick_schema_setup', async (lockedExecutor) => {
      await lockedExecutor.query(POSTGRES_SCHEMA);
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

export function isPostgresDatabaseURL(databaseURL: string | undefined): boolean {
  return Boolean(databaseURL?.startsWith('postgres://') || databaseURL?.startsWith('postgresql://'));
}
