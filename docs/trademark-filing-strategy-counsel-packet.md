# Agent Tick trademark filing strategy counsel packet

This packet prepares the `Agent Tick` filing-strategy decision for IP counsel. It is not legal advice and does not record a final filing decision until counsel confirms the owner, goods/services, classes, and jurisdiction plan.

Related repo evidence:

- [Agent Tick trademark knockout search memo](./trademark-knockout-search.md)
- [Agent Tick IP ownership packet](./ip-ownership-packet.md)

## Decision needed

Fizzy #59 asks the owner and IP counsel to choose one of these launch strategies:

1. **Minimal** — file only the most important word-mark application in the first launch jurisdiction.
2. **EU-first** — prioritize EU coverage for the apparent owner/operating base, then stage other filings.
3. **Global staged** — file in multiple priority jurisdictions early, preserving expansion options and reducing squatting risk.

The decision should also confirm:

- owner entity and address
- whether the filing is a word mark, stylized mark, logo/checkmark mark, or a staged mix
- Nice classes and goods/services descriptions
- whether `agenttick.sh`, app-store names, package names, and social handles need adjustment before filing
- whether any knockout finding requires a deeper clearance search before first filing

## Current facts to give counsel

| Topic | Current repo/product fact |
| --- | --- |
| Product name | `Agent Tick` |
| Current attribution | `Self-Deprecated`; `LICENSE` names `Self-Deprecated ApS` as licensor/copyright holder for `agent-tick` |
| Product surfaces | Hosted web app, API, CLI, docs, mobile app, source-available/self-hosted server |
| Domains in use | `agenttick.sh`, `app.agenttick.sh`, `api.agenttick.sh`, `docs.agenttick.sh` |
| Mobile identifiers | iOS bundle id `ai.selfdeprecated.agenttick`; Android package id `ai.selfdeprecated.agenttick` |
| Core description | Least-permission approvals for coding agents: status updates, bounded steering choices, and sanctions/approval decisions |
| Explicit boundary | Agent Tick is not a remote shell, remote desktop, broad agent control plane, or arbitrary remote prompt channel |
| Knockout concerns | `Agentick` AI/developer projects, `TickTick` app/task mark, `TICK.md`/`tick-md`, crowded AI `Agent...` marks |

## Strategy options

### Option A — minimal first filing

Summary: file the `Agent Tick` word mark in the first launch jurisdiction only, after counsel completes clearance.

Likely best when:

- budget is limited
- launch is small and early
- counsel thinks the knockout risks are manageable but wants narrower initial spend
- the owner can tolerate later foreign-filing cost/priority tradeoffs

Pros:

- lowest immediate legal spend
- fastest path to a basic filing record
- easier to revise before wider international spend if counsel finds issues

Cons:

- weaker international priority/squatting posture
- may not protect key app-store or SaaS markets in time
- may require later filings without the same priority benefit if deadlines are missed

Counsel questions:

- What is the single best first jurisdiction for `Self-Deprecated ApS`?
- Is a US filing still worth doing first if commercial use or target customers are US-heavy?
- Should the first filing be word mark only, leaving stylized/checkmark marks until after design provenance is complete?

### Option B — EU-first strategy

Summary: file an EU word-mark application first, then decide whether to add US/UK/other jurisdictions within priority windows.

Likely best when:

- the owner entity is Danish/EU-based
- early launch and business operations are centered in Europe
- the owner wants one regional filing with broad EU coverage before expanding
- budget supports a meaningful first filing but not full global coverage

Pros:

- aligns with an EU owner/operating base if counsel confirms `Self-Deprecated ApS` as owner
- one application can cover all EU member states
- creates a structured decision point for later US/UK/international filings

Cons:

- does not by itself protect the US, UK, Canada, Australia, or other likely developer markets
- EU opposition/clearance analysis may differ from US analysis
- app-store launch is global by default unless restricted

Counsel questions:

- Is `Agent Tick` distinctive enough under EUIPO practice for the relevant software/SaaS classes?
- Does `TickTick` or any EU `Agentick`/`Tick` use materially increase refusal/opposition risk?
- Should US/UK filings be budgeted immediately or within a priority window?

### Option C — global staged strategy

Summary: complete clearance, file a core word mark in priority jurisdictions early, and reserve stylized/logo filings for a second stage once brand assets are final.

Example first stage for counsel to evaluate:

- EU word mark
- US word mark
- UK word mark
- optional Canada/Australia depending on launch markets and app-store exposure

Pros:

- strongest early posture against copycats and squatting
- better fit for global app-store / developer-tool distribution
- creates consistent counsel-reviewed goods/services across jurisdictions

Cons:

- highest cost
- requires more clearance work before filing
- more exposure to office actions/oppositions in multiple jurisdictions
- may be premature if product positioning or name could still change after counsel review

Counsel questions:

- Which markets justify first-stage filing based on launch plans and customer location?
- Should the owner use Madrid Protocol later, or direct national/regional filings now?
- Which filings should wait until the checkmark/logo provenance and design strategy are settled?

## Proposed counsel recommendation template

Counsel should complete this section before the card is closed.

```text
Recommended strategy: [minimal / EU-first / global staged / other]

Owner entity:
Legal name:
Jurisdiction:
Address for filing:

Mark(s) to file now:
- [ ] Agent Tick word mark
- [ ] stylized Agent Tick mark
- [ ] checkmark/logo mark
- [ ] other:

Jurisdictions to file now:
- [ ] EU
- [ ] US
- [ ] UK
- [ ] Canada
- [ ] Australia
- [ ] other:

Priority-window follow-up jurisdictions:

Proposed Nice classes and descriptions:

Clearance blockers or required deeper searches:

Required product/website/app-store changes before filing:

Decision owner approval:
Counsel approval:
Date:
```

## Draft goods/services areas for counsel to refine

These are product-context prompts, not filing language:

- downloadable computer software for routing approval requests, status updates, and structured user decisions from local software agents
- downloadable mobile applications for receiving and responding to bounded approval requests from software development agents
- software-as-a-service for human-in-the-loop approval routing, team approval workflows, audit history, and agent-token/device management
- self-hostable server software for approval routing and workflow authorization
- developer tooling, CLI software, SDKs, and integrations for approval gates in software development workflows

Counsel should narrow these to actual use/intent-to-use and jurisdiction-specific language. Avoid goods/services wording that implies remote command execution, remote desktop control, broad AI governance, or legal/e-signature proof unless the product and filing strategy intentionally cover those areas.

## Recommended interim plan pending counsel

Pending counsel response, the repo-side recommendation is:

1. Treat `Agent Tick` word mark clearance as the first priority.
2. Do not file the checkmark/logo mark until design provenance and distinctiveness questions from the IP packet are answered.
3. Use the full `Agent Tick` name consistently; avoid shortening to `Tick`.
4. Avoid `®` and avoid “registered trademark” claims.
5. Preserve launch evidence: dated website screenshots, docs pages, app-store drafts, package releases, and commits.
6. Ask counsel whether `Agentick` no-space uses require outreach, coexistence analysis, or a name-adjustment discussion before filing.

## Decision log

| Date | Decision | Evidence | Owner/counsel |
| --- | --- | --- | --- |
| 2026-05-16 | Repo packet prepared; no final filing strategy selected in repo because counsel confirmation is still required. | This packet, knockout memo, IP ownership packet | Pending owner + counsel |

## Card status

This packet makes Fizzy #59 ready for owner/counsel decision, but it does **not** satisfy the final done criteria by itself. Close #59 only after counsel and the owner choose a filing strategy and confirm classes and owner entity.
