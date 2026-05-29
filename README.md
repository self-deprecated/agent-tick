# Agent Tick

**Least-permission approvals for coding agents.**

Agent Tick routes **Status Updates, Steering, and Sanctions** from local coding agents to trusted humans without turning the Native App, hosted service, or Personal Console into a remote shell.

Product surfaces:

- Marketing site: <https://agenttick.sh>
- Hosted app/API: <https://app.agenttick.sh>
- Documentation: <https://docs.agenttick.sh>

## Start here

Most users should use the hosted service at <https://app.agenttick.sh>.

For the smoothest setup, paste this prompt into your coding agent chat on the machine you want to configure:

```text
Fetch and follow the Agent Tick setup skill from:
https://agenttick.sh/skill.md

Use that skill to set up Agent Tick on this machine. Ask me which coding agent I am using and what kind of work I want routed Requests for. Walk me through enabling status updates, steering, and sanctions, and let me opt out of any of the three. Use the right integration for this agent, run a dry run first, explain what will change, then install after I confirm and verify it works.
```

The linked prompt-based skill flow works even when the target machine does not have this repo cloned. It inspects your agent configuration, chooses the right integration path, runs a dry run, explains exactly what will change, asks for confirmation, installs, and verifies.

If you prefer direct CLI configuration, run the installer on the machine where your coding agents run:

```sh
npx @self-deprecated/agent-tick install
```

To only sign in and save a local token without installing integrations yet:

```sh
npx @self-deprecated/agent-tick login
```

The installer opens Agent Tick in your browser, connects this machine to your hosted Agent Tick account, detects local AI coding agents, and installs supported integrations where available: Claude Code and Codex via MCP Adapter, optional Claude Code permission hooks, and Pi as a Native Extension. Other detected agents are shown as disabled scaffolds until their hook/config path is verified.

If you prefer a global install:

```sh
npm install -g @self-deprecated/agent-tick
agent-tick install
```

After setup, agents can ask for a sanction before sensitive work:

```sh
agent-tick sanction \
  --title "Deploy production?" \
  --body "Deploy commit abc123 to production." \
  --command "deploy production"
```

Or include a local command in a Sanction Request:

```sh
agent-tick sanction --title "Run migration?" -- ./migrate.sh
```

Agents can ask steering questions with structured choices:

```sh
agent-tick steering \
  --title "Which rollout?" \
  --choice canary="Canary" \
  --choice blue_green="Blue/green" \
  --choice cancel:deny="Cancel" \
  --choice-flag canary=favorite
```

Choice flags add mobile-visible cues. For example, `favorite` shows a yellow star; sanction approve choices can also be marked with warnings such as `production`, `destructive`, or `security_sensitive`.

Agents can send lightweight Status Updates that appear in Agent Tick:

```sh
AGENT_TICK_SESSION_ID=codex_019e9c78-ab9c-73b0-b21c-ce18a32c8499 \
  agent-tick status-update --session-title "Release prep" --state working --next "Run the build" "Tests are passing; checking packaging next"
```

Use a Session ID only when it is a real host chat/thread/session ID, with an optional Session title/label when the integration knows a useful chat/run name. If no real host chat ID is available, omit explicit `sessionId` and let Agent Tick group best-effort by source metadata such as agent/client name, host, and working directory. Do not generate random Session IDs for generic CLI/MCP calls. `working`, `waiting`, `blocked`, `done`, and `failed` are the semantic Status Update states. Custom state strings are still accepted for compatibility, but they are display-only; use the message or safe metadata for custom reasons. Do not send `waiting` just because the agent created an Agent Tick Request — the Request itself is the waiting signal.

## What gets installed?

`agent-tick install` does two things:

1. Runs browser-based CLI configuration against hosted Agent Tick by default, or the server passed with `--server`, and saves an Agent Tick `agent_...` token locally in `~/.config/agent-tick/config.json`.
2. Detects local agent configs and installs supported integrations:
   - Claude Code: MCP Adapter support through `agent-tick mcp` for Status Updates, Steering, and model/tool-driven Sanctions. Optional hooks can route Claude Code native `PermissionRequest` prompts through Agent Tick.
   - Codex: MCP Adapter support through `agent-tick mcp`.
   - Pi: Native Extension support via the repo-maintained extension from `packages/cli/assets/pi/agent-tick-sanction.ts`; see [docs/pi.md](./docs/pi.md).
   - Gemini, Cursor, OpenCode, generic `AGENTS.md`: detected and shown as disabled scaffolds until their hook/config behavior is verified.

Useful installer options. Omit `--server` for hosted Agent Tick; pass it only for self-hosted or custom deployments.

```sh
agent-tick install --target claude --target codex
agent-tick install --all
agent-tick install --dry-run
agent-tick install --server https://tick.example.com
agent-tick install --target claude --claude-scope local
agent-tick install --target claude --claude-scope global
agent-tick install --target claude --claude-permission-hook
agent-tick install --target claude --remove-claude-hooks
```

## Self-hosting

Agent Tick is source-available and self-hostable. That matters for trust, privacy, and Workspaces that need to operate Agent Tick Request routing on their own infrastructure.

Self-hosting is not the default onboarding path. If you want it, use [SELFHOSTING.md](./SELFHOSTING.md).

## What is in this repo

- Fastify API server
- Svelte Personal Console served by the server
- Expo mobile app
- `agent-tick` CLI with `install`, `config`, `login`, `mode`, `mcp`, `sanction`, `steering`, `abandon`, and `status-update`
- SQLite persistence
- optional Clerk human authentication for multi-user mode
- Agent Tick Workspaces, Routing Rules, Agent Activity, Activity History, Approval Devices, and Agent Tokens

Clerk, when enabled, is the human identity provider and may back Shared Workspace membership. Agent Tick owns routing, Agent Activity, Agent Tokens, Approval Devices, and authorization state.

## Development

Development details are in [DEVELOPMENT.md](./DEVELOPMENT.md). Contribution and public mirror policy is in [CONTRIBUTING.md](./CONTRIBUTING.md). A local contributor can bootstrap the repo with:

```sh
corepack pnpm install
corepack pnpm build
```

## Documentation

- [docs/index.md](./docs/index.md) — public documentation source for docs.agenttick.sh
- [docs/quick-start.md](./docs/quick-start.md) — connect a machine and send safe test requests
- [docs/integrations.md](./docs/integrations.md) — public integration setup guides
- [docs/self-hosting.md](./docs/self-hosting.md) — self-hosting guide used by the docs site
- [SELFHOSTING.md](./SELFHOSTING.md) — full repository-level self-hosting reference
- [DEVELOPMENT.md](./DEVELOPMENT.md) — local development workflow

## License

Agent Tick is source-available under the [Business Source License 1.1](./LICENSE) (BSL 1.1). You may use, modify, and self-host it internally — including for commercial purposes — but you may not offer Agent Tick as a hosted or managed service to third parties. The license converts to Apache 2.0 on 2028-05-31.
