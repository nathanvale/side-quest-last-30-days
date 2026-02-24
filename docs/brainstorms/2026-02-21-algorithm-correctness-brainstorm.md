---
date: 2026-02-21
topic: algorithm-correctness
---

# Algorithm Correctness Plan Brainstorm

## What We're Building
We want a two-phase correctness program for the last-30-days algorithm. Phase 1 proves correctness of our algorithm with deterministic inputs. Phase 2 compares outcomes against the baseline repo the project was derived from. The goal is to lock behavior and detect drift when changes are made.

## Why This Approach
Use a hybrid strategy: **Golden Snapshot + Contract Tests**. Snapshots give end-to-end confidence with real-world inputs, while contract tests validate the math in isolation. This balances rigor and stability without relying on flaky live data.

## Key Decisions
- **Correctness criteria:** both ranking stability and score stability, with tolerances where needed.
- **Testing strategy:** golden snapshots for end-to-end pipeline plus contract tests for scoring, trend weighting, recency decay, penalties, and dedupe.
- **Data source:** baseline snapshots stored in `fixtures/` for now to keep dependencies low.
- **CI enforcement:** fail builds if algorithm changes without updated snapshots.

## Open Questions
- What numeric tolerance should we allow for score deltas (e.g., absolute vs percentage, per-field limits)?
- Which dataset size is the minimum “realistic” snapshot set (topic count, source mix)?
- Do we gate CI on both snapshot freshness and contract test coverage thresholds?
- Should the baseline comparison against the old repo be in CI or a separate periodic job?
- Should we open a GitHub issue to evaluate S3-based snapshot storage if fixtures grow too large? (leaning yes)

## Next Steps
→ `/workflows:plan` for implementation details
