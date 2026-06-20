# Agent instructions for Agent Tick

## Project snapshot

Agent Tick is a fresh TypeScript-first least-permission Request layer for coding agents: Status Updates, Steering, and Sanctions.

- `apps/server` — Fastify API server, static dashboard host, Docker runtime entrypoint.
- `apps/admin` — Svelte 5 + Vite dashboard.
- `apps/mobile` — Expo React Native mobile Request app.
- `packages/cli` — private workspace CLI package exposing `agent-tick`.
- `packages/sdk` — typed HTTP client.
- `packages/shared` — shared Zod schemas, API types, constants.
- `packages/db` — SQLite schema management, migrations, store/repository helpers, test DB helpers.

The old Go server/CLI and prototype compatibility paths are not active product surfaces. Do not add Go-era compatibility unless explicitly requested.

Public surfaces: marketing at <https://agenttick.sh>, hosted app/API at <https://app.agenttick.sh>, and docs at <https://docs.agenttick.sh>. Self-hosting docs live in `SELFHOSTING.md`.

## Source-control workflow

This repository uses Jujutsu (`jj`). Do not use direct `git` commands.

### Workspace locality

When an agent session starts inside a monorepo workspace, that workspace is the working location. Use paths under the current workspace root (for example `projects/agent-tick/...` from the session `pwd`). Do not switch to sibling checkouts, main checkouts, mirrors, archived copies, or newly-created workspaces unless the user explicitly asks. Before editing, confirm `pwd` and `jj st` in the current workspace. If you accidentally edit outside the current workspace, immediately restore those edits and continue only in the current workspace.

Useful commands:

```sh
jj status --no-pager
jj diff --summary --no-pager
jj diff --no-pager
jj commit -m "type(scope): message" <paths...>
jj new
```

There is no staging area. If an unrelated local file is present, commit only the intended paths. `.pi-scratch.md` may exist as an uncommitted local scratch file; do not commit it unless the user asks.

## Package manager and runtime

Use Corepack + pnpm:

```sh
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Follow `DEVELOPMENT.md#dependency-policy` for npm dependency changes. Pin npm package versions exactly, commit `pnpm-lock.yaml` with dependency changes, use frozen lockfile installs for CI/release/Docker/reproducibility checks, and keep the `onlyBuiltDependencies` allowlist in `pnpm-workspace.yaml` minimal and explicit. Before finishing any dependency or version-bump task, audit whether `flake.nix` contains a related `fetchPnpmDeps` derivation and validate/update its hash in the same change with `nix run .#check-pnpm-deps-hash` / `nix run .#update-pnpm-deps-hash`.

Docker is the official server distribution path:

```sh
docker compose config
docker compose up --build
docker build -f apps/server/Dockerfile -t agent-tick:dev .
```

## CLI surface

Current launch CLI command concepts only:

- `agent-tick setup`
- `agent-tick login`
- `agent-tick config`
- `agent-tick features`
- `agent-tick mode`
- `agent-tick mcp`
- `agent-tick send status`
- `agent-tick send steering`
- `agent-tick send sanction`
- `agent-tick abandon`

Hidden compatibility surface: `agent-tick install` remains a shadow alias for `agent-tick setup` but should not be shown in user-facing help or docs.

The CLI package is prepared for public npm publishing as `@self-deprecated/agent-tick` and exposes the `agent-tick` binary. When bumping `packages/cli/package.json`, also bump `CLI_VERSION` in `packages/cli/src/index.ts` and the `agent-tick-cli.version` in `flake.nix` in the same change, then run `nix run .#check-pnpm-deps-hash` and `nix build .#agent-tick-cli --no-link --print-build-logs` so stale `pnpmDepsHash` values are caught before committing. For local repo development without a global install, use the workspace package name:

```sh
corepack pnpm --filter @self-deprecated/agent-tick build
node packages/cli/dist/index.js config --server http://localhost:8787 --token agent_...
```

Do not document or call missing commands such as `agent-tick adapter`, `agent-tick steer`, `agent-tick status-update`, top-level `agent-tick steering`, or top-level `agent-tick sanction` as current functionality. The preferred progress-update command is `agent-tick send status`.

## Auth and product model

- Default self-hosted mode is `single` and should require no Clerk, billing provider, email provider, or notification provider.
- Clerk mode is for human identity only.
- Agent Tick owns local users, Workspaces, Workspace Members, Routing Rules, Requests, agent tokens, devices, billing/seat-limit state, and audit logs.
- Use Clerk session tokens from clients; do not introduce Clerk JWT-template assumptions.
- Agent Tick Workspace context is local and selected with `X-Agent-Tick-Workspace-ID`.
- Agents use Agent Tick `agent_...` tokens, not Clerk tokens.

## Security expectations

