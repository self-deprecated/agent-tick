import { Pool, type PoolConfig } from 'pg';

export interface PostgresStoreOptions {
  databaseURL: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
}

/**
 * PostgreSQL connection foundation for the upcoming Postgres Agent Tick store.
 *
 * The durable repository methods are still implemented by the SQLite store in
 * this pass; this class centralizes lifecycle and readiness behavior so the
 * Postgres backend can be filled in without changing server startup/shutdown
 * wiring again.
 */
export class PostgresStoreConnection {
  readonly pool: Pool;

  constructor(options: PostgresStoreOptions) {
    this.pool = options.pool ?? new Pool({ connectionString: options.databaseURL, ...(options.poolConfig ?? {}) });
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function isPostgresDatabaseURL(databaseURL: string | undefined): boolean {
  return Boolean(databaseURL?.startsWith('postgres://') || databaseURL?.startsWith('postgresql://'));
}
