# @self-deprecated/agent-tick

Command-line approval gate for Agent Tick.

## Quickstart

Run the hosted-product installer:

```sh
npx @self-deprecated/agent-tick install
```

Or install globally first:

```sh
npm install -g @self-deprecated/agent-tick
agent-tick install
```

The installer opens <https://agenttick.sh>, saves a local Agent Tick token, detects local coding agents, and installs verified hook integrations. Claude Code and Pi are enabled today; other targets are shown as disabled scaffolds until verified.

## Use

Create an approval request and wait for a response:

```sh
agent-tick request \
  --title "Deploy production?" \
  --body "Deploy commit abc123" \
  --command "deploy production"
```

Run a command only after approval:

```sh
agent-tick guard --title "Run migration?" -- ./migrate.sh
```

Send a progress update without requesting approval:

```sh
agent-tick status --state working "Checking test failures"
```

Manual setup for CI or self-hosted servers:

```sh
agent-tick setup --server https://tick.example.com --token agent_...
```

Do not put tokens in logs or committed files.

More documentation: <https://github.com/self-deprecated/agent-tick#readme>
