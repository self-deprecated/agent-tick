# Approval templates

Approval templates define reusable bounded request shapes for common high-risk workflows. They are documentation-level templates for now: callers still create normal Agent Tick approval requests with the existing CLI, SDK, API, MCP, or connector primitives.

Agent Tick remains the approval layer. The protected deploy, refund, email, migration, or release still runs in the local agent, workflow tool, CI job, or business system after the workflow receives an explicit decision.

## Template contract

Each template should define:

- **Reviewer goal** — the decision the human is actually making.
- **Required fields** — the minimum context needed to decide.
- **Safe links** — links back to systems that already control access.
- **Choices** — finite options with an explicit deny/cancel path.
- **Flags** — mobile-visible risk hints such as `production`, `destructive`, or `external_effect`.
- **Metadata** — safe correlation fields for the caller, not secrets or full logs.
- **Reviewer guidance** — what to check before approving.

Do not put secrets, bearer tokens, cookies, private keys, `.env` files, full logs, raw AI prompts, or unnecessary customer data in request text or metadata.

## Shared defaults

Use these defaults unless a template says otherwise:

```json
{
  "choices": [
    { "id": "approve", "label": "Approve", "kind": "approve" },
    { "id": "deny", "label": "Deny", "kind": "deny" }
  ],
  "allowFreeformReply": true,
  "metadata": {
    "source": "workflow",
    "templateId": "replace-with-template-id",
    "correlationId": "safe-run-or-request-id"
  }
}
```

Recommended safe metadata keys:

- `source`
- `templateId`
- `workflowId`
- `runId`
- `executionId`
- `correlationId`
- `projectId`
- `projectName`
- `environment`

Reject or redact metadata keys that include `token`, `secret`, `password`, `authorization`, `cookie`, `privateKey`, `apiKey`, or `credential`.

## Production deploy

**Template id:** `production_deploy`

**Reviewer goal:** decide whether one specific build/version should deploy to a named production environment.

Required fields:

| Field | Example | Notes |
| --- | --- | --- |
| `service` | `api` | Human-readable service or app name. |
| `environment` | `production` | Use exact environment name. |
| `version` | `6f57b86` | Commit SHA, image digest, build number, or release tag. |
| `diffSummary` | `Auth callback retry fix` | Short summary, not full logs. |
| `rollbackPlan` | `Revert to api@a0255f2` | Required before approval. |
| `runbookUrl` | `https://...` | Link to existing access-controlled system. |
| `deployUrl` | `https://...` | CI run, release, or deploy preview link. |

Choices:

```json
[
  { "id": "approve", "label": "Approve deploy", "kind": "approve", "flags": ["production", "time_sensitive", "audit_relevant"] },
  { "id": "deny", "label": "Do not deploy", "kind": "deny", "flags": ["safest"] }
]
```

Reviewer guidance:

- Confirm the version, environment, and service are correct.
- Check rollout/rollback plan and recent test status.
- Deny if the request lacks a rollback plan or links to unreviewable context.

Example request shape:

```json
{
  "requestType": "approval",
  "title": "Deploy api to production?",
  "body": "Deploy api@6f57b86 to production. Summary: Auth callback retry fix. Rollback: revert to api@a0255f2. Runbook: https://runbooks.example.com/api-deploy",
  "command": "./scripts/deploy.sh api production 6f57b86",
  "risk": "high",
  "choices": [
    { "id": "approve", "label": "Approve deploy", "kind": "approve", "flags": ["production", "time_sensitive", "audit_relevant"] },
    { "id": "deny", "label": "Do not deploy", "kind": "deny", "flags": ["safest"] }
  ],
  "metadata": {
    "templateId": "production_deploy",
    "service": "api",
    "environment": "production",
    "version": "6f57b86",
    "correlationId": "gha-123456"
  }
}
```

## Refund

**Template id:** `refund_approval`

**Reviewer goal:** approve or deny one refund with enough policy context to avoid accidental over-refunds.

Required fields:

| Field | Example | Notes |
| --- | --- | --- |
| `amount` | `199.00` | Decimal amount only, no payment credentials. |
| `currency` | `USD` | ISO currency code. |
| `customerReference` | `cus_1234` | Internal reference, not full PII. |
| `reasonSummary` | `Duplicate charge` | Short reason. |
| `policyUrl` | `https://...` | Refund policy or support ticket. |
| `paymentUrl` | `https://...` | Link to payment processor record behind existing access controls. |

Choices:

```json
[
  { "id": "approve", "label": "Approve refund", "kind": "approve", "flags": ["external_effect", "costly", "audit_relevant"] },
  { "id": "deny", "label": "Deny refund", "kind": "deny" },
  { "id": "needs_more_context", "label": "Needs more context", "kind": "custom", "flags": ["needs_context"] }
]
```

Reviewer guidance:

- Confirm amount, currency, and customer reference match the ticket/payment system.
- Check the policy link before approving.
- Do not include full card data, bank details, addresses, or unrelated customer PII in the approval text.

## Outbound email

**Template id:** `outbound_email_approval`

**Reviewer goal:** decide whether a prepared outbound email should be sent by the workflow or agent.

Required fields:

| Field | Example | Notes |
| --- | --- | --- |
| `recipientClass` | `customer admin` | Avoid full address unless necessary. |
| `subjectSummary` | `Incident follow-up` | Summary, not necessarily exact subject if sensitive. |
| `draftUrl` | `https://...` | Link to existing draft/review system. |
| `reason` | `Customer requested RCA` | Why this email exists. |
| `complianceNote` | `No credentials included` | Required for sensitive domains. |

Choices:

