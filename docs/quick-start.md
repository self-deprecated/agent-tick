# Quick Start

Connect one coding-agent machine, send safe test requests, then install the iOS or Android app when you want phone approvals.

## 1. Use the setup skill

Paste this into your coding agent on the machine where the agent runs:

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

Use a safe steering test first:

```sh
agent-tick steering \
  --title "Agent Tick setup test" \
  --choice works="It works" \
  --choice stop:deny="Stop testing"
```

Send a status update:

```sh
agent-tick status-update --state working "Agent Tick setup test status update"
```

Then test a sanction with an explicit command summary. This creates an approval request for `pwd`; it does not run the command:

```sh
agent-tick sanction \
  --title "Approve a harmless command?" \
  --body "Test that Agent Tick can ask before local work proceeds." \
  --command "pwd"
```

To run a command only after approval, put the command after `--`:

```sh
agent-tick sanction --title "Run pwd?" -- pwd
```

## 3. Install the iOS or Android app

Install Agent Tick on your phone, sign in to agenttick.sh or connect to your self-hosted server, enable notifications if wanted, and verify requests open in the app.

- [Agent Tick for iOS](https://go.agenttick.sh/ios)
- [Agent Tick for Android](https://go.agenttick.sh/android)

If a store link is not live yet, continue with the web approval flow and retry after the store listing is published.
