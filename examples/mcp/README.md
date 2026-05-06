# MCP + Agent Tick

Agent Tick now ships a minimal MCP stdio server via `agent-tick mcp`.

## Start the MCP server

```sh
agent-tick mcp
```

The server exposes these MCP tools:

- `request_approval`
- `request_steer`
- `abandon_request`

## Legacy adapter path

If an MCP host, tool wrapper, or custom server already emits an approval request as JSON, you can still pipe it into `agent-tick adapter`.

```sh
printf '{"title":"Run production SQL?","body":"Requested from MCP tool","command":"psql -f migrate.sql"}' \
  | agent-tick adapter --timeout 30m
```

## Expected JSON shape

`agent-tick adapter` accepts the same request fields as the REST API and CLI bridge, including:

- `title`
- `body`
- `command`
- `requestType`
- `choices`
- `questions`
- `defaultChoice`
- `allowFreeformReply`
- `requester`
- `metadata`

## Pattern for MCP tool wrappers

1. Your MCP layer decides an action needs approval.
2. It prints a JSON request payload.
3. `agent-tick adapter` forwards the request to the Agent Tick server.
4. The adapter blocks until approval/denial.
5. The MCP tool continues only on success.

This keeps the MCP side simple while reusing Agent Tick's existing auth, routing, policy, timeout, and mobile approval flow.
