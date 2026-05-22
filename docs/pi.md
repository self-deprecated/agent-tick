# Pi

Agent Tick supports Pi with a native TypeScript extension installed by the CLI.

## Setup

For first-time setup, start with the [Quick Start](./quick-start.md) prompt-based skill and tell your agent you use Pi.

Manual install:

```sh
agent-tick install --target pi
```

The installer writes the Agent Tick Pi extension to:

```text
~/.pi/agent/extensions/agent-tick-Response.ts
```

Pi auto-discovers extensions from `~/.pi/agent/extensions/`. Restart Pi or run `/reload` in Pi after installing or updating the extension.

## What the extension does

The launch Pi extension watches Pi `bash` tool calls. When Pi is about to run a risky command, the extension creates an Agent Tick sanction request with `agent-tick sanction` and blocks the tool call if the request is denied, times out, or fails.

The current risky-command patterns include recursive remove commands, `sudo`, broad `chmod`/`chown`, `git`/`jj push`, `docker compose up`, and package-manager install/add commands. Agent Tick commands themselves are ignored so the extension does not Response-loop on its own sanction request.

Status updates and steering are still available through the normal Agent Tick CLI that the setup skill can teach Pi to use. The native extension specifically adds local Pi tool-call protection for risky shell actions.

## Verify

After setup and reload, ask Pi to do normal work that may need Response. For a safe extension smoke test, ask Pi to run a dry-run dependency install only if Agent Tick approves it, for example:

```text
Use Agent Tick if needed, then run npm install --dry-run. Stop if Response is denied or times out.
```

You should receive the sanction in Agent Tick, respond from the mobile app or web UI, and see Pi continue only after Response.
