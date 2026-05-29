# Agent Tick Context Map

Agent Tick is the first Self Deprecated product and has product-level language that spans multiple Projects in the monorepo. This map explains which context file applies where.

## Context layers

1. **Agent Tick product context**
   - Location: [`./CONTEXT.md`](./CONTEXT.md)
   - Scope: cross-surface Agent Tick direction, product model, launch posture, business model, positioning, legal/privacy posture, pricing, and coordination between Agent Tick Projects.
   - Visibility: private to the Self Deprecated monorepo unless intentionally copied into a public mirror.

2. **Agent Tick public context**
   - Location: [`./CONTEXT.public.md`](./CONTEXT.public.md)
   - Scope: public-safe contributor/product language for mirrors of the core Agent Tick repository.
   - Visibility: safe default for public source-available repository publication.

3. **Surface-specific context**
   - Locations: sibling Project contexts such as [`../agenttick.sh/CONTEXT.md`](../agenttick.sh/CONTEXT.md) and [`../pi-agent-tick/CONTEXT.md`](../pi-agent-tick/CONTEXT.md).
   - Scope: terms and behavior that are specific to a product surface, integration, site, package, or host.
   - Visibility: follows the Project or mirror target.

4. **Private Agent Tick mono-sd docs**
   - Location: [`../../docs/agent-tick/`](../../docs/agent-tick/)
   - Scope: private planning, strategy, legal, launch, operations, app-store, privacy-support, research, archive, and owner-facing Agent Tick material.
   - Visibility: private to the Self Deprecated monorepo; intentionally outside `projects/agent-tick` so public mirrors do not include it.

5. **Monorepo context**
   - Location: [`../../CONTEXT.md`](../../CONTEXT.md) and [`../../docs/monorepo-context.md`](../../docs/monorepo-context.md)
   - Scope: Self Deprecated monorepo layout, Project inventory, Root Development Environment, and Project Task Dispatcher.

## Conflict rule

If the Agent Tick product context and a surface-specific context disagree, do not silently choose one. Pause and ask which context should win for the current change.

When a conflict is resolved, update the appropriate context file or add a follow-up task so the same ambiguity does not recur.

## Known Agent Tick surface contexts

- [Agent Tick core](./CONTEXT.md) — product-level Agent Tick language for the core app/server/CLI/mobile/API repository.
- [Agent Tick public mirror context](./CONTEXT.public.md) — public-safe context for the source-available mirror.
- [Marketing site](../agenttick.sh/CONTEXT.md) — public positioning, pricing, legal/privacy page, and site-to-hosted-app language.
- [Pi Agent Tick](../pi-agent-tick/CONTEXT.md) — Pi integration language for mirrored prompts, local execution, Agent Tick config, and sanction gates.
- [Private Agent Tick mono-sd docs](../../docs/agent-tick/README.md) — owner-facing planning, strategy, legal, ops, research, and archive docs kept outside the public mirror source tree.
- `../host-clippy` and `../host-tay` — related hosting/deployment Projects. Add local context files only when their domain language diverges from the Agent Tick product context.

## Working rule for agents

Before editing an Agent Tick-related Project, check that Project's local `CONTEXT.md` when present, then read this product context when the change touches product direction, pricing, launch posture, legal/privacy language, or cross-surface terminology. Ask before applying product-level language over conflicting surface-local language or copying private context into a public mirror.
