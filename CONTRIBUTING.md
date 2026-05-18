# Contributing

Thanks for contributing to Agent Tick.

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
