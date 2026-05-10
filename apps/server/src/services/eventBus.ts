export interface OrganizationEventBus {
  waitForOrganizationEvent(organizationId: string, timeoutMs: number, signal?: AbortSignal): Promise<void>;
  publishOrganizationEvent(organizationId: string): void;
}

type Waiter = {
  organizationId: string;
  resolve: () => void;
  timeout: ReturnType<typeof setTimeout>;
  cleanup: () => void;
};

export function createOrganizationEventBus(): OrganizationEventBus {
  const waiters = new Set<Waiter>();

  const remove = (waiter: Waiter) => {
    clearTimeout(waiter.timeout);
    waiters.delete(waiter);
    waiter.cleanup();
  };

  return {
    waitForOrganizationEvent(organizationId, timeoutMs, signal) {
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

    publishOrganizationEvent(organizationId) {
      for (const waiter of Array.from(waiters)) {
        if (waiter.organizationId === organizationId) waiter.resolve();
      }
    }
  };
}

export function publishAuditWrites<T extends { writeAuditEvent: (...args: any[]) => unknown }>(store: T, eventBus: OrganizationEventBus): void {
  const marker = '__agentTickEventBusPatched';
  const patchable = store as T & { [marker]?: true };
  if (patchable[marker]) return;
  const original = store.writeAuditEvent.bind(store);
  store.writeAuditEvent = ((organizationId: string, ...rest: unknown[]) => {
    const result = original(organizationId, ...rest);
    eventBus.publishOrganizationEvent(organizationId);
    return result;
  }) as T['writeAuditEvent'];
  patchable[marker] = true;
}
