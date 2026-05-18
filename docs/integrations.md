# Integrations

Agent Tick integrations are for three things:

- **Status updates** — non-blocking progress from an agent.
- **Steering** — a human chooses from bounded options.
- **Sanctions** — a human approves or denies a specific local action before it proceeds.

The CLI, MCP adapter, hooks, native extensions, and GitHub Action are just ways to deliver those three interaction types. Agent Tick does not run commands on your phone or in the hosted app.

## Setup guides

- [Claude Code](./claude-code.md) — install Verified Hooks for steering and Claude permission-prompt sanctions.
- [Codex](./codex.md) — configure the Agent Tick MCP adapter for status updates, steering, and sanctions.
- [Pi](./pi.md) — install the native Pi extension for Agent Tick sanctions around risky shell actions.
- [GitHub Actions release Sanction tutorial](./github-actions-release-sanction-tutorial.md) — gate a workflow step before release or deploy.

For first-time product setup, start with [Quick Start](./quick-start.md). For running your own server, see [Self-Hosting](./self-hosting.md).

## CLI basics

Install and connect the CLI on the machine where the agent runs:

```sh
npx @self-deprecated/agent-tick install
```

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

Ask for a sanction before a local action:

```sh
agent-tick sanction \
  --title "Deploy production?" \
  --body "Deploy commit abc123 to production." \
  --command "./scripts/deploy.sh" \
  --choice-flag approve=production \
  --timeout 30m
```

Run a local command only after the sanction is approved:

```sh
agent-tick sanction \
  --title "Run production migration?" \
  --body "Run the migration against the production database." \
  -- ./migrate-prod.sh
```

Keep request text bounded: include summaries, links, commit SHAs, rollout/rollback notes, and other reviewer context. Do not include secrets, bearer tokens, private keys, raw logs, full prompts, or customer data.
