# Request waiter liveness

Agent Tick Requests will model whether the originating agent is still actively waiting for a pending Request response. A pending Request means human input is needed; waiter liveness means a response is still likely to reach the agent that asked. These are separate from Status Updates. Integrations must not keep sending `working` Status Updates merely to prove that an agent is waiting on a Request.

Agent Tick will add first-class Request waiter state, backed by server-side waiter records tied to waiter credentials. A waiter represents one originating agent run waiting for one Request. Waiter records include the Request, Workspace, Agent Connection, optional host run/session identifier, transport, last seen time, lease expiry, credential expiry, explicit terminal state, and optional stop or error details. Request reads expose a derived `agentWaiter` summary such as `waiting`, `stale`, `expired`, `stopped`, or `errored`, with timestamps and reason fields when relevant.

The server creates a waiter when an authenticated Agent Connection creates a Request and receives a waiter credential. Every `/v1/requests/:id/wait` call authenticated with that credential renews the waiter lease by updating `lastSeenAt` and `leaseExpiresAt`. Long-poll waits should set the lease long enough to cover the held request plus grace, and should refresh before returning while the Request remains pending. If the agent cancels, shuts down, resolves the mirrored prompt locally, or encounters a wait error it can explicitly stop or mark the waiter through a lightweight waiter endpoint authenticated by the same credential. If it does not, the waiter naturally becomes stale or expired from timestamps.

Session state derivation continues to prioritize pending Requests: any Session with a pending actionable Request is `needs-input` regardless of newer Status Updates. Session and Request UI may use waiter liveness to qualify that needs-input state: for example, “Agent is waiting · checked in 38s ago”, “Agent has not checked in for 12m — answer may not reach it”, or “Agent wait expired — response will be recorded, but the agent may not receive it.” Session Lanes should anchor on pending Requests ahead of later heartbeat-like Status Updates.

Pi Native Extension Mirrored Prompts should create the remote Agent Tick Request before blocking on local Pi UI, pause `working` heartbeats while waiting for the mirrored response, renew waiter liveness through the wait loop, stop the waiter when the local prompt wins, and report mirror creation or wait failures as mirrored prompt errors rather than silently treating the prompt as unmirrored. If all supported Pi prompts are intended to be mirrored, there is no user-facing “local-only prompt” state.

Implementation will introduce a `request_waiters` table and associate waiter tokens with waiter rows. Existing `request_waiter_tokens.last_used_at` data may be backfilled into waiter rows during migration, using token creation and expiry as the initial lease and credential boundaries. The shared schemas, SDK, server request routes, store mapping, Session derivation, Native App, Personal Console, and Pi Native Extension should be updated together so waiter liveness appears consistently wherever pending Requests are shown.

Validation should exercise the distinction end to end:

- Pending Request state answers “does a human still need to respond?” and keeps Sessions in `needs-input`.
- Request waiter liveness answers “is the originating agent still likely to receive that response?” and may be `waiting`, `stale`, `expired`, `stopped`, or `errored` while the Request remains pending.
- Status Updates answer “what work/progress did the agent report?” and must not be used as a substitute waiter heartbeat while a mirrored Request is awaiting input.

Integration-style tests should cover active, stale, expired, stopped, and errored waiter summaries in Session APIs, a successful waiter-token `/wait` delivery after a human response, and late responses that are still recorded by Request semantics even when waiter liveness warns that delivery to the original agent is uncertain or unavailable.
