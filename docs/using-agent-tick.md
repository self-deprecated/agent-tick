# Using Agent Tick

Agent Tick can be used as a managed product or as a self-hosted service.

- Managed product website: <https://agenttick.sh>
- Self-hosting guide: [SELFHOSTING.md](../SELFHOSTING.md)

## Managed product flow

Use the managed product when you do not want to operate the server, database, dashboard, or mobile push infrastructure yourself.

1. Install the CLI on macOS, Linux, or Windows:

   ```sh
   npm install -g @self-deprecated/agent-tick
   ```

   You can also run one-off commands with `npx @self-deprecated/agent-tick ...`.
2. Go to <https://agenttick.sh> and sign in.
3. Run the CLI browser setup command on the machine or agent host that needs approvals:

   ```sh
   agent-tick setup --login --server https://agenttick.sh
   ```

   The CLI starts a localhost callback, opens the dashboard in your browser, and waits. After you sign in and click **Authorize CLI setup**, the dashboard creates an Agent Tick `agent_...` token and posts it back to the CLI. The token is saved in `~/.config/agent-tick/config.json` by default.
4. Install/open the Agent Tick mobile app from your workspace's TestFlight link and sign in with the same account. Mobile is the primary approval surface.
5. Wrap sensitive actions with `agent-tick request` or `agent-tick guard`.
6. Review requests in the mobile app or, secondarily, the dashboard.

Current CLI commands:

```sh
agent-tick setup --login
agent-tick setup --server https://agenttick.sh --token agent_... # manual/CI setup
agent-tick request --title "Deploy production?" --body "Deploy commit abc123" --command "deploy production"
agent-tick request --title "Which rollout?" --choice canary="Canary" --choice cancel:deny="Cancel"
agent-tick guard --title "Run migration?" -- ./migrate.sh
agent-tick abandon req_...
```

For local repository development without a global npm install, run `node scripts/bootstrap.mjs`, then use `corepack pnpm --filter @self-deprecated/agent-tick exec agent-tick ...`.

## Mobile app access

Mobile approvals are the intended day-to-day review surface. During the current iOS beta, ask your workspace owner for the Agent Tick TestFlight invite link, install the app, and sign in with the same account you used for the dashboard. After sign-in, keep notifications enabled so approval requests arrive as push notifications. The web dashboard remains available as a backup approval surface.

For self-hosted servers, enter your server URL in the mobile app if prompted. Use the same public URL you configured as `AGENT_TICK_PUBLIC_URL`.

## Self-hosted flow

Use self-hosting when you want Agent Tick on your own infrastructure.

1. Choose `single` mode for a local/single-admin deployment or `clerk` mode for multi-user human sign-in.
2. Set `AGENT_TICK_PUBLIC_URL` to your deployment URL.
3. Start the Docker Compose stack.
4. Install the CLI with `npm install -g @self-deprecated/agent-tick`.
5. In Clerk mode, run `agent-tick setup --login --server <your-url>` and authorize setup in the browser. In single mode or CI, create an agent token in the dashboard and run `agent-tick setup --server <your-url> --token agent_...`.
6. Sign in to mobile for approvals, then configure agents or CI jobs to use `agent-tick request` or `agent-tick guard`.

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
