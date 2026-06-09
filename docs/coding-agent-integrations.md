---
title: Coding-agent integrations
description: Choose the right Agent Tick integration path for Claude Code, Codex, Pi, GitHub Actions, or other tools.
---

# Coding-agent integrations

A Coding-agent Integration is how a tool such as Claude Code, Codex, or Pi sends Agent Tick activity. The configured identity it creates or uses inside Agent Tick is an **Agent Connection**.

All integrations share the same product boundary:

- Status Updates report progress.
- Steering asks for bounded choices.
- Sanctions approve or deny one specific action.
- Local execution stays local.

## Current paths

| Tool or workflow | Recommended path | Guide |
| --- | --- | --- |
| Claude Code | MCP adapter; optional native permission hook | [Claude Code](./claude-code.md) |
| Codex | Manual MCP adapter config with `agent-tick mcp` | [Codex](./codex.md) |
| Pi | `pi-agent-tick` package for mirrored prompts, status, and optional gates | [Pi](./pi.md) |
| GitHub Actions | CLI/composite action Sanction before release/deploy steps | [CLI](./cli.md) |
| Other MCP or CLI-capable tools | Generic MCP, CLI, or project instructions | [Other tools](./other-tools.md) |

Installer-known targets that are not verified are not documented as supported integrations. Use the generic MCP/CLI path until a tool has a verified page.

## First-time setup

For a guided install, copy the setup prompt from the Personal Console after your app/Test Request proof. The prompt points the agent at:

```text
https://agenttick.sh/skill
```

Manual install remains available:

```sh
npx @self-deprecated/agent-tick install
```

## Keep integration requests reviewable

Include enough context for a human to decide: what action is proposed, why it matters, what will happen on denial/timeout, and where the local action runs.

Do not include secrets, raw logs, full prompts, `.env` files, or customer data.
