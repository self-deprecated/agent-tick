---
title: API and SDK
description: Build custom Agent Tick integrations with the TypeScript SDK or HTTP API.
sidebar_label: API and SDK
---

# API and SDK

Use the SDK/API when you are building a custom integration that cannot use an existing Coding-agent Integration, MCP adapter, or CLI command.

Agents authenticate with Agent Tick `agent_...` tokens. Humans authenticate through hosted sign-in or self-hosted credentials. Workspace context is selected with `X-Agent-Tick-Workspace-ID` where applicable.

Use SDK types in `packages/sdk` and shared schemas in `packages/shared` as the source of truth.

## Install

```sh
npm install @self-deprecated/agent-tick-sdk
```

Create an Agent Token in Agent Tick and provide it to the integration environment as a secret.

## Client setup

```ts
import { AgentTickClient } from '@self-deprecated/agent-tick-sdk';

export function agentTickClient() {
  return new AgentTickClient({
    baseUrl: process.env.AGENT_TICK_SERVER ?? 'https://app.agenttick.sh',
    tokenProvider: () => process.env.AGENT_TICK_TOKEN,
    workspaceIdProvider: () => process.env.AGENT_TICK_WORKSPACE_ID
  });
}
```

## Status Update

```ts
await client.createStatusUpdate({
  message: 'Finished edits; validating now',
  state: 'working',
  nextStep: 'Run tests',
  clientName: 'Custom agent'
});
```

If your host exposes a real chat/thread/session ID, pass it as `sessionId` and optionally add `session: { title: 'Billing migration' }`. Otherwise omit `sessionId`.

## Sanction helper

```ts
import type { AgentTickClient } from '@self-deprecated/agent-tick-sdk';
import type { Choice } from '@self-deprecated/agent-tick-shared';

export type SanctionDecision = 'approved' | 'denied' | 'expired';

const choices = [
  { id: 'approve', label: 'Approve', kind: 'approve', flags: ['audit_relevant'] },
  { id: 'deny', label: 'Deny', kind: 'deny', flags: ['blocked'] }
] satisfies Choice[];

export async function requestSanction(
  client: AgentTickClient,
  input: { title: string; body?: string; command?: string; timeoutMs?: number }
): Promise<SanctionDecision> {
  const created = await client.createRequest({
    requester: { name: 'Deploy agent' },
    requestType: 'sanction',
    title: input.title,
    body: input.body,
    command: input.command,
    choices,
    defaultChoice: 'deny',
    metadata: { helper: 'requestSanction' }
  });

  const result = await client.waitForCreatedRequest(created, { timeoutMs: input.timeoutMs ?? 30 * 60_000 });
  if (!result.terminal || result.request.status === 'expired') return 'expired';
  return result.request.response?.choiceId === 'approve' ? 'approved' : 'denied';
}
```

Run the sensitive local action only after this helper returns `approved`.

## Steering helper

```ts
const choices = [
  { id: 'small_fix', label: 'Small targeted fix', kind: 'approve', flags: ['favorite'] },
  { id: 'full_refactor', label: 'Full refactor', kind: 'approve' },
  { id: 'stop', label: 'Stop', kind: 'deny', flags: ['blocked'] }
] satisfies Choice[];

const created = await client.createRequest({
  requester: { name: 'Coding agent' },
  requestType: 'steering',
  title: 'Which path should I take?',
  choices,
  defaultChoice: 'stop'
});
```

## Routing and Workspace APIs

Advanced integrations can list Workspaces, create Agent Tokens, manage Routing Rules, and send Test Activity. Keep these flows behind human/admin authorization and avoid exposing raw tokens in logs.

## Guardrails

- Keep choices finite and include a deny/escape path for Sanctions and risky Steering.
- Treat timeout and missing responses as denial or no-op.
- Use metadata only for safe routing/debug fields.
- Never include secrets, customer data, raw prompts, or full logs in Agent Tick content.
- Prefer local execution: Agent Tick collects the human response; your local process decides what to do next.
