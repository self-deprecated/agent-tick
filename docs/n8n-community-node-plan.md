# n8n community node plan

## Summary

Build the Agent Tick n8n integration as a small community node package, preferably in a separate repository, after the connector contract is stable. The node should let an n8n workflow create a bounded Agent Tick approval request, wait or poll for a terminal decision, and branch on the result.

Agent Tick must remain the approval layer. The n8n workflow still executes the protected deploy, refund, email, migration, or release step after it receives an explicit decision.

## Package recommendation

Create a separate package/repository for the community node rather than adding it to the main Agent Tick monorepo first.

Suggested package:

- npm package: `n8n-nodes-agent-tick`
- repository: `self-deprecated/n8n-nodes-agent-tick` or equivalent integration repo
- license: match the intended connector distribution policy before publishing
- runtime dependency: minimal HTTP client or n8n helper request functions
- test dependency: n8n node test/lint tooling and mocked Agent Tick API responses

Why separate:

- n8n community nodes have their own package structure, release cadence, verification expectations, and npm metadata.
- Connector users should not need the full Agent Tick monorepo.
- It keeps the main product package/flake hashes from changing for n8n-specific dependencies.

## MVP scope

### Credentials

`AgentTickApi.credentials.ts`

Fields:

- `serverUrl` — default `https://api.agenttick.sh`; allow self-hosted URLs.
- `agentToken` — password field for `agent_...` token.
- Optional `organizationId` only if future API usage requires it; do not include by default.

Credential behavior:

- Use `Authorization: Bearer <agentToken>` for API calls.
- Never place the token in URLs, workflow outputs, logs, or request metadata.
- Validate that `serverUrl` is HTTPS unless the user explicitly uses localhost/private self-hosted development.

### Node operations

One node can start with a single resource, `Approval Request`, and three operations.

#### Create approval request

Purpose: create a bounded Agent Tick request and return the request id plus safe status fields.

Inputs:

- `title` — required, short reviewer-facing title.
- `body` — optional reviewer guidance.
- `command` or `actionSummary` — optional; use only for a safe action summary.
- `requestType` — `approval`, `sanction`, `questionnaire`, or `steer` where supported by Agent Tick API.
- `risk` — optional `low`, `medium`, `high` label.
- `timeoutMinutes` — maps to `expiresAt`.
- `choices` — fixed choices with `id`, `label`, `kind`, optional `description`, `flags`, and `tags`.
- `questions` — optional for questionnaire-style templates.
- `metadata` — safe key/value fields only: `source=n8n`, workflow id, execution id, template id, correlation id.

Required defaults:

- Provide an explicit deny/cancel choice for sanction-style operations.
- Default choices for a simple approval request:
  - `approve` / `Approve` / kind `approve`
  - `deny` / `Deny` / kind `deny`

Outputs:

- `requestId`
- `status`
- `terminal=false`
- `createdAt`
- `expiresAt`
- `dashboardUrl` only if safe and based on configured public URL/server behavior
- raw Agent Tick request object behind an advanced option, disabled by default

#### Wait for decision

Purpose: wait for a terminal request result using Agent Tick's wait endpoint/SDK semantics.

Inputs:

- `requestId` — required, often from Create approval request.
- `timeoutSeconds` — node wait timeout; defaults should stay below n8n execution limits.
- `pollIntervalSeconds` — if polling is used instead of long wait.

Behavior:

- Use `GET /v1/approval-requests/:id/wait?timeoutMs=...` where appropriate.
- If no terminal decision occurs before the node timeout, output `terminal=false` and `status=pending` rather than pretending the request was denied.
- Treat expired/abandoned/denied as terminal negative outcomes.

Outputs:

- `requestId`
- `terminal`
- `status`
- `decision` — normalized `approved`, `denied`, `expired`, `abandoned`, `pending`, or `unknown`.
- `choiceId`
- `choiceKind`
- `message` only if explicitly safe and provided by the API response.
- `answers` for questionnaire results.
- `respondedAt` if available.

#### Create and wait

Purpose: convenience operation for common workflows.

Inputs:

- all Create approval request fields
- wait timeout/polling fields

Outputs:

- combined create + terminal decision fields

This should be the easiest path for n8n users, but the separate create/wait operations are still needed for long-running workflows.

