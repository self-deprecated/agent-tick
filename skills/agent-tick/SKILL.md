---
name: agent-tick
description: Send status updates, ask steering questions, request sanctions, or configure Claude Code AFK/pass-through routing through the Agent Tick CLI. Use when an agent is about to run a potentially risky command, make a destructive or expensive change, access sensitive data, install dependencies, modify infrastructure, perform a long-running operation, provide mobile-visible status while working away from the user, or when the user explicitly asks to gate work or send updates through Agent Tick. This skill covers the current TypeScript CLI commands: `agent-tick install`, `agent-tick setup`, `agent-tick mode`, `agent-tick sanction`, `agent-tick steering`, `agent-tick abandon`, and `agent-tick status`.
---

# Agent Tick

Agent Tick is a CLI-based human loop for status, steering, and sanctions. Sanctions and steering block until the user responds; status is non-blocking.

## First Check

Before using Agent Tick, check whether the CLI exists:

```sh
command -v agent-tick
```

If it is missing, tell the user to install or build the `agent-tick` CLI for this project and stop. Do not bypass approval just because the CLI is unavailable.

For an interactive machine in hosted/Clerk mode, prefer the installer when setting up a new machine or coding agent:

```sh
agent-tick install
```

For Claude Code setup, guide the user interactively before installing:

1. Ask whether they run mostly interactive local sessions, headless loops, or mixed usage.
2. Do **not** ask which capabilities to enable by default. Agent Tick should encourage the full setup: status updates, steering (`AskUserQuestion`), and sanctions (Claude Code `PermissionRequest`) are all enabled unless the user explicitly asks to opt out of one.
3. For interactive sessions, recommend installing hooks in **pass-through mode** and toggling **AFK mode** only when away.
4. For headless loops, recommend AFK behavior for status, steering, and sanctions.
5. Explain that sanctions route Claude Code's own permission prompts only; Agent Tick does not manage risky-command patterns for Claude Code setup yet.
6. Avoid phrasing setup questions around a specific UI surface. Say "through Agent Tick" or "remotely" instead.
7. Inspect existing Claude settings before changing them: `~/.claude/settings.json`, project `.claude/settings.json`, and `.claude/settings.local.json` if present. Look for existing hooks and permission rules that might conflict with `Bash(agent-tick:*)`.
8. Run a dry run first and summarize exactly what will change. For interactive local sessions, use defaults:

```sh
agent-tick install --target claude --dry-run
```

For headless loops, prefer explicit routing flags:

```sh
agent-tick install --target claude \
  --claude-profile headless \
  --claude-steering always \
  --claude-sanctions always \
  --claude-initial-mode afk \
  --dry-run
```

9. After user confirmation, run the install with the same options minus `--dry-run`, then verify the settings:

```sh
agent-tick mode
```

Tell the user to restart Claude Code after hook changes. The mode commands are:

```sh
agent-tick mode afk
agent-tick mode pass-through
```

For setup only, without installing agent instructions, use browser setup:

```sh
agent-tick setup --login --server https://agenttick.sh
```

The CLI opens Agent Tick in the browser, the user signs in, authorizes CLI setup, and Agent Tick returns a newly-created `agent_...` token to the CLI over a localhost callback. The CLI saves it to `~/.config/agent-tick/config.json` by default.

If the user gives a setup command from Agent Tick, run it exactly once. For CI, headless hosts, single-mode self-hosting, or manual setup, the server may be the hosted product at `https://agenttick.sh` or the user's self-hosted URL:

```sh
agent-tick setup --server https://agenttick.sh --token agent_...
```

Do not print, log, summarize, or expose the token value after setup.

## Sanctions

Use `agent-tick sanction` when asking for approval of a risky or sensitive action:

```sh
agent-tick sanction \
  --title "Proceed with deployment?" \
  --body "Deploy commit abc123 to production." \
  --command "deploy production"
```

