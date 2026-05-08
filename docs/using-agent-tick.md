# Using Agent Tick

Agent Tick can be used as a managed product or as a self-hosted service.

- Managed product website: <https://agenttick.sh>
- Self-hosting guide: [SELFHOSTING.md](../SELFHOSTING.md)

## Managed product flow

Use the managed product when you do not want to operate the server, database, dashboard, or mobile push infrastructure yourself.

1. Go to <https://agenttick.sh>.
2. Sign in and create or select your organization.
3. Create an agent token for each agent host, CI workflow, or automation context that needs to request approvals.
4. Configure the CLI with the hosted Agent Tick server URL and the generated `agent_...` token.
5. Wrap sensitive actions with `agent-tick request` or `agent-tick guard`.
6. Review requests in the dashboard or mobile app.

Current CLI commands:

```sh
agent-tick setup --server https://agenttick.sh --token agent_...
agent-tick request --title "Deploy production?" --body "Deploy commit abc123" --command "deploy production"
agent-tick guard --title "Run migration?" -- ./migrate.sh
agent-tick abandon req_...
```

The npm CLI package is not yet published from this repository. Until publishing is enabled, repository examples that can be run today use the workspace-built CLI with `corepack pnpm --filter agent-tick exec agent-tick ...`.

## Self-hosted flow

Use self-hosting when you want Agent Tick on your own infrastructure.

1. Choose `single` mode for a local/single-admin deployment or `clerk` mode for multi-user human sign-in.
2. Set `AGENT_TICK_PUBLIC_URL` to your deployment URL.
3. Start the Docker Compose stack.
4. Create an agent token in the dashboard.
5. Configure agents or CI jobs with that token.

See [SELFHOSTING.md](../SELFHOSTING.md) for environment variables, Docker commands, backup notes, and security guidance.

## What Agent Tick owns

Even when Clerk is enabled, Agent Tick owns product authorization and data:

- local organizations and memberships
- teams and approval policies
- approval requests and responses
- agent tokens
- device registrations and notification routing
- audit logs
- local billing/seat-limit state

Clerk is only the human identity provider.

## Current integration surface

Implemented today:

- `agent-tick setup`
- `agent-tick request`
- `agent-tick guard`
- `agent-tick abandon`
- dashboard approvals
- mobile approvals and push registration
- GitHub Actions composite action that expects `agent-tick` on `PATH`
- optional outbound approval notification webhook

Not currently implemented:

- MCP server command
- JSON stdin adapter command
- steering command
- Slack/Teams/SMTP-specific notification providers

Those surfaces should be documented only when implementation and tests are added.
