# @self-deprecated/agent-tick

Command-line status, steering, and sanction interface for Agent Tick.

## Quickstart

Sign in to the hosted product and run the installer:

```sh
npx @self-deprecated/agent-tick login
npx @self-deprecated/agent-tick install
```

Or install globally first:

```sh
npm install -g @self-deprecated/agent-tick
agent-tick install
```

The installer opens <https://agenttick.sh>, saves a local Agent Tick token, detects local coding agents, and installs verified hook integrations. Claude Code and Pi are enabled today; other targets are shown as disabled scaffolds until verified.

## Use

Ask for a sanction and wait for approval:

```sh
agent-tick sanction \
  --title "Deploy production?" \
  --body "Deploy commit abc123" \
  --command "deploy production"
```

Run a command only after sanction approval:

```sh
agent-tick sanction --title "Run migration?" -- ./migrate.sh
```

Ask a steering question with structured choices:

```sh
agent-tick steering \
  --title "Which rollout?" \
  --choice canary="Canary" \
  --choice cancel:deny="Cancel" \
  --choice-flag canary=favorite
```

Use `--choice-flag choiceId=favorite` for a mobile-visible recommendation star, or warning flags such as `production`, `destructive`, and `security_sensitive` on sanction approve choices.

Send a status update without requesting approval:

```sh
agent-tick status --state working "Checking test failures"
```

Run the local stdio MCP adapter from an MCP-capable agent config:

```sh
agent-tick mcp
```

Codex can use the adapter as a stdio MCP server, and steering/sanction tools support local MCP form elicitation when Codex is configured to allow MCP elicitations.

For Claude Code, the default interactive profile starts hooks in pass-through mode. Route Claude Code steering and permission prompts through Agent Tick when away from the terminal:

```sh
agent-tick mode afk
agent-tick mode pass-through
```

For unattended Claude Code runs, install with the headless profile:

```sh
agent-tick install --target claude --claude-profile headless --claude-steering always --claude-sanctions always
```

Browser sign-in without installing hooks:

```sh
agent-tick login
# equivalent: agent-tick setup --login
```

Manual setup for CI or self-hosted servers:

```sh
agent-tick setup --server https://tick.example.com --token agent_...
```

Do not put tokens in logs or committed files.

More documentation: <https://github.com/self-deprecated/agent-tick#readme>