For shell commands, pass the command after `--`. Agent Tick requests sanction approval and only runs the command after approval:

```sh
agent-tick sanction -- npm install
```

For commands with flags, pipes, redirection, shell expansion, or multiple steps, wrap the command in a shell:

```sh
agent-tick sanction -- sh -c 'npm install && npm test'
```

Use a custom title/body when the risk is not obvious:

```sh
agent-tick sanction \
  --title "Modify production database?" \
  --body "Run the migration against the production database." \
  -- ./migrate-prod.sh
```

If denied, stop the gated action and report that the user denied it.

## Steering

Use `agent-tick steering` for real multiple-choice questions that steer the work. Repeat `--choice`. Use `id=Label` or `id:kind=Label`; custom choices must include at least one `kind` of `deny`. The mobile app highlights deny choices in red, and selecting one makes the CLI exit non-zero. If `kind` is omitted, it defaults to `approve` except deny-style ids such as `cancel`, `deny`, `reject`, and `no`, which default to `deny`.

```sh
agent-tick steering \
  --title "Which rollout should I use?" \
  --body "Choose the deployment strategy." \
  --choice canary="Canary rollout" \
  --choice blue_green="Blue/green rollout" \
  --choice cancel:deny="Do not deploy"
```

Treat denial or any selected `deny` choice as a hard stop unless the user gives a new instruction.

## AFK Status Updates

Use `agent-tick status` to send lightweight progress updates that do not ask for approval and do not block. This is useful during AFK/long-running work so the user can see that the agent is still working from the mobile app.

Send concise updates at meaningful milestones, not after every small action:

```sh
agent-tick status --state working --next "Run typecheck" "Finished edits; validating now"
```

Use `--state done` at the end of a long task, or `--state blocked` when waiting on user input:

```sh
agent-tick status --state done "Implementation complete; tests passed"
agent-tick status --state blocked --next "Wait for user decision" "Need clarification before changing the API shape"
```

If an integration has a stable chat/thread id, pass it with `--thread` or set `AGENT_TICK_THREAD_ID`. Otherwise the CLI scopes the thread to the current host and working directory.

```sh
agent-tick status \
  --thread "$AGENT_TICK_THREAD_ID" \
  --state working \
  --next "Fix failing test" \
  "Server route is implemented; checking failures"
```

The status message is visible to humans. Do not include secrets or sensitive logs.

## JSON Output

Use `--json` when another script needs machine-readable events from `sanction`, `steering`, `abandon`, or `status`:

```sh
agent-tick sanction \
  --json \
  --title "Proceed with deployment?" \
  --body "Deploy commit abc123 to production."
```

The current CLI does not support JSON stdin adapter, MCP, constrained steering, context-file, project-routing, requester override, freeform text replies, or custom Claude Code command-risk policies. Do not use undocumented commands or flags.

## Timeouts

The CLI waits up to 30 minutes by default. For slower decisions, set a longer timeout:

```sh
agent-tick sanction --timeout 30m -- ./long-running-operation
```

Use `--timeout 0` on `sanction` or `steering` to create a request without waiting.

Do not retry repeatedly after timeouts unless the user asks. Repeated retries can spam the user's approval channel.

For status updates, `--json` returns the accepted status update:

```sh
agent-tick status --json --state working "Running server tests"
```

## Abandoning A Request

Use `agent-tick abandon` to cancel a pending request by ID:

```sh
agent-tick abandon req_...
```

## Safety Rules

- Do not use Agent Tick to approve its own setup command.
- Do not include secrets, bearer tokens, private keys, session cookies, or full `.env` contents in sanction titles, steering bodies, status messages, or command summaries.
- Do not continue a gated action after denial, timeout, CLI failure, or a non-zero `agent-tick` exit.
- Do not replace Agent Tick with a normal prompt when the user asked for Agent Tick approval.
- Use one approval for one meaningful action. Batch only when the full batch is clearly described.