```json
[
  { "id": "approve", "label": "Approve send", "kind": "approve", "flags": ["external_effect", "audit_relevant"] },
  { "id": "deny", "label": "Do not send", "kind": "deny" },
  { "id": "revise", "label": "Revise before sending", "kind": "custom", "flags": ["needs_context"] }
]
```

Reviewer guidance:

- Review the draft in the source system before approving.
- Do not paste full customer threads, attachments, or secrets into Agent Tick.
- Use `Revise before sending` when content needs edits; Agent Tick should not become the email editor in this template.

## Database migration

**Template id:** `database_migration`

**Reviewer goal:** decide whether a specific migration should run against a named database/environment.

Required fields:

| Field | Example | Notes |
| --- | --- | --- |
| `database` | `primary-postgres` | Human-readable DB/service name. |
| `environment` | `production` | Exact environment. |
| `migrationId` | `20260516_add_policy_index` | Migration or change id. |
| `backupStatus` | `snapshot complete at 09:00Z` | Required before approval. |
| `rollbackPlan` | `drop index concurrently` | Required and specific. |
| `reviewUrl` | `https://...` | PR/migration review link. |

Choices:

```json
[
  { "id": "approve", "label": "Run migration", "kind": "approve", "flags": ["destructive", "production", "security_sensitive", "audit_relevant"] },
  { "id": "deny", "label": "Do not run", "kind": "deny", "flags": ["safest"] }
]
```

Reviewer guidance:

- Confirm backup status and rollback plan are current.
- Check the migration id and target environment.
- Deny if the request includes raw dumps, credentials, or unclear rollback behavior.

## Release approval

**Template id:** `release_approval`

**Reviewer goal:** decide whether a release can proceed based on release notes, checklist status, and owner accountability.

Required fields:

| Field | Example | Notes |
| --- | --- | --- |
| `releaseName` | `mobile 0.1.0` | Human-readable release. |
| `riskLevel` | `medium` | Low/medium/high. |
| `releaseNotesUrl` | `https://...` | Release notes or changelog. |
| `checklistState` | `tests green, support copy approved` | Short status. |
| `owner` | `release captain` | Human owner/team. |
| `rollbackOrHotfixPlan` | `ship 0.1.1 hotfix` | Required for production-impacting releases. |

Choices:

```json
[
  { "id": "approve", "label": "Approve release", "kind": "approve", "flags": ["production", "audit_relevant"] },
  { "id": "deny", "label": "Hold release", "kind": "deny" },
  { "id": "needs_owner", "label": "Escalate to owner", "kind": "custom", "flags": ["needs_context"] }
]
```

Reviewer guidance:

- Confirm checklist and release notes match the candidate build.
- Confirm the owner is reachable for rollback/hotfix follow-up.
- Use `Hold release` if any required signoff is missing.

## CLI example

Today, callers can map a template into the existing CLI fields. `agent-tick sanction` uses the default Approve/Reject choices; use the SDK, API, MCP, or connector primitives when you need custom choice labels or more than two choices.

```sh
agent-tick sanction \
  --title "Deploy api to production?" \
  --body "api@6f57b86 · rollback: revert to api@a0255f2 · runbook: https://runbooks.example.com/api-deploy" \
  --command "./scripts/deploy.sh api production 6f57b86" \
  --choice-flag approve=production \
  --choice-flag approve=time_sensitive \
  --choice-flag approve=audit_relevant \
  --timeout 30m
```

## SDK example

```ts
import { AgentTickClient } from '@agent-tick/sdk';

const client = new AgentTickClient({
  baseUrl: process.env.AGENT_TICK_SERVER ?? 'https://api.agenttick.sh',
  tokenProvider: () => process.env.AGENT_TICK_TOKEN
});
const created = await client.createApprovalRequest({
  requester: { name: 'Refund workflow' },
  title: 'Approve refund?',
  body: 'Refund USD 199.00 for customer ref cus_1234. Reason: duplicate charge. Policy: https://support.example.com/refunds',
  requestType: 'approval',
  risk: 'medium',
  allowFreeformReply: true,
  choices: [
    { id: 'approve', label: 'Approve refund', kind: 'approve', flags: ['external_effect', 'costly', 'audit_relevant'] },
    { id: 'deny', label: 'Deny refund', kind: 'deny' },
    { id: 'needs_more_context', label: 'Needs more context', kind: 'custom', flags: ['needs_context'] }
  ],
  metadata: {
    templateId: 'refund_approval',
    correlationId: 'support-ticket-1234'
  }
});

const decision = await client.waitForApproval(created.request.id, { timeoutMs: 30 * 60_000 });
```

## Connector usage

No-code connectors should expose these templates as presets that prefill safe fields and flags. They should still let builders review every field before sending a request.

For n8n, Zapier, and Make:

- Use the same `templateId` names.
- Output normalized branch fields such as `decision`, `choiceId`, `choiceKind`, and `terminal`.
- Keep source-system links behind the source system's own access control.
- Do not store bearer tokens or customer secrets in connector metadata.

## Non-goals

- Server-side template IDs or dashboard-managed template editors.
- Attachments/file upload handling.
- Editing outbound email content inside Agent Tick.
- Legal/e-signature proof for consumer approvals.
- Agent Tick executing the approved action.
- Replacing workflow-platform permissions, payment permissions, or CI authorization.

## Future product hooks

When templates move beyond docs, add them in this order:

1. SDK constants/helpers for these request shapes.
2. Connector presets for n8n/Zapier/Make.
3. Dashboard-managed template definitions with owner/team scoping.
4. CLI/API `templateId` support after server-side validation rules exist.
5. Optional guest-review links only after scoped-link security requirements are implemented.
