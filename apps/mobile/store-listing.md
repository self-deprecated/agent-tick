# Agent Tick app-store listing

## App metadata

- App name: Agent Tick
- Subtitle: Phone approvals for coding agents.
- Privacy Policy URL: https://agenttick.sh/privacy
- Terms URL: https://agenttick.sh/terms
- Category: Developer Tools / Productivity

## Short promotional copy

Phone approvals for coding agents. Route status updates, steering, and sanctions from your local agent to your phone without turning the app into a remote shell.

## Description

Agent Tick is a least-permission approval layer for coding agents.

Use the Agent Tick app when your local coding agent needs a bounded human response while you are away from your desk:

- Status Updates show where the agent is in the work.
- Steering lets you choose from bounded options the agent provided.
- Sanctions let you approve or deny one specific risky action before it happens.

Agent Tick is not a remote shell. The app cannot execute arbitrary commands on your machine, and approved actions still run in your local agent environment.

The service is source-available and self-hostable. You can inspect the code and run your own Agent Tick server, or use the hosted service when you want routing, push notifications, updates, and uptime handled for you.

## Pricing copy

Agent Tick starts with a 7-day Trial. The Trial includes both hosted and self-hosted app use.

After the Trial, Lifetime app unlock is a one-time $19.99 in-app purchase: “Use the Agent Tick app with self-hosted servers forever.” The unlock does not imply hosted service forever.

Lifetime app unlock includes one hosted month that starts when hosted personal service is first activated after purchase. Continued hosted personal service is available as an optional in-app subscription: $5/month or $50/year.

## Screenshot plan

Automated scene data lives in [`store-assets/screenshots/scenes.json`](./store-assets/screenshots/scenes.json). Generate Apple and Google Play exports with:

```sh
corepack pnpm --filter @agent-tick/mobile screenshots:store
```

The export script writes generated SVGs for each scene/size and PNGs when ImageMagick `magick` is available.

1. Approval request — show a Sanction with exact action context and minimal lock-screen disclosure posture.
2. Steering choices — show bounded options with a recommended/favorite choice and a decline/stop option.
3. Status Update / Activity History — show recent agent progress and session history.
4. Hosted/self-hosted account setup — show account switcher or setup screen with hosted and self-hosted paths.
5. Native App Paywall — show 7-day Trial remaining, Lifetime app unlock at $19.99, Restore purchases, and optional Hosted personal service.

## Review notes

Agent Tick routes approval decisions for local developer tools. It does not provide remote desktop, remote shell, or general device control. Push notifications are minimal by default; full request details are reviewed inside the app.
