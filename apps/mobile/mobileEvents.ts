import type { AgentTickClient, AuditEventRecord, EventSourceConstructor } from "@agent-tick/sdk";

type EventStreamClient = Pick<AgentTickClient, "openEventStream">;

type EventStreamStatus = "unsupported" | "connecting" | "open" | "reconnecting" | "closed";

type SubscribeToMobileEventStreamOptions = {
  client: EventStreamClient;
  EventSource?: EventSourceConstructor | null;
  initialLastEventId?: number;
  reconnectDelayMs?: number;
  onAuditEvent: (event: AuditEventRecord) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: EventStreamStatus) => void;
};

type MobileEventStreamSubscription = {
  supported: boolean;
  close: () => void;
};

export function mobileEventStreamsAvailable(EventSourceCtor: EventSourceConstructor | null | undefined = globalThis.EventSource): boolean {
  return typeof EventSourceCtor === "function";
}

export function subscribeToMobileEventStream({
  client,
  EventSource: EventSourceCtor = globalThis.EventSource,
  initialLastEventId,
  reconnectDelayMs = 5000,
  onAuditEvent,
  onError,
  onStatusChange,
}: SubscribeToMobileEventStreamOptions): MobileEventStreamSubscription {
  if (!mobileEventStreamsAvailable(EventSourceCtor)) {
    onStatusChange?.("unsupported");
    return { supported: false, close: () => undefined };
  }

  let closed = false;
  let stream: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEventId = normalizeEventId(initialLastEventId);
  const sourceCtor = EventSourceCtor!;

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const closeStream = () => {
    if (stream) {
      stream.close();
      stream = null;
    }
  };

  const scheduleReconnect = (error?: Error) => {
    if (closed) return;
    onStatusChange?.("reconnecting");
    if (error) onError?.(error);
    closeStream();
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, reconnectDelayMs);
  };

  const connect = async () => {
    if (closed) return;
    onStatusChange?.("connecting");
    try {
      const nextStream = await client.openEventStream({
        ...(lastEventId === undefined ? {} : { lastEventId }),
        EventSource: sourceCtor,
      });
      if (closed) {
        nextStream.close();
        return;
      }
      stream = nextStream;
      addEventListener(nextStream, "open", () => onStatusChange?.("open"));
      addEventListener(nextStream, "ready", (event) => {
        const data = parseEventData<{ lastEventId?: unknown }>(event);
        const readyEventId = normalizeEventId(data?.lastEventId);
        if (readyEventId !== undefined) lastEventId = readyEventId;
        onStatusChange?.("open");
      });
      addEventListener(nextStream, "audit", (event) => {
        const auditEventId = normalizeEventId((event as MessageEvent).lastEventId);
        const data = parseEventData<AuditEventRecord>(event);
        if (!data) return;
        lastEventId = auditEventId ?? normalizeEventId(data.eventId) ?? lastEventId;
        onAuditEvent(data);
      });
      addEventListener(nextStream, "error", () => {
        scheduleReconnect(new Error("Event stream disconnected"));
      });
    } catch (error) {
      scheduleReconnect(error instanceof Error ? error : new Error("Failed to open event stream"));
    }
  };

  void connect();

  return {
    supported: true,
    close: () => {
      closed = true;
      clearReconnectTimer();
      closeStream();
      onStatusChange?.("closed");
    },
  };
}

function addEventListener(source: EventSource, event: string, handler: (event: Event) => void): void {
  source.addEventListener(event, handler as EventListener);
}

function parseEventData<T>(event: Event): T | null {
  const data = (event as MessageEvent).data;
  if (typeof data !== "string" || !data) return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

function normalizeEventId(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.trunc(parsed);
}
