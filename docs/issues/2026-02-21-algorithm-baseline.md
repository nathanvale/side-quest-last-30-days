# Issue: Algorithm Baseline Lock-In (Deterministic)

**Goal**
Lock deterministic algorithm behavior with golden snapshots and contract tests so scoring/ranking drift is explicit and reviewable.

**Context**
We now have deterministic fixtures and baseline tests. This issue formalizes sign-off and usage rules.

**Current Status**
Baseline fixtures exist in `fixtures/algorithm-baseline/v1.json`. Snapshot and contract tests are in `tests/algorithm-baseline.test.ts` and `tests/algorithm-contracts.test.ts`. CI guard is wired and `bun run update:baseline` is documented.

## Tasks
- Confirm baseline fixtures represent current intent (`fixtures/algorithm-baseline/v1.json`).
- Confirm baseline tolerances for internal correctness (strict) are correct.
- Confirm update workflow: `bun run update:baseline` is the only acceptable fixture update.
- Ensure CI guard blocks algorithm file changes without baseline updates.
- Update README/EXPLAIN with baseline workflow if not already present.

## Acceptance Criteria
- Baseline fixtures reviewed and approved by maintainer.
- Baseline tests pass (`tests/algorithm-baseline.test.ts`).
- CI guard triggers on algorithm changes without fixture updates.
- Baseline update command documented.

## Notes
- Baseline is deterministic (fixed dates, seeded data). No live data used here.
