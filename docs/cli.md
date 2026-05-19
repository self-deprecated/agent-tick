# CLI

The day-to-day Agent Tick commands are `status-update`, `steering`, and `sanction`. Use `install` when you want Agent Tick to configure supported local coding-agent integrations; use `setup` when you only need to save a server URL and `agent_...` token.

Examples use the `agent-tick` binary. If it is not on your `PATH`, run one-off commands with `npx @self-deprecated/agent-tick <command>` or install the package globally first.

## Setup

Primary hosted setup is the prompt-based skill from [Quick Start](./quick-start.md). Manual setup:

```sh
npx @self-deprecated/agent-tick install
```

Sign in and save a local token without installing hooks:

```sh
npx @self-deprecated/agent-tick login
```

For self-hosted servers or CI, create an agent token in the dashboard and save it locally:

```sh
agent-tick setup --server https://tick.example.com --token agent_...
```

## Status updates

Send non-blocking progress:

```sh
agent-tick status-update --state working --next "Run tests" "Finished edits; validating now"
```

Recommended states: `working`, `waiting`, `blocked`, `done`, `failed`. Use `--notify` and `--importance` only when the update should be eligible for future push behavior.

## Steering

Ask a human to choose from bounded options:

```sh
agent-tick steering \
  --title "Which rollout?" \
  --choice canary="Canary" \
  --choice blue_green="Blue/green" \
  --choice cancel:deny="Cancel"
```

Steering is bounded input: Agent Tick returns only one of the choices supplied by the caller. Include a deny/escape option when a bad state is possible.

Choice flags add mobile-visible cues:

```sh
agent-tick steering \
  --title "Which fix?" \
  --choice small="Small targeted fix" \
  --choice rewrite="Rewrite subsystem" \
  --choice stop:deny="Stop" \
  --choice-flag small=favorite
```

## Sanctions

Ask for approval before a specific action. This records the command as reviewer context and does not run it:

```sh
agent-tick sanction \
  --title "Run migration?" \
  --body "Run the migration against the staging database." \
  --command "./migrate-staging.sh"
```

Run a local command only after sanction approval by putting the command after `--`:

```sh
agent-tick sanction --title "Run migration?" -- ./migrate-staging.sh
```

Approved actions execute locally in the agent environment, not on Agent Tick servers or phones.

## MCP adapter

Run the local stdio MCP adapter from an MCP-capable agent configuration:

```sh
agent-tick mcp
```

The adapter uses the same saved CLI setup/token and exposes Agent Tick tools for status updates, steering, and sanctions.

## Abandon a pending request

If a local caller created a request it no longer needs, abandon it by ID:

```sh
agent-tick abandon apr_123
```
