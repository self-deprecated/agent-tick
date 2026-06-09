---
title: Other tools
description: Use Agent Tick with MCP-capable tools, direct CLI workflows, and project instruction files.
---

# Other tools

If your coding agent is not covered by a dedicated guide, use one of these generic paths.

## MCP-capable tools

Run the local MCP adapter:

```sh
agent-tick mcp
```

Configure your tool to launch that command as an MCP server, then approve the Agent Tick tools if the host asks:

- `agent_tick_status_update`
- `agent_tick_steering`
- `agent_tick_sanction`

The adapter uses the saved Agent Tick CLI config/token.

## CLI-capable tools

Any agent or workflow that can run shell commands can use the CLI:

```sh
agent-tick status-update --state working "Running validation"
agent-tick steering --title "Which path?" --choice small="Small fix" --choice stop:deny="Stop"
agent-tick sanction --title "Run migration?" --command "./migrate.sh"
```

See [CLI](./cli.md) for the smoke-test and reference flow.

## Project instruction files

For tools that read project instructions such as `AGENTS.md`, add concise rules:

```text
Use Agent Tick for bounded human input. Use Status Updates for milestones, Steering for bounded choices, and Sanctions before risky local actions. Do not put secrets or raw logs in Agent Tick content. If an Agent Tick request is denied or times out, stop or choose a safe fallback.
```

## Unsupported installer targets

The CLI may know about additional installer target names for detection or scaffolding. A target is not a supported public integration until it has a verified guide or uses the generic MCP/CLI path above.
