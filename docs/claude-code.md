# Claude Code

Agent Tick can route selected Claude Code prompts through Agent Tick using local Verified Hooks installed by the CLI.

Supported launch behavior:

- `AskUserQuestion` can become Agent Tick steering.
- Claude Code `PermissionRequest` prompts can become Agent Tick sanctions.
- Agent Tick runs locally as a hook on the same machine as Claude Code.
- Approved actions still execute in Claude Code's local environment. Agent Tick does not remotely run commands.

Agent Tick does not replace Claude Code's permission model or classify every command itself. It handles the prompts Claude Code already exposes through supported hook events.

## Install

Run a dry run first:

```sh
agent-tick install --target claude --dry-run
```

Review the planned settings file, hook entries, and `Bash(agent-tick:*)` allow rule. Then install either locally for one project or globally for your Claude Code user config.

Local project install:

```sh
agent-tick install --target claude --claude-scope local
```

Global install:

```sh
agent-tick install --target claude --claude-scope global
```

Restart Claude Code after installing or changing hook configuration.

## Modes

The default interactive profile starts in pass-through mode. In pass-through mode, Claude Code behaves normally and Agent Tick does not create remote requests for those prompts.

Check or change mode:

```sh
agent-tick mode
agent-tick mode afk
agent-tick mode pass-through
```

Use AFK mode when you want configured Claude Code steering and permission prompts routed through Agent Tick.

For unattended runs, install the headless profile:

```sh
agent-tick install --target claude \
  --claude-profile headless \
  --claude-steering always \
  --claude-sanctions always \
  --claude-initial-mode afk
```

## Verify steering

Switch to AFK mode:

```sh
agent-tick mode afk
```

Ask Claude Code to use a bounded question with an escape option, for example:

```text
Ask which safe documentation-only path to take next. Offer exactly these options: Review setup wording, Review troubleshooting wording, Stop the demo. Treat Stop the demo as the escape option and do not edit files yet.
```

Expected result: Agent Tick creates a steering request and returns the selected bounded answer to Claude Code.

## Verify sanctions

Ask Claude Code for a harmless action that triggers its own permission prompt, such as reading a non-sensitive file or running `pwd` in a disposable checkout.

Expected result: Claude Code asks for permission, the Agent Tick hook creates a sanction, and Agent Tick returns allow or deny for that specific prompt. Agent Tick does not execute the command itself.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Claude Code still shows native prompts | Agent Tick is in pass-through mode, Claude Code was not restarted, or hooks were installed in a different scope. | Run `agent-tick mode afk`, restart Claude Code, and inspect the selected Claude settings file. |
| Agent Tick requests appear during pass-through | Routing policy is set to `always`. | Re-run installer dry-run and review `--claude-steering` / `--claude-sanctions`. |
| Agent Tick hook triggers a permission loop | Missing `Bash(agent-tick:*)` allow rule. | Re-run installer dry-run and add the specific allow rule. |
| Hook fails closed | Agent Tick CLI setup/token is missing or the server is unreachable. | Run `agent-tick install`, `agent-tick setup --login`, or `agent-tick setup --server ... --token ...`. |
