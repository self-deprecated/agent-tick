import type { AgentTickClient, EventPollEvent } from "@agent-tick/sdk";

type EventPollClient = Pick<AgentTickClient, "pollEvents">;

type EventStreamStatus = "unsupported" | "connecting" | "open" | "reconnecting" | "closed";

type SubscribeToMobileEventStreamOptions = {
  client: EventPollClient;
  initialLastEventId?: number;
  timeoutMs?: number;
  onAuditEvent: (event: EventPollEvent) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: EventStreamStatus) => void;
};

type MobileEventStreamSubscription = {
  supported: boolean;
  close: () => void;
};

export function mobileEventStreamsAvailable(): boolean {
  return true;
}

export function subscribeToMobileEventStream({
  client,
  initialLastEventId,
  timeoutMs = 25_000,
  onAuditEvent,
  onError,
  onStatusChange,
}: SubscribeToMobileEventStreamOptions): MobileEventStreamSubscription {
  let closed = false;
  let lastEventId = normalizeEventId(initialLastEventId) ?? 0;
  let backoffMs = 1000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = (error: Error) => {
    if (closed) return;
    onStatusChange?.("reconnecting");
    onError?.(error);
    const delay = jitter(backoffMs);
    backoffMs = Math.min(backoffMs * 2, 30_000);
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void poll();
    }, delay);
  };

  const poll = async () => {
    if (closed) return;
    onStatusChange?.("connecting");
    try {
      const response = await client.pollEvents({ lastEventId, timeoutMs });
      if (closed) return;
      onStatusChange?.("open");
      backoffMs = 1000;
      lastEventId = Math.max(lastEventId, response.nextEventId);
      for (const event of response.events) onAuditEvent(event);
      void poll();
    } catch (error) {
      scheduleReconnect(error instanceof Error ? error : new Error("Failed to poll events"));
    }
  };

  void poll();

  return {
    supported: true,
    close: () => {
      closed = true;
      clearReconnectTimer();
      onStatusChange?.("closed");
    },
  };
}

function normalizeEventId(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.trunc(parsed);
}

function jitter(delayMs: number): number {
  return Math.round(delayMs * (0.75 + Math.random() * 0.5));
}
