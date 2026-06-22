# Mobile app shell seams

`AgentTickApp.tsx` is the composition root for the Native App. It is allowed to wire broad slices of app state together, but app-shell modules should earn their seam by owning product behavior instead of only forwarding props.

## Ownership guide

- `useMobile*` hooks own reusable mobile behavior and state machines such as activity loading, billing access, connection lifecycle, diagnostics, request handling, settings actions, and Session Stack behavior.
- `useAgentTick*` hooks should remain only when they encode Agent Tick app-shell orchestration across multiple mobile domains, for example opening Settings from realtime notification prompts or coordinating Session Stack persistence/selection.
- Pure forwarding wrappers should be collapsed into `AgentTickApp.tsx` or into a behavior-rich `useMobile*` module. Do not add a wrapper just to rename `useMobile*` to `useAgentTick*`.

## Current navigation notes

- `navigationState.screen` controls the top-level surface: Requests, History, Settings, Scanner, or Paywall.
- Session Stack focus is separate from the top-level screen and lives in `useSessionStackDashboard` / `useSessionStackPersistence`.
- The app header may clear Session focus when returning to the Stack, but it should not mutate connection, billing, or request-handling state directly.
- Settings deep links such as the notification reminder use `settingsViewTarget` so they can navigate to Settings without making Settings own realtime or push-notification policy.
