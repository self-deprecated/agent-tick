---
title: Integrations
description: Choose the Agent Tick integration path for Claude Code, Codex, Pi, GitHub Actions, or direct CLI use.
---

# Integrations

Agent Tick integrations deliver the same three request types:

- **Status updates** — non-blocking progress from an agent.
- **Steering** — a human chooses from bounded options.
- **Sanctions** — a human approves or denies one specific local action before it proceeds.

The CLI, MCP adapter, hooks, native extensions, and GitHub Action are transport paths. Agent Tick still does not run commands on your phone or in the hosted app.

## Choose your integration

| Agent or workflow | Recommended path | Guide |
| --- | --- | --- |
| Claude Code | MCP adapter; optional native permission hook | [Claude Code](./claude-code.md) |
| Codex | MCP adapter launched with `agent-tick mcp` | [Codex](./codex.md) |
| Pi | Native Pi extension for risky shell sanctions | [Pi](./pi.md) |
| GitHub Actions | Composite action to gate release/deploy steps | [GitHub Actions release gate](./github-actions-release-sanction-tutorial.md) |
| Anything else | Direct CLI commands or SDK | [CLI reference](./cli.md), [API and SDK](./api-sdk.md) |

For first-time product setup, start with [Quick Start](./quick-start.md). For running your own server, see [Self-hosting](./self-hosting.md).

## Install the CLI on the agent machine

Recommended setup uses the prompt-based skill from [Quick Start](./quick-start.md). Manual install/config:

```sh
npx @self-deprecated/agent-tick install
```

For self-hosted Agent Tick:

```sh
npx @self-deprecated/agent-tick install --server https://tick.example.com
```

## Direct CLI examples

Send a status update:

```sh
agent-tick status-update --state working --next "Run tests" "Finished edits; validating now"
```

Ask a bounded steering question:

```sh
agent-tick steering \
  --title "Which rollout should I use?" \
  --body "Choose the deployment strategy." \
  --choice canary="Canary rollout" \
  --choice blue_green="Blue/green rollout" \
  --choice cancel:deny="Do not deploy" \
  --choice-flag canary=favorite
```

Ask for a sanction before a local action. Use `--command` when the command is reviewer context only and another agent or workflow will decide whether to continue:

```sh
agent-tick sanction \
  --title "Deploy production?" \
  --body "Deploy commit abc123 to production." \
  --command "./scripts/deploy.sh" \
  --choice-flag approve=production \
  --timeout 30m
```

Put the command after `--` only when you want the CLI itself to run that local command after approval:

```sh
agent-tick sanction \
  --title "Run production migration?" \
  --body "Run the migration against the production database." \
  -- ./migrate-prod.sh
```

## Session grouping

Supported integrations pass real host chat/thread/session IDs where possible so related requests appear together. Do not invent random IDs for generic CLI/MCP calls. See [Session identity](./session-identity.md).

## Keep requests reviewable

Include concise reviewer context: summaries, links, commit SHAs, rollout notes, rollback owners, and timeout behavior.

Do not include secrets, bearer tokens, private keys, cookies, `.env` files, raw logs, full prompts/transcripts, or customer data in titles, bodies, commands, choices, metadata, diagnostics, or notifications.
