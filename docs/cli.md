# CLI

The launch command concepts are `status-update`, `steering`, and `sanction`.

## Status Updates

```sh
agent-tick status-update --state working --next "Run tests" "Finished edits; validating now"
```

Recommended states: `working`, `waiting`, `blocked`, `done`, `failed`. Use `--notify` and `--importance` only when the update should be eligible for future push behavior.

## Steering

```sh
agent-tick steering \
  --title "Which rollout?" \
  --choice canary="Canary" \
  --choice blue_green="Blue/green" \
  --choice cancel:deny="Cancel"
```

Steering is bounded input: Agent Tick returns only one of the choices supplied by the caller.

## Sanctions

```sh
agent-tick sanction --title "Run migration?" -- ./migrate.sh
```

A Sanction approves or denies one specific action. Approved actions execute locally in the agent environment, not on Agent Tick servers or phones.