## Branching contract

The node should make branch conditions simple:

```text
{{$json.decision}} equals approved
{{$json.choiceKind}} equals approve
{{$json.terminal}} is true
```

Do not make users parse raw Agent Tick payloads for normal approval/deny branching.

## Scenario presets

The n8n node can include optional UI presets that prefill safe fields without requiring server-side template support.

### Production deploy

- title: `Deploy production?`
- flags on approve: `production`, `time_sensitive`, `audit_relevant`
- fields: service, environment, version/sha, rollback link, runbook link

### Refund

- title: `Approve refund?`
- flags on approve: `external_effect`, `costly`, `audit_relevant`
- fields: amount, currency, customer/account reference, policy link, reason summary

### Outbound email

- title: `Send outbound email?`
- flags on approve: `external_effect`, `needs_context`
- fields: recipient class, subject summary, draft link, compliance note

### Database migration

- title: `Run database migration?`
- flags on approve: `destructive`, `production`, `security_sensitive`
- fields: database, migration id, backup status, rollback plan

### Release approval

- title: `Approve release?`
- flags on approve: `production`, `audit_relevant`
- fields: release notes link, risk level, checklist status, owner

## Security and privacy boundaries

The node should include visible help text:

- Do not include secrets, bearer tokens, private keys, cookies, or environment files.
- Do not include raw prompts, full transcripts, or full command output.
- Prefer short summaries and links back to systems that already control access.
- Agent Tick records and routes the approval decision; the action still runs in n8n.
- Do not use approval links with bearer tokens in URLs.

Metadata allowlist:

- `source`
- `workflowId`
- `executionId`
- `nodeId`
- `templateId`
- `correlationId`

Reject or warn on metadata keys matching `token`, `secret`, `password`, `authorization`, `cookie`, `privateKey`, `apiKey`.

## Error handling

Normalize common failures:

| Failure | Node output/error behavior |
| --- | --- |
| Missing credentials | fail with setup guidance |
| 401/403 | fail with token/server permission guidance |
| 404 request id | fail for wait operation |
| 429 | retry when n8n retry policy allows; otherwise fail with retry-after hint |
| network error | fail with server URL guidance |
| pending after timeout | success output with `terminal=false`, `decision=pending` |
| denied/expired/abandoned | success output with terminal negative decision so workflows can branch |

## Testing plan

Unit tests with mocked Agent Tick API:

- creates approval request with default approve/deny choices
- preserves custom choices and flags
- redacts/rejects unsafe metadata keys
- waits and maps approved response
- waits and maps denied response
- handles pending timeout as non-terminal output
- handles expired/abandoned as terminal negative output
- handles 401/403/404/429/network errors
- supports self-hosted server URL

Manual n8n smoke test:

1. Configure credentials against a local or hosted Agent Tick test server.
2. Create a request from n8n.
3. Approve from mobile/dashboard.
4. Verify n8n branches on `decision=approved`.
5. Deny and verify the negative branch.
6. Timeout and verify pending/timeout branch behavior.

## Publishing checklist

- Package named with `n8n-nodes-` prefix.
- Node and credentials descriptions explain bounded approval behavior.
- README includes hosted and self-hosted setup.
- README includes the five scenario recipes.
- README includes privacy/security warnings.
- Lint/test with n8n community node tooling.
- Publish dry run before npm publish.
- Decide whether to submit for n8n community verification after local testing.

## Non-goals for MVP

- Agent Tick executing workflow actions.
- Guest approval links.
- Attachments or file upload handling.
- Server-managed template IDs.
- Slack/Teams notification provider setup.
- OAuth to Agent Tick.
- Editing outbound email content inside Agent Tick.

## Open implementation questions

- Should n8n use regular agent tokens, or should Agent Tick add workflow-scoped tokens first?
- Should the wait operation use waiter tokens for no-code connectors?
- What is the safest maximum wait duration for common n8n deployment modes?
- Should the community node include a trigger once Agent Tick has stable response webhooks?
- Should the package live under the main organization or a dedicated integrations organization?

## Decision

Do not add a half-finished n8n package to the main product repo. Create a dedicated `n8n-nodes-agent-tick` package/repo when ready, with MVP operations for create, wait, and create-and-wait. Until then, this plan is the implementation contract for card #66.
