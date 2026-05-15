# Agent Tick Context

Agent Tick coordinates human-visible decisions and progress updates for AI agents across local and remote approval surfaces.

## Language

**Status Update**:
A non-blocking progress note from an agent to humans following the work.
_Avoid_: log entry, approval

**Steering**:
A structured human choice, including single-select or multi-select choice sets with an explicit decline option, that guides what an agent should do next.
_Avoid_: questionnaire, survey

**Sanction**:
An explicit human approval before risky, irreversible, or externally significant agent work.
_Avoid_: approval request, permission prompt, confirmation

**Agentic Decision**:
A human decision whose result is returned to an agent and can influence the agent's next action.
_Avoid_: chat reply, remote-control message

**Agent Tick Request**:
A human-facing request created by an agent for a decision, approval, or structured input.
_Avoid_: ticket, task

**Request Deadline**:
The time by which an Agent Tick Request must receive a human decision before the agent stops waiting and the request becomes stale.
_Avoid_: local timeout, polling timeout

**MCP Adapter**:
A local MCP server process that exposes Status Updates, Steering, and Sanctions to MCP-capable agents and calls Agent Tick with a saved agent credential.
_Avoid_: product server endpoint, remote MCP service

**Agent Token**:
A scoped credential issued after human sign-in that lets an agent act through Agent Tick without holding a human session.
_Avoid_: user token, Clerk token

**Remote Approval Surface**:
A phone or web surface where an eligible Agent Tick human can answer an Agent Tick Request.
_Avoid_: remote UI, dashboard only

**Local Prompt**:
A same-session prompt shown by the agent client to the person at the terminal.
_Avoid_: local approval, canonical response

**Mirrored Prompt**:
A prompt presented both as a Local Prompt and as an Agent Tick Request, where the first terminal local result or remote answer is used and the losing surface is abandoned or closed.
_Avoid_: duplicate prompt, two approvals

**Local-only Prompt**:
A Local Prompt used when remote routing is intentionally disabled after the MCP Adapter has been configured.
_Avoid_: offline Agent Tick request, implicit approval

**Abandoned Request**:
An Agent Tick Request that stopped waiting because another path resolved or invalidated it before a remote answer arrived.
_Avoid_: denied request, failed request

## Relationships

- The **MCP Adapter** uses an **Agent Token** provisioned through human sign-in.
- **Steering** and **Sanctions** are represented as distinct **Agent Tick Request** types when remote routing is available.
- Multi-select **Steering** is still **Steering**; questionnaire-style presentation is only a way to collect the answer.
- **Steering** requires a structured choice set with a caller-provided decline option rather than an implicit hidden cancellation path.
- In multi-select **Steering**, decline choices are mutually exclusive with normal choices.
- An **Agentic Decision** returns only structured choices, not human-written comments or freeform instructions.
- A **Mirrored Prompt** has exactly one **Local Prompt** and exactly one **Agent Tick Request**.
- A **Remote Approval Surface** answers an **Agent Tick Request**.
- A **Local Prompt** can resolve a **Mirrored Prompt** without becoming a remote Agent Tick human response.
- A **Local-only Prompt** has no corresponding **Agent Tick Request**.
- A **Mirrored Prompt** is preferred for configured MCP flows; a **Local-only Prompt** is an explicit mode, not a substitute for missing setup.
- Both **Steering** and **Sanctions** may use a **Local-only Prompt** when explicitly requested.
- A **Mirrored Prompt** can leave an **Abandoned Request** when its **Local Prompt** wins the race, including local decline, cancellation, or timeout.
- An unanswered **Agent Tick Request** should become an **Abandoned Request** when the MCP tool reaches its **Request Deadline**.
- An **Abandoned Request** from a locally answered **Mirrored Prompt** can record constrained structured local outcome metadata without becoming a remote Agent Tick response.

## Example dialogue

> **Dev:** "If a phone response and terminal response both arrive for a **Sanction**, do we need two approvals?"
> **Domain expert:** "No — this is a **Mirrored Prompt**. Whichever surface answers first resolves it, and the other surface is abandoned or closed."

## Flagged ambiguities

- "local MCP elicitation" could mean either an Agent Tick human decision or a local agent-client answer — resolved: it behaves like the Pi extension's local half of a **Mirrored Prompt**.
- "without Agent Tick config" could mean either failing MCP startup or falling back to the client prompt — resolved: the **MCP Adapter** fails with setup instructions when no Agent Token is configured.
- "abandoned" could mean either an unexplained cancellation or a local-won mirrored flow — resolved: **Abandoned Requests** should carry a non-secret reason/source and structured local outcome metadata when another path resolved the decision.
- "questionnaire" could mean a separate product primitive or the presentation used for multi-select **Steering** — resolved: new questionnaire-style collection should use **Steering**, while historical Questionnaire records may remain labeled as such.
- "freeform" or "comment" could mean extra context returned to the agent — resolved: **Agentic Decisions** must not return human-written comments or freeform instructions.
