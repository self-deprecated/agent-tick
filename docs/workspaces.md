---
title: Workspaces
description: Understand Personal Workspaces, Shared Workspaces, members, Routing Rules, Agent Assignments, and hosted billing caveats.
---

# Workspaces

A Workspace contains Agent Connections, members, routing, and activity history.

## Personal Workspace

Every human gets a Personal Workspace for individual setup. It has one member and implicitly routes that member’s Agent Connections to that member.

Use a Personal Workspace when you are a solo developer connecting your own coding agents.

## Shared Workspace

A Shared Workspace is for multiple members, shared administration, routing, and activity visibility.

Shared Workspaces can be created and configured in hosted Agent Tick. Hosted shared routing and responses require an active Shared Workspace entitlement, so hosted shared routing/responses are blocked until that entitlement is active.

## Roles

Shared Workspace roles are:

- **Owner** — billing, recovery, and ultimate Workspace responsibility.
- **Admin** — manages members, Agent Connections, routing, and operational settings.
- **Member** — participates in routed activity according to Routing Rules and Availability.

## Routing Rules

A Routing Rule decides which Workspace Members receive matched Agent Activity and how many responses are required.

A healthy rule needs:

- at least one recipient
- enough recipients for the required response count
- push-ready Approval Devices for recipients who should receive notifications
- available recipients when the route is expected to be active

## Agent Assignments

In a Shared Workspace, each Agent Connection needs an Agent Assignment: the Routing Rule selected for that connection.

Unassigned shared Agent Connections are connected but not ready. They should not silently route to administrators.

## Availability

Members can mark themselves available, busy, do-not-disturb, or off-call. Availability affects whether routed Approval Interactions should reach them.

## Test before relying on a route

Use route tests from the Personal Console to verify the selected path. Test Requests are labeled and follow the same recipient/response flow as the path being tested.

## Self-hosted Workspaces

Self-hosted operators control their own deployment, entitlement model, access controls, backups, and retention. Hosted Shared Workspace billing caveats apply to hosted Agent Tick, not to your self-hosted infrastructure.
