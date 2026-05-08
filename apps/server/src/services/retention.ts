import type { AgentTickStore, CleanupExpiredSecretsResult, CleanupRetentionResult, RetentionPolicy } from '@agent-tick/db';
import type { FastifyBaseLogger } from 'fastify';
import type { ServerConfig } from '../config.js';

export interface RetentionCleanupRunResult {
  secrets: CleanupExpiredSecretsResult;
  retention: CleanupRetentionResult;
}

export interface RetentionCleanupTimer {
  run(): RetentionCleanupRunResult;
  stop(): void;
}

export function retentionPolicyFromConfig(config: ServerConfig): RetentionPolicy {
  return {
    ...(config.approvalRetentionDays !== undefined ? { approvalRequestsDays: config.approvalRetentionDays } : {}),
    ...(config.auditRetentionDays !== undefined ? { auditEventsDays: config.auditRetentionDays } : {}),
    ...(config.unregisteredDeviceRetentionDays !== undefined ? { unregisteredDevicesDays: config.unregisteredDeviceRetentionDays } : {}),
    ...(config.expiredInviteRetentionDays !== undefined ? { expiredInvitesDays: config.expiredInviteRetentionDays } : {})
  };
}

export function runRetentionCleanup(store: AgentTickStore, config: ServerConfig, now = new Date().toISOString()): RetentionCleanupRunResult {
  return {
    secrets: store.cleanupExpiredSecrets(now),
    retention: store.cleanupRetention(retentionPolicyFromConfig(config), now)
  };
}

export function hasRetentionCleanupChanges(result: RetentionCleanupRunResult): boolean {
  return Object.values(result.secrets).some((count) => count > 0) || Object.values(result.retention).some((count) => count > 0);
}

export function startRetentionCleanupTimer(options: { store: AgentTickStore; config: ServerConfig; logger: FastifyBaseLogger }): RetentionCleanupTimer {
  const { store, config, logger } = options;
  const run = (): RetentionCleanupRunResult => runRetentionCleanup(store, config);
  const timer = setInterval(() => {
    try {
      const result = run();
      if (hasRetentionCleanupChanges(result)) logger.info({ result }, 'cleaned retained data');
    } catch (error) {
      logger.error({ err: error }, 'failed to clean retained data');
    }
  }, config.retentionCleanupIntervalMinutes * 60_000);
  timer.unref();
  return {
    run,
    stop: () => clearInterval(timer)
  };
}
