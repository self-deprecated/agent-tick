# Workspace routing model

Agent Tick's current server/API implementation uses `Workspace` as the top-level authorization and routing container. Public product copy should usually say **personal account**, **Organization**, **Project**, **Agent Connection**, **Approval Access**, **Team Routing**, and **Activity History** where those terms better match the user-facing model; `Workspace` remains an implementation/API term in this repository.

Every human has a personal Workspace fixed-name `Personal` for individual setup, and hosted shared work uses separate shared Workspaces backed by Clerk Organizations for membership/account management. Agent Tick mirrors membership into Owner/Admin/Member roles while keeping routing, Activity History, Agent Tokens, Devices, and authorization state in Agent Tick.

Agent Tokens are the server-side identity for local agents and workflows. Shared Workspace Agent Tokens can be assigned to routing configuration that decides which eligible members receive Status Updates, Steering, and Sanctions. Client, host, folder, CI, and coding-agent names are metadata on activity from that token rather than separate top-level managed Agent identities.

Personal and shared use cases use the same routing model with different available options: a one-member Workspace implicitly routes each Agent Connection to its sole member, while multi-member Workspaces require explicit access/routing configuration before shared activity is usable.

This replaces a split mental model of single-user mode versus multi-user shared mode. The server does not need separate product modes for routing semantics; it exposes capabilities according to the Workspace's membership, entitlement, deployment mode, and configured routing/access state. Hosted, self-hosted, Clerk, and local access differences are authentication/deployment concerns rather than separate product capability models.
