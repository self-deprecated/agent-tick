# Integrations

Agent Tick already supports the CLI, `guard`, `steer`, JSON `adapter`, and the Claude Code questionnaire hook. This document adds practical patterns for extra sinks and connectors.

## Outbound notification sinks

These sinks notify other systems when a new approval request is created. They do **not** replace the existing mobile push flow; they run alongside it.

### Generic webhooks

Send the full request JSON plus a dashboard URL to one or more endpoints:

```sh
AGENT_TICK_WEBHOOK_URLS=https://hooks.example.com/agent-tick,https://ops.example.com/tick
```

Payload shape:

```json
{
  "event": "approval.created",
  "dashboardUrl": "https://tick.example.com/#approvals",
  "request": {
    "id": "req_...",
    "title": "Deploy production?"
  }
}
```

### Slack incoming webhooks

Post a rich message with the request title, requester, details, and a button back to the dashboard:

```sh
AGENT_TICK_SLACK_WEBHOOK_URLS=https://hooks.slack.com/services/...
```

### Slack DM

Send direct messages through a bot token to fixed Slack user IDs:

```sh
AGENT_TICK_SLACK_BOT_TOKEN=xoxb-...
AGENT_TICK_SLACK_DM_USER_IDS=U01234567,U08999999
```

The server opens a DM and sends the same approval summary used for Slack webhook messages.

### Microsoft Teams incoming webhooks

Post a MessageCard with an **Open Agent Tick** action:

```sh
AGENT_TICK_TEAMS_WEBHOOK_URLS=https://example.webhook.office.com/webhookb2/...
```

### Email via SMTP

Send plain-text approval summaries to one or more inboxes:

```sh
AGENT_TICK_EMAIL_SMTP_ADDR=smtp.example.com:587
AGENT_TICK_EMAIL_SMTP_USERNAME=agent-tick
AGENT_TICK_EMAIL_SMTP_PASSWORD=...
AGENT_TICK_EMAIL_FROM=tick@example.com
AGENT_TICK_EMAIL_TO=ops@example.com,oncall@example.com
```

If your SMTP relay allows unauthenticated local delivery, omit the username/password.

## Connector examples

### GitHub Actions

This repo now includes a composite action at [`integrations/github-actions/request-approval/action.yml`](../integrations/github-actions/request-approval/action.yml).

Use it from a workflow:

```yaml
- name: Wait for approval
  uses: self-deprecated/agent-tick/integrations/github-actions/request-approval@v0.1.0
  with:
    server: ${{ secrets.AGENT_TICK_SERVER }}
    token: ${{ secrets.AGENT_TICK_TOKEN }}
    title: Deploy production?
    body: ${{ github.repository }} @ ${{ github.sha }}
    command: gh workflow run deploy
```

The action waits for the final decision and exposes `request-id`, `status`, and `choice-id` outputs. A fuller example lives in [`examples/github-actions/approval-gate.yml`](../examples/github-actions/approval-gate.yml).

### MCP

This repo now includes a minimal MCP stdio server:

```sh
agent-tick mcp
```

It exposes three tools:

- `request_approval`
- `request_steer`
- `abandon_request`

For hosts that already emit Agent Tick-shaped JSON, the older adapter path still works too:

```sh
printf '{"title":"Run migration?","command":"atlas migrate apply"}' | agent-tick adapter
```

A small wrapper example lives in [`examples/mcp/README.md`](../examples/mcp/README.md).

## Security notes

- Treat third-party sinks as external disclosure boundaries.
- Do not send secrets in request titles, bodies, commands, or metadata.
- Prefer a short summary plus the dashboard link when routing to Slack, Teams, email, or generic webhooks.
- Set `AGENT_TICK_PUBLIC_URL` so generated links point at the correct dashboard origin.
