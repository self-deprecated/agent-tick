import { openAgentTickStore } from '@agent-tick/db';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { hasRetentionCleanupChanges, runRetentionCleanup, startRetentionCleanupTimer } from './services/retention.js';

const config = loadConfig();
const store = openAgentTickStore({ databaseURL: config.databaseURL });
await store.migrate();
await store.ensureSingleTenantDefaults();

const app = await buildApp({ config, store });
const startupCleanup = await runRetentionCleanup(store, config);
if (hasRetentionCleanupChanges(startupCleanup)) app.log.info({ result: startupCleanup }, 'cleaned retained data at startup');
const retentionCleanup = startRetentionCleanupTimer({ store, config, logger: app.log });

const shutdown = async (): Promise<void> => {
  retentionCleanup.stop();
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
