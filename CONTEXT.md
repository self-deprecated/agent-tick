# Agent Tick Context

Agent Tick coordinates human-visible decisions and progress updates for AI agents across local and remote approval surfaces.

## Language

**Agent Activity**:
Human-visible activity initiated by an agent and routed to humans, either a Status Update or an Agent Tick Request.
_Avoid_: event, notification

**Status Update**:
A non-blocking progress note from an agent to humans following the work.
_Avoid_: log entry, approval

**Test Status Update**:
A non-agentic status-shaped signal used to verify that status delivery reaches the intended Remote Approval Surfaces, not that push alerts fire.
_Avoid_: fake progress, demo log, push test

**Steering**:
A structured human choice, including single-select or multi-select choice sets with an explicit decline option, that guides what an agent should do next.
_Avoid_: questionnaire, survey

**Sanction**:
An explicit human approval before risky, irreversible, or externally significant agent work.
_Avoid_: approval request, permission prompt, confirmation

**Agentic Decision**:
A human decision whose result is returned to an agent and can influence the agent's next action.
_Avoid_: chat reply, remote-control message

**Response**:
An Agent Tick Human's answer to an Agent Tick Request.
_Avoid_: vote, approval

**Agent Tick Request**:
A human-facing request created through Agent Tick for a decision, approval, structured input, or routing test.
_Avoid_: ticket, task, approval request

**Test Request**:
A non-agentic Agent Tick Request created to verify that the intended Remote Approval Surfaces receive and can answer requests.
_Avoid_: demo approval, fake agent request

**Request Deadline**:
The time by which an Agent Tick Request must receive a human decision before the agent stops waiting and the request becomes stale.
_Avoid_: local timeout, polling timeout

**Agent Tick Human**:
A signed-in person who can belong to Workspaces and answer routed Agent Activity.
_Avoid_: approval device, workspace

**Workspace Member**:
An Agent Tick Human within a specific Workspace, with an Owner, Admin, or Member role.
_Avoid_: global user, device owner

**Approval Device**:
A device or app installation connected to an Agent Tick Human for receiving human-visible Agent Activity.
_Avoid_: workspace device, team device

**Workspace**:
The top-level Agent Tick container for agents, members, routing rules, activity history, and administration, with either Personal or Shared type.
_Avoid_: organization, local organization, account

**Personal Workspace**:
A one-member Workspace used for an individual setup.
_Avoid_: personal organization, user account

**Shared Workspace**:
A multi-member Workspace used for shared administration and routing.
_Avoid_: organization workspace, Clerk organization, company account

**Routing Rule**:
A user-named Workspace rule with match conditions, recipients, delivery behavior, and required Response count for matched Agent Activity.
_Avoid_: request rule, approval rule, policy, team as separate type, project as separate type

**Agent Assignment**:
The Routing Rule selected for an Agent Token in a Shared Workspace.
_Avoid_: workspace route, token owner, project assignment, team assignment

**MCP Adapter**:
A local MCP server process that exposes Status Updates, Steering, and Sanctions to MCP-capable agents and calls Agent Tick with a saved agent credential.
_Avoid_: product server endpoint, remote MCP service

**Coding-agent Integration**:
A documented way for a coding-agent tool or workflow, such as Claude Code, Codex, or Pi, to use Agent Tick.
_Avoid_: Agent Connection when referring to the host tool, agent as the precise section label, integration target as public copy

**Optional Native Permission Hook**:
A narrow opt-in hook that routes a host agent's native permission prompt, such as Claude Code `PermissionRequest`, through Agent Tick Sanctions.
_Avoid_: primary Claude setup path, command execution, risk classifier

**Agent Token**:
A Workspace-owned scoped credential with an editable label that identifies the agent actor sending Agent Activity.
_Avoid_: user token, Clerk token, separate agent identity

**Remote Approval Surface**:
A phone or web surface where an eligible Agent Tick human can answer an Agent Tick Request.
_Avoid_: remote UI, dashboard only

**Personal Console**:
A functional web surface for one signed-in human to complete setup, review their connected agent and mobile status, and trigger Test Requests.
_Avoid_: marketing page, admin dashboard

**Entitlement Status**:
A read-only summary of whether Agent Tick app access and hosted service access are active.
_Avoid_: checkout, upgrade prompt, subscription manager

**Trial**:
A 7-day free $0 App Store or Google Play purchase, represented through RevenueCat entitlement state, that unlocks temporary Native App responses.
_Avoid_: local first-open trial, free tier, freemium plan, hidden subscription start

**App Purchase**:
The one-time app-store purchase that unlocks ongoing personal Native App use with Self-Hosted Deployments.
_Avoid_: hosted subscription, recurring app rent, organization license

