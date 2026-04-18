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

## How It Works

An agent calls `agent-tick request` or `agent-tick guard`. The CLI sends the request to the server and polls for a response. The server pushes the request to your paired phone. You approve or deny. The server returns the decision to the CLI, and the agent continues.

## Agent Skill

This repo includes a Codex-compatible skill at `skills/agent-tick`. Install it into your agent's skills directory so the agent knows when to call `agent-tick guard`, `agent-tick request`, and `agent-tick setup`.

## License

agent-tick is licensed under the [Business Source License 1.1](./LICENSE) (BSL 1.1). You are free to use, modify, and self-host it — including for commercial purposes — but you may not offer agent-tick as a hosted or managed service to third parties. The license converts to Apache 2.0 on 2028-04-18.

---

- [SELFHOSTING.md](./SELFHOSTING.md) — run your own Agent Tick server
- [DEVELOPMENT.md](./DEVELOPMENT.md) — contributing and building from source
