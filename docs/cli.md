# CLI

The day-to-day Agent Tick commands are `status-update`, `steering`, and `sanction`.

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
