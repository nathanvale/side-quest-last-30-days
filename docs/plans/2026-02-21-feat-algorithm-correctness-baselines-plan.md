---
title: Algorithm Correctness Baselines
type: feat
status: active
date: 2026-02-21
origin: docs/brainstorms/2026-02-21-algorithm-correctness-brainstorm.md
---

# Algorithm Correctness Baselines

## Overview
Establish a two-phase correctness program for the last-30-days algorithm. Phase 1 proves correctness with deterministic inputs and golden snapshots. Phase 2 compares outputs against the baseline repo the project was derived from. This plan hardens the repo by locking algorithm behavior and detecting drift in ranking or scoring. (see brainstorm: docs/brainstorms/2026-02-21-algorithm-correctness-brainstorm.md)

## Problem Statement / Motivation
The scoring and dedupe pipeline is opinionated and central to product value. Without a deterministic baseline, subtle changes can drift ranking or scoring without being noticed. We need a repeatable, CI-enforced approach that signals when algorithm behavior changes and forces explicit baseline updates. (see brainstorm: docs/brainstorms/2026-02-21-algorithm-correctness-brainstorm.md)

## Proposed Solution
Adopt a hybrid testing strategy: golden snapshots for end-to-end correctness plus contract tests for core math. Store snapshots in `fixtures/` and enforce freshness in CI. Use explicit update commands to regenerate baselines when behavior changes. (see brainstorm: docs/brainstorms/2026-02-21-algorithm-correctness-brainstorm.md)

## Technical Considerations
- Snapshot stability: capture deterministic inputs and normalized outputs to avoid flaky tests.
- Tolerances: use a hybrid rule for score deltas (human-friendly). Default policy: `abs(delta) <= max(0.01, 0.5% of baseline)` with a minimum baseline clamp of `1.0` to avoid divide-by-zero.
- Drift detection: add a guard that fails CI when algorithm-affecting files change without snapshot updates. Initial file set: `src/lib/score.ts`, `src/lib/dedupe.ts`, `src/lib/normalize.ts`, `src/lib/trend.ts`, `src/lib/dates.ts`, `src/lib/delta.ts`, `src/lib/render.ts`, `src/lib/entity-extract.ts`, `src/lib/retrieval/**`, `src/adapters/youtube.ts`.
- Coverage: ensure contract tests cover scoring, trend weighting, recency decay, penalties, normalization, and dedupe. (see brainstorm: docs/brainstorms/2026-02-21-algorithm-correctness-brainstorm.md)
- Fixture growth: keep datasets scoped and add a future migration note for external storage if fixtures become too large. (see brainstorm: docs/brainstorms/2026-02-21-algorithm-correctness-brainstorm.md)

## Tolerance Policy (Concrete)
- Score delta rule (initial defaults, tune later): `abs(delta) <= max(0.01, 0.5% of baseline)` where `baseline = max(baselineScore, 1.0)`.
- Ranking rule (initial defaults, tune later): top-10 strict order; items below top 10 may drift by at most ±2 slots unless score deltas exceed tolerance.
- Tie-breakers: deterministic order by `source`, `id`, then `title` when scores are within tolerance.

## Baseline Dataset Scope (Locked)
- Topics: 5 fixed topics (mix of technical + non-technical) captured once and pinned for v1.
- Sources: Reddit, X, YouTube, Web (to exercise source-specific scoring and penalties).
- Strategy: single-phase only (two-phase added later once v1 is stable).
- Window: 30-day lookback.
- Size target: 15-25 items per source per topic after normalization.
- Inputs: normalized items for baseline comparisons; separate small fixtures for raw normalization coverage.

## Human-Friendly CI Output (Example)
```text
Algorithm baseline mismatch detected.
Top-10 order changed: 3 items moved beyond allowed tolerance.
Score deltas exceeded tolerance: 2 items.
If this change is intentional, run:
  bun run update:baseline
Then review the diff in fixtures and commit.
```

## System-Wide Impact
- Interaction graph: algorithm changes affect CLI output ranking, JSON report ordering, and downstream consumer expectations.
- Error propagation: tests should fail loudly when snapshot mismatches occur, with clear diff output.
- State lifecycle risks: fixture updates must be explicit to avoid accidental drift acceptance.
- API surface parity: CLI and library exports must continue to produce identical algorithm results on the same inputs.
- Integration test scenarios: real-world dataset snapshots should exercise multi-source normalization, trend scoring, and dedupe across sources.

