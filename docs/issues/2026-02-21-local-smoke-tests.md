# Issue: Local Smoke Tests (Current vs Legacy)

**Goal**
Run live local smoke tests against active topics to validate the current algorithm “in the wild”.

**Scope**
Local only. No automation yet. Use the same topics and date window for current + legacy.

**Current Status**
Runbook has been added to README and EXPLAIN. No live smoke tests have been run yet.

## Tasks
- Choose 3–5 high‑activity dev topics (example below).
- Run current repo CLI for each topic and capture outputs.
- Run legacy repo CLI for the same topics and capture outputs.
- Compare results manually (top‑10 overlap, obvious ranking issues).
- Record findings in this issue.

## Suggested Topics (busy / active)
- “Bun 1.3 features”
- “React Server Components security fixes”
- “Node.js 24/25 release changes”

## Acceptance Criteria
- Outputs saved under `reports/smoke/current/` and `reports/smoke/legacy/`.
- Manual comparison notes recorded.
- Decision: acceptable or needs adjustments.
