import { createClient, type RedisClientType } from 'redis';

export interface OrganizationEventBus {
  waitForOrganizationEvent(organizationId: string, timeoutMs: number, signal?: AbortSignal): Promise<void>;
  publishOrganizationEvent(organizationId: string): void | Promise<void>;
  close?(): void | Promise<void>;
}

type Waiter = {
  organizationId: string;
  resolve: () => void;
  timeout: ReturnType<typeof setTimeout>;
  cleanup: () => void;
};

function createWaiterRegistry() {
  const waiters = new Set<Waiter>();

  const remove = (waiter: Waiter) => {
    clearTimeout(waiter.timeout);
    waiters.delete(waiter);
    waiter.cleanup();
  };

  return {
    wait(organizationId: string, timeoutMs: number, signal?: AbortSignal) {
      if (signal?.aborted) return Promise.resolve();
      return new Promise<void>((resolve) => {
        let waiter: Waiter;
        const onAbort = () => {
          remove(waiter);
          resolve();
        };
        waiter = {
          organizationId,
          resolve: () => {
            remove(waiter);
            resolve();
          },
          timeout: setTimeout(() => {
            remove(waiter);
            resolve();
          }, timeoutMs),
          cleanup: () => signal?.removeEventListener('abort', onAbort)
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        waiters.add(waiter);
      });
    },

    publish(organizationId: string) {
      for (const waiter of Array.from(waiters)) {
        if (waiter.organizationId === organizationId) waiter.resolve();
      }
    },

    clear() {
      for (const waiter of Array.from(waiters)) waiter.resolve();
    }
  };
}

export function createMemoryOrganizationEventBus(): OrganizationEventBus {
  const registry = createWaiterRegistry();
  return {
    waitForOrganizationEvent: (organizationId, timeoutMs, signal) => registry.wait(organizationId, timeoutMs, signal),
    publishOrganizationEvent: (organizationId) => registry.publish(organizationId),
    close: () => registry.clear()
  };
}

export const createOrganizationEventBus = createMemoryOrganizationEventBus;

export async function createRedisOrganizationEventBus(redisURL: string): Promise<OrganizationEventBus> {
  const registry = createWaiterRegistry();
  const publisher = createClient({ url: redisURL }) as RedisClientType;
  const subscriber = publisher.duplicate() as RedisClientType;
  const channelPrefix = 'agent-tick:events:organization:';

  await publisher.connect();
  await subscriber.connect();
  await subscriber.pSubscribe(`${channelPrefix}*`, (_message, channel) => {
    if (!channel.startsWith(channelPrefix)) return;
    registry.publish(channel.slice(channelPrefix.length));
  });

  return {
    waitForOrganizationEvent: (organizationId, timeoutMs, signal) => registry.wait(organizationId, timeoutMs, signal),
    publishOrganizationEvent: async (organizationId) => {
      registry.publish(organizationId);
      await publisher.publish(`${channelPrefix}${organizationId}`, 'changed');
    },
    close: async () => {
      registry.clear();
      await Promise.allSettled([subscriber.quit(), publisher.quit()]);
    }
  };
}

export async function createConfiguredOrganizationEventBus(options: { backend: 'memory' | 'redis'; redisURL?: string | undefined }): Promise<OrganizationEventBus> {
  if (options.backend === 'redis') {
    if (!options.redisURL) throw new Error('AGENT_TICK_EVENT_BUS_BACKEND=redis requires AGENT_TICK_REDIS_URL');
    return createRedisOrganizationEventBus(options.redisURL);
  }
  return createMemoryOrganizationEventBus();
}

export function publishAuditWrites<T extends { writeAuditEvent: (...args: any[]) => unknown }>(store: T, eventBus: OrganizationEventBus): void {
  const marker = '__agentTickEventBusPatched';
  const patchable = store as T & { [marker]?: true };
  if (patchable[marker]) return;
  const original = store.writeAuditEvent.bind(store);
  store.writeAuditEvent = ((organizationId: string, ...rest: unknown[]) => {
    const result = original(organizationId, ...rest);
    void eventBus.publishOrganizationEvent(organizationId);
    return result;
  }) as T['writeAuditEvent'];
  patchable[marker] = true;
}
