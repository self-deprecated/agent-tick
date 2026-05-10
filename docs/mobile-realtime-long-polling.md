# Mobile realtime updates with long polling

## Goal

Make approval requests appear in the mobile app as soon as practical without constant short-interval polling.

The target user experience is:

1. An agent creates an approval request.
2. The server persists it and emits a small change event.
3. If the phone is backgrounded, push notification wakes/alerts the user.
4. If the app is open, the foreground realtime channel wakes immediately.
5. The app fetches canonical approval state and renders the request.

The realtime event is only a hint that something changed. `GET /v1/approval-requests` remains the source of truth.

## Why change the current approach

The current mobile app uses canonical HTTP fetches and falls back to polling approximately every 5 seconds when realtime event streams are unavailable. This is simple, but at scale it creates unnecessary load:

```text
1,000 active users / 5s = 200 requests/sec
10,000 active users / 5s = 2,000 requests/sec
```

Most of those requests return no changes. Users still sometimes see a delay because a push notification can arrive before the next polling tick or before app foreground/session restore finishes.

Long polling keeps the implementation mobile-friendly while reducing idle churn:

```text
1,000 active users / 30s = ~33 idle requests/sec
10,000 active users / 30s = ~333 idle requests/sec
```

When an event arrives, the relevant long-poll request returns immediately.

## Architecture

Use four layers:

1. **Canonical sync** — `GET /v1/approval-requests`
2. **Foreground realtime hint** — authenticated long-poll endpoint
3. **Background wake-up** — Expo/APNs push notification
4. **Fallback** — slow/adaptive polling only when long polling is unavailable

```text
agent/CLI
  -> POST /v1/approval-requests
  -> DB transaction stores request + audit/event row
  -> in-process event bus wakes org subscribers
  -> push notification sent to registered devices

mobile foreground
  -> GET /v1/events/poll?lastEventId=N  (held up to ~25s)
  <- event list or empty timeout
  -> if relevant event: GET /v1/approval-requests
  -> immediately start next long poll

mobile background/closed
  <- push notification
  -> on open/resume/tap: GET /v1/approval-requests immediately
```

## Server API

Add a mobile-friendly event polling endpoint. It should use normal `Authorization` headers, never bearer tokens in query strings.

```http
GET /v1/events/poll?lastEventId=123&timeoutMs=25000
Authorization: Bearer <Agent Tick mobile session or Clerk session>
X-Agent-Tick-Organization-ID: org_...
```

Response when events are available:

```json
{
  "events": [
    {
      "eventId": 124,
      "type": "approval.created",
      "targetId": "req_...",
      "createdAt": "2026-05-10T09:30:00.000Z"
    }
  ],
  "nextEventId": 124
}
```

Response on idle timeout:

```json
{
  "events": [],
  "nextEventId": 123
}
```

Use `200` with an empty event array rather than requiring clients to special-case `204`.

### Event payload rules

Do not include approval titles, bodies, commands, tokens, or notification payload contents.

Safe fields:

- `eventId`
- `type`
- `targetId`
- `createdAt`

The client uses these only to decide whether to refresh canonical state.

## Server implementation plan

### 1. Shared schema

Add shared schemas:

- `EventPollEventSchema`
- `EventPollResponseSchema`

Event types can initially mirror audit event types, e.g.:

- `approval.created`
- `approval.responded`
- `approval.abandoned`
- `approval.expired`
- `device.registered`

Mobile only needs to refresh approvals for `approval.*` events.

### 2. Store query for backfill

Add DB helper:

```ts
listAuditEventsAfter(organizationId: string, lastEventId: number, limit = 50)
```

It should be indexed by organization/time/event id. Existing `audit_events.event_id` is monotonic. Add an index if needed:

```sql
CREATE INDEX IF NOT EXISTS audit_events_org_event_idx
ON audit_events(organization_id, event_id);
```

### 3. In-process event bus

For single-node Docker deployments, add an in-memory pub/sub helper:

```ts
type EventWaiter = {
  organizationId: string;
  afterEventId: number;
  resolve: () => void;
  timeout: ReturnType<typeof setTimeout>;
};
```

When an audit event is written, wake waiters for that organization.

Implementation options:

- Preferred: store method returns the written audit event id and route/service calls `eventBus.publish(...)`.
- Simpler first pass: after create/respond/abandon routes write state, call `eventBus.publishOrganization(organizationId)`.

The endpoint should:

1. authenticate human/mobile request
2. read events after `lastEventId`
3. return immediately if any
4. otherwise wait until either:
   - event bus wakes the org, then read events again
   - timeout elapses
5. return events or empty response

### 4. Timeouts and limits

Clamp client-provided timeout:

```text
min: 5s
max: 30s
recommended default: 25s
```

Clamp event count:

```text
max events per response: 50
```

