# Hosted Clerk production setup

Use this checklist for the managed Agent Tick deployment. It keeps Clerk as the human identity provider while Agent Tick continues to own Workspaces, Agent Tokens, devices, Requests, billing state, and audit logs.

## Production domains

- Marketing site: `https://agenttick.sh`
- Hosted dashboard/frontend and API for CLI, mobile, and integrations: `https://app.agenttick.sh`
- Clerk Account Portal: `https://accounts.agenttick.sh` if Clerk is configured with `agenttick.sh` as the production application domain.

## Clerk dashboard

In the Clerk production instance:

1. Set the application home URL to `https://app.agenttick.sh`.
2. Configure the Account Portal on the `accounts.agenttick.sh` subdomain.
3. Enable the production social connections you want at launch, such as Apple, GitHub, and Google. Production social connections need their real provider credentials; Clerk's development shared OAuth credentials do not carry over.
4. Add the native app entries Clerk requires for mobile OAuth:
   - iOS bundle ID: `ai.selfdeprecated.agenttick`
   - Android package: `ai.selfdeprecated.agenttick`
5. Copy the production keys:
   - Publishable key: `pk_live_...`
   - Secret key: `sk_live_...`

## Hosted server environment

Set these on the production server deployment:

```sh
AGENT_TICK_MODE=clerk
AGENT_TICK_PUBLIC_URL=https://app.agenttick.sh
AGENT_TICK_CLERK_PUBLISHABLE_KEY=pk_live_...
AGENT_TICK_CLERK_SECRET_KEY=sk_live_...
AGENT_TICK_CLERK_AUTHORIZED_PARTIES=https://app.agenttick.sh
```

`AGENT_TICK_CLERK_AUTHORIZED_PARTIES` should list the web origins allowed to mint Clerk session tokens that the API accepts. Include `https://agenttick.sh` too only if the marketing site opens Clerk directly instead of just linking to the hosted dashboard.

Optional:

```sh
AGENT_TICK_CLERK_JWT_KEY="-----BEGIN PUBLIC KEY-----..."
```

The server exposes the runtime auth configuration at `/v1/auth/config`. The dashboard and mobile app read the Clerk publishable key from that endpoint, so the Clerk production publishable key is not hardcoded in those clients.

CLI browser setup opens and saves `https://app.agenttick.sh`; the dashboard and `/v1/*` API share the same hosted origin.

## Marketing site environment

The marketing site can simply link users to the hosted dashboard. If you want its header sign-in button to open Clerk directly, set the production publishable key at build time:

```sh
VITE_AGENT_TICK_APP_URL=https://app.agenttick.sh
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
```

If `VITE_CLERK_PUBLISHABLE_KEY` is omitted, the marketing sign-in button falls back to `VITE_AGENT_TICK_APP_URL`, and the dashboard handles Clerk sign-in.

## Mobile builds

The mobile app does not embed a Clerk publishable key. It fetches Clerk runtime config from the hosted app/API origin. Hosted builds default to `https://app.agenttick.sh`. To make that explicit in a release channel, set:

```sh
EXPO_PUBLIC_AGENT_TICK_HOSTED_SERVER_URL=https://app.agenttick.sh
```

For a development build against a separate Clerk development instance, override the hosted server before building or publishing an Expo update:

```sh
EXPO_PUBLIC_AGENT_TICK_HOSTED_SERVER_URL=https://dev-app.example.com
```

Self-hosted testing is still available from the in-app self-hosted server entry path.

## Adding SSO providers later

The web dashboard uses Clerk's hosted/prebuilt sign-in flow, and the mobile app uses Clerk Expo `AuthView`. Those Clerk surfaces are driven by the sign-in methods and social connections enabled in the Clerk dashboard, so a newly enabled provider should appear there without changing Agent Tick UI code.

Caveat for mobile: native OAuth providers can require provider credentials and native app configuration in Clerk. If the provider needs a new URL scheme, entitlement, bundle/package registration, or Clerk Expo plugin setting that is not already in the binary, ship a native app update. If the required native configuration is already present and only the Clerk dashboard/provider credentials change, no Agent Tick app update should be needed.
