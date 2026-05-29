import {
  AgentTickStore,
  DEFAULT_USER_ID,
  DEFAULT_WORKSPACE_ID,
  type AsyncAgentTickStore
} from '../src/index.js';
import { createPostgresSchemaHarness, postgresTestDatabaseURL, type PostgresSchemaHarness } from './postgresHarness.js';

export const TEST_NOW = '2026-05-08T00:00:00.000Z';

export interface StoreContractHarness {
  name: string;
  open(): AsyncAgentTickStore | Promise<AsyncAgentTickStore>;
  close?(store: AsyncAgentTickStore): void | Promise<void>;
}

export const sqliteStoreHarness: StoreContractHarness = {
  name: 'SQLite',
  open() {
    return AgentTickStore.open({ databaseURL: ':memory:' });
  }
};

const postgresSchemas = new WeakMap<AsyncAgentTickStore, PostgresSchemaHarness>();

export const postgresStoreHarness: StoreContractHarness | undefined = postgresTestDatabaseURL
  ? {
      name: 'Postgres',
      async open() {
        const harness = await createPostgresSchemaHarness();
        postgresSchemas.set(harness.store, harness);
        return harness.store;
      },
      async close(store) {
        const harness = postgresSchemas.get(store);
        if (!harness) {
          await store.close();
          return;
        }
        postgresSchemas.delete(store);
        await harness.close();
      }
    }
  : undefined;

export async function openSeededStore(harness: StoreContractHarness, now = TEST_NOW): Promise<AsyncAgentTickStore> {
  const store = await harness.open();
  await store.migrate(now);
  await store.ensureSingleTenantDefaults(now);
  return store;
}

export async function closeStore(store: AsyncAgentTickStore | undefined, harness?: StoreContractHarness): Promise<void> {
  if (!store) return;
  if (harness?.close) await harness.close(store);
  else await store.close();
}

export { DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID };
