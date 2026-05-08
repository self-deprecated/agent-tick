import type { EventSourceConstructor } from "@agent-tick/sdk";
import { mobileEventStreamsAvailable, subscribeToMobileEventStream } from "./mobileEvents";

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, Array<(event: Event) => void>>();
  closed = false;

  constructor(readonly url: string | URL) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(event: string, handler: (event: Event) => void) {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(handler);
    this.listeners.set(event, handlers);
  }

  removeEventListener(event: string, handler: (event: Event) => void) {
    const handlers = this.listeners.get(event) ?? [];
    this.listeners.set(event, handlers.filter((candidate) => candidate !== handler));
  }

  close() {
    this.closed = true;
  }

  emit(event: string, payload?: unknown, lastEventId = "") {
    const message = {
      data: payload === undefined ? undefined : JSON.stringify(payload),
      lastEventId,
    } as MessageEvent;
    for (const handler of this.listeners.get(event) ?? []) {
      handler(message);
    }
  }
}

const FakeEventSourceCtor = FakeEventSource as unknown as EventSourceConstructor;

const flushPromises = () => Promise.resolve();

describe("mobile event streams", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
  });

  it("reports unsupported runtimes without opening a ticketed stream", () => {
    const statuses: string[] = [];
    const client = { openEventStream: jest.fn() };

    const subscription = subscribeToMobileEventStream({
      client,
      EventSource: null,
      onAuditEvent: jest.fn(),
      onStatusChange: (status) => statuses.push(status),
    });

    expect(subscription.supported).toBe(false);
    expect(statuses).toEqual(["unsupported"]);
    expect(client.openEventStream).not.toHaveBeenCalled();
  });

  it("opens ticketed event streams and refreshes on audit events", async () => {
    const auditEvents: unknown[] = [];
    const statuses: string[] = [];
    const client = {
      openEventStream: jest.fn(async () => new FakeEventSource("https://tick.example.com/v1/events?ticket=evt_123") as unknown as EventSource),
    };

    const subscription = subscribeToMobileEventStream({
      client,
      EventSource: FakeEventSourceCtor,
      onAuditEvent: (event) => auditEvents.push(event),
      onStatusChange: (status) => statuses.push(status),
    });

    await flushPromises();
    expect(subscription.supported).toBe(true);
    expect(client.openEventStream).toHaveBeenCalledWith({ EventSource: FakeEventSourceCtor });

    const source = FakeEventSource.instances[0]!;
    source.emit("ready", { organizationId: "org_123", lastEventId: 5 });
    source.emit("audit", { eventId: 6, action: "approval.created" }, "6");

    expect(auditEvents).toEqual([{ eventId: 6, action: "approval.created" }]);
    expect(statuses).toEqual(["connecting", "open"]);

    subscription.close();
    expect(source.closed).toBe(true);
  });

  it("reconnects with a fresh ticket and the last seen event id", async () => {
    jest.useFakeTimers();
    const statuses: string[] = [];
    const client = {
      openEventStream: jest.fn(async () => new FakeEventSource("https://tick.example.com/v1/events?ticket=evt_123") as unknown as EventSource),
    };

    const subscription = subscribeToMobileEventStream({
      client,
      EventSource: FakeEventSourceCtor,
      initialLastEventId: 3,
      reconnectDelayMs: 100,
      onAuditEvent: jest.fn(),
      onStatusChange: (status) => statuses.push(status),
    });

    await flushPromises();
    const firstSource = FakeEventSource.instances[0]!;
    firstSource.emit("ready", { organizationId: "org_123", lastEventId: 10 });
    firstSource.emit("error");

    expect(firstSource.closed).toBe(true);
    expect(client.openEventStream).toHaveBeenCalledWith({ lastEventId: 3, EventSource: FakeEventSourceCtor });

    jest.advanceTimersByTime(100);
    await flushPromises();

    expect(client.openEventStream).toHaveBeenCalledTimes(2);
    expect(client.openEventStream).toHaveBeenLastCalledWith({ lastEventId: 10, EventSource: FakeEventSourceCtor });
    expect(statuses).toContain("reconnecting");

    subscription.close();
    jest.useRealTimers();
  });

  it("feature-detects EventSource support", () => {
    expect(mobileEventStreamsAvailable(FakeEventSourceCtor)).toBe(true);
    expect(mobileEventStreamsAvailable(null)).toBe(false);
  });
});
