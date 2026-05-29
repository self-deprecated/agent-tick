---
title: Pi
description: Install the Agent Tick Pi extension for sanctions around risky shell actions.
---

# Pi

Agent Tick supports Pi with a native TypeScript extension installed by the CLI.

## Setup

For first-time setup, start with the [Quick Start](./quick-start.md) prompt-based skill and tell your agent you use Pi.

Manual install:

```sh
npx @self-deprecated/agent-tick install --target pi
```

The installer writes the Agent Tick Pi extension to:

```text
~/.pi/agent/extensions/agent-tick-sanction.ts
```

Pi auto-discovers extensions from `~/.pi/agent/extensions/`. Restart Pi or run `/reload` in Pi after installing or updating the extension.

## What the extension does

The launch Pi extension watches Pi `bash` tool calls. When Pi is about to run a risky command, the extension creates an Agent Tick sanction request with `agent-tick sanction` and blocks the tool call if the request is denied, times out, or fails.

The current risky-command patterns include recursive remove commands, `sudo`, broad `chmod`/`chown`, `git`/`jj push`, `docker compose up`, and package-manager install/add commands. Agent Tick commands themselves are ignored so the extension does not loop on its own Sanction Request.

Status Updates, Steering, and Sanctions from the Pi Native Extension share one Agent Tick Session per Pi chat. The extension uses Pi's persisted chat/session ID when available, so resumed Pi chats continue in the same Agent Tick Session. If Pi does not expose a real chat/session ID and no `AGENT_TICK_SESSION_ID` override is set, the extension should omit explicit `sessionId` rather than generate a random fallback; Agent Tick will group best-effort by source metadata. Host/source hints such as host, working directory, and client name remain source metadata, not Session identity. Set `AGENT_TICK_SESSION_ID` and optional `AGENT_TICK_SESSION_TITLE` only when a host integration already has a stronger chat/session ID or user-facing label.

## Verify

After setup and reload, ask Pi to do normal work that may need Response. For a safe extension smoke test, ask Pi to run a dry-run dependency install only after a human approving Response, for example:

```text
Use Agent Tick if needed, then run npm install --dry-run. Stop if the Response denies or times out.
```

You should receive the Sanction Request in Agent Tick, respond from the mobile app or web UI, and see Pi continue only after the Response.
