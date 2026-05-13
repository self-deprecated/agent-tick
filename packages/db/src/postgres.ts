import { Pool, type PoolConfig } from 'pg';
import { POSTGRES_MIGRATIONS } from './postgresMigrations.js';

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

  async migrate(now = new Date().toISOString()): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [agentTickMigrationLockId()]);
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
      for (const migration of POSTGRES_MIGRATIONS) {
        const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [migration.version]);
        if (existing.rowCount && existing.rowCount > 0) continue;
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations(version, applied_at) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING', [migration.version, now]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function isPostgresDatabaseURL(databaseURL: string | undefined): boolean {
  return Boolean(databaseURL?.startsWith('postgres://') || databaseURL?.startsWith('postgresql://'));
}

function agentTickMigrationLockId(): number {
  return 0x61746963;
}
