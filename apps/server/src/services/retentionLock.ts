import { createClient, type RedisClientType } from 'redis';
import type { ServerConfig } from '../config.js';

export interface RetentionCleanupLock {
  runExclusive<T>(fn: () => Promise<T>): Promise<T | null>;
  close?(): Promise<void> | void;
}

export function createNoopRetentionCleanupLock(): RetentionCleanupLock {
  return {
    runExclusive: (fn) => fn()
  };
}

export async function createRedisRetentionCleanupLock(options: { redisURL: string; ttlMs: number }): Promise<RetentionCleanupLock> {
  const client = createClient({ url: options.redisURL }) as RedisClientType;
  const key = 'agent-tick:retention-cleanup:lock';
  await client.connect();

  return {
    async runExclusive(fn) {
      const token = crypto.randomUUID();
      const acquired = await client.set(key, token, { NX: true, PX: options.ttlMs });
      if (acquired !== 'OK') return null;
      try {
        return await fn();
      } finally {
        await client.eval(
          "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
          { keys: [key], arguments: [token] }
        );
      }
    },
    close: async () => {
      await client.quit();
    }
  };
}

export async function createConfiguredRetentionCleanupLock(config: ServerConfig): Promise<RetentionCleanupLock> {
  if (config.retentionCleanupLockBackend === 'redis') {
    if (!config.redisURL) throw new Error('AGENT_TICK_RETENTION_CLEANUP_LOCK_BACKEND=redis requires AGENT_TICK_REDIS_URL');
    return createRedisRetentionCleanupLock({ redisURL: config.redisURL, ttlMs: config.retentionCleanupLockTtlMs });
  }
  return createNoopRetentionCleanupLock();
}
