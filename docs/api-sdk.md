# API/SDK

Agent Tick exposes a TypeScript SDK and HTTP API used by the CLI, dashboard, Native App, and integrations.

Launch SDK surfaces include:

- approval request create/list/respond/wait/abandon
- status update create/list
- agent token setup and management
- device registration and push token management
- organization, team, project, invite, and availability management

Agents authenticate with Agent Tick `agent_...` tokens. Humans authenticate through local single-mode admin/device credentials or hosted Clerk-backed sessions. Organization context is selected with `X-Agent-Tick-Organization-ID` where applicable.

Use the SDK types in `packages/sdk` and shared schemas in `packages/shared` as the source of truth for request/response shapes.