Add rate limiting, but account for long-held requests. Do not use the same low limit as short auth endpoints. Long-poll clients are expected to maintain one request per active app.

### 5. Connection cleanup

Use request abort handling:

```ts
request.raw.on('close', cleanup)
```

Ensure every waiter is removed on timeout, wake, client disconnect, and server error.

## Mobile implementation plan

### 1. Replace foreground 5s polling as primary path

Introduce a transport abstraction:

```ts
subscribeToApprovalEvents({
  client,
  lastEventId,
  onEvent,
  onStatusChange,
  onError,
})
```

The first implementation uses long polling. Existing SSE support can be removed or kept behind the same interface.

### 2. Long-poll loop

Pseudo-code:

```ts
let stopped = false;
let lastEventId = storedLastEventId;

async function loop() {
  while (!stopped) {
    try {
      setStatus('connecting');
      const response = await client.pollEvents({ lastEventId, timeoutMs: 25000 });
      setStatus('open');

      if (response.nextEventId > lastEventId) {
        lastEventId = response.nextEventId;
        await saveLastEventId(lastEventId);
      }

      if (response.events.some(isApprovalEvent)) {
        onEvent(); // schedule immediate GET /v1/approval-requests
      }
    } catch (error) {
      setStatus('reconnecting');
      await sleep(backoffWithJitter());
    }
  }
}
```

Use jittered backoff after failures:

```text
1s, 2s, 5s, 10s, max 30s
```

Reset backoff after a successful response.

### 3. Immediate refresh triggers

Even with long polling, mobile should fetch immediately when:

- app starts with valid auth
- app returns to foreground (`AppState` becomes `active`)
- notification is received while foregrounded
- notification is tapped/opened from background
- long-poll event indicates `approval.*`
- user taps “Check Connection”

These refreshes should be debounced/coalesced so multiple triggers in the same few hundred ms do one canonical fetch.

### 4. Slow fallback polling

If long polling repeatedly fails or the endpoint returns `404` against an older server, fall back to slow polling:

```text
15s–30s when app is foregrounded
no polling when app is backgrounded
```

This preserves compatibility during upgrades without returning to 5s constant polling.

### 5. Diagnostics

Record diagnostics for:

- long poll connected/reconnecting/offline state transitions
- endpoint `404` fallback
- repeated network failures
- notification receipt that caused refresh
- canonical refresh latency after event notification

Avoid logging approval text, command text, tokens, or raw notification payloads.

## Push notification interaction

Push remains important because mobile operating systems restrict background networking. Long polling is for foreground/open app responsiveness, not a replacement for push.

When push arrives:

- app foreground: notification listener records the ID and triggers immediate canonical refresh
- app background: OS shows notification; on tap/resume, app triggers immediate canonical refresh
- app closed: launch path reads last notification response and triggers immediate canonical refresh

The push payload should contain only IDs/hints, not full request content beyond what is safe for user-visible notification text.

## Scaling path

This long-poll design is a stepping stone that keeps the key abstraction stable.

### 1k–10k active users

Long polling is appropriate:

- simple infrastructure
- works with React Native `fetch`
- low idle request rate
- avoids EventSource compatibility problems

### 100k active users

Consider replacing the transport with WebSocket or SSE gateway infrastructure:

```text
API server -> event bus -> realtime gateway -> connected clients
```

The mobile app should not need a product-level rewrite if the transport abstraction is in place.

### 1M active users

Use dedicated realtime fanout infrastructure:

- sharded WebSocket/SSE gateways
- Redis/NATS/Kafka/PubSub or managed equivalent
- push-first background strategy
- canonical HTTP sync with ETags/incremental sync
- per-user/per-org channel authorization

The invariant remains unchanged:

```text
realtime event = hint
HTTP API/DB = source of truth
```

## Rollout plan

1. Add schemas and SDK `pollEvents` method.
2. Add DB helper and audit event index.
3. Add server long-poll endpoint with in-memory event bus.
4. Add tests for:
   - immediate return when events already exist
   - delayed return when event is published during wait
   - timeout returns empty event list
   - auth/organization scoping
5. Add mobile long-poll transport and fallback.
6. Add immediate refresh on notification receipt/tap and app foreground.
7. Use diagnostics to verify latency:
   - event received timestamp
   - approval fetch started timestamp
   - approval rendered timestamp
8. Once stable, increase fallback polling interval from 5s to 15s–30s.

## Success criteria

- Foreground app shows a new approval within ~0.5–1.0s of server event under normal LAN/WAN conditions.
- Background app shows notification via push and refreshes immediately on open.
- Idle foreground users do not issue frequent `GET /v1/approval-requests` calls.
- Older servers degrade gracefully to slow fallback polling.
- No approval commands/bodies/tokens are sent through event payloads or diagnostics.
