import { PostgresStoreConnection, type PostgresStoreOptions } from './postgres.js';

/**
 * PostgreSQL connection wrapper for the Workspace/Routing Rule schema.
 *
 * The SQLite store is the fully exercised local/dev implementation in this
 * cutover. Postgres migrations are kept current so hosted/dev Postgres can be
 * reset to the same baseline before the durable Postgres repository is filled
 * back in.
 */
export class PostgresAgentTickStore extends PostgresStoreConnection {
  static open(options: PostgresStoreOptions): PostgresAgentTickStore {
    return new PostgresAgentTickStore(options);
  }
}
