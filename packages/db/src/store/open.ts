import { isPostgresDatabaseURL } from '../postgres.js';
import { PostgresAgentTickStore } from '../postgresStore.js';
import { AgentTickStore } from '../sqlite/store.js';
import type { AsyncAgentTickStore, OpenStoreOptions } from './types.js';

export function openAgentTickStore(options: OpenStoreOptions = {}): AsyncAgentTickStore {
  const databaseURL = options.databaseURL;
  if (isPostgresDatabaseURL(databaseURL) && databaseURL) {
    return PostgresAgentTickStore.open({ databaseURL, ...(options.postgresPool ? { poolConfig: options.postgresPool } : {}) });
  }
  return AgentTickStore.open(options);
}

