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
- Fill out winner scorecard metrics (`relevance_at_10`, `order_quality`, `known_bad_hits`) in `docs/issues/2026-02-23-algorithm-winner-scorecard.md`.
- Apply fact-check rubric and capture evidence rows in `docs/issues/2026-02-23-hit-quality-fact-check-rubric.md`.
- Record findings in this issue.

## Suggested Topics (busy / active)
- “Bun 1.3 features”
- “React Server Components security fixes”
- “Node.js 24/25 release changes”

## Acceptance Criteria
- Outputs saved under `reports/smoke/current/` and `reports/smoke/legacy/`.
- Manual comparison notes recorded.
- Scorecard table completed for each topic pair in `docs/issues/2026-02-23-algorithm-winner-scorecard.md`.
- Fact-check evidence captured for scored top-10 items.
- Decision: acceptable or needs adjustments.

## Execution Log (2026-02-23)
- Topics run:
  - `Bun 1.3 features`
  - `React Server Components security fixes`
  - `Node.js 24/25 release changes`
- Current outputs:
  - `reports/smoke/current/bun-1-3-features.json`
  - `reports/smoke/current/react-server-components-security-fixes.json`
  - `reports/smoke/current/node-js-24-25-release-changes.json`
- Legacy outputs:
  - `reports/smoke/legacy/bun-1-3-features.json`
  - `reports/smoke/legacy/react-server-components-security-fixes.json`
  - `reports/smoke/legacy/node-js-24-25-release-changes.json`
- Logs:
  - `reports/smoke/logs/*`

## Findings
- Runs succeeded for all topics in both implementations.
- In this terminal context, Web search did not execute; reports contained Web search instructions but no `web` items.
- This does not block the current parity scope, which is Reddit/X algorithm comparison.
- Remaining blocker is limited Reddit coverage in this batch and incomplete fact-check evidence rows.

## Decision
- **Needs adjustments**.
- Follow-up needed to run a Reddit-heavier topic batch and complete fact-check evidence capture.

## Follow-up Run (Reddit-Heavy, 2026-02-23)
- Ran additional smoke with `--sources=reddit` for:
  - `TypeScript 5.9`
  - `React 19 server components`
  - `Bun runtime`
  - `Node.js LTS`
  - `Next.js app router`
  - `Open source LLM tools`
- Artifacts:
  - `reports/smoke-reddit/current/`
  - `reports/smoke-reddit/legacy/`
  - `reports/smoke-reddit/logs/`
- Summary:
  - Reddit coverage remained sparse on current runs.
  - One current run hit non-retryable OpenAI quota (`Open source LLM tools`).
  - Outcome: still not enough live Reddit confidence for final winner declaration.