## SpecFlow Analysis Summary
### User Flow Overview
1. Developer changes algorithm code, runs `bun run update:baseline`, reviews snapshot diffs, commits snapshots.
2. Developer changes algorithm code without updating baselines, CI fails with a clear error and instructions.
3. Baseline comparison against the legacy repo is run on a schedule or manual command, producing a report of score/rank deltas.
4. Developer updates baseline size or tolerance values, revalidates via tests, and commits updated configuration.

### Flow Permutations Matrix
- User state: new contributor vs existing maintainer.
- Context: algorithm change vs refactor with no behavior change.
- Environment: local run vs CI run.
- Data path: using stored fixtures vs re-capturing from live APIs.

### Missing Elements & Gaps
- Error handling: explicit messaging when mismatches occur and how to update snapshots.
- Validation: tolerance policy for score deltas and ranking changes.
- Integration contract: scope of which sources must be included in baseline snapshots.
- Storage policy: criteria for moving fixtures to external storage in the future.

### Critical Questions Requiring Clarification
1. Critical: What numeric tolerance should score deltas allow, and is it absolute or percentage-based?
2. Critical: What dataset size is the minimum “realistic” snapshot set (topic count, source mix)?
3. Important: Should baseline comparison against the old repo run in CI or as a scheduled job?
4. Nice-to-have: What is the threshold for moving fixtures to external storage and how to document that migration?

### Recommended Next Steps
- Define tolerance policy and dataset scope before implementation.
- Decide whether baseline comparison runs in CI or as a scheduled job.
- Create a GitHub issue to track future S3 migration criteria. (see brainstorm: docs/brainstorms/2026-02-21-algorithm-correctness-brainstorm.md)
- Add a human-friendly CI diff summary with the exact snapshot update command to avoid blind trust.

## Acceptance Criteria
- A deterministic golden snapshot test validates ranking order and score values against fixtures with declared tolerances. (see brainstorm: docs/brainstorms/2026-02-21-algorithm-correctness-brainstorm.md)
- Contract tests cover scoring, trend weighting, recency decay, penalties, normalization, and dedupe. (see brainstorm: docs/brainstorms/2026-02-21-algorithm-correctness-brainstorm.md)
- CI fails if algorithm-affecting files change without updated baseline snapshots. (see brainstorm: docs/brainstorms/2026-02-21-algorithm-correctness-brainstorm.md)
- Baseline snapshots are stored in `fixtures/` and are version-controlled. (see brainstorm: docs/brainstorms/2026-02-21-algorithm-correctness-brainstorm.md)
- A documented command exists to update baseline snapshots in one step.
- Default tolerance policy is enforced (score floor 0.01, 0.5% pct, top-10 strict, ±2 slots below) with clear documentation that it is tunable.

## Success Metrics
- Zero unexpected ranking or score regressions across merges after baselines are introduced.
- Snapshot update process takes under 5 minutes for a maintainer.
- CI failure messages clearly indicate baseline drift and update steps.

## Dependencies & Risks
- Risk: live data snapshots can become stale or too large if not curated.
- Risk: tolerances too loose could hide regressions; too strict could make CI noisy.
- Dependency: access to API keys for initial snapshot capture.

## Proposed Implementation Phases
### Phase 1: Baseline Design
- Define baseline dataset scope and tolerance policy.
- Identify algorithm-affecting files to include in drift detection.
- Decide baseline comparison strategy against legacy repo.

### Phase 2: Baseline Fixtures and Tests
- Capture real-world inputs and outputs into `fixtures/`.
- Add golden snapshot tests for ranking and score validation.
- Add contract tests for scoring, trend weighting, recency decay, penalties, normalization, and dedupe.

### Phase 3: CI Enforcement and Developer Workflow
- Add `bun run update:baseline` (or similar) script.
- Add CI guard that fails on algorithm changes without snapshot updates.
- Document the workflow in `README.md` or `EXPLAIN.md`.

### Phase 4: Legacy Repo Comparison
- Implement a comparison harness that runs both repos on the same fixtures and outputs deltas.
- Execution: scheduled weekly GitHub Action plus manual `bun run compare:legacy`.

## Alternative Approaches Considered
- Live end-to-end tests only: rejected due to flakiness and rate-limit risk.
- Unit tests only: rejected due to limited coverage of integration behavior. (see brainstorm: docs/brainstorms/2026-02-21-algorithm-correctness-brainstorm.md)

## Sources & References
- Origin brainstorm: `docs/brainstorms/2026-02-21-algorithm-correctness-brainstorm.md`
- Primary reference: `README.md`
- Architecture context: `EXPLAIN.md`

## Open Questions
- Create GitHub issue for future S3 snapshot migration criteria.
