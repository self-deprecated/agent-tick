import { describe, expect, it } from 'vitest';
import { createMemoryOrganizationEventBus, createRedisOrganizationEventBus } from '../src/services/eventBus.js';
import { createMemoryRateLimiter, createRedisRateLimiter } from '../src/services/rateLimit.js';
import { createNoopRetentionCleanupLock, createRedisRetentionCleanupLock } from '../src/services/retentionLock.js';

const redisURL = process.env.AGENT_TICK_TEST_REDIS_URL;
const describeRedis = redisURL ? describe : describe.skip;

describe('memory coordination services', () => {
  it('wakes in-process organization event waiters', async () => {
    const bus = createMemoryOrganizationEventBus();
    const wait = bus.waitForOrganizationEvent('org_test', 1_000);
    bus.publishOrganizationEvent('org_test');
    await expect(wait).resolves.toBeUndefined();
  });

  it('rate limits repeated in-process requests', async () => {
    const limiter = createMemoryRateLimiter();
    await expect(limiter.check('local-key', { windowMs: 60_000, max: 1 }, 0)).resolves.toEqual({ allowed: true });
    await expect(limiter.check('local-key', { windowMs: 60_000, max: 1 }, 1)).resolves.toMatchObject({ allowed: false });
  });

  it('no-op retention lock always runs the cleanup function', async () => {
    const lock = createNoopRetentionCleanupLock();
    await expect(lock.runExclusive(async () => 'ran')).resolves.toBe('ran');
  });
});

describeRedis('redis coordination services', () => {
  it('wakes organization event waiters across bus instances', async () => {
    const waiterBus = await createRedisOrganizationEventBus(redisURL!);
    const publisherBus = await createRedisOrganizationEventBus(redisURL!);
    try {
      const wait = waiterBus.waitForOrganizationEvent('org_redis_test', 5_000);
      await publisherBus.publishOrganizationEvent('org_redis_test');
      await expect(wait).resolves.toBeUndefined();
    } finally {
      await Promise.allSettled([waiterBus.close?.(), publisherBus.close?.()]);
    }
  });

  it('shares rate limits across limiter instances', async () => {
    const first = await createRedisRateLimiter(redisURL!);
    const second = await createRedisRateLimiter(redisURL!);
    const key = `redis-key-${crypto.randomUUID()}`;
    try {
      await expect(first.check(key, { windowMs: 60_000, max: 1 })).resolves.toEqual({ allowed: true });
      await expect(second.check(key, { windowMs: 60_000, max: 1 })).resolves.toMatchObject({ allowed: false });
    } finally {
      await Promise.allSettled([first.close?.(), second.close?.()]);
    }
  });

  it('allows only one retention cleanup holder at a time', async () => {
    const first = await createRedisRetentionCleanupLock({ redisURL: redisURL!, ttlMs: 60_000 });
    const second = await createRedisRetentionCleanupLock({ redisURL: redisURL!, ttlMs: 60_000 });
    try {
      const result = await first.runExclusive(async () => second.runExclusive(async () => 'second-ran'));
      expect(result).toBeNull();
    } finally {
      await Promise.allSettled([first.close?.(), second.close?.()]);
    }
  });
});
