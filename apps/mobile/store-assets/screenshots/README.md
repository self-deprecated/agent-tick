# Store screenshot automation

This directory contains deterministic app-store screenshot scene data and an export script for Agent Tick mobile launch assets.

## Generate exports

```sh
corepack pnpm --filter @agent-tick/mobile screenshots:store
```

The script reads [`scenes.json`](./scenes.json) and writes generated SVG files for every scene/size to `generated/`. When ImageMagick's `magick` command is available, it also renders PNG files suitable for upload review.

Generated files are ignored by git so screenshots can be regenerated after copy or scene changes without committing large binary assets.

## Sizes

The current export set covers:

- Apple 6.7 inch: `1290x2796`
- Apple 6.5 inch: `1242x2688`
- Apple 5.5 inch: `1242x2208`
- Google Play phone: `1080x1920`

## Scenes

The first five launch scenes mirror [`store-listing.md`](../../store-listing.md):

1. Request / Sanction
2. Steering choices
3. Status Update / Activity History
4. Hosted/self-hosted setup
5. Native app Trial, Lifetime unlock, and Restore purchases

## Copy and privacy rules

Keep screenshots bounded and store-review-safe:

- Show Request summaries, commit SHAs, links, and action labels.
- Do not include secrets, private keys, bearer tokens, cookies, raw logs, `.env` files, customer data, or full AI prompts/transcripts.
- Keep Agent Tick positioned as the Request routing layer; the local agent or workflow still executes authorized actions.
