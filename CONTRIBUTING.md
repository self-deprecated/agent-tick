# Contributing

Thanks for contributing to Agent Tick.

## Public mirror and PR policy

This repository is a public mirror of work developed in the private Self Deprecated mono-sd monorepo. The first public release is expected to be squashed into a single public init commit; private monorepo history is not part of the public repository.

Pull requests are welcome as **Prompt Requests**: a concrete problem statement, proposed direction, reproduction, patch, or review note that helps us decide what to do next. Depending on volume, timing, fit, and maintenance capacity, we may or may not review, accept, or merge public PRs.

Even when a PR is useful, we may recreate the change ourselves in the private monorepo and then sync an equivalent change back into the public mirror instead of merging the PR branch directly. If you send code, assume it may be adapted, rewritten, or used as design input under this repository's license.

## Dependency changes

Follow [`DEVELOPMENT.md#dependency-policy`](DEVELOPMENT.md#dependency-policy) for npm dependency changes.

In short:

- Prefer standard library, platform APIs, and workspace code before adding packages.
- Pin npm package versions exactly.
- Commit `pnpm-lock.yaml` with dependency changes.
- Use frozen lockfile installs for reproducibility checks.
- Keep dependency lifecycle-script allowlists minimal and explicit.

## Development workflow

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for local development, testing, and validation commands.
