import { openAgentTickStore } from '@agent-tick/db';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { assertSchemaCompatible, SchemaMismatchError } from './schemaCompatibility.js';
import { hasRetentionCleanupChanges, runRetentionCleanup, startRetentionCleanupTimer } from './services/retention.js';
import { createConfiguredRetentionCleanupLock } from './services/retentionLock.js';

const config = loadConfig();
const postgresPool = {
  ...(config.postgresPoolMax !== undefined ? { max: config.postgresPoolMax } : {}),
  ...(config.postgresPoolIdleTimeoutMs !== undefined ? { idleTimeoutMillis: config.postgresPoolIdleTimeoutMs } : {}),
  ...(config.postgresPoolConnectionTimeoutMs !== undefined ? { connectionTimeoutMillis: config.postgresPoolConnectionTimeoutMs } : {}),
  ...(config.postgresStatementTimeoutMs !== undefined ? { statementTimeout: config.postgresStatementTimeoutMs } : {}),
  ...(config.postgresQueryTimeoutMs !== undefined ? { queryTimeout: config.postgresQueryTimeoutMs } : {})
};
const store = openAgentTickStore({
  databaseURL: config.databaseURL,
  ...(Object.keys(postgresPool).length ? { postgresPool } : {})
});
store.setPrivateRequestPolicy(config.privateRequestsPolicy);
if (config.databaseMigrateOnStart) await store.migrate();
await store.ensureSingleTenantDefaults();

// Fail fast: if the deployed schema is missing columns the running code needs,
// refuse to bind the port instead of serving a lying readiness probe that fails
// on the first Activity write. Migrations run above; this catches deployments
// where migrate-on-start is disabled or the applied migrations lag the image.
try {
  await assertSchemaCompatible(store);
} catch (error) {
  console.error(
    '[agent-tick] Startup aborted: database schema is incompatible with the running server.',
    error instanceof SchemaMismatchError ? error.message : error,
    'Run migrations or roll back.'
  );
  process.exit(1);
}

const app = await buildApp({ config, store });
const retentionCleanupLock = config.retentionCleanupEnabled ? await createConfiguredRetentionCleanupLock(config) : null;
const startupCleanup = config.retentionCleanupEnabled ? await runRetentionCleanup(store, config, new Date().toISOString(), retentionCleanupLock ?? undefined) : null;
if (startupCleanup && hasRetentionCleanupChanges(startupCleanup)) app.log.info({ result: startupCleanup }, 'cleaned retained data at startup');
const retentionCleanup = config.retentionCleanupEnabled ? startRetentionCleanupTimer({ store, config, logger: app.log, ...(retentionCleanupLock ? { lock: retentionCleanupLock } : {}) }) : null;

const shutdown = async (): Promise<void> => {
  retentionCleanup?.stop();
  await retentionCleanupLock?.close?.();
  await app.close();
  await store.close();
};
process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
