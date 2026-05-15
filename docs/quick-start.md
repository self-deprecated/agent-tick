# Quick Start

Start with CLI/web proof, then activate the Native App.

## 1. Use the setup skill

Paste this into your coding agent on the machine where your local agent runs:

```text
Fetch and follow the Agent Tick setup skill from:
https://agenttick.sh/skill
```

The skill inspects existing agent config, runs a dry run, explains changes, asks for confirmation, installs, and verifies.

Manual CLI path:

```sh
npx @self-deprecated/agent-tick install
```

## 2. Prove routing safely

Use a safe Steering test first:

```sh
agent-tick steering \
  --title "Agent Tick setup test" \
  --choice works="It works" \
  --choice stop:deny="Stop testing"
```

Optional follow-up:

```sh
agent-tick status-update --state working "Agent Tick setup test status update"
agent-tick sanction --title "Agent Tick setup test sanction" --body "No command will run."
```

## 3. Activate the Native App

Install the app, sign in or pair your self-hosted server, enable notifications if wanted, and verify requests open inside the app.