- Do not put bearer tokens in event-stream query strings. The current event stream flow uses short-lived one-use tickets.
- Management routes should require owner/admin roles where appropriate.
- Request responders must be eligible for the relevant Workspace/Routing Rule.
- Request expiration is enforced in list/get/respond/resolve/wait flows.
- Treat sanction titles, steering bodies, status messages, commands, metadata, webhooks, logs, and notifications as disclosure surfaces. Do not include secrets.

## Documentation expectations

Keep the first-time user flow simple:

- README should point users to either hosted product usage (`https://app.agenttick.sh`) or self-hosting.
- Self-hosting details belong in `SELFHOSTING.md`.
- Product-vs-self-hosted usage flow belongs in user-facing docs such as `docs/quick-start.md`, `docs/self-hosting.md`, and `docs/coding-agent-integrations.md`.
- Integration details belong in `docs/coding-agent-integrations.md` and the integration-specific docs it links.
- Development workflow belongs in `DEVELOPMENT.md`.

When docs mention setup commands, use the prompt-based setup skill at `https://agenttick.sh/skill` as the primary setup path and `npx @self-deprecated/agent-tick setup` as the manual command. For rich message/tool mirroring, docs should tell users to enable **Native App → Settings → General → Private encryption** first and then use `agent-tick features` / `privacy.defaultContentMode = private` as the recommended default. Do not show `curl | sh` in public launch docs.

## Testing and validation

Use the narrowest meaningful validation for the change, then run broader checks before large commits.

Common full gate:

```sh
docker compose config
corepack pnpm typecheck
corepack pnpm test
corepack pnpm i18n:audit
corepack pnpm build
corepack pnpm --filter agent-tick-admin check
```

Targeted checks:

```sh
corepack pnpm --filter @agent-tick/server typecheck
corepack pnpm --filter @agent-tick/server test
corepack pnpm --filter @agent-tick/db typecheck
corepack pnpm --filter @agent-tick/db test
corepack pnpm --filter @self-deprecated/agent-tick typecheck
corepack pnpm --filter @self-deprecated/agent-tick test
corepack pnpm --filter @agent-tick/mobile typecheck
corepack pnpm --filter @agent-tick/mobile test --runInBand
corepack pnpm --filter agent-tick-admin check
```

Mobile Jest gotcha: pass `--runInBand` directly as shown above. Avoid `corepack pnpm --filter @agent-tick/mobile test -- --runInBand`; that form can be treated as a Jest pattern and report "No tests found".

### Fetching Expo/EAS mobile build logs

When a remote Expo/EAS mobile build fails, fetch the build metadata and logs from the mobile app directory. Prefer `npm exec --package eas-cli@19.1.0` if `corepack pnpm dlx eas-cli` hits ignored-build-script issues or if the latest EAS CLI is unavailable for the pinned registry date.

```sh
cd projects/agent-tick/apps/mobile
npm exec --yes --package=eas-cli@19.1.0 -- eas build:list --platform ios --limit 5 --json --non-interactive > /tmp/agent-tick-eas-builds.json
```

The JSON contains `status`, `error`, `buildProfile`, `appVersion`, and `logFiles`. EAS log URLs are short-lived and may be Brotli-compressed newline-delimited JSON. To save the latest log:

```sh
python3 - <<'PY'
import json, urllib.request, pathlib
build = json.load(open('/tmp/agent-tick-eas-builds.json'))[0]
url = build['logFiles'][0]
data = urllib.request.urlopen(url, timeout=60).read()
pathlib.Path('/tmp/agent-tick-eas-latest.log.br').write_bytes(data)
print(build['id'], build['status'], build.get('error'))
PY
brotli -d -f /tmp/agent-tick-eas-latest.log.br -o /tmp/agent-tick-eas-latest.log
```

Then inspect the failed phase, for example:

```sh
rg 'result":"failed|level":50|\[!\]|error|failed' /tmp/agent-tick-eas-latest.log
```

Admin/Svelte changes: load the Svelte skills if available, and run `corepack pnpm --filter agent-tick-admin check`.

Docker/runtime changes: validate at least `docker compose config`; for Dockerfile/runtime changes, build the image and smoke-test `/healthz` when practical.

Final dependency/Nix audit before finishing:

1. Run `jj diff --summary --no-pager` and look for `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, version files, or `flake.nix` changes.
2. If dependencies or package versions changed, verify every affected `fetchPnpmDeps` hash in `flake.nix` by running `nix run .#check-pnpm-deps-hash` plus the narrowest relevant Nix build, for example `nix build .#agent-tick-cli --no-link --print-build-logs` for CLI changes.
3. If the hash check fails, run `nix run .#update-pnpm-deps-hash`; if a Nix build reports a fixed-output hash mismatch manually, replace the stale hash with the reported `got:` hash and rerun the same Nix build successfully before committing.

## Commit guidance

Commit substantial, coherent slices with conventional messages, for example:

```sh
jj commit -m "docs: update agent instructions" AGENTS.md
```

After committing, verify:

```sh
jj status --no-pager
```
