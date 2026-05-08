---
name: agent-tick
description: Request out-of-band human approval through the Agent Tick CLI. Use when an agent is about to run a potentially risky command, make a destructive or expensive change, access sensitive data, install dependencies, modify infrastructure, perform a long-running operation, or when the user explicitly asks to gate work through Agent Tick. This skill covers the current TypeScript CLI commands: `agent-tick setup`, `agent-tick request`, `agent-tick abandon`, and `agent-tick guard`.
---

# Agent Tick

Agent Tick is a CLI-based approval gate. It sends an approval request to the user's Agent Tick server/mobile flow and waits before proceeding.

## First Check

Before using Agent Tick, check whether the CLI exists:

```sh
command -v agent-tick
```

If it is missing, tell the user to install or build the `agent-tick` CLI for this project and stop. Do not bypass approval just because the CLI is unavailable.

If the user gives a setup command from the dashboard, run it exactly once. The server may be the hosted product at `https://agenttick.sh` or the user's self-hosted URL:

```sh
agent-tick setup --server https://agenttick.sh --token agent_...
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

## JSON Output

Use `--json` when another script needs machine-readable events from `request` or `abandon`:

```sh
agent-tick request \
  --json \
  --title "Proceed with deployment?" \
  --body "Deploy commit abc123 to production."
```

The current CLI does not support JSON stdin adapter, MCP, constrained steering, context-file, project-routing, requester override, or metadata flags. Do not use undocumented commands or flags.

## Timeouts

The CLI waits up to 30 minutes by default. For slower decisions, set a longer timeout:

```sh
agent-tick guard --timeout 30m -- ./long-running-operation
```

Use `--timeout 0` on `request` to create a request without waiting.

Do not retry repeatedly after timeouts unless the user asks. Repeated retries can spam the user's approval channel.

## Abandoning A Request

Use `agent-tick abandon` to cancel a pending request by ID:

```sh
agent-tick abandon req_...
```

## Safety Rules

- Do not use Agent Tick to approve its own setup command.
- Do not include secrets, bearer tokens, private keys, session cookies, or full `.env` contents in approval titles, bodies, or command summaries.
- Do not continue a gated action after denial, timeout, CLI failure, or a non-zero `agent-tick` exit.
- Do not replace Agent Tick with a normal prompt when the user asked for Agent Tick approval.
- Use one approval for one meaningful action. Batch only when the full batch is clearly described.
