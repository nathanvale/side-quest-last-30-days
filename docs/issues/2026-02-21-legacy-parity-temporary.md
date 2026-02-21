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
