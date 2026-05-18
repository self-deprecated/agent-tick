# iOS and Android app

The iOS and Android app is the primary day-to-day approval surface for Agent Tick.

## Install

- [Agent Tick for iOS](https://go.agenttick.sh/ios)
- [Agent Tick for Android](https://go.agenttick.sh/android)

If a store link is not live yet, continue with the web approval flow and retry after the store listing is published.

## Connect

For hosted Agent Tick, sign in to agenttick.sh with the same account used during CLI setup.

For a self-hosted server, choose the self-hosted server option in the app and enter your server URL, for example:

```text
https://tick.example.com
```

The app can also scan pairing QR codes where the product flow provides one.

## Respond to requests

The app shows bounded Agent Tick requests:

- status updates for progress
- steering questions with fixed options
- sanctions with approve/deny decisions

The phone does not run commands. If a sanction is approved, the local agent or workflow decides whether to continue on the machine where it was already running.

## Notifications

Enable notifications if you want approval alerts while the app is closed. Push notifications should stay minimal; review the request details inside Agent Tick before approving or denying.

## Trial and purchases

- A 7-day local trial starts on first open.
- The trial includes hosted and self-hosted app use.
- After the trial, Lifetime app unlock keeps app responses available for self-hosted servers.
- Hosted personal service is separate from permanent self-hosted app use.

See [Entitlement lifecycle](./entitlement-lifecycle.md) for the full Trial, Lifetime app unlock, included hosted month, subscription, and read-only grace states.
