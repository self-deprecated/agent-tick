---
title: GitHub Actions release gate
description: Gate a GitHub Actions release or deploy step with an Agent Tick sanction.
sidebar_label: GitHub Actions
---

# GitHub Actions release gate

Use the Agent Tick GitHub Action to pause a release workflow until a human approves the exact release candidate. GitHub Actions still builds, tags, publishes, and deploys; Agent Tick only routes the bounded Sanction decision and records the response.

This pattern is useful when a manual release job can build and package unattended but should not publish until a reviewer has checked the tag, commit SHA, changelog, timeout window, and rollback owner. Prefer a manual `workflow_dispatch` trigger with a dry-run default for first releases; add automatic release triggers only after you are comfortable with the gate and recovery path.

## What the reviewer should see

Keep the request short and reproducible. Include:

- release tag or version
- immutable commit SHA
- changelog or GitHub Release URL
- release target, such as npm, app store, container registry, or production environment
- timeout window and what happens if nobody responds
- rollback or hotfix owner for production-impacting releases

Do not include secrets, bearer tokens, private keys, cookies, `.env` files, raw logs, full agent prompts/transcripts, or customer data in `title`, `body`, `command`, or metadata.

## Required secrets

Store these values as GitHub Actions secrets before enabling the gate:

| Secret | Purpose |
| --- | --- |
| `AGENT_TICK_SERVER` | Hosted app/API or self-hosted Agent Tick server URL, for example `https://app.agenttick.sh` or your own self-hosted URL. |
| `AGENT_TICK_TOKEN` | Agent Tick agent token scoped for the release workflow. |
| `NPM_TOKEN` | npm token with publish rights, if your guarded release target is npm. Use the equivalent registry/deploy secret for other targets. |

Use separate Agent Tick tokens for release workflows when possible so revocation does not affect unrelated CI jobs. Keep publish credentials in GitHub Actions secrets; do not include them in the Agent Tick Sanction title, body, command, or metadata.

## Workflow example

The example below creates a manual release gate with `workflow_dispatch`. It defaults to `dry-run: true`, builds and tests before the gate, then publishes for real only when the Agent Tick Sanction returns `approve`.

```yaml
name: gated-release

on:
  workflow_dispatch:
    inputs:
      release-tag:
        description: Release tag, for example v1.2.3
        required: true
      changelog-url:
        description: Changelog or release notes URL
        required: true
      dry-run:
        description: Run publish with --dry-run
        required: false
        default: "true"
        type: choice
        options:
          - "true"
          - "false"

permissions:
  contents: read
  id-token: write

concurrency:
  group: gated-release
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Resolve release context
        id: release-context
        shell: bash
        run: |
          set -euo pipefail
          tag="${{ github.event.inputs.release-tag }}"
          changelog="${{ github.event.inputs.changelog-url }}"
          sha="${{ github.sha }}"
          echo "tag=${tag}" >> "$GITHUB_OUTPUT"
          echo "sha=${sha}" >> "$GITHUB_OUTPUT"
          echo "changelog=${changelog}" >> "$GITHUB_OUTPUT"

      - name: Build and test candidate
        run: |
          corepack enable
          pnpm install --frozen-lockfile
          pnpm test
          pnpm build

      - name: Verify publish credentials
        if: ${{ github.event.inputs.dry-run != 'true' }}
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: npm whoami --registry https://registry.npmjs.org >/dev/null

      - name: Wait for Agent Tick release Sanction
        id: sanction
        if: ${{ github.event.inputs.dry-run != 'true' }}
        uses: self-deprecated/agent-tick/integrations/github-actions/sanction-request@v1.0.0
        with:
          server: ${{ secrets.AGENT_TICK_SERVER }}
          token: ${{ secrets.AGENT_TICK_TOKEN }}
          title: Publish ${{ github.repository }} ${{ steps.release-context.outputs.tag }}?
          body: |
            Repository: ${{ github.repository }}
            Tag: ${{ steps.release-context.outputs.tag }}
            Commit: ${{ steps.release-context.outputs.sha }}
            Changelog: ${{ steps.release-context.outputs.changelog }}
            Timeout: 30m; no response blocks the release.
            Rollback owner: release captain
          command: pnpm publish --access public --provenance
          timeout: 30m

      - name: Publish release artifact
        if: ${{ github.event.inputs.dry-run == 'true' || steps.sanction.outputs.choice-id == 'approve' }}
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
          DRY_RUN: ${{ github.event.inputs.dry-run }}
        run: |
          set -euo pipefail
          args=(publish --access public --provenance)
          if [[ "${DRY_RUN}" == "true" ]]; then
            args+=(--dry-run)
          fi
          pnpm "${args[@]}"
```

For a complete copyable file, see [`examples/github-actions/release-sanction.yml`](https://github.com/self-deprecated/agent-tick/blob/main/examples/github-actions/release-sanction.yml). If you add a `release` event trigger later, keep the publish step behind the same Agent Tick approval condition and make sure the tag/changelog fallback cannot publish the wrong candidate.

## How denial and timeout behave

The composite action exits with the same status code as `agent-tick sanction`. A denial or timeout should normally fail the guarded job and stop the publish step. If your workflow needs a softer path, branch on `steps.sanction.outputs.choice-id` and keep the protected publish/deploy command behind `choice-id == 'approve'`.

Do not put the protected publish command inside Agent Tick. The `command` input is reviewer context only; GitHub Actions remains the execution environment.

## Checklist before shipping

- The release candidate is already built/tested before the Sanction step.
- The request body includes tag, SHA, changelog URL, target, timeout, and owner.
- The Response text contains no secrets, raw logs, prompts, or customer data.
- The publish/deploy step runs only when `choice-id == 'approve'`.
- Denial and timeout block by default or route to a documented manual recovery path.
