# Agent Tick IP ownership packet

This packet is a counsel-facing evidence checklist for Agent Tick launch assets. It is not legal advice and should be reviewed by counsel before trademark, copyright, store, or investment diligence filings.

## Scope

Prepared for Fizzy #61: icon, logo/mark, source assets, app-store assets, website brand usage, and repository evidence for Agent Tick.

Primary repos/surfaces inspected:

- `agent-tick` — product source, mobile app assets, docs site assets, CLI assets, license text.
- `agenttick.sh` — marketing-site brand usage and text/checkmark mark.

Related launch surfaces:

- Hosted app: `https://app.agenttick.sh`
- Hosted API: `https://api.agenttick.sh`
- Docs: `https://docs.agenttick.sh`
- Marketing site: `https://agenttick.sh`
- iOS bundle id: `ai.selfdeprecated.agenttick`
- Android package id: `ai.selfdeprecated.agenttick`

## Counsel deliverables

Collect these before counsel review:

1. **Source files and exports** — canonical editable source files, exported PNG/SVG/PDF assets, and dimensions.
2. **Authorship evidence** — commits, prompts/briefs, design notes, invoices, employment or contractor context, and review notes showing who created each asset.
3. **Assignments and licenses** — employee invention assignment, contractor IP assignment, stock/template/font/icon licenses, AI-tool terms, and open-source license notices.
4. **Tool history** — design tools, generators, AI systems, prompts, seed files, and any third-party references used.
5. **Use inventory** — where each asset appears in apps, websites, docs, stores, repositories, and social cards.
6. **Clearance questions** — trademark searches, visual similarity concerns, geographic classes, and whether the checkmark-in-box mark is distinctive enough to register.

## Current asset inventory

### Mobile app icons

| Asset | Use | Current evidence | SHA-256 |
| --- | --- | --- | --- |
| `apps/mobile/assets/icon.png` | Expo/iOS/Android app icon | Referenced by `apps/mobile/app.json` as `expo.icon` | `3d4a9e4f7d023fd9d0bb0b4d76e9ce3ef674b7d8924318ff4503195184f7589b` |
| `apps/mobile/assets/adaptive-icon.png` | Android adaptive foreground | Referenced by `apps/mobile/app.json` as `android.adaptiveIcon.foregroundImage` | `8243535ae995ad3a21bacaa3bbca95022d3da019f4a7f7edec56cd49e7c46102` |
| `apps/mobile/assets/favicon.png` | Expo web/mobile favicon | Referenced by `apps/mobile/app.json` as `web.favicon` | `1587d2315582e9d56862babcd620c73f16ae6d81cbf4b8d4a0b549145d48830c` |

Needed from owner/designer:

- Editable source file for the icon family, if it exists.
- Creation date, author, and tool used.
- Confirmation whether any stock icon, template, font, or AI-generated base was used.
- Assignment from any non-employee contributor.

### Docs-site brand assets

| Asset | Use | Current evidence | SHA-256 |
| --- | --- | --- | --- |
| `apps/docs/static/img/favicon.svg` | Docusaurus favicon/logo | Referenced by `apps/docs/docusaurus.config.js`; green rounded square with white checkmark | `80477356cf5531a77ac0e66e150c952f0c9212d24ffd9ebbe81712b7fefa17da` |
| `apps/docs/static/img/social-card.svg` | Open graph/social card | Referenced by `apps/docs/docusaurus.config.js`; title card with Agent Tick Docs and checkmark | `392c27e9e53fbf4b954692c8ae3dc0a27e64ff021c44bb86ee0e54095820adb2` |

Needed from owner/designer:

- Whether these SVGs are hand-authored in-repo, generated from another source file, or derived from the mobile icon.
- Whether the color palette and checkmark geometry are intended as trademark-identifying elements or documentation-only treatment.

### Marketing-site mark usage

`agenttick.sh/src/routes/+layout.svelte` currently uses a text brand with a checkmark glyph:

```svelte
<span class="mark">✓</span>
<span>Agent Tick</span>
```

Observed use:

- Header brand link.
- Footer brand link.
- Marketing-site layout and CSS define the visual treatment.

Needed from owner/designer:

- Whether the website mark is the canonical logo or a temporary text treatment.
- Source/approval history for the checkmark glyph styling.
- Any trademark clearance notes for the words `Agent Tick`, `agenttick.sh`, and the checkmark mark.

### App-store and generated screenshot assets

