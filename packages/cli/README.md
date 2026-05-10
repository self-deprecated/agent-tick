# @self-deprecated/agent-tick

Command-line approval gate for Agent Tick.

## Install

```sh
npm install -g @self-deprecated/agent-tick
```

Or run without a global install:

```sh
npx @self-deprecated/agent-tick --help
```

## Set up

Hosted product:

```sh
agent-tick setup --login --server https://agenttick.sh
```

Self-hosted server:

```sh
agent-tick setup --login --server https://tick.example.com
```

For CI or single-mode self-hosting, create an agent token in the dashboard and save it manually:

```sh
agent-tick setup --server https://tick.example.com --token agent_...
```

Do not put tokens in logs or committed files.

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

Cancel a pending request:

```sh
agent-tick abandon req_...
```

More documentation: <https://github.com/self-deprecated/agent-tick#readme>
