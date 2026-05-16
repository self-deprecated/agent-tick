# GitHub Actions release Sanction tutorial

Use the Agent Tick GitHub Action to pause a release workflow until a human approves the exact release candidate. GitHub Actions still builds, tags, publishes, and deploys; Agent Tick only routes the bounded Sanction decision and records the response.

This pattern is useful when a release job can run unattended but should not publish until a reviewer has checked the tag, commit SHA, changelog, timeout window, and rollback owner.

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
| `AGENT_TICK_SERVER` | Hosted or self-hosted Agent Tick API URL, for example `https://api.agenttick.sh`. |
| `AGENT_TICK_TOKEN` | Agent Tick agent token scoped for the release workflow. |

Use separate Agent Tick tokens for release workflows when possible so revocation does not affect unrelated CI jobs.

## Workflow example

The example below creates a draft release gate for `workflow_dispatch` and `release` events. It checks out the exact SHA, builds and tests before the gate, then publishes only when the Agent Tick Sanction returns `approve`.

```yaml
name: gated-release

on:
  workflow_dispatch:
    inputs:
      release-tag:
        description: Release tag, for example v0.1.0
        required: true
      changelog-url:
        description: Changelog or release notes URL
        required: true
  release:
    types: [published]

permissions:
  contents: read

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
          tag="${{ github.event.inputs.release-tag || github.ref_name }}"
          changelog="${{ github.event.inputs.changelog-url || github.event.release.html_url }}"
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

      - name: Wait for Agent Tick release Sanction
        id: sanction
        uses: self-deprecated/agent-tick/integrations/github-actions/request-approval@v0.1.0
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
        if: ${{ steps.sanction.outputs.choice-id == 'approve' }}
        run: pnpm publish --access public --provenance
```

For a complete copyable file, see [`examples/github-actions/release-sanction.yml`](../examples/github-actions/release-sanction.yml).

## How denial and timeout behave

The composite action exits with the same status code as `agent-tick sanction`. A denial or timeout should normally fail the guarded job and stop the publish step. If your workflow needs a softer path, branch on `steps.sanction.outputs.choice-id` and keep the protected publish/deploy command behind `choice-id == 'approve'`.

Do not put the protected publish command inside Agent Tick. The `command` input is reviewer context only; GitHub Actions remains the execution environment.

## Checklist before shipping

- The release candidate is already built/tested before the Sanction step.
- The request body includes tag, SHA, changelog URL, target, timeout, and owner.
- The approval text contains no secrets, raw logs, prompts, or customer data.
- The publish/deploy step runs only when `choice-id == 'approve'`.
- Denial and timeout block by default or route to a documented manual recovery path.
