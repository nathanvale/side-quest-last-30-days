# Issue: Legacy Parity Check (Temporary)

**Goal**
Use the legacy repo to sanity-check parity while we build confidence in the current algorithm. Remove legacy compare once parity is acceptable.

**Context**
We have a compare harness (`bun run compare:legacy`) that uses deterministic fixtures and a relaxed tolerance to avoid rounding noise.

**Current Status**
Legacy compare harness exists at `scripts/baseline/compare-legacy.ts` and outputs `reports/legacy-compare.json`. Parity is clean for Reddit/X under relaxed tolerance; Web still shows top-10 order changes on two topics and remaining deltas.

## Tasks
- Run `bun run compare:legacy` and capture report in `reports/legacy-compare.json`.
- Review report:
Reddit/X parity must be clean.
Web parity differences must be explicitly accepted or fixed.
- Document the parity decision in this issue.
- Remove legacy compare harness once parity is accepted.

## Acceptance Criteria
- Parity decision recorded: accepted or rejected.
- If accepted, legacy compare script removed.
- If rejected, follow-up issue created for remediation.

## Removal Criteria
- Baseline fixtures approved.
- Local smoke tests are run and acceptable.
- Legacy compare no longer needed.

## Execution Log
- Ran `bun run compare:legacy` on 2026-02-23.
- Report captured at `reports/legacy-compare.json`.
- Report metadata:
  - `generated_at`: `2026-02-23T19:15:23.736Z`
  - `fixture_version`: `v1`
  - `from_date`: `2026-01-22`
  - `to_date`: `2026-02-21`

## Parity Review
- Reddit: clean parity (`top_order_changed=false`, `over_tolerance_count=0`).
- X: clean parity (`top_order_changed=false`, `over_tolerance_count=0`).
- Web: parity not clean:
  - `top_order_changed=true` for `melbourne-events` and `indie-games`.
  - `over_tolerance_count=27` across all topics.
  - Topic breakdown:
    - `ai-assistants`: `order_changed=false`, `over_tol=5`
    - `rust-runtime`: `order_changed=false`, `over_tol=7`
    - `melbourne-events`: `order_changed=true`, `over_tol=8`
    - `e-bike`: `order_changed=false`, `over_tol=4`
    - `indie-games`: `order_changed=true`, `over_tol=3`

## Decision
- **Parity decision: rejected (2026-02-23).**
- Legacy compare harness is retained for now.
- Follow-up issue created: `docs/issues/2026-02-23-web-parity-remediation.md`.
