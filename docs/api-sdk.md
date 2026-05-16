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

## Typed helper patterns

The SDK intentionally exposes low-level request primitives. Integration code should wrap those primitives in small typed helpers so each call site stays bounded, privacy-safe, and easy to audit.

### Client setup

```ts
import { AgentTickClient } from '@agent-tick/sdk';

export function agentTickClient() {
  return new AgentTickClient({
    baseUrl: process.env.AGENT_TICK_SERVER ?? 'https://api.agenttick.sh',
    tokenProvider: () => process.env.AGENT_TICK_TOKEN,
    organizationIdProvider: () => process.env.AGENT_TICK_ORGANIZATION_ID
  });
}
```

Agent tokens should be treated as secrets. Do not place request bodies, commands, choices, or approval content in logs or analytics.

### Sanction helper

Use sanctions when the local agent is about to perform a bounded sensitive action and needs explicit human approval. Always include a deny choice, and keep the command/body descriptive rather than secret-bearing.

```ts
import type { AgentTickClient } from '@agent-tick/sdk';
import type { Choice } from '@agent-tick/shared';

export type SanctionDecision = 'approved' | 'denied' | 'expired';

const sanctionChoices = [
  {
    id: 'approve',
    label: 'Approve',
    kind: 'approve',
    flags: ['production', 'audit_relevant']
  },
  {
    id: 'deny',
    label: 'Deny',
    kind: 'deny',
    flags: ['blocked']
  }
] satisfies Choice[];

export async function requestSanction(
  client: AgentTickClient,
  input: {
    title: string;
    body?: string;
    command?: string;
    timeoutMs?: number;
  }
): Promise<SanctionDecision> {
  const created = await client.createApprovalRequest({
    requester: { name: 'Deploy agent' },
    requestType: 'sanction',
    title: input.title,
    body: input.body,
    command: input.command,
    choices: sanctionChoices,
    defaultChoice: 'deny',
    metadata: { helper: 'requestSanction' }
  });

  const result = await client.waitForApproval(created.request.id, {
    timeoutMs: input.timeoutMs ?? 30 * 60_000
  });

  if (!result.terminal || result.request.status === 'expired') return 'expired';
  return result.request.response?.choiceId === 'approve' ? 'approved' : 'denied';
}
```

Run the sensitive local action only after this helper returns `approved`. The phone or hosted service returns a bounded decision; it does not execute the command remotely.

### Steering helper

Use steering when the agent needs the human to choose between known next steps. Prefer fixed choices over freeform input, and include a safe escape choice when a bad state is possible.

```ts
import type { AgentTickClient } from '@agent-tick/sdk';
import type { Choice } from '@agent-tick/shared';

export type SteeringChoice = 'small_fix' | 'full_refactor' | 'stop';

const steeringChoices = [
  {
    id: 'small_fix',
    label: 'Small targeted fix',
    kind: 'approve',
    description: 'Change only the failing path and keep risk low.',
    flags: ['safest']
  },
  {
    id: 'full_refactor',
    label: 'Full refactor',
    kind: 'approve',
    description: 'Clean up the surrounding code while fixing the issue.',
    flags: ['experimental']
  },
  {
    id: 'stop',
    label: 'Stop and preserve current changes',
    kind: 'deny',
    flags: ['blocked']
  }
] satisfies Choice[];

export async function askSteering(
  client: AgentTickClient,
  input: {
    title: string;
    body?: string;
    timeoutMs?: number;
  }
): Promise<SteeringChoice | 'expired'> {
  const created = await client.createApprovalRequest({
    requester: { name: 'Coding agent' },
    requestType: 'steering',
    title: input.title,
    body: input.body,
    choices: steeringChoices,
    defaultChoice: 'stop',
    metadata: { helper: 'askSteering' }
  });

  const result = await client.waitForApproval(created.request.id, {
    timeoutMs: input.timeoutMs ?? 15 * 60_000
  });

  if (!result.terminal || result.request.status === 'expired') return 'expired';
  const choice = result.request.response?.choiceId;
  return choice === 'small_fix' || choice === 'full_refactor' || choice === 'stop' ? choice : 'expired';
}
```

### Questionnaire steering

For multi-question steering, send `questions` instead of open-ended prompt text. Keep options bounded and avoid secrets in labels or descriptions.

```ts
const created = await client.createApprovalRequest({
  requester: { name: 'Release agent' },
  requestType: 'steering',
  title: 'Choose release plan',
  questions: [
    {
      header: 'Rollout',
      question: 'Which deployment window should we use?',
      options: [{ label: 'Now' }, { label: 'After business hours' }]
    },
    {
      header: 'Checks',
      question: 'Which extra checks should run first?',
      multiSelect: true,
      options: [{ label: 'Smoke tests' }, { label: 'Database backup' }]
    }
  ]
});

const result = await client.waitForApproval(created.request.id, { timeoutMs: 15 * 60_000 });
const answers = result.request.response?.answers ?? {};
```

### Helper guardrails

- Keep choices finite and include a `kind: 'deny'` escape path for sanctions and risky steering.
- Treat timeouts, expiration, and missing responses as denial or no-op.
- Never include secrets, bearer tokens, private customer data, or raw unreviewed prompt text in titles, bodies, commands, choices, metadata, diagnostics, or analytics.
- Use `metadata` only for safe routing/debug fields such as helper name, request class, project key, or correlation ID.
- Prefer local execution: Agent Tick collects the human decision; your local process decides what to do next.
