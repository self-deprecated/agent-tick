# Agent Tick competitor investigation: human approval for AI agents

Date: 2026-05-09

This is a best-effort market scan of products, open-source projects, framework features, and adjacent automation platforms that can compete with, substitute for, or inspire Agent Tick's human-approval workflow. The strongest direct competitors are products that let an agent pause a sensitive action, notify a human, collect an approve/reject/input decision, and return that decision to the agent with an audit trail.

## Executive summary

Agent Tick's current positioning is clear and valuable: a Docker-first approval gate with web dashboard, mobile approval app, CLI `request`/`guard`, SQLite persistence, org/team/policy/audit primitives, and self-hosted single mode with no required third-party identity provider.

The competitive market is already crowded in four overlapping buckets:

1. **Dedicated approval infrastructure**: HumanLayer, gotoHuman, Queuelo, Approve AI, AwaitHuman, HumanAssist, OKrunit, HITL Relay, HumanRail, HumanOps, HumanLatch, CodeVF, Arahi.
2. **MCP / agent governance gateways**: Preloop, Permit MCP Gateway, Airlock, call-a-human MCP, other open-source MCP HITL servers.
3. **Workflow automation platforms with approval steps**: Zapier Human in the Loop, n8n HITL for AI tool calls, Relay.app, OKrunit/Zapier/Make-style approval gateways, EnforcedFlow.
4. **Framework/runtime primitives**: LangGraph/LangChain interrupts, Cloudflare Agents `waitForApproval`, FastMCP Approval provider, PromptRails approvals, useworkflow hooks.

The setup pattern worth copying most aggressively is **zero- or near-zero-code onboarding**: one-command installers plus agent discovery flows that rewrite Claude Code/Cursor/Codex/Gemini/OpenCode configs; MCP servers that can be added with one `npx` command; Zapier/n8n nodes that non-developers can wire visually; and hosted products that create a secure review link without requiring reviewers to create accounts.


## Feature checkbox matrix: source, self-hosting, app, least privilege

Legend: ✅ = clear public evidence/current capability; ◐ = partial, enterprise-only, unclear, or depends on how you assemble it; ❌ = not found or not applicable in this scan.

**Bottom line:** Agent Tick is not the only project that can plausibly tick these boxes. Preloop is the closest public competitor that claims source-available/open-source core, self-hosting, its own approval surfaces, and least-privilege policy controls. However, Agent Tick appears to be the clearest **focused approval gate** in this scan that combines source-available licensing, Docker-first self-hosting, first-party web/mobile approval apps, agent-token/org/team/policy authorization, and a simple CLI approval workflow without needing an enterprise tier or a broader MCP/model gateway.

