---
title: Set up CLI distribution via GoReleaser (Homebrew tap, Scoop bucket, install.sh, GitHub Releases)
priority: medium
---

## Goal

Make `agent-tick` installable via Homebrew (macOS/Linux), Scoop (Windows), a `curl | sh` install script, and pre-built binaries on GitHub Releases — mirroring the setup used in `~/Development/active/tools/juggler`.

## Acceptance Criteria

- [ ] `.goreleaser.yaml` at repo root, modeled on `~/Development/active/tools/juggler/.goreleaser.yaml`:
  - Builds from `./apps/server/cmd/agent-tick`
  - Targets `linux`, `darwin`, `windows` × `amd64`, `arm64`
  - `CGO_ENABLED=0` (note: the SQLite store uses `mattn/go-sqlite3` which requires CGO — if this conflicts, switch the server-only build to a separate goreleaser build ID with CGO, and keep the CLI standalone without the server subcommand, OR switch SQLite driver to a pure-Go alternative like `modernc.org/sqlite`. Document the choice in the task output.)
  - `brews:` block publishing to a tap repo (name TBD — propose `self-deprecated/homebrew-tap` or similar; confirm with user before creating)
  - `scoops:` block publishing to a scoop bucket repo (name TBD — propose `self-deprecated/scoop-bucket`)
  - Archive template matches juggler's conventions
  - Checksums file
- [ ] `install.sh` at repo root (adapted from juggler's) that detects OS+arch, downloads the appropriate archive from the latest GitHub Release, and installs to `~/.local/bin`.
- [ ] GitHub Actions workflow `.github/workflows/release.yml` that runs GoReleaser on tag push. Reuses the existing `cli release workflow` (commit `6f9963f`) as a starting point — extend or replace.
- [ ] Secrets documented (but NOT committed): `GITHUB_TOKEN` (default), plus a PAT with write access to the tap and scoop-bucket repos (usually `GORELEASER_TAP_TOKEN` or similar).
- [ ] First successful dry-run with `goreleaser release --snapshot --clean` produces archives for all 6 platforms locally.

## Design Decisions

- **Mirror juggler's approach exactly** where possible — same GoReleaser structure, same install.sh shape, same release workflow pattern. Deviate only where the CGO SQLite dependency forces a split.
- **Tap and bucket repos** will be new GitHub repos under the user's `self-deprecated` org (or wherever they prefer — confirm before creating).
- **Binary name**: `agent-tick`.

## Implementation Notes

- Reference: `~/Development/active/tools/juggler/.goreleaser.yaml`, `~/Development/active/tools/juggler/install.sh`, `~/Development/active/tools/juggler/.github/workflows/*release*`.
- The current CLI bundles both the server and the client (all subcommands in one binary). The server uses `mattn/go-sqlite3` → CGO. Options:
  1. Build with CGO enabled for all platforms (cross-compilation gets harder, needs zig or platform runners).
  2. Switch to `modernc.org/sqlite` (pure Go, CGO-free). Easiest for distribution.
  3. Split the binary: `agent-tick` (client-only, pure Go) + `agent-tick-server` (requires CGO). More ergonomic for end users.
  Recommend option 2 if the SQLite access patterns are compatible; otherwise option 3.
- Before creating tap/bucket repos, the implementing agent MUST ask the user for confirmation on repo names and org.
- Verify goreleaser config with `goreleaser check` and `goreleaser release --snapshot --clean --skip=publish` before tagging anything.
