---
name: agent-tick
description: Request out-of-band human approval through the Agent Tick CLI. Use when an agent is about to run a potentially risky command, make a destructive or expensive change, access sensitive data, install dependencies, modify infrastructure, perform a long-running operation, or when the user explicitly asks to gate work through Agent Tick. This skill covers `agent-tick setup`, `agent-tick request`, `agent-tick guard`, and `agent-tick adapter`.
---

# Agent Tick

Agent Tick is a CLI-based approval gate. It sends an approval request to the user's phone and waits for approve/deny before proceeding.

## First Check

Before using Agent Tick, check whether the CLI exists:

```sh
command -v agent-tick
```

If it is missing, tell the user to install the `agent-tick` CLI from the project's GitHub Releases and stop. Do not bypass approval just because the CLI is unavailable.

If the user gives a setup command from the dashboard, run it exactly once:

```sh
agent-tick setup --server https://tick.example.com --token agent_...
```

Do not print, log, summarize, or expose the token value after setup.

## Command Approval

For shell commands, prefer `agent-tick guard`. It requests approval and only runs the command after approval:

```sh
agent-tick guard -- npm install
```

For commands with flags, pipes, redirection, shell expansion, or multiple steps, wrap the command in a shell:

```sh
agent-tick guard -- sh -c 'npm install && npm test'
```

Use a custom title/body when the risk is not obvious:

```sh
agent-tick guard \
  --title "Modify production database?" \
  --body "Run the migration against the production database." \
  -- ./migrate-prod.sh
```

If denied, stop the gated action and report that the user denied it.

## Approval Without Running A Command

Use `agent-tick request` when asking for approval of a decision or action that is not a single local command:

```sh
agent-tick request \
  --title "Proceed with deployment?" \
  --body "Deploy commit abc123 to production." \
  --command "deploy production"
```

Treat denial as a hard stop unless the user gives a new instruction.

## Include Context

For long details, write the extra context to a temporary file and attach it:

```sh
agent-tick request \
  --title "Apply large patch?" \
  --body "Review the attached patch summary before approval." \
  --context-file /tmp/agent-tick-context.txt
```

Keep `--body` short enough to scan on a phone. Put verbose logs, diffs, plans, and command output in `--context-file`.

## Timeouts

The CLI waits up to 10 minutes by default. For slower decisions, set a longer timeout:

```sh
agent-tick guard --timeout 30m -- ./long-running-operation
```

Do not retry repeatedly after timeouts unless the user asks. Repeated retries can spam the user's phone.

## Stdio Adapter

Use `agent-tick adapter` when another tool emits a JSON approval request on stdin:

```sh
printf '{"title":"Run command?","command":"npm install"}' | agent-tick adapter
```

Use this for integrations that already produce structured request JSON.

## Safety Rules

- Do not use Agent Tick to approve its own setup command.
- Do not include secrets, bearer tokens, private keys, session cookies, or full `.env` contents in approval titles, bodies, or context files.
- Do not continue a gated action after denial, timeout, CLI failure, or a non-zero `agent-tick` exit.
- Do not replace Agent Tick with a normal prompt when the user asked for Agent Tick approval.
- Use one approval for one meaningful action. Batch only when the full batch is clearly described.