`apps/mobile/store-listing.md` defines app-store metadata, copy, pricing text, screenshot plan, and review notes. `apps/mobile/store-assets/screenshots/scenes.json` now contains deterministic screenshot scene data, and `apps/mobile/scripts/generate-store-screenshots.mjs` generates Apple/Google screenshot exports.

Needed from owner/designer:

- Counsel review of app-store claims, pricing copy, and review notes.
- Confirmation that screenshots do not include real customer data, secrets, raw prompts, or third-party marks.
- Store submission screenshots generated from the final release build or approved deterministic scene exports.

### License and source-code ownership

`LICENSE` identifies:

- Licensor: `Self-Deprecated ApS`
- Licensed work: `agent-tick`
- Copyright: `(c) 2026 Self-Deprecated ApS`
- License: Business Source License 1.1 with Apache 2.0 change license.

Needed from counsel/owner:

- Confirm the legal entity name, jurisdiction, and exact copyright holder.
- Confirm BSL parameters and change date are intentional.
- Confirm contributor/license policy for third-party patches.
- Confirm whether marketing-site repo `agenttick.sh` has its own license or should inherit/declare a separate policy.

## Evidence collection commands

Run these in a clean workspace and archive the output with the packet:

```sh
cd agent-tick
jj status --no-pager
jj log --no-pager --limit 50 --template 'change_id.short() ++ " " ++ commit_id.short() ++ " " ++ description.first_line() ++ "\n"'
sha256sum apps/mobile/assets/icon.png \
  apps/mobile/assets/adaptive-icon.png \
  apps/mobile/assets/favicon.png \
  apps/docs/static/img/favicon.svg \
  apps/docs/static/img/social-card.svg
```

```sh
cd ../agenttick.sh
jj status --no-pager
jj log --no-pager --limit 50 --template 'change_id.short() ++ " " ++ commit_id.short() ++ " " ++ description.first_line() ++ "\n"'
git grep -n -E 'Agent Tick|Self-Deprecated|mark|logo|icon|copyright|license|terms|privacy' src README.md package.json
```

Archive generated screenshot outputs separately if they are submitted to app stores:

```sh
cd agent-tick
corepack pnpm --filter @agent-tick/mobile screenshots:store
find apps/mobile/store-assets/screenshots/generated -type f -maxdepth 1 -print0 | sort -z | xargs -0 sha256sum
```

## Assignment and tool-history questionnaire

Ask each creator or contributor to answer:

1. What assets did you create or modify?
2. Were you an employee, founder, contractor, or external vendor at the time?
3. Which agreement assigned IP to Self-Deprecated ApS?
4. What tools were used: Figma, Illustrator, Sketch, Canva, Inkscape, ImageMagick, AI image generation, code generation, or hand-authored SVG/CSS?
5. Were any stock assets, templates, icon sets, fonts, screenshots, device frames, competitor references, or third-party marks used?
6. If AI tools were used, what prompts, source images, model/provider, account, and terms governed the generation?
7. Are there earlier drafts or rejected concepts counsel should see for provenance?
8. Are any assets intentionally temporary and not intended for registration?

## Open gaps before counsel review

- No editable source file for `apps/mobile/assets/*.png` was found in the inspected paths.
- No explicit `agenttick.sh` license file was observed during this pass.
- A repo-side knockout memo now exists at [`docs/trademark-knockout-search.md`](./trademark-knockout-search.md), but no attorney clearance opinion or filing strategy is in the inspected repo paths.
- No contributor assignment records, contractor agreements, invoices, or AI-tool prompt logs are in the inspected repo paths.
- The public website uses a simple checkmark glyph as the mark; counsel should assess distinctiveness and similarity risk before treating it as registerable.
- The Docusaurus SVG favicon/social card appear hand-authored in repo, but provenance and approval history still need owner confirmation.

## Launch-safe interim guidance

Until counsel clears final registration/filings:

- Use `Agent Tick` as a product name with `Self-Deprecated` attribution.
- Avoid claiming registered trademark status unless a registration exists.
- Keep source-available and self-hosting claims aligned with the actual `LICENSE`.
- Keep screenshot and website copy focused on bounded approval decisions, not remote command execution.
- Do not publish source assets that reveal secrets, customer data, raw prompts, or unreleased legal strategy.

## Packet status

This document is the repo-side packet skeleton and evidence inventory. It is complete enough to start counsel review with the companion [trademark knockout search memo](./trademark-knockout-search.md) and [trademark filing strategy counsel packet](./trademark-filing-strategy-counsel-packet.md), but the owner still needs to attach off-repo evidence: assignments, design/source files, tool history, attorney trademark clearance, filing recommendations, and final store-export hashes.