**Personal Hosted Subscription**:
The optional app-store subscription for ongoing hosted personal service after the Trial.
_Avoid_: app ownership purchase, required purchase for self-hosted use, web checkout for launch personal subscription

**Native App**:
The mobile app used as the primary day-to-day Remote Approval Surface.
_Avoid_: remote-control app, Agent Tick Mobile, phone as the only supported form factor

**Local Prompt**:
A same-session prompt shown by the agent client to the person at the terminal.
_Avoid_: local approval, canonical response

**Mirrored Prompt**:
A prompt presented both as a Local Prompt and as an Agent Tick Request, where the first terminal local result or remote answer is used and the losing surface is resolved or closed.
_Avoid_: duplicate prompt, two approvals

**Local-only Prompt**:
A Local Prompt used when remote routing is intentionally disabled after the MCP Adapter has been configured.
_Avoid_: offline Agent Tick request, implicit approval

**Resolved Request**:
An Agent Tick Request that stopped waiting because another path resolved or invalidated it before a remote answer arrived.
_Avoid_: denied request, failed request, abandoned request

**Documentation Site**:
The public docs surface for human developers learning what Agent Tick is and how to use it, organized around user journeys rather than implementation surfaces.
_Avoid_: marketing page, dashboard help text, private website docs, agent-facing setup notes as the primary voice

## Relationships

