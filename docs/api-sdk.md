---
title: API and SDK
description: Use the Agent Tick TypeScript SDK or HTTP API from custom integrations.
sidebar_label: API and SDK
---

# API and SDK

Agent Tick exposes a TypeScript SDK and HTTP API used by the CLI, Personal Console, mobile apps, and integrations.

Launch SDK surfaces include:

- Request create/list/get/respond/wait/abandon
- Activity list/history and pending Request count
- Status Update create/list
- Workspace list/create/member helpers
- Agent Token setup and management
- Routing Rule management and test Activity
- Approval Device registration and push token management
- Entitlement Status, product catalog, personal billing update, and purchase preflight helpers for the first-party mobile app

Agents authenticate with Agent Tick `agent_...` tokens. Humans authenticate through local single-mode admin/device credentials or hosted Clerk-backed sessions. Workspace context is selected with `X-Agent-Tick-Workspace-ID` where applicable.

Use SDK types in `packages/sdk` and shared schemas in `packages/shared` as the source of truth. See [Session identity](./session-identity.md) before setting `sessionId` manually.

## Install

```sh
npm install @self-deprecated/agent-tick-sdk
```

Create an `agent_...` token in the Agent Tick dashboard, then provide it as an environment variable or secret in the environment where your integration runs.

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

Agent Tokens are secrets. Do not place Request bodies, commands, choices, or other sensitive content in logs or analytics.

## Minimal status update

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

Use Sanctions when the local agent is about to perform a bounded sensitive action and needs an explicit human Response. Always include a deny choice.

```ts
import type { AgentTickClient } from '@self-deprecated/agent-tick-sdk';
import type { Choice } from '@self-deprecated/agent-tick-shared';

export type SanctionDecision = 'approved' | 'denied' | 'expired';

const sanctionChoices = [
  { id: 'approve', label: 'Approve', kind: 'approve', flags: ['production', 'audit_relevant'] },
  { id: 'deny', label: 'Deny', kind: 'deny', flags: ['blocked'] }
] satisfies Choice[];

export async function requestSanction(client: AgentTickClient, input: { title: string; body?: string; command?: string; timeoutMs?: number }): Promise<SanctionDecision> {
  const created = await client.createRequest({
    requester: { name: 'Deploy agent' },
    requestType: 'sanction',
    title: input.title,
    body: input.body,
    command: input.command,
    choices: sanctionChoices,
    defaultChoice: 'deny',
    metadata: { helper: 'requestSanction' }
  });

  const result = await client.waitForCreatedRequest(created, { timeoutMs: input.timeoutMs ?? 30 * 60_000 });
  if (!result.terminal || result.request.status === 'expired') return 'expired';
  return result.request.response?.choiceId === 'approve' ? 'approved' : 'denied';
}
```

Run the sensitive local action only after this helper returns `approved`. Agent Tick collects the human Response; it does not execute the command remotely.

## Steering helper

Use Steering when the agent needs the human to choose between known next steps.

```ts
import type { AgentTickClient } from '@self-deprecated/agent-tick-sdk';
import type { Choice } from '@self-deprecated/agent-tick-shared';

export type SteeringChoice = 'small_fix' | 'full_refactor' | 'stop';

const steeringChoices = [
  { id: 'small_fix', label: 'Small targeted fix', kind: 'approve', flags: ['safest'] },
  { id: 'full_refactor', label: 'Full refactor', kind: 'approve', flags: ['experimental'] },
  { id: 'stop', label: 'Stop and preserve current changes', kind: 'deny', flags: ['blocked'] }
] satisfies Choice[];

export async function askSteering(client: AgentTickClient, input: { title: string; body?: string; timeoutMs?: number }): Promise<SteeringChoice | 'expired'> {
  const created = await client.createRequest({
    requester: { name: 'Coding agent' },
    requestType: 'steering',
    title: input.title,
    body: input.body,
    choices: steeringChoices,
    defaultChoice: 'stop'
  });

  const result = await client.waitForCreatedRequest(created, { timeoutMs: input.timeoutMs ?? 15 * 60_000 });
  if (!result.terminal || result.request.status === 'expired') return 'expired';
  const choice = result.request.response?.choiceId;
  return choice === 'small_fix' || choice === 'full_refactor' || choice === 'stop' ? choice : 'expired';
}
```

