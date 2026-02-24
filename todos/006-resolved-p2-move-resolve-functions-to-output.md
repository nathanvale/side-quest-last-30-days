---
status: resolved
priority: p2
issue_id: "006"
tags: [code-review, architecture]
dependencies: []
---

# 006 - resolveOutputArgs/resolveErrorContext Should Move to output.ts

## Problem Statement

`resolveOutputArgs()` and `resolveErrorContext()` are defined in `cli.ts` but are pure functions that belong in `output.ts`. They handle output formatting decisions (JSON envelope, emit mode resolution, error serialization) which is the output module's responsibility.

**Why it matters:** Keeping output logic in cli.ts makes cli.ts harder to test and reason about. The functions have no CLI-specific dependencies and would be more discoverable in output.ts.

## Findings

- **Source:** TypeScript Reviewer, Architecture Strategist
- **File:** `src/cli.ts` (resolveOutputArgs, resolveErrorContext), `src/lib/output.ts`
- **Evidence:** Both functions are pure (no process.exit, no I/O) and only depend on types already imported by output.ts.

## Proposed Solutions

### Option A: Move both functions to output.ts
- **Pros:** Clean separation, easier to test
- **Cons:** Import changes in cli.ts
- **Effort:** Small
- **Risk:** Low

## Recommended Action

Move `resolveOutputArgs()` and `resolveErrorContext()` into `output.ts`.

## Technical Details

- **Affected files:** `src/cli.ts`, `src/lib/output.ts`

## Acceptance Criteria

- [x] resolveOutputArgs lives in output.ts
- [x] resolveErrorContext lives in output.ts
- [x] cli.ts imports them from output.ts
- [x] Existing tests pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Created from code review | TypeScript Reviewer + Architecture Strategist both flagged |
| 2026-02-24 | Resolved by relocating output helpers | CLI now delegates output concerns |

## Resources

- PR branch: feat/agent-native-cli