- A **Workspace** contains **Workspace Members**, **Agent Tokens**, **Routing Rules**, **Agent Activity**, and administration settings.
- An **Agent Tick Human** may be a **Workspace Member** in one or more **Workspaces**.
- A **Workspace Member** belongs to exactly one **Workspace** and exactly one **Agent Tick Human**.
- An **Approval Device** belongs to exactly one **Agent Tick Human**.
- By default, routed **Agent Activity** goes to all active **Approval Devices** for each routed **Agent Tick Human**.
- **Routing Rules** may include members without active **Approval Devices**, but the UI should warn about delivery readiness.
- Workspace-specific routing or member preferences may narrow which of a human's **Approval Devices** receive activity for that Workspace.
- Every **Agent Tick Human** has a **Personal Workspace** for individual setup, fixed-name “Personal”.
- A **Personal Workspace** is not deleted independently from account or hosted data deletion.
- When an **Agent Tick Human** account is deleted by the identity provider, Agent Tick revokes access while retaining historical activity and audit records as needed.
- A **Personal Workspace** has exactly one **Workspace Member** and implicitly routes that member's agents to that member.
- A **Personal Workspace** may still have personal delivery Routing Rules, such as device or timing preferences.
- A **Personal Workspace** cannot invite additional members; shared work uses a **Shared Workspace** separate from each member's **Personal Workspace**.
- A **Shared Workspace** has one or more **Workspace Members** and may have administrators.
- Hosted **Shared Workspaces** can be created and configured before Shared Workspace billing is enabled, but hosted shared routing and responses require active Shared Workspace entitlement.
- Personal and shared usage use the same **Workspace** model; available options differ by membership, entitlement, and configured **Routing Rules**.
- Authentication and deployment differences do not create separate routing models.
- An **Agent Token** belongs to exactly one **Workspace** and is the server-side identity for the agent actor using it.
- An **Agent Token** may have an **Agent Assignment**.
- Agent Activity may carry host, working directory, and client/integration metadata without creating separate agent identities.
- The human who created an **Agent Token** is audit context, not the owner of the token.
- A Shared Workspace **Agent Token** has exactly one active **Agent Assignment**.
- An **Agent Assignment** refers to one **Routing Rule** within the same **Shared Workspace**.
- Multiple agents may share the same **Routing Rule**.
- A team or project is just a user-named **Routing Rule**, not a separate type.
- **Agent Activity** is initiated through an **Agent Token**.
- An **Agent Tick Human** can view a feed of **Agent Activity** routed to them across all their **Workspaces** or filtered to one **Workspace**.
- **Routing Rules** use the agent's **Agent Assignment** and activity context to route all matched **Agent Activity** to selected **Workspace Members** and their **Approval Devices** or other **Remote Approval Surfaces**.
- A **Routing Rule** can match an agent and require one, all, or another number of routed **Responses**.
- If a **Routing Rule**'s exact required Response count exceeds its recipient count, it is clamped to all recipients.
- An agent in a **Shared Workspace** needs an explicit **Routing Rule** before its activity can route.
- **Routing Rules** have no enabled, disabled, or archived lifecycle state; they either exist with at least one recipient or are hard-deleted.
- Deleting a **Routing Rule** can leave assigned agents unrouted.
- Unrouted Shared Workspace agents fail with setup instructions rather than silently routing to administrators.
- Creating or authorizing an agent in a **Shared Workspace** may create an unrouted agent.
- An unrouted Shared Workspace agent is connected but not ready until a **Routing Rule** is assigned.
- Shared Workspace agent setup is complete only when a connected agent has a **Routing Rule** assignment.
- A **Status Update** is **Agent Activity** but not an **Agent Tick Request**.
- **Steering** and **Sanctions** are represented as distinct **Agent Tick Request** types when remote routing is available.
- A **Response** belongs to exactly one **Agent Tick Request** and one **Agent Tick Human**.
- A **Routing Rule** can require one or more **Responses** for any **Agent Tick Request**, including **Steering** and **Sanctions**.
- Required **Responses** are evaluated against the recipient set snapshotted when the **Agent Tick Request** is created, regardless of whether those recipients currently have active **Approval Devices**.
- In multi-response Requests, the first choice to reach the required **Response** count becomes the final answer returned to the agent.
- Once a choice reaches quorum, remaining unanswered surfaces for that **Agent Tick Request** are resolved or closed.
- Submitted **Responses** are visible to routed recipients and kept in request history even when they are not the final winning choice.
- Multi-select **Steering** is still **Steering**; questionnaire-style presentation is only a way to collect the answer.
- **Steering** requires a structured choice set with a caller-provided decline option rather than an implicit hidden cancellation path.
- In multi-select **Steering**, decline choices are mutually exclusive with normal choices.
- An **Agentic Decision** returns only structured choices, not human-written comments or freeform instructions.
- The **MCP Adapter** uses an **Agent Token** provisioned through human sign-in.
- A **Mirrored Prompt** has exactly one **Local Prompt** and exactly one **Agent Tick Request**.
- A **Remote Approval Surface** answers an **Agent Tick Request**.
- A **Personal Console** may show **Entitlement Status** but does not manage purchases.
- A **Trial** starts from the app-store/RevenueCat entitlement path, not first local app open.
- An **App Purchase** unlocks ongoing personal Native App use with Self-Hosted Deployments and does not include an extra hosted-service month.
- A **Personal Hosted Subscription** is required for ongoing hosted personal service after the **Trial**.
- A **Personal Console** can create a **Test Request** to verify request routing to intended **Remote Approval Surfaces**.
- A **Personal Console** can create a **Test Status Update** to verify status delivery to intended **Remote Approval Surfaces**.
- A **Personal Console** can act as a **Remote Approval Surface** when web request handling is available.
- A **Personal Console** prioritizes the signed-in human's setup path before **Workspace** administration.
- In a **Shared Workspace**, the Personal Console's phone setup state reflects the signed-in human's active **Approval Device**; workflow tests reveal other recipients' delivery readiness.
- A **Test Request** is an **Agent Tick Request** but not an **Agentic Decision**.
- A **Test Request** may use **Steering** or **Sanction** presentation to verify request notification and response paths while remaining labeled as a test.
- A **Test Request** follows the same recipient and response flow as the path being tested; a personal setup test verifies the default personal route, while a Workspace workflow test may reach multiple eligible humans.
- A **Personal Console** uses setup tests for the active Workspace's basic route and Settings tests for specific **Routing Rules**.
- In a **Personal Workspace**, setup tests use the implicit sole-member route.
- In a **Shared Workspace**, setup tests use the selected or first routed agent's **Routing Rule**.
- When multiple connected or routed agents are available, setup tests let the human choose which agent route to test.
- Unrouted Shared Workspace agents may appear in test selectors as disabled with a routing-required warning.
- Any **Workspace Member** may run workflow tests for that **Workspace**.
- **Shared Workspace** roles are Owner, Admin, and Member regardless of how membership is authenticated.
- Clerk-backed **Shared Workspaces** mirror Clerk organization membership and role changes into Workspace Member records through verified webhooks and on-demand sign-in sync.
- Removing a **Workspace Member** removes them from **Routing Rule** recipient lists; rules with no valid recipients are removed from assigned Agent Tokens, leaving those tokens unrouted.
- **Shared Workspace** Admins and Owners may create or edit **Routing Rules** or agent tokens.
- **Shared Workspace** Owners additionally control billing, naming, and destructive Workspace lifecycle actions.
- A **Test Request** uses a short **Request Deadline** so unanswered setup tests do not linger.
- **Test Requests** and **Test Status Updates** remain labeled as setup tests or workflow tests when shown alongside real agent activity and do not pretend to come from the connected agent.
- A **Local Prompt** can resolve a **Mirrored Prompt** without becoming a remote Agent Tick human response.
- A **Local-only Prompt** has no corresponding **Agent Tick Request**.
- A **Mirrored Prompt** is preferred for configured MCP flows; a **Local-only Prompt** is an explicit mode, not a substitute for missing setup.
- Both **Steering** and **Sanctions** may use a **Local-only Prompt** when explicitly requested.
- A **Mirrored Prompt** can leave a **Resolved Request** when its **Local Prompt** wins the race, including local decline, cancellation, or timeout.
- An unanswered **Agent Tick Request** should become a **Resolved Request** when the MCP tool reaches its **Request Deadline**.
- A **Resolved Request** from a locally answered **Mirrored Prompt** can record constrained structured local outcome metadata without becoming a remote Agent Tick response.

