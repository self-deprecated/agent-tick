---
title: Claude Code
description: Configure Claude Code to use Agent Tick through MCP tools and optional native permission hooks.
---

# Claude Code

Claude Code uses Agent Tick primarily through the local MCP adapter. Claude can call Agent Tick tools for Status Updates, Steering, and Sanctions while all commands and file edits remain local to Claude Code.

## What Claude gets

- `agent_tick_status_update` — send progress.
- `agent_tick_steering` — ask a bounded question.
- `agent_tick_sanction` — ask for approval before one specific action.
- Optional native permission hook — route Claude Code `PermissionRequest` prompts through Agent Tick Sanctions.

MCP does not automatically intercept Claude Code’s own native permission prompts. Install the optional permission hook only if you want those prompts routed through Agent Tick.

## Install

Use the setup prompt from the Personal Console for first-time setup, or run a manual dry run:

```sh
npx @self-deprecated/agent-tick install --target claude --dry-run
```

Install after reviewing the plan:

```sh
npx @self-deprecated/agent-tick install --target claude
```

Choose local project scope when you want this repository to carry the MCP config:

```sh
npx @self-deprecated/agent-tick install --target claude --claude-scope local
```

Choose global/user scope when this machine should use Agent Tick across Claude Code projects:

```sh
npx @self-deprecated/agent-tick install --target claude --claude-scope global
```

Verify:

```sh
claude mcp list
claude mcp get agent-tick
```

## Optional native permission hook

To route Claude Code native permission prompts such as Bash/Edit through Agent Tick:

```sh
npx @self-deprecated/agent-tick install --target claude --claude-permission-hook
```

Agent Tick returns allow/deny for Claude Code’s prompt. It does not run the command remotely.

## Session guidance

Claude MCP cannot read `${CLAUDE_SESSION_ID}` from the shell environment. Use Claude’s prompt substitution token in Claude-facing instructions and pass it to Agent Tick tool calls:

```text
Pass sessionId "claude_${CLAUDE_SESSION_ID}" on every Agent Tick MCP tool call in this chat. Add sessionTitle when you have a useful human-readable chat label. Do not use the title for grouping.
```

Claude hooks receive `session_id` in hook stdin JSON and can use that automatically.

## Verify Steering

Ask Claude:

```text
Use `agent_tick_steering` to ask which safe documentation-only path to take next. Pass sessionId "claude_${CLAUDE_SESSION_ID}". Offer exactly these options: Review setup wording, Review troubleshooting wording, Stop the demo. Treat Stop the demo as the decline option and do not edit files yet.
```

Expected result: Agent Tick creates a Steering Request and Claude receives only the selected bounded choice.

## Verify Sanctions

Ask Claude:

```text
Before running `pwd`, use `agent_tick_sanction` with sessionId "claude_${CLAUDE_SESSION_ID}" and the exact command as context.
```

If approved, Claude Code may run the command locally. If denied or timed out, it should stop.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Claude cannot see Agent Tick tools | MCP entry missing or Claude needs reload | Run `claude mcp get agent-tick`, rerun the installer dry run, then reinstall. |
| Claude still shows native permission prompts | MCP tools do not intercept native permission prompts | Install `--claude-permission-hook` if desired. |
| Hook fails closed | Agent Tick CLI config/token missing or server unreachable | Run `agent-tick login`, `agent-tick install`, or `agent-tick config --server ... --token ...`. |
| Agent Tick hook triggers a permission loop | Missing `Bash(agent-tick:*)` allow rule | Re-run installer with the optional hook flag and restart Claude Code. |
