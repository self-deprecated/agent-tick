# Mobile App

The Native App is the primary day-to-day approval surface.

## Trial and purchases

- 7-day local Trial starts on first open and does not require sign-in.
- Trial includes hosted and self-hosted app use.
- Lifetime app unlock: $19.99 one-time in-app purchase.
- Lifetime app unlock copy: “Use the Agent Tick app with self-hosted servers forever.”
- Restore purchases is available in Settings and on the paywall.
- Lifetime app unlock includes one hosted month that starts when hosted personal service is first activated after purchase.
- Hosted personal service is optional: $5/month or $50/year.

## Entitlement status screen copy/spec

See [Entitlement lifecycle](./entitlement-lifecycle.md) for the full Trial, Lifetime app unlock, included hosted month, subscription, and read-only routing grace diagram.

The mobile Settings screen should always show one current entitlement status before purchase actions so the user can tell whether they can respond to approvals now, what hosted access is active, and what payment action (if any) keeps access working.

| State | Status title | Summary | App access copy | Hosted access copy | Paywall/action copy |
| --- | --- | --- | --- | --- | --- |
| Trial active, no Lifetime unlock | Trial active | `N days left in trial` | Trial includes hosted and self-hosted app use. | The included hosted month does not start during Trial. | Buy Lifetime app unlock before Trial ends to keep responding from this app. |
| Trial ended, no Lifetime unlock | Read-only after Trial | Trial ended. Viewing, settings, purchase, and restore stay available. | Responses are disabled until Lifetime app unlock is purchased or restored. | Hosted personal service also requires an active Trial, included hosted month, or subscription. | Buy Lifetime app unlock to respond again and use self-hosted Agent Tick forever. |
| Lifetime unlock, no hosted subscription/month | Lifetime unlock active | Self-hosted Agent Tick use is unlocked forever on this app-store account. | You can keep using the app with self-hosted servers without another app purchase. | Hosted personal service is optional for agenttick.sh routing, push, updates, and uptime. | Activate the included hosted month or subscribe when you want first-party hosted service. |
| Included hosted month active | Included hosted month active | Your Lifetime app unlock is active, and the included hosted month is running. | Self-hosted Agent Tick access stays unlocked forever on this app-store account. | agenttick.sh remains available until the included hosted month ends. | Subscribe monthly or yearly to keep hosted personal service active after the included month. |
| Hosted subscription active | Hosted personal active | Your Lifetime app unlock and hosted personal service are active. | You can respond to approvals from hosted or self-hosted Agent Tick servers. | agenttick.sh routing, push, updates, and uptime are covered by your hosted subscription. | Manage or cancel the hosted subscription from the app store when needed. |

The status copy must not imply that the phone can execute remote commands. It only describes whether the user can view and respond to bounded Agent Tick approval requests.

## After Trial

Without Lifetime app unlock, app use becomes read-only after Trial: viewing, settings, purchase, and restore stay available, but responses are disabled.

## Self-hosted use

Self-hosted app use is unlimited after Lifetime app unlock. First-party hosted push relay is not a launch product; self-hosted deployments use polling/manual refresh by default or their own notifier integrations.