## External Approvers and Audience Channels

Shared Workspace admins can add constrained External Approvers for one-customer approval routes. A typical backend flow creates an invite, has the customer accept it in Agent Tick, creates a single-recipient Routing Rule for that customer, then creates an Agent Token bound to that recipient.

```ts
const approver = await client.createExternalApprover({
  displayName: 'Jane Customer',
  externalSubject: 'customer_123'
});
const invite = await client.createExternalApproverInviteForApprover(approver.externalApproverId);
// Show invite.qrPayload or invite.deepLink to the customer.

await client.acceptExternalApproverInvite(invite.token);
const token = await client.createExternalApproverBoundAgentToken(approver.externalApproverId);
```

For lower-level setup, you can still compose the pieces directly:

```ts
const route = await client.createRoutingRule({
  workspaceId: 'wsp_123',
  name: 'Jane Customer approvals',
  recipientUserIds: ['usr_jane'],
  requiredResponseMode: 'any_one',
  requiredResponseCount: 1
});

const token = await client.createAgentToken({
  workspaceId: 'wsp_123',
  label: 'Legal AI for Jane',
  routingRuleId: route.routingRuleId,
  boundRecipientUserId: 'usr_jane'
});
```

Audience Channels are for public-safe Steering polls. Audience Requests must use `deliveryKind: 'audience_channel'`, `requestType: 'steering'`, `responsePolicy: 'deadline_plurality'`, and `closesAt`; they cannot include commands.

```ts
const channel = await client.createAudienceChannel({
  workspaceId: 'wsp_123',
  name: 'Roadmap votes',
  slug: 'roadmap',
  visibility: 'public'
});
await client.subscribeToAudienceChannel(channel.channelId);

await client.createRequest({
  requester: { name: 'Roadmap agent' },
  requestType: 'steering',
  deliveryKind: 'audience_channel',
  audienceChannelId: channel.channelId,
  responsePolicy: 'deadline_plurality',
  closesAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  title: 'What should the agent work on next?',
  choices: [
    { id: 'external_approvers', label: 'External Approvers', kind: 'approve' },
    { id: 'mobile_widgets', label: 'Mobile widgets', kind: 'approve' },
    { id: 'stop', label: 'Do nothing', kind: 'deny' }
  ],
  defaultChoice: 'stop'
});
```

## Activity and Routing Rules

```ts
const workspaces = await client.listWorkspaces();
const activity = await client.listActivity({ workspaceId: workspaces[0]?.workspaceId, limit: 50 });
const pending = await client.getPendingRequestCount();
const rule = await client.createRoutingRule({
  workspaceId: workspaces[0].workspaceId,
  name: 'Backend routing',
  recipientUserIds: ['usr_123'],
  requiredResponseMode: 'any_one',
  requiredResponseCount: 1
});
await client.sendTestActivity({ kind: 'sanction', context: 'routing_rule', routingRuleId: rule.routingRuleId });
```

## Guardrails

- Keep choices finite and include a `kind: 'deny'` escape path for Sanctions and risky Steering.
- Treat timeouts, expiration, and missing Responses as denial or no-op.
- Use External Approvers for private customer/client decisions and Audience Channels only for public-safe Steering.
- Never include secrets, bearer tokens, private customer data, raw prompt text, or full environment files in titles, bodies, commands, choices, metadata, diagnostics, or analytics.
- Use `metadata` only for safe routing/debug fields such as helper name, request class, client key, or correlation ID.
- Prefer local execution: Agent Tick collects the human Response; your local process decides what to do next.
