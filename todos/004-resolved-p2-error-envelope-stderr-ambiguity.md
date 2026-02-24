---
status: resolved
priority: p2
issue_id: "004"
tags: [code-review, agent-native]
dependencies: []
---

# 004 - Error Envelope Goes to stderr Only (Ambiguous for Agents)

## Problem Statement

In `--json` mode, error envelopes are written to stderr while success envelopes go to stdout. Some agent runtimes only capture stdout, meaning they miss structured error responses entirely.

**Why it matters:** The contract help says "Exit 0 = parse stdout. Exit 1-5 = read stderr." But agents using subprocess capture may not read stderr, getting empty stdout on errors instead of the structured error envelope.

## Findings

- **Source:** Agent-Native Reviewer
- **File:** `src/lib/output.ts` (`writeError` function)
- **Evidence:** `writeError` writes to `process.stderr`, not `process.stdout`.

## Proposed Solutions

### Option A: Write error envelope to stdout in --json mode
- **Pros:** Agents always get JSON on stdout regardless of success/failure
- **Cons:** Mixing error and data on stdout (some purists object)
- **Effort:** Small
- **Risk:** Low

### Option B: Write to both stdout and stderr in --json mode
- **Pros:** Compatible with both capture strategies
- **Cons:** Duplicate output
- **Effort:** Small
- **Risk:** Low

### Option C: Document clearly and keep current behavior
- **Pros:** No code change, Unix convention (errors to stderr)
- **Cons:** Agents that only read stdout get nothing on error
- **Effort:** Small
- **Risk:** Medium

## Recommended Action

Emit JSON error envelopes to stdout as well as stderr in JSON/JSONL mode.

## Technical Details

- **Affected files:** `src/lib/output.ts`
- **Components:** Error output routing

## Acceptance Criteria

- [x] Agents capturing only stdout get structured JSON on error in --json mode
- [x] Non-JSON mode errors still go to stderr as plain text
- [x] Contract help text matches actual behavior

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Created from code review | Agent-Native Reviewer flagged stderr-only errors |
| 2026-02-24 | Resolved by duplicating JSON errors to stdout | Improves agent compatibility |

## Resources

- PR branch: feat/agent-native-cli
