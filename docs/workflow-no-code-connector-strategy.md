# Workflow and no-code connector strategy

## Summary

Agent Tick should treat workflow and no-code connectors as distribution surfaces for bounded approval decisions, not as new execution environments. The first connector work should help teams pause an existing automation, ask a human for an explicit decision, and resume or branch locally inside the workflow tool.

Recommendation: prioritize an n8n community node first, then a Zapier app/action opportunity brief and Make templates. Ship vertical recipes alongside connectors so the value is concrete: production deploy, refund, outbound email, database migration, and release approval.

## Decision

Priority order:

1. **n8n community node** — first build target.
2. **Vertical approval templates** — define reusable request shapes in parallel with the n8n plan.
3. **Zapier app/action** — second platform target after the n8n plan validates request and wait semantics.
4. **Make templates/actions** — follow Zapier once webhook/polling semantics are stable.
5. **Workflow SDK primitives** — document patterns for durable workflow systems after the no-code connector contract is proven.

Do not start with a broad “AI employee” or automation platform. Agent Tick should remain the approval layer that workflow tools call.

## Why this order

### n8n first

n8n is self-host-friendly and AI-workflow-native. It fits Agent Tick’s source-available and self-hosting story better than hosted-only workflow platforms. A community node can be small and explicit:

- create an Agent Tick approval request
- wait or poll for a terminal decision
- output normalized branch fields
- never execute the approved action itself

This creates a reusable connector contract for other workflow tools.

### Vertical templates in parallel

Connectors need concrete scenarios, not only generic fields. See [Approval templates](./approval-templates.md) for the docs-first reusable request shapes. The first templates should model:

| Scenario | Decision type | Required fields | Useful flags |
| --- | --- | --- | --- |
| Production deploy | approve/deny sanction | service, environment, version/sha, rollback plan, deploy link | `production`, `time_sensitive`, `audit_relevant` |
| Refund | approve/deny or questionnaire | amount, currency, customer/account reference, reason, policy link | `external_effect`, `costly`, `audit_relevant` |
| Outbound email | approve/deny or edit-before-send later | recipient class, subject summary, draft link, risk notes | `external_effect`, `needs_context` |
| Database migration | approve/deny sanction | database, migration id, backup status, rollback plan | `destructive`, `production`, `security_sensitive` |
| Release approval | questionnaire/approval | release notes link, risk level, checklist state, owner | `production`, `audit_relevant` |

Templates should be request-shape guidance first. Server-side template IDs, dashboard editors, and attachments can come later.

### Zapier second

Zapier has the strongest no-code distribution and already has Human in the Loop primitives. Agent Tick should enter Zapier only with a clear complementary story:

- agent-token-scoped approvals for coding agents and self-hosted teams
- mobile/Agent Tick dashboard as approval surfaces
- bounded decision objects for workflow branching
- optional self-hosted server URL for teams that do not want hosted approval state

The first Zapier work should be an opportunity brief and prototype action design, not a full marketplace launch.

### Make after Zapier

Make is valuable, but the Agent Tick API shape should be proven with n8n and Zapier first. Make work should reuse the same field names, decision output shape, and safety copy.

### Workflow SDKs later

Durable workflow systems and SDKs are valuable for developers, but they overlap with existing SDK/API docs. Prioritize visual workflow distribution before adding new SDK abstractions.

## Connector contract

Every no-code connector should expose a small, consistent contract.

### Credentials

- Agent Tick server URL.
- Agent token or scoped workflow token.
- Optional organization/project/team routing fields where supported.
- Never store human session tokens in connector credentials.
- Never place bearer tokens in approval links or notification URLs.

### Create request operation

Inputs:

- title
- body or short reviewer guidance
- optional command/action summary
- request type: sanction, questionnaire, steering-style choice, or generic approval
- finite choices with `kind` and optional flags
- optional questions for structured collection
- safe metadata: workflow id, run id, template id, correlation id
- expiration/timeout

Outputs:

