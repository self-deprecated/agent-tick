---
title: add a license. Permissive but stopping others from running it for profit - like amazon
priority: medium
---

## Goal

Add a source-available license that permits broad use (including internal commercial use) but prevents third parties from offering agent-tick as a hosted/managed service. License converts to Apache 2.0 after a fixed window.

## Acceptance Criteria

- [ ] `LICENSE` file at repo root contains the Business Source License 1.1 text with the parameters below filled in.
- [ ] Licensor: `Self-Deprecated ApS` (registered in Denmark).
- [ ] Change Date: 2 years from the date the LICENSE file is committed (concrete date written into the file, e.g. `2028-04-18` if committed on 2026-04-18).
- [ ] Change License: `Apache License, Version 2.0`.
- [ ] Additional Use Grant: "Any use of the Licensed Work is permitted, except offering the Licensed Work to third parties as a hosted or managed service."
- [ ] `README.md` gains a short "License" section referencing BSL 1.1 and noting the Additional Use Grant in plain English.
- [ ] No other files need license headers (single top-level LICENSE is sufficient for BSL 1.1).

## Design Decisions

- **License**: Business Source License 1.1 (BSL 1.1).
- **Change Date**: 2 years from each release/commit of the license file.
- **Change License**: Apache License, Version 2.0.
- **Additional Use Grant**: "Any use of the Licensed Work is permitted, except offering the Licensed Work to third parties as a hosted or managed service."
- **Licensor**: Self-Deprecated ApS, registered in Denmark.

## Implementation Notes

- Use the canonical BSL 1.1 template from https://mariadb.com/bsl11/ — do not hand-roll the legal text.
- Fill the four parameters: Licensor, Licensed Work (agent-tick), Additional Use Grant, Change Date, Change License.
- Compute the Change Date as (commit date + 2 years) and hard-code it into the file.
- When future releases ship, the Change Date should be updated to (that release's date + 2 years) — document this in README or a RELEASING note so it isn't forgotten.