## Example dialogue

> **Dev:** "If a phone response and terminal response both arrive for a **Sanction**, do we need two approvals?"
> **Domain expert:** "No — this is a **Mirrored Prompt**. Whichever surface answers first resolves it, and the other surface is resolved or closed."
>
> **Dev:** "When Jane uses Agent Tick alone, is Jane herself the Workspace?"
> **Domain expert:** "No — Jane has a **Personal Workspace** with one **Workspace Member**. The distinction matters once Jane joins or creates another Workspace."
>
> **Dev:** "Does an agent route a request to the Workspace?"
> **Domain expert:** "Not directly. The agent uses an **Agent Token** in a **Workspace**; its **Agent Assignment** and the Workspace's **Routing Rules** decide which **Workspace Members** receive the activity."
>
> **Dev:** "Can the **Personal Console** create a quick approval to check whether the phone is connected?"
> **Domain expert:** "Yes, but call it a **Test Request**. It verifies the intended **Remote Approval Surface** and is not an **Agentic Decision** because no agent is waiting for the answer."

## Flagged ambiguities

- "local MCP elicitation" could mean either an Agent Tick human decision or a local agent-client answer — resolved: it behaves like the Pi extension's local half of a **Mirrored Prompt**.
- "without Agent Tick config" could mean either failing MCP startup or falling back to the client prompt — resolved: the **MCP Adapter** fails with setup instructions when no Agent Token is configured.
- "abandoned" could mean either an unexplained cancellation or a local-won mirrored flow — resolved: use **Resolved Request** with a resolution reason/source and structured local outcome metadata when another path resolved the decision.
- "questionnaire" could mean a separate product primitive or the presentation used for multi-select **Steering** — resolved: new questionnaire-style collection should use **Steering**, while historical Questionnaire records may remain labeled as such.
- "freeform" or "comment" could mean extra context returned to the agent — resolved: **Agentic Decisions** must not return human-written comments or freeform instructions.
- "dashboard" could mean either the one-human setup/request surface or **Workspace** administration — resolved: use **Personal Console** for the default one-human workflow and keep **Workspace** administration secondary.
- "organization" and "local organization" were used for the Agent Tick container while external identity providers may also have organization concepts — resolved: use **Workspace** in Agent Tick user-facing language and **Shared Workspace** for multi-member Workspaces.
- "Workspace" could mean the routing target for activity — resolved: a **Workspace** is the top-level container; **Agent Assignments** and **Routing Rules** route activity inside it.
- "team", "project", "on-call", and "policy" can sound like unrelated product primitives — resolved: treat them as user-named or configured **Routing Rules**, not separate top-level mental models or database types.
- "phone connected to a workspace" could mean a physical device belongs to a Workspace — resolved: an **Approval Device** belongs to an **Agent Tick Human**; Workspace-specific routing or member preferences can select among that human's devices.
- "billing" could mean purchase management or read-only access state — resolved: the initial web surface shows **Entitlement Status** only; purchases and subscription changes are handled in the mobile app/app store for now.
- "trial" was used for both a local first-open timer and an app-store entitlement — resolved: **Trial** starts through the app-store/RevenueCat entitlement path, not on local first app open.
- "test request" could mean either a real agent dry-run or a console-created routing verification — resolved: use **Test Request** for the console-created routing verification, which does not have an agent waiting for the answer.
- "test request routing" could mean self-only setup routing or full workflow routing — resolved: a **Test Request** follows the recipient and response flow being tested.
- "vote" was used for individual quorum records — resolved: use **Response** for a human's answer to an **Agent Tick Request**.
- "approval rule", "request rule", and "policy" were used for routing/quorum configuration — resolved: use **Routing Rule** in user-facing language.
- "test status update" could mean either real agent progress or console-created setup verification — resolved: use **Test Status Update** for console-created status delivery verification.
