# Quick Start

Set up one coding-agent machine, install the mobile app, then do normal work and watch Agent Tick requests arrive.

## 1. Ask your agent to set up Agent Tick

Paste this into the coding agent you want to connect:

```text
Fetch and follow the Agent Tick setup skill from:
https://agenttick.sh/skill.md

Use that skill to set up Agent Tick on this machine. Ask me which coding agent I am using and what kind of work I want remote approval for. Walk me through enabling status updates, steering, and sanctions, and let me opt out of any of the three. Use the right integration for this agent, run a dry run first, explain what will change, then install after I confirm and verify it works.
```

You will sign in to hosted Agent Tick through the browser. The skill works even when this repository is not cloned.

## 2. Install the mobile app

Install Agent Tick on your phone and sign in with the same account.

- [Agent Tick for iOS](https://go.agenttick.sh/ios)
- [Agent Tick for Android](https://go.agenttick.sh/android)

If a store link is not live yet, use the web approval flow and retry the app later.

## 3. Test it with real work

Ask your agent to continue with normal work. Depending on the agent and setup, it may use CLI commands, MCP elicitation, hooks, or a native extension. Your agent should guide you through the exact path.

You should see:

- **status updates** for progress
- **steering** when the agent needs a bounded choice
- **sanctions** before sensitive local actions proceed

Agent Tick routes the request and your response. The phone and hosted app do not run commands.