- request id
- status
- dashboard/mobile deep link if safe
- created/expires timestamps
- waiter credential only if the API provides one for that connector mode

### Wait/poll operation

Inputs:

- request id
- timeout
- poll interval or wait mode

Outputs:

- terminal: true/false
- status: approved, denied, expired, abandoned, responded, or pending
- selected choice id/kind
- questionnaire answers when applicable
- safe response message only when explicitly enabled

The workflow tool branches on this output. Agent Tick does not run the protected action.

### Trigger/event operation

A later connector can include “approval responded” triggers if webhook delivery semantics are stable. MVP should prefer create + wait/poll because it is easier to explain and test.

## Disclosure boundaries

No-code connectors are high-leakage surfaces because workflow builders often map fields from many upstream apps. Defaults must be conservative.

Do not send or encourage:

- secrets, bearer tokens, private keys, cookies, env files
- raw prompts or full transcripts
- private customer data beyond what the reviewer needs
- full command output or logs
- approval content in notification URLs

Prefer:

- short human-readable summary
- safe links back to the source system
- bounded choices
- explicit deny/cancel choices
- metadata limited to correlation ids and routing hints

## Product positioning

Use this language:

- “Add a human approval checkpoint to a workflow.”
- “Branch the workflow on an Agent Tick decision.”
- “The approved action still runs in your workflow or local agent environment.”
- “Agent Tick records and routes bounded approval decisions.”

Avoid this language:

- “Agent Tick runs the deploy/refund/email for you.”
- “Remote shell approval.”
- “Approve arbitrary prompts.”
- “Unlimited audit log” unless the retention/audit scope is implemented and documented.

## Implementation slices

### Slice 1 — shared connector request shape

- Document a canonical JSON shape for create/wait outputs.
- Add examples for the five vertical templates.
- Ensure SDK helpers can express the shape without new server features.

### Slice 2 — n8n community node plan/prototype

See [n8n community node plan](./n8n-community-node-plan.md) for the concrete package/repo recommendation, operations, credential shape, output contract, testing plan, and publishing checklist.

- Node credentials: server URL and agent token.
- Operations: create approval request; wait for decision.
- Outputs: normalized decision fields for branch nodes.
- Tests: mocked Agent Tick API create/wait responses.
- Docs: self-hosted and hosted setup.

### Slice 3 — Zapier opportunity brief

- Define auth model and invite/onboarding friction.
- Compare Zapier Human in the Loop vs Agent Tick action.
- Prototype actions: create approval request, wait for approval.
- Optional trigger: approval responded.

### Slice 4 — Make templates

- Reuse the same field names and decision outputs.
- Publish scenario templates only after n8n/Zapier wording is stable.

### Slice 5 — richer templates

- Add server-side template IDs and dashboard-managed templates only after connector usage proves demand.
- Consider attachments/edit-before-send after privacy and retention behavior is explicit.

## Validation checklist for future connector builds

- Connector can create a request with finite choices and a deny/cancel path.
- Connector can wait/poll and branch without executing the action in Agent Tick.
- No token, secret, command output, or raw prompt is sent in metadata by default.
- Notification payloads contain IDs/hints, not full sensitive content.
- Self-hosted server URL works without hosted-only assumptions.
- Hosted app copy distinguishes Agent Tick approvals from workflow-platform permissions.
- Tests mock API errors, denial, timeout, expiration, and approval.

## Open questions

- Should workflow connectors use regular agent tokens or a new workflow-scoped token type?
- Should wait/poll use waiter tokens for no-code platforms, or require the original agent token?
- Should vertical templates be docs-only, SDK helper constants, or server-managed objects first?
- How much response freeform text should no-code connectors allow?
- What is the first platform where a casual reviewer should be able to approve without a full Agent Tick account?

## Non-goals

- Building a full no-code automation platform.
- Running remote commands from Agent Tick.
- Replacing Zapier/n8n/Make permissions, OAuth scopes, or execution logs.
- Claiming legal/e-signature proof for workflow approvals.
- Sending arbitrary prompt or transcript content into workflow metadata.
