# @agent-tick/sdk

TypeScript HTTP client for Agent Tick.

```ts
import { AgentTickClient } from '@agent-tick/sdk';

const client = new AgentTickClient({
  baseUrl: process.env.AGENT_TICK_SERVER ?? 'https://app.agenttick.sh',
  tokenProvider: () => process.env.AGENT_TICK_TOKEN,
  workspaceIdProvider: () => process.env.AGENT_TICK_WORKSPACE_ID
});
```

Agents authenticate with Agent Tick `agent_...` tokens. Humans use the local self-hosted session/device credentials or hosted Clerk-backed sessions. Do not send secrets in request titles, bodies, commands, metadata, diagnostics, or logs.

See <https://docs.agenttick.sh> for API and integration docs.
