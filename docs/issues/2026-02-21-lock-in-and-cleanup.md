# Issue: Lock-In + Cleanup

**Goal**
Finalize baseline lock‑in, retire legacy compare, and document the local smoke test runbook.

## Tasks
- Remove legacy compare harness after parity is accepted.
- Confirm baseline guard + tests run in CI.
- Add a short smoke‑test runbook to README/EXPLAIN.
- Ensure `reports/` is excluded from git if it’s temporary output.

## Acceptance Criteria
- Legacy compare removed and no longer referenced.
- Baseline workflow documented clearly.
- Smoke‑test runbook present in README and EXPLAIN.
- `.gitignore` updated if needed to exclude `reports/`.
