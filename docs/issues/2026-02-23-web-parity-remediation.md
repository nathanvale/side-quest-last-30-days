# Issue: Web Legacy Parity Remediation

**Goal**
Close remaining Web parity gaps against legacy output so legacy compare can be retired safely.

**Context**
Legacy parity run on 2026-02-23 (`reports/legacy-compare.json`) shows Reddit/X parity is clean, but Web still diverges in top-10 ordering and score deltas over tolerance.

## Findings
- Web top-10 ordering changed for:
  - `melbourne-events`
  - `indie-games`
- Web score deltas over tolerance: `27` total.
- Per-topic over-tolerance counts:
  - `ai-assistants`: `5`
  - `rust-runtime`: `7`
  - `melbourne-events`: `8`
  - `e-bike`: `4`
  - `indie-games`: `3`

## Tasks
- Identify root causes for Web ranking and score divergence vs legacy.
- Implement fixes or explicitly codify accepted divergences.
- Re-run `bun run compare:legacy`.
- Record updated parity status and decision in `docs/issues/2026-02-21-legacy-parity-temporary.md`.
- If parity is accepted, remove legacy compare harness (`scripts/baseline/compare-legacy.ts`) and related script wiring.

## Acceptance Criteria
- Web top-10 ordering parity accepted (fixed or intentionally accepted with rationale).
- Web over-tolerance deltas reduced to acceptable level with documented reasoning.
- Final parity decision updated in the legacy parity issue.
