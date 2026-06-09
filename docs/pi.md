---
title: Pi
description: Use pi-agent-tick for mirrored Pi prompts, Agent Tick Steering, Status Updates, and optional Sanction gates.
---

# Pi

Pi’s primary Agent Tick integration is `pi-agent-tick`. It adds a canonical Pi tool named `agent_tick_ask_user` and can mirror local Pi prompts to Agent Tick phone/web surfaces.

Agent Tick remains a decision, approval, and status layer. Pi and the local shell remain the execution environment.

## Install pi-agent-tick

```sh
pi install npm:@self-deprecated/pi-agent-tick
```

Enable remote Agent Tick mirroring by logging in with the Agent Tick CLI:

```sh
agent-tick login
```

If no Agent Tick config is available, `agent_tick_ask_user` still opens the local Pi prompt. If config is available, the prompt appears both locally and remotely; the first valid answer wins.

## Use `agent_tick_ask_user`

Ask Pi to call `agent_tick_ask_user` at decision boundaries:

```text
Use `agent_tick_ask_user` to ask one focused question before choosing the migration path. Gather repo context first, provide 2-4 options, mark your recommended option with the favorite flag, and wait for the answer.
```

A good tool call includes:

- one focused `question`
- concise `context`
- clear `options`
- `flags: ["favorite"]` on the recommended option when there is one
- a deny/stop option for risky work

## Mirrored prompts

A mirrored prompt appears in two places:

1. the local Pi prompt in the current session
2. the Agent Tick app/web Request

Answer whichever surface is convenient. If the local prompt wins, the remote Request is resolved rather than treated as a denial.

## Decision-gate skill

`pi-agent-tick` includes an `agent-tick-decision-gate` skill. Use it before high-stakes architecture, schema, API, deployment, or security decisions.

The skill’s handshake is:

1. detect ambiguity or high stakes
2. gather evidence from the codebase
3. summarize context and trade-offs
4. ask one focused Agent Tick question
5. proceed only after the bounded answer

## Optional Status Updates

`pi-agent-tick` can send lifecycle Status Updates when Agent Tick config exists and status hooks are enabled. Keep updates quiet and milestone-based: start, blocked, validation, done.

## Optional Sanction gates

Sanction gates are opt-in. Configure rules when you want Pi to require approval before risky local shell commands such as recursive delete, pushes, broad permission changes, or package installs.

Agent Tick returns the approval decision. Pi still decides whether to run or block the local tool call.

## Compatibility: CLI-installed Pi extension

The Agent Tick CLI also has a Pi target:

```sh
npx @self-deprecated/agent-tick install --target pi
```

That path installs a Pi extension file at `~/.pi/agent/extensions/agent-tick-sanction.ts` focused on risky shell Sanctions. Prefer `pi-agent-tick` when you want mirrored prompts, decision gates, status hooks, and configurable Pi behavior.
