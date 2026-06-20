import type { AsyncAgentTickStore, SchemaCompatibilityMissingColumn } from '@agent-tick/db';

/**
 * Thrown when the deployed database schema is missing columns the running server
 * code requires. Readiness/startup surfaces this as the public `schema_mismatch`
 * code so operators run migrations or roll back. It must never repair schema.
 */
export class SchemaMismatchError extends Error {
  readonly code = 'schema_mismatch' as const;
  readonly statusCode = 503;
  readonly missing: ReadonlyArray<SchemaCompatibilityMissingColumn>;
  constructor(missing: ReadonlyArray<SchemaCompatibilityMissingColumn>) {
    const list = missing.map((entry) => `${entry.table}.${entry.column}`).join(', ');
    super(`Database schema is incompatible with the running server: missing required columns (${list}). Run migrations or roll back.`);
    this.name = 'SchemaMismatchError';
    this.missing = missing;
  }
}

/**
 * Read-only compatibility gate run after `store.migrate()` / schema setup. Throws
 * {@link SchemaMismatchError} when the schema lags the running code, so startup
 * refuses to serve traffic instead of reporting a healthy database that fails on
 * the first Activity write.
 */
export async function assertSchemaCompatible(store: AsyncAgentTickStore): Promise<void> {
  const result = await store.verifySchemaCompatibility();
  if (!result.ok) throw new SchemaMismatchError(result.missing);
}
