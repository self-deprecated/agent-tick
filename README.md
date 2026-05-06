# Agent Tick

Agent Tick is an approval broker for agent systems. An agent submits a request; your phone shows it; you approve or deny; the agent continues.

You currently need to run your own Agent Tick server. A hosted option is planned. See [SELFHOSTING.md](./SELFHOSTING.md) to get one running in minutes.

## Install

**macOS:**

```bash
brew install self-deprecated/tap/agent-tick
```

**Windows:**

```bash
scoop bucket add self-deprecated https://github.com/self-deprecated/scoop-bucket
scoop install self-deprecated/agent-tick
```

**Linux:**

```bash
curl -sSL https://raw.githubusercontent.com/self-deprecated/agent-tick/main/install.sh | bash
```

**Go:**

```bash
go install github.com/self-deprecated/agent-tick/apps/server/cmd/agent-tick@latest
```

## Quick Start

**1. Pair your phone**

Open the dashboard at your server URL, sign in, and open the **Devices** panel. Click **Create QR**, then in the Agent Tick phone app open Settings → **Scan Pairing QR**.

**2. Create an agent token**

In the dashboard, open the **Agents** panel and click **Create Agent Token**. Run the shown setup command on the machine where your agent runs:

```bash
agent-tick setup --server <your-server-url> --token agent_...
```

**3. Send an approval request**

```bash
agent-tick request \
  --title "Run command?" \
  --body "codex wants to run npm install" \
  --command "npm install"
```

Your phone shows the request. Approve or deny. The CLI returns with the decision.

**4. Guard a command**

```bash
agent-tick guard -- npm install
```

The command only runs after you approve on your phone.

**5. Ask for steering without freeform text**

```bash
agent-tick steer \
  --title "How should I continue?" \
  --option run-tests:"Run tests and fix failures" \
  --option update-docs:"Update README/docs"
```

Your phone shows only the supplied options plus **Do nothing / skip**. The CLI prints only the selected option ID, or `none` on skip, timeout, expiry, or delivery failure.

Requests are grouped in the mobile app by project. The CLI defaults the project to the current machine and working directory; override the display name with `--project` and the grouping directory with `--project-dir`. Team-aware servers can also use `--project-id` / `AGENT_TICK_PROJECT_ID`, `--team` / `AGENT_TICK_TEAM`, and `--approval-policy` / `AGENT_TICK_APPROVAL_POLICY` routing hints.

Team-aware servers can attach approval policies to projects or agent tokens. Simple requests still need one response, while policy-backed requests can require an owner, any team member, a quorum, an on-call approver, the most recently active available teammate, or an ordered multi-step flow. The phone app shows who is responsible, quorum progress, availability controls, and vote history; the CLI keeps waiting until the policy reaches its final approved or denied decision.

## How It Works

An agent calls `agent-tick request`, `agent-tick guard`, or `agent-tick steer`. The CLI sends the request to the server and polls for a response. The server pushes the request to your paired phone. You approve, deny, or select a constrained steering option. The server returns the decision to the CLI, and the agent continues.

The server can also fan out new requests to extra notification sinks such as generic webhooks, Slack, Slack DM, Microsoft Teams, and SMTP email while keeping the existing mobile push flow. For connector-style integrations, the repo also includes a GitHub Actions composite action and an MCP stdio server.

## Agent Skill

This repo includes a Codex-compatible skill at `skills/agent-tick`. Install it into your agent's skills directory so the agent knows when to call `agent-tick guard`, `agent-tick request`, and `agent-tick setup`.

## License

agent-tick is licensed under the [Business Source License 1.1](./LICENSE) (BSL 1.1). You are free to use, modify, and self-host it — including for commercial purposes — but you may not offer agent-tick as a hosted or managed service to third parties. The license converts to Apache 2.0 on 2028-04-18.

---

- [SELFHOSTING.md](./SELFHOSTING.md) — run your own Agent Tick server
- [docs/integrations.md](./docs/integrations.md) — Slack, Teams, webhooks, email, GitHub Actions, and MCP patterns
- [DEVELOPMENT.md](./DEVELOPMENT.md) — contributing and building from source
