# MCP + Agent Tick

MCP support is not currently implemented in the TypeScript CLI.

The active CLI commands are:

```sh
agent-tick setup
agent-tick sanction
agent-tick steering
agent-tick status
agent-tick abandon
```

Use `agent-tick sanction` when an MCP host or wrapper needs approval before continuing:

```sh
agent-tick sanction \
  --title "Run production SQL?" \
  --body "Requested from MCP tool" \
  --command "psql -f migrate.sql" \
  --timeout 30m
```

Use `agent-tick sanction -- <command>` when the wrapper can express the gated operation as a local command:

```sh
agent-tick sanction \
  --title "Run production SQL?" \
  --body "Requested from MCP tool" \
  -- psql -f migrate.sql
```

The older `agent-tick mcp` and `agent-tick adapter` commands are intentionally not documented as available commands because they do not exist in the current CLI. Reintroduce MCP/adapter support only with implementation and tests.