| Product | Source available / open source | Self-hostable | Own approval app / UI | Mobile/native app | Least-privilege controls | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **Agent Tick now** | ✅ BSL source-available repo | ✅ Docker-first self-hosting | ✅ Dashboard | ✅ Expo mobile app | ✅ Agent tokens, org/team/policy eligibility, admin roles | Baseline: focused approval gate. |
| HumanLayer | ❌ Not found | ◐ Enterprise private VPC/on-prem mentioned in third-party listing | ◐ API/CLI/React Embed; managed app unclear | ❌ Not found | ◐ Routing/permissions/RBAC on higher tiers | Strong SDK surface, not source/self-host-first. |
| Preloop | ✅ Apache/open-source core claimed | ✅ Self-hostable claimed | ✅ Control-plane UI/approval surfaces claimed | ✅ Mobile/watch approval claimed | ✅ MCP firewall, allow/deny/approval policies, budgets | Closest broad competitor; much larger governance gateway scope. |
| gotoHuman | ❌ Not found | ❌ Managed SaaS | ✅ Agent Inbox/templates | ❌ Not found | ◐ Team routing/workspaces; deeper controls on higher tiers | Strong app UX, not source/self-host. |
| Queuelo | ❌ Not found | ❌ Not found | ✅ Dashboard | ❌ Not found | ◐ Agents/API keys; policy depth unclear | Simple hosted approval queue. |
| Approve AI | ❌ Not found | ❌ Not found | ◐ Approval workflows/no-code; app details unclear | ❌ Not found | ✅/◐ Passkeys, e-sign proof, RBAC/audit claims | Best high-assurance user approval angle. |
| AwaitHuman | ❌ Not found | ❌ Not found | ✅ Web dashboard/white-label embed claimed | ✅ iOS/Android and desktop claimed | ◐ Routing/audit; explicit least-privilege controls unclear | Strong omnichannel app story, SaaS/beta. |
| HumanAssist | ❌ Not found | ❌ Not found | ◐ HITL platform UI implied | ❌ Not found | ◐ Agent-scoped keys/limits unclear | Similar direct HITL product; limited public detail. |
| HumanRail | ❌ Not found | ❌ Not found | ◐ Worker/task UI implied | ❌ Not found | ❌ Not central | External worker handoff, not internal least-privilege approval. |
| OKrunit | ❌ Not found | ◐ Dedicated instance enterprise, not self-host evidence | ✅ Dashboard | ❌ Not found | ✅/◐ Rules, routing, teams, SSO/SAML, IP/geo controls | Strong workflow gateway controls, SaaS-first. |
| HITL Relay | ❌ Not found | ❌ FAQ says no on-prem/VPC currently | ✅ App/local-agent model implied | ◐ Local in-app/mobile-device model implied | ◐ Agent-scoped API keys, E2EE interactions | Privacy/E2EE angle; not self-host. |
| HumanOps | ❌ Not found | ❌ Not found | ◐ Operator platform | ❌ Not found | ◐ Enterprise controls unclear | Marketplace/operator platform. |
| CodeVF | ❌ Not found | ❌ Not found | ❌ API-first | ❌ Not found | ❌ Not central | Human verification API. |
| Arahi AI | ❌ Not found | ❌ Not found | ✅ No-code automation platform | ❌ Not found | ◐ Business automation controls unclear | Approval feature inside broad SaaS platform. |
| HumanLatch | ❌ Not found | ❌ Not found | ✅/◐ Control-plane UI implied | ❌ Not found | ✅ Policy scoring/routing/audit positioning | Public detail limited. |
| Govyn approval workflows | ❌ Not found | ❌ Not found | ◐ Governance UI implied | ❌ Not found | ✅/◐ Approval workflow interception/policies | Governance product, limited setup evidence. |
| Permit MCP Gateway | ❌ Not source available | ✅/◐ On-prem/VPC on Enterprise | ✅ Consent/admin UI | ❌ Not found | ✅ Strong authz/RBAC/ABAC/ReBAC/trust levels | HITL is Enterprise-only; excellent least-privilege story. |
| Zapier Human in the Loop | ❌ Not source available | ❌ SaaS | ✅ Zapier workflow UI | ◐ Zapier mobile exists; approval-app specificity unclear | ◐ App auth/task permissions, not agent-token least privilege | Best no-code distribution. |
| n8n HITL | ✅ Source-available n8n platform | ✅ Self-hostable n8n | ✅ Workflow UI | ❌ Not found | ◐ Workflow credentials/permissions; agent policy less direct | Strong workflow-native self-host alternative. |
| Relay.app HITL | ❌ Not found | ❌ SaaS | ✅ Workflow UI | ❌ Not found | ◐ Workflow/app permissions | SaaS workflow feature. |
| EnforcedFlow | ❌ Not found | ❌ Not found | ✅ Approval links/batch UI | ❌ Not found | ✅/◐ Scoped expiring links | Strong guest-link pattern. |
| LangGraph / LangChain HITL | ✅ Open-source libraries | ✅ Self-hostable if you build/run it | ❌ No first-party approval app | ❌ No | ◐ Depends on application code | Primitive, not product. |
| Cloudflare Agents HITL | ❌ Platform source not available | ❌ Cloudflare platform | ◐ Workflow/platform UI | ❌ Not found | ◐ Cloudflare IAM/platform controls | Runtime primitive, not approval product. |
| FastMCP Approval | ✅ Open-source/library | ✅ Self-host in your MCP server | ❌ Uses MCP client approval cards | ❌ No | ◐ Depends on MCP server/app | Primitive, not centralized app. |
| PromptRails approvals | ❌ Not found | ❌ Not found | ✅/◐ Platform UI implied | ❌ Not found | ◐ Checkpoint config | Embedded platform feature. |
| useworkflow HITL | ❌ Not found | ◐ Depends on deployment | ❌ No approval app by itself | ❌ No | ◐ Depends on application code | SDK primitive. |
| call-a-human-mcp | ✅ Open source | ✅ Local/self-hosted MCP server | ◐ Slack/Telegram/macOS dialogs, no central app | ❌ No | ◐ Limited/local | Good solo/local pattern, not org product. |
| AndyRightNow HITL MCP | ✅ Open source | ✅ Local/self-hosted MCP server | ◐ Telegram/Slack/Discord/HTTP transports | ❌ No | ◐ Limited/local | Modular transports, not full product. |
| Airlock | ✅ Open source | ✅ Self-hosted gateway | ◐ TUI/webhook/chat channels; app unclear | ❌ Not found | ✅ Per-agent allowlists and approvals | Strong least-privilege gateway, lacks first-party mobile approval app. |
| human-loop-mcp | ✅ Open source | ✅ Local/self-hosted MCP server | ◐ Browser dialogs | ❌ No | ◐ Limited/local | Nice local browser UX. |
| GongRzhe HITL MCP | ✅ Open source | ✅ Local/self-hosted MCP server | ◐ GUI dialogs | ❌ No | ◐ Limited/local | Local GUI only. |
| TextForge | ❌ Not found | ❌ Not found | ✅ Email approval queue | ❌ Not found | ◐ Gmail OAuth/email-specific controls | Vertical email approval product. |

### What this means for positioning

