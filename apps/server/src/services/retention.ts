import type { AsyncAgentTickStore as AgentTickStore, CleanupExpiredSecretsResult, CleanupRetentionResult, RetentionPolicy } from '@agent-tick/db';
import type { FastifyBaseLogger } from 'fastify';
import type { ServerConfig } from '../config.js';
import type { RetentionCleanupLock } from './retentionLock.js';

export interface RetentionCleanupRunResult {
  secrets: CleanupExpiredSecretsResult;
  retention: CleanupRetentionResult;
}

export interface RetentionCleanupTimer {
  run(): Promise<RetentionCleanupRunResult>;
  stop(): void;
}

export function retentionPolicyFromConfig(config: ServerConfig): RetentionPolicy {
  return {
    ...(config.approvalRetentionDays !== undefined ? { requestsDays: config.approvalRetentionDays } : {}),
    ...(config.statusUpdateRetentionDays !== undefined ? { statusUpdatesDays: config.statusUpdateRetentionDays } : {}),
    ...(config.auditRetentionDays !== undefined ? { auditEventsDays: config.auditRetentionDays } : {}),
    ...(config.unregisteredDeviceRetentionDays !== undefined ? { unregisteredDevicesDays: config.unregisteredDeviceRetentionDays } : {})
  };
}

export async function runRetentionCleanup(store: AgentTickStore, config: ServerConfig, now = new Date().toISOString(), lock?: RetentionCleanupLock): Promise<RetentionCleanupRunResult | null> {
  const run = async () => ({ secrets: await store.cleanupExpiredSecrets(now), retention: await store.cleanupRetention(retentionPolicyFromConfig(config), now) });
  return lock ? lock.runExclusive(run) : run();
}

export function hasRetentionCleanupChanges(result: RetentionCleanupRunResult | null): boolean {
  return Boolean(result && (Object.values(result.secrets).some((count) => count > 0) || Object.values(result.retention).some((count) => count > 0)));
}

export function startRetentionCleanupTimer(options: { store: AgentTickStore; config: ServerConfig; logger: FastifyBaseLogger; lock?: RetentionCleanupLock }): RetentionCleanupTimer {
  const { store, config, logger, lock } = options;
  const run = (): Promise<RetentionCleanupRunResult> => runRetentionCleanup(store, config, new Date().toISOString(), lock).then((result) => result ?? emptyRetentionCleanupResult());
  const timer = setInterval(() => {
    run()
      .then((result) => { if (hasRetentionCleanupChanges(result)) logger.info({ result }, 'cleaned retained data'); })
      .catch((error) => { logger.error({ err: error }, 'failed to clean retained data'); });
  }, config.retentionCleanupIntervalMinutes * 60_000);
  timer.unref();
  return { run, stop: () => clearInterval(timer) };
}

function emptyRetentionCleanupResult(): RetentionCleanupRunResult {
  return {
    secrets: { eventTickets: 0, pairingCodes: 0, requestWaiterTokens: 0, approvalWaiterTokens: 0 },
    retention: { requests: 0, statusUpdates: 0, auditEvents: 0, devices: 0 }
  };
}
