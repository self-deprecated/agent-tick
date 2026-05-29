# Store screenshots

This directory stores real captured mobile screenshots and a small resize helper for App Store / Play Store upload sizes.

## Source captures

The current checked-in source set lives at:

```txt
captures/ios-1.1-session-stack-iphone-61/
```

Those files are the 10 selected iOS 1.1 App Store screenshots, captured manually at `1125x2436` and renamed into upload order. They include the Session Lane/Stack refactor, plus retained sign-in and paywall captures from the iOS 1.0 set.

The previous iOS 1.0 set remains archived at:

```txt
captures/ios-1.0-app-store-iphone-61/
```

## Seed Session Stack screenshot data

Generate repeatable fake Session Lane/Stack Activity against a local or staging Agent Tick server with an Agent Token:

```sh
AGENT_TICK_TOKEN=agent_... corepack pnpm --filter @agent-tick/mobile screenshots:seed-sessions -- --base-url http://127.0.0.1:3000
```

Useful options:

- `--run-id <id>`: stable suffix for the seeded Session IDs. Use a fresh value for a new top-of-stack dataset.
- `--workspace-id <id>`: workspace header when the token/server needs one.
- `--dry-run`: print every Status Update and Request payload without sending it.

The seed creates safe demo Sessions for release approval, flaky-test steering, webhook status progress, and docs cleanup. All content is bounded and store-review-safe.

## Generate resized upload assets

Generate the required iPhone 6.5-inch screenshots with:

```sh
corepack pnpm --filter @agent-tick/mobile screenshots:captured -- --source apps/mobile/store-assets/screenshots/captures/ios-1.1-session-stack-iphone-61 --size apple-65
```

This writes exact `1242x2688` PNGs to:

```txt
generated/captured/ios-1.1-session-stack-iphone-61/apple-65-1242x2688/
```

Generated files are ignored by git. Recreate them from the checked-in captures whenever needed.

## Supported resize targets

- `apple-65`: Apple 6.5 inch, `1242x2688`
- `apple-67`: Apple 6.7 inch, `1290x2796`
- `apple-61`: Apple 6.1 inch, `1170x2532`
- `apple-55`: Apple 5.5 inch, `1242x2208`
- `google-phone`: Google Play phone, `1080x1920`

Use `--all` instead of `--size apple-65` to generate every target.

## Copy and privacy rules

Keep screenshots bounded and store-review-safe:

- Show Request summaries, commit SHAs, links, and action labels.
- Do not include secrets, private keys, bearer tokens, cookies, raw logs, `.env` files, customer data, or full AI prompts/transcripts.
- Keep Agent Tick positioned as the Request routing layer; the local agent or workflow still executes authorized actions.
