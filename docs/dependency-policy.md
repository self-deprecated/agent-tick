# Dependency policy

Agent Tick keeps npm dependencies deliberately small, pinned, and reproducible.

## Default stance

- Prefer the TypeScript/Node standard library, browser APIs, platform APIs, or workspace code over adding a package.
- Add a new npm dependency only when it materially reduces risk or complexity compared with local code.
- Avoid small convenience packages, abandoned packages, packages with unclear ownership, and packages with broad transitive dependency trees.
- Keep the public CLI runtime dependency surface especially small.

## Versioning and lockfiles

- Pin all npm package versions exactly in `package.json`; do not use `^`, `~`, `>`, `>=`, or tag ranges such as `latest`.
- Keep `pnpm-lock.yaml` committed.
- Use Corepack and the pnpm version declared by the root `packageManager` field.
- Use frozen lockfile installs for CI, release, Docker, and reproducibility checks:

  ```sh
  corepack pnpm install --frozen-lockfile
  ```

- When intentionally updating dependencies, update package manifests and `pnpm-lock.yaml` together.
- For Nix package builds that use `fetchPnpmDeps`, update the corresponding fixed-output hash in `flake.nix` in the same dependency-change commit.

## Lifecycle scripts

Dependency install scripts are a supply-chain risk.

- Do not broadly enable arbitrary dependency build scripts.
- Keep the `onlyBuiltDependencies` allowlist in `pnpm-workspace.yaml` minimal and explicit.
- Adding a package that requires an install/build lifecycle script requires an explicit explanation in the change.

## Review checklist for new dependencies

Before adding a dependency, document or verify:

- Why local/workspace code is not the better option.
- Whether the package is maintained and has a clear upstream.
- The size and risk of its transitive dependency graph.
- Whether it runs install scripts or downloads binaries.
- Whether it handles secrets, auth, crypto, approvals, notifications, or other sensitive data.
- Whether the dependency is needed at runtime or can be dev-only.

## Useful commands

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm install --lockfile-only
corepack pnpm audit
```
