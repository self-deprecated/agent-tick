import { createClient, type RedisClientType } from 'redis';

export interface WorkspaceEventBus {
  waitForWorkspaceEvent(workspaceId: string, timeoutMs: number, signal?: AbortSignal): Promise<void>;
  publishWorkspaceEvent(workspaceId: string): void | Promise<void>;
  ping?(): void | Promise<void>;
  close?(): void | Promise<void>;
}

type Waiter = {
  workspaceId: string;
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
    wait(workspaceId: string, timeoutMs: number, signal?: AbortSignal) {
      if (signal?.aborted) return Promise.resolve();
      return new Promise<void>((resolve) => {
        let waiter: Waiter;
        const onAbort = () => { remove(waiter); resolve(); };
        waiter = {
          workspaceId,
          resolve: () => { remove(waiter); resolve(); },
          timeout: setTimeout(() => { remove(waiter); resolve(); }, timeoutMs),
          cleanup: () => signal?.removeEventListener('abort', onAbort)
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        waiters.add(waiter);
      });
    },
    publish(workspaceId: string) {
      for (const waiter of Array.from(waiters)) if (waiter.workspaceId === workspaceId) waiter.resolve();
    },
    clear() { for (const waiter of Array.from(waiters)) waiter.resolve(); }
  };
}

export function createMemoryWorkspaceEventBus(): WorkspaceEventBus {
  const registry = createWaiterRegistry();
  return {
    waitForWorkspaceEvent: (workspaceId, timeoutMs, signal) => registry.wait(workspaceId, timeoutMs, signal),
    publishWorkspaceEvent: (workspaceId) => registry.publish(workspaceId),
    ping: () => undefined,
    close: () => registry.clear()
  };
}

export const createWorkspaceEventBus = createMemoryWorkspaceEventBus;

export async function createRedisWorkspaceEventBus(redisURL: string): Promise<WorkspaceEventBus> {
  const registry = createWaiterRegistry();
  const publisher = createClient({ url: redisURL }) as RedisClientType;
  const subscriber = publisher.duplicate() as RedisClientType;
  const channelPrefix = 'agent-tick:events:workspace:';
  await publisher.connect();
  await subscriber.connect();
  await subscriber.pSubscribe(`${channelPrefix}*`, (_message, channel) => {
    if (!channel.startsWith(channelPrefix)) return;
    registry.publish(channel.slice(channelPrefix.length));
  });
  return {
    waitForWorkspaceEvent: (workspaceId, timeoutMs, signal) => registry.wait(workspaceId, timeoutMs, signal),
    publishWorkspaceEvent: async (workspaceId) => {
      registry.publish(workspaceId);
      await publisher.publish(`${channelPrefix}${workspaceId}`, 'changed');
    },
    ping: async () => { await publisher.ping(); await subscriber.ping(); },
    close: async () => { registry.clear(); await Promise.allSettled([subscriber.quit(), publisher.quit()]); }
  };
}

export async function createConfiguredWorkspaceEventBus(options: { backend: 'memory' | 'redis'; redisURL?: string | undefined }): Promise<WorkspaceEventBus> {
  if (options.backend === 'redis') {
    if (!options.redisURL) throw new Error('AGENT_TICK_EVENT_BUS_BACKEND=redis requires AGENT_TICK_REDIS_URL');
    return createRedisWorkspaceEventBus(options.redisURL);
  }
  return createMemoryWorkspaceEventBus();
}


export function publishAuditWrites<T extends { writeAuditEvent: (...args: any[]) => unknown }>(store: T, eventBus: WorkspaceEventBus): void {
  const marker = '__agentTickEventBusPatched';
  const publisherMarker = '__agentTickPublishAudit';
  const patchable = store as T & { [marker]?: true; [publisherMarker]?: (workspaceId: string) => void };
  patchable[publisherMarker] = (workspaceId: string) => { void eventBus.publishWorkspaceEvent(workspaceId); };
  if (patchable[marker]) return;
  const original = store.writeAuditEvent.bind(store);
  store.writeAuditEvent = ((workspaceId: string, ...rest: unknown[]) => {
    const result = original(workspaceId, ...rest);
    patchable[publisherMarker]?.(workspaceId);
    return result;
  }) as T['writeAuditEvent'];
  patchable[marker] = true;
}