- **Agent Tick should not claim to be the only source-available, self-hostable approval option.** Preloop, Airlock, n8n, LangGraph/LangChain, FastMCP, and several MCP projects satisfy parts of that claim.
- **Agent Tick can more defensibly claim the focused combination:** source-available + Docker self-hosting + first-party dashboard/mobile approval app + least-privilege agent-token/team/policy model + simple CLI approval gate.
- **The closest threat to the full checkbox set is Preloop**, but Preloop is a broader governance/model/MCP gateway. That can make Agent Tick's simpler setup and approval-focused UX a differentiator if Agent Tick closes the MCP/discovery gap.
- **Open-source MCP tools beat Agent Tick on local setup simplicity today**, but they generally lack durable org/team approval state, mobile approval, audit history, and self-hosted dashboard product polish.

## Competitive matrix

| Competitor | Category | Price / cost signal | Agents/harnesses and installation/ease | Approval channels / UX | Differences from Agent Tick | Setup ideas to copy |
| --- | --- | --- | --- | --- | --- | --- |
| [HumanLayer](https://humanlayer.dev/docs/integrations) | Dedicated HITL API + SDK | Third-party listing says free forever with 1,000 ops/month, Premium $500/mo, Enterprise custom. Pricing not obvious on main docs. | Python/TypeScript SDK; OpenAI, LangChain, CrewAI, ControlFlow, Chainlit, Vercel AI SDK, Mastra, FastAPI, Flask; install via `pip install humanlayer`, TypeScript SDK, CLI, and framework quickstarts. | Slack, email, React embeds; listing mentions Teams, SMS, RCS on higher tiers and Discord coming. | More SDK/framework-oriented than Agent Tick; has human-as-tool and omnichannel routing. Less obviously Docker/self-host-first in public docs. | Add decorator/helper SDKs around Agent Tick requests; create LangChain/CrewAI/Vercel AI SDK examples; add React/embed approval widget. |
| [Preloop](https://preloop.ai/) | Open-source agent control plane / MCP firewall / model gateway | Open-source core; enterprise edition for RBAC, quorum, AI-driven approvals, etc. Public page emphasizes free trial/demo rather than fixed SaaS pricing. | OpenClaw, Hermes, Claude Code, Codex CLI, Cursor, Gemini CLI, Windsurf, Cline, OpenCode, any MCP-compatible runtime; install with the site's curl-to-sh command, then `preloop agents discover` to import/rewrite local configs without SDK changes. | Mobile, watch, Slack, Mattermost, email, custom webhook; async polling mode. | Much broader: MCP firewall, AI model gateway, spend attribution, runtime sessions, EU AI Act evidence. Agent Tick is narrower/simpler approval service. | Highest-value setup model to copy: CLI discovery of installed agents, config backup, one-command MCP proxy insertion, policy templates. |
| [gotoHuman](https://www.gotohuman.com/) | Managed agent review inbox | Pricing page/search: Starter $39/mo, Team $99/mo, Growth $399/mo; 14-day Team trial; extra user pricing. | Platform-agnostic API/webhooks; n8n community node; MCP server at `gotohuman/gotohuman-mcp-server`. | Agent Inbox, customizable review templates, email + Slack; Team adds routing/API/MS Teams soon; Business adds audit logs. | Strong configurable review UI/templates and managed team workflow. Agent Tick has simpler approval models and self-hosting. | Add no-code approval template builder; make request forms configurable per token/team; publish MCP server with one-line install. |
| [Queuelo](https://queuelo.com/) | Lightweight approval infrastructure | Free: 50 approvals/mo, 1 agent, 24h history. Pro: $19/mo, unlimited approvals, 10 agents, 90-day history, email, webhooks. Team: $49/mo, unlimited agents/history, 5 seats, Slack, SLA. | Any agent via POST API; public page does not name frameworks. | Agent POSTs action; dashboard; notifications; webhooks on paid plans. | Very close to Agent Tick's narrow product surface but appears hosted/SaaS-first and simpler. | Copy simple pricing/limits clarity; landing page flow with "agent submits -> notify -> one-click decision". |
| [Approve AI](https://approvemy.ai/) | User approval with passkeys/e-signatures | Startup free: 1,000 API calls/mo. Pro: $99/mo, 10,000 API calls, 1-year history. Enterprise custom. | Python SDK, JS/TS SDK, API; LangChain/LangGraph, LlamaIndex, OpenAI SDK, Bedrock, Vertex/Gemini. | No-code integration; passkeys and e-sign approvals; analytics. | Focuses on legally binding user purchase/action approvals, fraud/chargeback reduction, ESIGN/eIDAS. Agent Tick is operator/team approval, not consumer e-sign. | Consider optional passkey-backed high-risk approval; stronger proof/receipt export for regulated actions. |
| [AwaitHuman](https://www.awaithuman.dev/) | Escalation-as-a-service / approval queues | Free during beta; future pricing TBD. | Existing OpenAI, Claude, or other LLM agents via webhook or `await_human()`-style function. | Push, email, SMS, Telegram, WhatsApp; web dashboard; native desktop and mobile apps claimed; white-label embed. | More about support escalation and human takeover with LLM reasoning traces; less CLI-focused. | Copy `await_human()` developer mental model, white-label/embed idea, and full reasoning/tool trace presentation. |
| [HumanAssist](https://humanassist.dev/) | Dedicated HITL platform | Search result: free $0/mo with 100 approvals/user/month, up to 3 users; paid $10/user monthly with 500 approvals/user/month. | Says works with popular frameworks and supports Python/TypeScript/API. | Slack, email, Discord. | Similar direct approval product; pricing is per user and approval quota. | Simple per-user quota presentation; Discord channel option. |
| [HumanRail](https://humanrail.dev/) | Human worker handoff / task routing | Public page did not expose clear pricing in search results. | LangChain, CrewAI, Vercel AI SDK, OpenAI Assistants, Claude; Python SDK; MCP server exists. | Webhook or polling; routes to vetted worker pool; structured schema-validated responses; worker payouts. | Not just approval by your team; outsources judgment to external workers. | Agent Tick could add "ask internal reviewer for structured fields" but should avoid outsourced worker marketplace unless strategic. |
| [OKrunit](https://okrunit.com/) | Approval gateway for automations/AI agents | Free: 100 requests/mo. Pro: $20/mo ($16 annual), unlimited requests, 15 connections/members, 90-day history. Business: $60/mo ($48 annual), SSO/SAML, multi-step approvals, 1-year history. Enterprise custom. | Zapier, Make, n8n, GitHub Actions, any API; Temporal integration package. | Email free; Slack/webhook paid; dashboard, scheduled approvals, rules engine, analytics. | Broader automation approval gateway with strong workflow integrations and billing docs. | Copy Zapier/Make/n8n connectors; add usage endpoint; add scheduled approval windows and multi-step approvals. |
| [Human-in-the-Loop Relay](https://humanintheloop-relay.com/pricing) | MCP/API HITL relay | Free $0/mo: 100 remote interactions, 20 E2EE interactions, 2 remote agents. Pro $14.99/mo. Max $29.99/mo unlimited. | MCP tools first; paid API + MCP; remote agents such as Claude Code or n8n; local in-app agents. | Real-time notifications; optional E2EE via CLI proxy and MCP tools. | Strong privacy/E2EE angle and low individual pricing. | Add E2EE mode or request payload encryption option for sensitive approval metadata. |
| [HumanOps](https://humanops.io/pricing) | Pay-per-task human operator platform | Pricing page search: no subscription/seat fees; first $1,000 in tasks free; 10% platform fee per successful task. | REST API + MCP for Claude, Cursor, any MCP agent. | Human operator execution/verification, escrow, AI guardian verification. | Human labor marketplace, not just approval of your own staff. | Maybe not core; copy pay-per-task clarity only if adding external expert review. |
| [CodeVF](https://codevf.com/) | Real humans verify AI decisions | Search result shows $0.0067/sec human time; example 20 sec = $0.13. | API returning structured JSON. | Human engineers verify low-confidence/risky actions. | External verifier marketplace. | Structured JSON response contract is useful; cost model not aligned with current product. |
| [Arahi AI human approval](https://arahi.ai/human-approval) | AI automation platform with approval mode | Plans start around $29/mo on pricing page; approval mode free to start. | Arahi agents / no-code automation platform; 1,500+ app claims. | Slack, email, dashboard; audit trail. | Approval is a feature inside a no-code AI employee platform rather than standalone infrastructure. | Make Agent Tick easy to embed into no-code automations and business templates. |
| [HumanLatch](https://humanlatch.verdictlayer.com/) | Approval control plane | No clear public pricing found. | Same API for Terraform bots, GitHub Actions agents, support automations, and internal copilots. | Policy scoring, approval routing, audit trail. | Similar governance framing; public detail is limited. | Copy risk scoring language and per-action policy match explanation. |
| [Govyn Approval Workflows](https://govynai.com/features/approval-workflows) | AI governance approval workflows | No clear public pricing found. | Intercepts agent requests before LLM provider/downstream service. | Approval workflows/rules, governance. | More AI governance/security product; less narrow approval CLI. | Position Agent Tick as operational approval evidence, not just notifications. |
| [Permit MCP Gateway](https://www.permit.io/mcp-gateway/pricing) | MCP auth/authorization gateway | Community free up to 1,000 MAU; Pro starts $25/mo up to 50,000 MAU; Enterprise custom. HITL approvals are Enterprise-only. | Cursor, Claude, VS Code Copilot, MCP clients/servers. | One gateway URL switch; auth, consent, policy, audit; enterprise HITL. | Authorization/consent platform first; HITL is advanced tier feature. | Add consent/permission receipts for agent-token-scoped permissions; support MCP gateway mode eventually. |
| [Zapier Human in the Loop / MCP](https://www.zapier.com/blog/human-in-the-loop-guide/) | Workflow automation approval step | Available on Zapier Pro and higher tiers; exact current plan cost depends on Zapier pricing. | Zapier workflows, Zapier Agents, Zapier MCP server, 8,000+ apps. | No-code pause/review/edit/add-data steps; MCP exposes HITL action to AI assistants. | Massive ecosystem and non-technical UX; expensive at scale and less self-hosted. | Build Zapier app/action or template; support approval links that do not require full account setup for casual reviewers. |
| [n8n HITL for AI tool calls](https://docs.n8n.io/advanced-ai/human-in-the-loop-tools/) | Workflow automation / self-hostable | n8n has source-available/self-hosted and cloud plans; HITL is platform feature. | n8n AI Agent node tools; LangChain-style n8n workflows. | Pause before selected tool calls; approve/deny; no-code workflow UI. | Directly competes for workflow-native AI agents, especially self-hosters. | Create an n8n community node for Agent Tick and docs that wrap tool calls. |
| [Relay.app human in loop](https://www.relay.app/features/human-in-the-loop) | Workflow automation with review | Pricing not collected in this scan. | Relay workflows and app integrations. | Review email before sending, approve outgoing actions, edit results. | Workflow SaaS feature, not agent-specific approval infra. | Copy inline edit-before-approve UX and workflow-native templates. |
| [EnforcedFlow](https://enforcedflow.com/extensions/human-in-the-loop) | Human-in-loop extension for automations | No clear pricing found. | Zapier, Make, API; any platform. | Secure expiring links; reviewers need no accounts; batch approval sessions. | Simple approval-link gateway. | Very relevant: add expiring unauthenticated/signed reviewer links with scoped permissions, and batch review mode. |
| [LangGraph / LangChain HITL](https://docs.langchain.com/oss/python/langchain/human-in-the-loop) | Framework primitive | Framework/platform pricing varies; open-source libraries plus LangGraph Platform. | LangChain/LangGraph agents and server API. | Interrupts pause execution; persisted state; human can review/edit/approve tool calls. | Developers can build approvals without a separate service; lacks Agent Tick's mobile/app/audit product unless assembled. | Add official LangGraph examples and adapter that stores interrupts in Agent Tick. |
| [Cloudflare Agents HITL](https://developers.cloudflare.com/agents/guides/human-in-the-loop/) | Runtime primitive | Cloudflare platform pricing; not a dedicated approval product. | Cloudflare Agents, Workflows, MCP elicitation. | `waitForApproval()` durable workflow approval; MCP elicitation. | Infrastructure primitive inside Cloudflare. | Add durable wait semantics and docs comparing webhook/poll/EventSource wait modes. |
| [FastMCP Approval provider](https://gofastmcp.com/apps/providers/approval) | MCP server/provider primitive | Open-source/library feature; pricing not applicable. | FastMCP servers and MCP clients. | `request_approval` tool shows approval card/buttons. | In-process UI card, not centralized org/mobile approval service. | Agent Tick MCP server should offer a similarly tiny tool surface: `request_approval`, `ask_human`, `notify_human`. |
| [PromptRails Approvals](https://promptrails.ai/docs/approvals) | Agent/workflow approval feature | Pricing not collected. | PromptRails workflows/agents. | Configurable checkpoints, webhook notifications, approve/reject. | Embedded platform feature. | Reusable policy checkpoint docs and webhook resume examples. |
| [useworkflow.dev Human-in-the-Loop](https://useworkflow.dev/docs/ai/human-in-the-loop) | Workflow SDK primitive | Pricing not collected. | Workflow SDK AI workflows. | `defineHook()` creates awaitable hook; pauses without compute until human acts. | Developer workflow primitive. | Copy `await hook` style for SDK ergonomics. |
| [call-a-human-mcp](https://github.com/nishantmodak/call-a-human-mcp) | Open-source MCP server | Free/open source. | Claude Desktop, Cursor, Windsurf, any MCP-compatible agent. | Slack, Telegram, macOS dialogs. | Lightweight local-first tool, no hosted org/team product. | Publish simple Agent Tick MCP server install snippets for Claude/Cursor/Windsurf. |
| [AndyRightNow/human-in-the-loop-mcp](https://github.com/AndyRightNow/human-in-the-loop-mcp/) | Open-source MCP server | Free/open source. | MCP-compatible clients. | Telegram, Slack, Discord/HTTP variants in repo docs. | Lightweight connector. | Copy transport modularity; make notification providers pluggable. |
| [airlock-dev/airlock](https://github.com/airlock-dev/airlock) | Open-source permissions-aware MCP gateway | Free/open source. | Claude Code, Cursor, OpenClaw, downstream MCP servers, CLI tools, REST APIs. | Telegram, Slack, webhook, TUI, maybe local channels. | More gateway/proxy oriented; closer to Preloop than Agent Tick. | Gateway mode and per-agent allowlists are valuable future scope. |
| [dzulfiikar/human-loop-mcp](https://github.com/dzulfiikar/human-loop-mcp) | Open-source browser-dialog MCP | Free/open source. | MCP clients. | Browser dialogs with questions/choices/attachments. | Local operator interaction, not team/mobile. | Attachments and polished local browser dialogs could improve dev-mode approvals. |
| [GongRzhe/Human-In-the-Loop-MCP-Server](https://github.com/GongRzhe/Human-In-the-Loop-MCP-Server) | Open-source GUI HITL MCP | Free/open source. | Claude and MCP assistants. | GUI dialogs, choices, confirmations, feedback. | Local GUI interaction only. | Add local desktop/browser notification path for self-hosted developers. |
| [TextForge](https://textforge.net/compare/textforge-vs-email-mcp-servers) | Email-specific MCP with mandatory approval | Pricing not collected. | MCP email workflows, Gmail OAuth. | Approval queue for email drafts, webhooks, attachments, Markdown-to-HTML. | Vertical solution for outbound email rather than general approval. | Create vertical examples: email send approval, production deploy approval, refund approval. |

## Competitor notes and implications

### 1. HumanLayer

HumanLayer is probably the closest developer-first SDK competitor. Its docs present HumanLayer as an API and SDK for approvals, feedback, and contacting humans, with quickstarts for Python and TypeScript and framework pages for LangChain, CrewAI, ControlFlow, Vercel AI SDK, and Mastra. Its differentiated surface includes "human as tool", routing to teams/individuals, escalations, timeouts, webhooks, and eventually learning/auto-approval from prior decisions.

**Threat to Agent Tick:** if developers are already in LangChain/CrewAI or want Slack/email-first routing, HumanLayer may feel easier than wrapping shell commands with `agent-tick guard`.

**Copy:** small framework adapters and decorator-style APIs. Agent Tick can still keep CLI-first ergonomics, but the SDK should make approval feel like `await tick.approve({ ... })` or a decorator around risky functions.

### 2. Preloop

Preloop is the most important setup/onboarding competitor. It does not merely expose an approval API; it installs a governance layer around local agents. The public page says the CLI discovers and onboards local configs for OpenClaw, Claude Code, Codex CLI, Cursor, Gemini CLI, Hermes, Windsurf, OpenCode, and other MCP-compatible runtimes, then rewrites them to route tool calls/model traffic through Preloop without SDK changes.

**Threat to Agent Tick:** Preloop can become the default "safe agent" install because it controls MCP tools, model spend, policy, audit, and approvals in one setup.

**Copy:** agent discovery and auto-configuration. Agent Tick should not need to become a full model gateway immediately, but a command such as `agent-tick integrate claude-code` or `agent-tick doctor --agents` would materially improve first-time setup.

### 3. gotoHuman

gotoHuman is a polished managed review inbox. It emphasizes customizable templates, team routing, API/webhooks, n8n support, and an MCP server. Pricing is concrete: Starter/Team/Growth/Business tiers, with user-seat expansion and history limits.

**Threat to Agent Tick:** business users may prefer configurable review forms and routing over a developer CLI.

**Copy:** request templates and reviewer forms. Agent Tick approvals could include typed fields, attachments, and custom choice sets per policy/team.

### 4. Queuelo

Queuelo is a concise, direct approval infrastructure service. Its page makes the value proposition obvious in three steps and publishes very simple pricing: free, $19 Pro, $49 Team.

**Threat to Agent Tick:** simple SaaS can beat richer self-hosting if the onboarding is faster.

**Copy:** crisp product copy, usage tiers, and a "first approval in 60 seconds" path.

### 5. Approve AI

Approve AI is differentiated by passkeys and e-signatures. It targets user approval for purchases or legally sensitive actions, not just internal operator approval. It advertises ESIGN/eIDAS compliance, passkey proof, audit logs, analytics, and support for major frameworks.

**Threat to Agent Tick:** in payments and consumer authorization, a plain approve/reject audit log may be insufficient.

**Copy:** optional strong approval proof: passkey challenge, signed approval receipt, immutable receipt export.

### 6. Automation platforms: Zapier, n8n, Relay, OKrunit, EnforcedFlow

Automation platforms have a distribution advantage: they live where business users already configure workflows. Zapier exposes Human in the Loop as a Pro+ feature and through MCP. n8n supports requiring approval before AI Agent node tools execute. OKrunit and EnforcedFlow wrap Zapier/Make/n8n/API approvals with a dedicated queue.

**Threat to Agent Tick:** non-technical users will solve approvals inside Zapier/n8n rather than install a separate service.

**Copy:** build connectors. The fastest path is likely an n8n node and Zapier app/action that create Agent Tick requests and resume workflows based on the decision.

### 7. Open-source MCP tools

The GitHub MCP projects demonstrate how low the bar is for local human approval: install an MCP server, configure Claude/Cursor/Windsurf, and get Slack/Telegram/macOS/browser approval dialogs.

**Threat to Agent Tick:** for solo developers, free local MCP tools may be "good enough".

**Copy:** make Agent Tick's MCP story equally easy but with stronger persistence, mobile, audit, org/team policy, and self-hosting.

## Installation and ease ranking

| Rank | Product / pattern | Why it is easy | What Agent Tick can copy |
| --- | --- | --- | --- |
| 1 | Preloop CLI discovery | Finds existing agent configs, backs them up, rewrites endpoints, no SDK changes. | Add `agent-tick discover` and per-agent config writers for Claude Code, Cursor, Codex, Gemini, Windsurf, OpenCode. |
| 2 | MCP servers via `npx` / config snippet | One package added to an MCP client config. | Publish `@agent-tick/mcp` or `agent-tick mcp` only when implemented; include copy-paste JSON snippets. |
| 3 | Zapier/n8n nodes | Non-developers add approval steps visually. | Build n8n community node first; Zapier action second. |
| 4 | `await_human()` / `await hook` SDK primitives | Clear mental model for developers writing async agents. | Add SDK helpers with durable wait, timeout, abandon, and typed decision result. |
| 5 | Secure review links | Reviewers click a link and do not need setup. | Add optional expiring, scoped approval links with no full dashboard onboarding for guest/incident reviewers. |
| 6 | Docker Compose self-hosting | Strong for infra-minded teams but heavier than SaaS. | Keep as Agent Tick strength; add a post-start wizard and health/setup checklist. |

## Pricing observations

- The cheapest direct SaaS competitors publish hobby/free tiers: Queuelo (50 approvals/mo), Approve AI (1,000 API calls/mo), OKrunit (100 approvals/mo), HITL Relay (100 remote interactions/mo), HumanAssist (100 approvals/user/mo).
- Low-end paid prices cluster around **$15-20/mo** for individual/pro tiers: Queuelo Pro $19, OKrunit Pro $20, HITL Relay Pro $14.99.
- Team products cluster around **$49-99/mo** entry team plans: Queuelo Team $49, gotoHuman Team $99, Approve AI Pro $99.
- Enterprise/gateway platforms avoid fixed pricing and sell custom deployments: Preloop Enterprise, Permit Enterprise, HumanLayer Enterprise, OKrunit Enterprise.
- External human-worker platforms use usage/task-time models: CodeVF per-second human time, HumanOps 10% per completed task.

## Agent / harness coverage observations

Competitors most often name these integration surfaces:

- **Coding agents / IDEs:** Claude Code, Cursor, Codex CLI, Gemini CLI, Windsurf, Cline, OpenCode, OpenClaw, VS Code Copilot.
- **MCP:** the dominant interoperability layer for local agent tooling and approvals.
- **Agent frameworks:** LangChain, LangGraph, CrewAI, LlamaIndex, Vercel AI SDK, Mastra, ControlFlow, OpenAI Assistants/SDK, Bedrock, Vertex/Gemini.
- **Automation platforms:** Zapier, Make, n8n, GitHub Actions, Temporal.
- **Notification/review channels:** dashboard, mobile app, email, Slack, Teams, Discord, Telegram, WhatsApp, SMS, macOS/browser dialogs, webhooks.

Agent Tick currently has dashboard, mobile, CLI, GitHub Actions, and generic notification webhook. The biggest missing coverage is MCP, agent-framework SDK adapters, Slack/Teams/Discord/Telegram-specific channels, and n8n/Zapier connectors.

## Meta report: recommendations for Agent Tick

### Highest priority copies

1. **One-command agent discovery and setup**
   - Add `agent-tick discover` to detect Claude Code, Cursor, Codex CLI, Gemini CLI, Windsurf, OpenCode, MCP configs, GitHub Actions, and common repo scripts.
   - Add `agent-tick integrate <target>` commands that write config snippets or wrappers after showing a diff and taking confirmation.
   - This borrows Preloop's biggest onboarding advantage without requiring Agent Tick to become a full governance gateway immediately.

2. **MCP server integration**
   - Implement a small MCP server with tools such as `request_approval`, `ask_human`, and `notify_human`.
   - Provide install snippets for Claude Desktop/Code, Cursor, Windsurf, Cline, OpenCode, Codex/Gemini where applicable.
   - Keep the MCP surface narrow and tested; do not document it as current until implemented.

3. **SDK ergonomics: `await tick.approve()`**
   - Add TypeScript and Python examples/helpers for durable approval waits.
   - Framework examples: LangGraph interrupt bridge, LangChain tool wrapper, CrewAI tool, Vercel AI SDK tool, OpenAI function/tool calling.
   - Use typed Zod schemas from `packages/shared` to return typed approval decisions.

4. **No-code workflow connectors**
   - Build an n8n community node first because n8n is AI-native and self-host-friendly.
   - Then add Zapier and Make templates/actions.
   - Include recipes for deploy approval, refund approval, outbound email approval, database migration approval, and payment approval.

5. **Approval templates and richer review forms**
   - Let teams define templates with required fields, custom choices, risk labels, links, attachments, and reviewer guidance.
   - Use templates in CLI/SDK/MCP requests by ID.
   - Competitors like gotoHuman and workflow platforms make the review context feel structured; Agent Tick should not be limited to title/body/command forever.

6. **Secure expiring guest approval links**
   - Add optional scoped one-use or short-lived links for reviewers who should not need a full account.
   - This is useful for incident response, consultants, or customer approval flows.
   - Keep default org-authenticated approvals for high-security teams.

7. **Notification channel expansion**
   - Add first-class Slack and Teams before less common channels.
   - Consider Discord/Telegram for developer communities and solo users.
   - Preserve the current generic webhook sink for custom integrations.

### Medium priority copies

8. **Passkey-backed high-assurance approvals**
   - Inspired by Approve AI. Useful for payment, procurement, production, and legal workflows.
   - Could produce signed approval receipts without turning Agent Tick into an e-signature company.

9. **Policy explanation and risk scoring**
   - Borrow HumanLatch/Preloop language: show matched policy, risk score, reason approval is required, and audit evidence.
   - Helps reviewers decide faster and improves compliance posture.

10. **Batch approval mode**
   - Inspired by EnforcedFlow and approval queues.
   - Let reviewers approve/reject a queue quickly, especially for repetitive low-risk requests.

11. **E2EE or payload redaction mode**
   - Inspired by HITL Relay and Preloop redaction claims.
   - Let agents send sensitive fields encrypted or redacted in notifications, with full detail only in the dashboard/mobile app.

12. **Usage and billing transparency**
   - Publish usage endpoints and clear plan limits if/when hosted pricing is formalized.
   - OKrunit's billing docs are a good model.

### Lower priority or avoid for now

13. **External human worker marketplace**
   - HumanRail, HumanOps, and CodeVF route tasks to paid humans. This is a different business with quality, labor, marketplace, and compliance complexity.
   - Agent Tick should first dominate approvals by the user's own team.

14. **Full model gateway / spend control**
   - Preloop's model gateway is powerful but expands scope substantially.
   - Agent Tick can integrate with gateways later; near-term differentiation is approval setup and review UX.

15. **Broad no-code AI employee platform**
   - Arahi-style AI automation platform is too broad. Agent Tick should remain the approval layer that such platforms can call.

## Suggested concrete roadmap slices

1. **MCP MVP**
   - `agent-tick mcp` or separate package.
   - Tools: `request_approval`, `wait_for_approval`, `ask_human`.
   - Docs: Claude Code/Cursor/Windsurf config snippets.
   - Validation: integration tests with mocked MCP client.

2. **n8n node**
   - Create approval request, wait/poll for decision, branch on approve/reject.
   - Include self-hosted server URL/token config.

3. **Agent discovery CLI**
   - Read-only `agent-tick discover` first.
   - Show detected MCP config files, shell availability, GitHub workflow files, package scripts.
   - Later add guarded write mode.

4. **Templates**
   - Server schema for approval templates.
   - Dashboard editor.
   - CLI/SDK `--template` support.

5. **Slack/Teams notifications**
   - Start with incoming webhooks or Slack app, but avoid bearer tokens in URLs.
   - Keep request details minimal by default and link to Agent Tick for sensitive context.

## Source index

- HumanLayer docs: <https://humanlayer.dev/docs/integrations>
- HumanLayer third-party profile/pricing: <https://everydev.ai/tools/humanlayer>
- Preloop: <https://preloop.ai/>
- gotoHuman: <https://www.gotohuman.com/> and <https://www.gotohuman.com/pricing>
- Queuelo: <https://queuelo.com/>
- Approve AI: <https://approvemy.ai/>
- AwaitHuman: <https://www.awaithuman.dev/>
- HumanAssist: <https://humanassist.dev/>
- HumanRail: <https://humanrail.dev/>
- OKrunit: <https://okrunit.com/> and <https://www.okrunit.com/docs/billing>
- HITL Relay: <https://humanintheloop-relay.com/pricing>
- HumanOps: <https://humanops.io/pricing>
- CodeVF: <https://codevf.com/>
- Arahi AI: <https://arahi.ai/human-approval>
- HumanLatch: <https://humanlatch.verdictlayer.com/>
- Govyn approval workflows: <https://govynai.com/features/approval-workflows>
- Permit MCP Gateway: <https://www.permit.io/mcp-gateway/pricing>
- Zapier Human in the Loop: <https://www.zapier.com/blog/human-in-the-loop-guide/> and <https://zapier.com/mcp/human-in-the-loop>
- n8n HITL tools: <https://docs.n8n.io/advanced-ai/human-in-the-loop-tools/>
- Relay.app HITL: <https://www.relay.app/features/human-in-the-loop>
- EnforcedFlow HITL: <https://enforcedflow.com/extensions/human-in-the-loop>
- LangChain/LangGraph HITL: <https://docs.langchain.com/oss/python/langchain/human-in-the-loop> and <https://docs.langchain.com/langgraph-platform/add-human-in-the-loop>
- Cloudflare Agents HITL: <https://developers.cloudflare.com/agents/guides/human-in-the-loop/>
- FastMCP Approval: <https://gofastmcp.com/apps/providers/approval>
- PromptRails approvals: <https://promptrails.ai/docs/approvals>
- useworkflow HITL: <https://useworkflow.dev/docs/ai/human-in-the-loop>
- call-a-human-mcp: <https://github.com/nishantmodak/call-a-human-mcp>
- AndyRightNow/human-in-the-loop-mcp: <https://github.com/AndyRightNow/human-in-the-loop-mcp/>
- airlock-dev/airlock: <https://github.com/airlock-dev/airlock>
- dzulfiikar/human-loop-mcp: <https://github.com/dzulfiikar/human-loop-mcp>
- GongRzhe/Human-In-the-Loop-MCP-Server: <https://github.com/GongRzhe/Human-In-the-Loop-MCP-Server>
- TextForge comparison: <https://textforge.net/compare/textforge-vs-email-mcp-servers>
