import { mobileEventStreamsAvailable, subscribeToMobileEventStream } from "./mobileEvents";

const flushPromises = () => Promise.resolve();

describe("mobile event streams", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("uses long polling in React Native runtimes", () => {
    expect(mobileEventStreamsAvailable()).toBe(true);
  });

  it("starts polling at the server's latest event when no cursor is provided", async () => {
    const pendingPoll = new Promise<{ events: []; nextEventId: number }>(() => undefined);
    const client = { pollEvents: jest.fn(() => pendingPoll) };

    const subscription = subscribeToMobileEventStream({
      client,
      timeoutMs: 25000,
      onAuditEvent: jest.fn(),
    });

    await flushPromises();
    subscription.close();

    expect(client.pollEvents).toHaveBeenCalledWith(expect.not.objectContaining({ lastEventId: expect.any(Number) }));
    expect(client.pollEvents).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 25000, signal: expect.any(AbortSignal) }));
  });

  it("polls for events and emits audit hints", async () => {
    const auditEvents: unknown[] = [];
    const statuses: string[] = [];
    let secondPollStarted = false;
    const pendingPoll = new Promise<{ events: []; nextEventId: number }>(() => undefined);
    const client = {
      pollEvents: jest.fn(async () => {
        if (client.pollEvents.mock.calls.length === 1) {
          return { events: [{ eventId: 6, type: "request.created", targetId: "req_123", createdAt: "2026-01-01T00:00:00.000Z" }], nextEventId: 6 };
        }
        secondPollStarted = true;
        return pendingPoll;
      }),
    };

    const subscription = subscribeToMobileEventStream({
      client,
      initialLastEventId: 5,
      timeoutMs: 25000,
      onAuditEvent: (event) => auditEvents.push(event),
      onStatusChange: (status) => statuses.push(status),
    });

    await flushPromises();
    await flushPromises();
    subscription.close();

    expect(subscription.supported).toBe(true);
    expect(client.pollEvents).toHaveBeenCalledWith(expect.objectContaining({ lastEventId: 5, timeoutMs: 25000, signal: expect.any(AbortSignal) }));
    expect(client.pollEvents).toHaveBeenLastCalledWith(expect.objectContaining({ lastEventId: 6, timeoutMs: 25000, signal: expect.any(AbortSignal) }));
    expect(auditEvents).toEqual([{ eventId: 6, type: "request.created", targetId: "req_123", createdAt: "2026-01-01T00:00:00.000Z" }]);
    expect(statuses).toContain("connecting");
    expect(statuses).toContain("open");
    expect(secondPollStarted).toBe(true);
  });

  it("backs off and reconnects after polling errors", async () => {
    jest.useFakeTimers();
    const statuses: string[] = [];
    const errors: Error[] = [];
    const pendingPoll = new Promise<{ events: []; nextEventId: number }>(() => undefined);
    const client = {
      pollEvents: jest
        .fn()
        .mockRejectedValueOnce(new Error("network"))
        .mockImplementation(() => pendingPoll),
    };

    const subscription = subscribeToMobileEventStream({
      client,
      initialLastEventId: 3,
      timeoutMs: 25000,
      onAuditEvent: jest.fn(),
      onError: (error) => errors.push(error),
      onStatusChange: (status) => statuses.push(status),
    });

    await flushPromises();
    expect(statuses).toContain("reconnecting");
    expect(errors[0]?.message).toBe("network");

    jest.advanceTimersByTime(2000);
    await flushPromises();

    expect(client.pollEvents).toHaveBeenCalledTimes(2);
    expect(client.pollEvents).toHaveBeenLastCalledWith(expect.objectContaining({ lastEventId: 3, timeoutMs: 25000, signal: expect.any(AbortSignal) }));

    subscription.close();
  });
});
