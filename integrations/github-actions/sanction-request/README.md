# Agent Tick GitHub Action

Add a bounded human Sanction Request checkpoint to a GitHub Actions workflow. The action creates an Agent Tick Sanction Request, waits for the reviewer Response, and returns normalized outputs so later workflow steps can branch safely.

Agent Tick does **not** run your deploy, refund, migration, or release command. GitHub Actions remains the execution environment; Agent Tick only records and routes the Response decision.

## Marketplace summary

- **Action name:** Agent Tick Sanction
- **Use case:** pause a workflow until a human responds to a bounded action
- **Best fit:** production deploys, database migrations, release gates, high-risk automation, and AI-agent workflow checkpoints
- **Security model:** use a GitHub secret containing an Agent Tick `agent_...` token; never put tokens in workflow logs or request text

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `server` | yes | — | Agent Tick app/API server URL, for example `https://app.agenttick.sh` or a self-hosted URL. |
| `token` | yes | — | Agent Tick agent token stored as a GitHub secret. |
| `title` | yes | — | Short reviewer-facing request title. |
| `body` | no | `""` | Reviewer guidance. Keep it concise and avoid secrets or raw logs. |
| `command` | no | `""` | Safe command/action summary for the reviewer. Do not include credentials. |
| `timeout` | no | `10m` | How long the CLI should wait, such as `30s`, `10m`, or `1h`. |
| `install-cli` | no | `true` | Install `@self-deprecated/agent-tick` with npm if `agent-tick` is not already on `PATH`. |

## Outputs

| Output | Description |
| --- | --- |
| `request-id` | Agent Tick Request id. |
| `status` | Final Agent Tick request status returned by the CLI. |
| `choice-id` | Final selected choice id when present, commonly `approve` or `deny`. |

The action exits with the same status code as `agent-tick sanction`. A denial or timeout should fail the guarded job unless your workflow catches the result and branches explicitly.

## Example

```yaml
name: gated-deploy

on:
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Wait for Agent Tick Sanction Response
        id: sanction
        uses: self-deprecated/agent-tick/integrations/github-actions/sanction-request@v1.0.0
        with:
          server: ${{ secrets.AGENT_TICK_SERVER }}
          token: ${{ secrets.AGENT_TICK_TOKEN }}
          title: Deploy production?
          body: ${{ github.repository }} @ ${{ github.sha }}
          command: ./scripts/deploy.sh
          timeout: 10m

      - name: Deploy
        if: ${{ steps.sanction.outputs.choice-id == 'approve' }}
        run: ./scripts/deploy.sh
```

## Safe request text

Prefer bounded summaries:

- repository and commit SHA
- environment and service name
- release notes or runbook links
- rollback plan or migration id

Do not include:

- secrets, bearer tokens, private keys, cookies, or `.env` files
- full command output or logs
- raw AI prompts/transcripts
- customer data beyond what the reviewer needs

## Setup checklist

1. Create or choose an Agent Tick server: hosted `https://app.agenttick.sh` or self-hosted.
2. Create an Agent Tick agent token and store it in `AGENT_TICK_TOKEN`.
3. Store the API URL in `AGENT_TICK_SERVER`.
4. Add this action before the protected workflow step.
5. Keep the protected command in GitHub Actions, not inside Agent Tick.

For broader integration docs, see [`docs/integrations.md`](../../../docs/integrations.md). For a release-specific gate with tag, SHA, changelog, and timeout guidance, see [`docs/github-actions-release-sanction-tutorial.md`](../../../docs/github-actions-release-sanction-tutorial.md).
