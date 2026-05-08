import { AgentTickStore } from '@agent-tick/db';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const store = AgentTickStore.open({ databaseURL: config.databaseURL });
store.migrate();
store.ensureSingleTenantDefaults();
store.cleanupExpiredSecrets();

const app = await buildApp({ config, store });
const retentionTimer = setInterval(() => {
  try {
    const result = store.cleanupExpiredSecrets();
    if (result.eventTickets || result.pairingCodes) app.log.info({ result }, 'cleaned expired secrets');
  } catch (error) {
    app.log.error({ err: error }, 'failed to clean expired secrets');
  }
}, 60 * 60_000);
retentionTimer.unref();

const shutdown = async (): Promise<void> => {
  clearInterval(retentionTimer);
  await app.close();
  store.close();
};
process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
