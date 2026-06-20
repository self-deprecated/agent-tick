---
title: Personal Console
description: Use the Agent Tick web app for setup, Test Requests, web fallback responses, Workspaces, routing, Activity, and Settings.
---

# Personal Console

The Personal Console is the authenticated web app at [app.agenttick.sh](https://app.agenttick.sh). Use it for setup, fallback responses, Workspace management, and troubleshooting.

The Native App is still the day-to-day approval surface. The Personal Console is where you connect and inspect the system.

## Connections

The **Connections** page walks through setup:

1. connect a push-ready Approval Device
2. send a first-party Test Request
3. connect an Agent Connection
4. receive real Agent Activity

For Shared Workspaces, Connections also shows Routing Rules, Agent Assignments, route health, and route tests.

## Activity

The **Activity** page shows Sessions that need input first, then recent Session activity. Use it to inspect the same Requests, Status Updates, and Responses that appear in the app.

Web fallback responses are available here where entitlement and routing allow them.

## Workspace

The **Workspace** page shows Workspace type, your role, response entitlement, member readiness, and Shared Workspace membership/routing readiness.

Shared Workspace Owners and Admins manage membership through Clerk-backed organization controls where available. Agent Tick still owns Workspace routing, Agent Connections, Activity, and authorization.

## Settings

The **Settings** page contains low-frequency account, support, privacy, language, and developer diagnostic controls. Use **Settings → General → Private encryption** in the Native App before enabling rich agent message/tool mirroring; setup should then make encrypted Activity the default.

Developer diagnostics may show raw Workspace, Agent Connection, Approval Device, and audit identifiers. Treat them as support/debug context, not public copy.

## Test Requests

A Test Request is safe setup activity. It verifies that routing and response behavior works without pretending to be real agent work.

Use Test Requests before trusting an integration with sensitive actions.
