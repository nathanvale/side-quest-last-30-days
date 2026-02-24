---
status: resolved
priority: p3
issue_id: "008"
tags: [code-review, simplicity]
dependencies: []
---

# 008 - field-projection.ts YAGNI Consideration

## Problem Statement

The `field-projection.ts` module (88 lines + tests) implements dot-path field projection for `--fields`. The Code Simplicity Reviewer argues this is YAGNI since agents typically have `jq` available and can project fields themselves.

**Why it matters:** Every feature has maintenance cost. If agents already have `jq`, the `--fields` flag adds complexity without unique value.

## Findings

- **Source:** Code Simplicity Reviewer
- **File:** `src/lib/field-projection.ts` (88 lines), tests
- **Evidence:** The feature duplicates what `| jq '{score, title, url}'` does. No evidence of user demand for built-in projection.

## Proposed Solutions

### Option A: Keep as-is (it's already built and tested)
- **Pros:** Already done, some agents may not have jq
- **Cons:** Ongoing maintenance, prototype pollution surface area
- **Effort:** None
- **Risk:** Low

### Option B: Remove and document jq examples instead
- **Pros:** -330 LOC, removes security surface area
- **Cons:** Less convenient for agents without jq
- **Effort:** Small
- **Risk:** Low

## Recommended Action

Keep field projection for now; document rationale and ensure security fix (#001).

## Technical Details

- **Affected files:** `src/lib/field-projection.ts`, related tests

## Acceptance Criteria

- [x] Decision documented
- [x] If removed: help text updated, jq examples added (not applicable)
- [x] If kept: prototype pollution fix applied (see #001)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Created from code review | Simplicity Reviewer flagged YAGNI |
| 2026-02-24 | Resolved by keeping feature and fixing security | Revisit removal with product input |

## Resources

- PR branch: feat/agent-native-cli
- Related: #001 (prototype pollution)
