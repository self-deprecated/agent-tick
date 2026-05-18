# Agent Tick IAP manual QA checklist

Date: 2026-05-18
Status: pending external QA

This checklist tracks the device, store-console, and release-review work that cannot be verified by repository tests alone. The repo implementation is expected to pass automated checks before this checklist is executed.

## Required configuration before device QA

- [ ] RevenueCat project is configured for the Agent Tick iOS and Android apps.
- [ ] RevenueCat entitlements exist:
  - [ ] `lifetime_app_unlock`
  - [ ] `hosted_personal`
- [ ] RevenueCat offerings/packages map to Agent Tick product keys:
  - [ ] `lifetime_unlock`
  - [ ] `hosted_personal_monthly`
  - [ ] `hosted_personal_yearly`
- [ ] Server is running with billing enabled for the hosted/product environment:
  - [ ] `AGENT_TICK_BILLING_PROVIDER=revenuecat`
  - [ ] `AGENT_TICK_REVENUECAT_WEBHOOK_SECRET` set
  - [ ] RevenueCat webhook points to `POST /v1/billing/webhooks/revenuecat`
- [ ] Mobile build environment has platform public SDK keys:
  - [ ] `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`
  - [ ] `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`

## Apple setup

- [ ] Paid Apps Agreement active.
- [ ] Tax and banking complete.
- [ ] Bundle ID `ai.selfdeprecated.agenttick` has In-App Purchase capability.
- [ ] App Store Connect app exists.
- [ ] Products created and priced:
  - [ ] `ai.selfdeprecated.agenttick.lifetime_unlock` non-consumable
  - [ ] `ai.selfdeprecated.agenttick.hosted_personal_monthly` auto-renewable subscription
  - [ ] `ai.selfdeprecated.agenttick.hosted_personal_yearly` auto-renewable subscription
- [ ] Monthly/yearly hosted plans are in the same subscription group.
- [ ] Sandbox tester accounts ready.
- [ ] App Review notes include the entitlement model and a test account.

## Google setup

- [ ] Play Console app exists for package `ai.selfdeprecated.agenttick`.
- [ ] Play Billing products/base plans configured:
  - [ ] one-time product `lifetime_unlock`
  - [ ] subscription product `hosted_personal`
  - [ ] base plan `monthly`
  - [ ] base plan `yearly`
- [ ] Monthly/yearly hosted base plans are mutually exclusive within the same subscription product/family.
- [ ] License testers configured.
- [ ] Internal testing track ready.
- [ ] RevenueCat/Google integration receives Play subscription lifecycle events.
- [ ] App access/review credentials provided.

## iOS device QA

Use an Expo development build and then TestFlight before release. Record tester account, build number, server URL, and RevenueCat environment for each run.

- [ ] Fresh account starts trial and `GET /v1/billing/personal` shows trial active.
- [ ] Lifetime purchase completes through Apple sandbox.
- [ ] After lifetime purchase, server `activeEntitlements.lifetimeUnlock.active` becomes `true` with `originPlatform: "ios"`.
- [ ] Restore lifetime purchase on a second iOS install/device refreshes server entitlement.
- [ ] Monthly hosted subscription completes through Apple sandbox.
- [ ] Yearly hosted subscription completes through Apple sandbox.
- [ ] Monthly/yearly upgrade or downgrade stays within the same subscription group and does not create duplicate active hosted subscriptions.
- [ ] Cancellation remains active until the paid-through date and reports `willRenew: false`.
- [ ] Expiration after cancellation enters read-only grace, then disables hosted routing after grace.
- [ ] Refund/revocation removes the relevant entitlement.
- [ ] No credit-card, Stripe, web checkout, or “buy cheaper on web” CTA is shown in the app.
- [ ] TestFlight build repeats the successful purchase/restore/cancel/refund smoke path before release.

## Android device QA

Use a Play internal testing build with license testers. Record tester account, build number, server URL, and RevenueCat environment for each run.

- [ ] Fresh account starts trial and `GET /v1/billing/personal` shows trial active.
- [ ] Lifetime purchase completes through Google Play Billing.
- [ ] After lifetime purchase, server `activeEntitlements.lifetimeUnlock.active` becomes `true` with `originPlatform: "android"`.
- [ ] Restore lifetime purchase on a second Android install/device refreshes server entitlement.
- [ ] Monthly hosted subscription completes through Google Play Billing.
- [ ] Yearly hosted subscription completes through Google Play Billing.
- [ ] Monthly/yearly upgrade or downgrade stays within the same subscription product/family and does not create duplicate active hosted subscriptions.
- [ ] Cancellation remains active until the paid-through date and reports `willRenew: false`.
- [ ] Expiration after cancellation enters read-only grace, then disables hosted routing after grace.
- [ ] Refund/revocation removes the relevant entitlement.
- [ ] No credit-card, Stripe, web checkout, or “buy cheaper on web” CTA is shown in the app.

## Cross-platform duplicate-prevention QA

- [ ] Purchase hosted monthly/yearly on iOS, then sign in to the same Agent Tick account on Android.
  - [ ] Android shows active via Apple copy.
  - [ ] Android disables hosted subscription purchase buttons.
  - [ ] Android manage-subscription action directs the user to manage on iOS/App Store.
- [ ] Purchase hosted monthly/yearly on Android, then sign in to the same Agent Tick account on iOS.
  - [ ] iOS shows active via Google copy.
  - [ ] iOS disables hosted subscription purchase buttons.
  - [ ] iOS manage-subscription action directs the user to manage on Android/Google Play.
- [ ] Purchase preflight returns 409 for duplicate hosted subscription attempts on the same Agent Tick account.

## Evidence to attach before release signoff

- [ ] Server logs/audit screenshots showing RevenueCat webhook events processed without raw receipts or payment payloads.
- [ ] `GET /v1/billing/personal` samples for lifetime, active subscription, canceled active, read-only grace, expired, refunded/revoked, and cross-platform states.
- [ ] RevenueCat event history screenshots for purchase, renewal, cancellation, expiration, and refund/revocation.
- [ ] App Store Connect sandbox/TestFlight purchase screenshots.
- [ ] Play Console/internal testing purchase screenshots.
- [ ] App Review notes copied into the release ticket.
