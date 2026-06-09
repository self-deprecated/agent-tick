# Agent Tick

<p align="center">
  <img src="./media/readme/agent-tick-hero.gif" alt="Agent Tick mirrors a Pi steering question to the mobile app; answering on the phone resolves the waiting terminal request." width="900" />
</p>

**Let coding agents ask before they do sensitive work.**

Agent Tick mirrors bounded requests from local coding agents to trusted humans. It works across agent surfaces — including **Claude Code**, **Codex**, **Pi**, and other local coding agents — so teams can keep one human-in-the-loop layer as their agent stack changes.

Agents can send **Status Updates**, ask **Steering** questions, and request **Sanctions** before risky actions — without turning the Native App, hosted service, or Personal Console into a remote shell.

<p align="center">
  <a href="https://agenttick.sh/?utm_campaign=agent-tick-readme&utm_content=readme-product-surface-marketing&utm_medium=referral&utm_source=github"><b>Website</b></a> ·
  <a href="https://app.agenttick.sh/?utm_campaign=agent-tick-readme&utm_content=readme-product-surface-app&utm_medium=referral&utm_source=github"><b>Hosted app</b></a> ·
  <a href="https://docs.agenttick.sh/?utm_campaign=agent-tick-readme&utm_content=readme-product-surface-docs&utm_medium=referral&utm_source=github"><b>Docs</b></a> ·
  <a href="./SELFHOSTING.md"><b>Self-hosting</b></a>
</p>

<p align="center">
  <a href="https://get.agenttick.sh/ios"><img src="https://img.shields.io/badge/iOS-App%20Store-0D1117?logo=apple&logoColor=white" alt="Download Agent Tick on the App Store" /></a>
  <a href="https://get.agenttick.sh/android"><img src="https://img.shields.io/badge/Android-Google%20Play-0D1117?logo=googleplay&logoColor=white" alt="Get Agent Tick on Google Play" /></a>
</p>

## Why Agent Tick?

Coding agents are most useful when they can keep working independently, but they still need crisp human input at the right moments.

Agent Tick gives them a least-permission request layer:

- **Status Updates** — lightweight progress notes from local agent sessions.
- **Steering** — bounded questions with structured choices when the agent needs direction.
- **Sanctions** — explicit approval before sensitive commands, deploys, migrations, or policy-relevant work.

The agent asks once. The same request can appear in the local agent interface and in the Agent Tick Native App. The first answer resolves the request everywhere, then local work continues.

## Get started

Most users should start with the [hosted service](https://app.agenttick.sh/?utm_campaign=agent-tick-readme&utm_content=readme-start-hosted-service&utm_medium=referral&utm_source=github).

For guided setup, paste this into your coding agent chat on the machine you want to configure:

```text
Fetch and follow the Agent Tick setup skill from:
https://agenttick.sh/skill

Use that skill to set up Agent Tick on this machine.
Ask me which coding agent I am using and what kind of work I want routed Requests for.
Walk me through enabling status updates, steering, and sanctions, and let me opt out of any of the three.
Use the right integration for this agent.
Run a dry run first and explain what will change.
Install only after I confirm, then verify it works.
```

Prefer to set it up yourself?

```sh
npx @self-deprecated/agent-tick install
```

This command runs the CLI, connects this machine to Agent Tick, stores a local `agent_...` token, detects local coding-agent configs, and installs supported integrations where available.

Launch integrations include Claude Code and Codex through MCP, optional Claude Code permission hooks, and Pi through the native extension. The CLI can also be used directly from other agents or automation, with additional agent-specific integrations planned as their hook/config behavior is verified.

## Self-hosting

Agent Tick is source-available and self-hostable for teams that need to operate request routing on their own infrastructure. Self-hosting is not the default onboarding path; start with [SELFHOSTING.md](./SELFHOSTING.md) if you need it.

## Development and docs

- [docs/index.md](./docs/index.md) — public documentation source for docs.agenttick.sh
- [docs/quick-start.md](./docs/quick-start.md) — connect a machine and send safe test requests
- [docs/coding-agent-integrations.md](./docs/coding-agent-integrations.md) — public coding-agent integration setup guides
- [docs/self-hosting.md](./docs/self-hosting.md) — self-hosting quick start used by the docs site
- [SELFHOSTING.md](./SELFHOSTING.md) — full repository-level self-hosting reference
- [DEVELOPMENT.md](./DEVELOPMENT.md) — local development workflow
- [CONTRIBUTING.md](./CONTRIBUTING.md) — contribution and public mirror policy

## License

Agent Tick is source-available under the [Business Source License 1.1](./LICENSE) (BSL 1.1). You may use, modify, and self-host it internally — including for commercial purposes — but you may not offer Agent Tick as a hosted or managed service to third parties. The license converts to Apache 2.0 on 2028-05-31.
