import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresAgentTickStore } from '../src/index.js';
import type { StoreContractHarness } from './storeHarness.js';

export const postgresTestDatabaseURL = process.env.AGENT_TICK_TEST_POSTGRES_URL;

export const postgresStoreHarness: StoreContractHarness | null = postgresTestDatabaseURL
  ? {
      name: 'PostgreSQL',
      async open() {
        const databaseURL = postgresTestDatabaseURL!;
        const schemaName = `agent_tick_test_${randomUUID().replace(/-/g, '_')}`;
        const adminPool = new Pool({ connectionString: databaseURL });
        await adminPool.query(`CREATE SCHEMA ${schemaName}`);
        const store = PostgresAgentTickStore.open({ databaseURL: postgresDatabaseURLForSchema(databaseURL, schemaName) });
        const closeStore = store.close.bind(store);
        let closed = false;
        store.close = async () => {
          if (closed) return;
          closed = true;
          await closeStore();
          await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
          await adminPool.end();
        };
        return store;
      }
    }
  : null;

export interface PostgresSchemaHarness {
  databaseURL: string;
  schemaName: string;
  adminPool: Pool;
  store: PostgresAgentTickStore;
  openStore(): PostgresAgentTickStore;
  close(): Promise<void>;
}

export function postgresDatabaseURLForSchema(databaseURL: string, schemaName: string): string {
  const separator = databaseURL.includes('?') ? '&' : '?';
  return `${databaseURL}${separator}options=${encodeURIComponent(`-c search_path=${schemaName}`)}`;
}

export async function createPostgresSchemaHarness(): Promise<PostgresSchemaHarness> {
  if (!postgresTestDatabaseURL) throw new Error('Set AGENT_TICK_TEST_POSTGRES_URL to run real PostgreSQL schema tests');
  const databaseURL = postgresTestDatabaseURL;
  const schemaName = `agent_tick_test_${randomUUID().replace(/-/g, '_')}`;
  const adminPool = new Pool({ connectionString: databaseURL });
  await adminPool.query(`CREATE SCHEMA ${schemaName}`);
  const openedStores: PostgresAgentTickStore[] = [];
  const openStore = (): PostgresAgentTickStore => {
    const store = PostgresAgentTickStore.open({ databaseURL: postgresDatabaseURLForSchema(databaseURL, schemaName) });
    openedStores.push(store);
    return store;
  };
  const store = openStore();

  return {
    databaseURL,
    schemaName,
    adminPool,
    store,
    openStore,
    async close() {
      for (const openedStore of openedStores.splice(0)) await openedStore.close();
      await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      await adminPool.end();
    }
  };
}

export async function withPostgresSchemaHarness<T>(run: (harness: PostgresSchemaHarness) => T | Promise<T>): Promise<T> {
  const harness = await createPostgresSchemaHarness();
  try {
    return await run(harness);
  } finally {
    await harness.close();
  }
}
