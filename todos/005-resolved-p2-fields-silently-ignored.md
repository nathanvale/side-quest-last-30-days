---
status: resolved
priority: p2
issue_id: "005"
tags: [code-review, agent-native]
dependencies: []
---

# 005 - --fields Silently Ignored with Non-JSON Emit Modes

## Problem Statement

Passing `--fields=score,title,url` with `--emit=compact` or `--emit=md` silently ignores the fields flag. No warning, no error. Agents may think they're getting projected output when they're getting full output.

**Why it matters:** Silent flag ignoring violates the principle of least surprise. Agents constructing CLI invocations may not realize their --fields flag has no effect.

## Findings

- **Source:** Agent-Native Reviewer
- **File:** `src/cli.ts`, `src/lib/field-projection.ts`
- **Evidence:** Field projection only applies in JSON/JSONL output paths. Compact/md/context renderers ignore the fields list.

## Proposed Solutions

### Option A: Warn on stderr when --fields used with incompatible mode
- **Pros:** Non-breaking, informative
- **Cons:** Agents may not read stderr
- **Effort:** Small
- **Risk:** Low

### Option B: Error with CONFLICT_FLAGS when --fields used with non-JSON mode
- **Pros:** Explicit, fail-fast
- **Cons:** Breaking if anyone accidentally uses it today
- **Effort:** Small
- **Risk:** Low

### Option C: Document the limitation in help text
- **Pros:** No code change
- **Cons:** Doesn't prevent silent misconfiguration
- **Effort:** Small
- **Risk:** Low

## Recommended Action

Error when `--fields` is used with non-JSON emit modes to prevent silent ignores.

## Technical Details

- **Affected files:** `src/cli.ts` (flag validation), `src/lib/help.ts` (documentation)

## Acceptance Criteria

- [x] `--fields=x --emit=compact` produces a warning or error
- [x] `--fields=x --json` continues to work as expected
- [x] Help text documents which modes support --fields

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Created from code review | Agent-Native Reviewer flagged silent flag ignoring |
| 2026-02-24 | Resolved with conflict error on incompatible emit modes | Prevents silent misconfiguration |

## Resources

- PR branch: feat/agent-native-cli
