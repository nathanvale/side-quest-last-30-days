---
status: resolved
priority: p3
issue_id: "010"
tags: [code-review, quality]
dependencies: []
---

# 010 - Unused Error Codes (NOT_FOUND, API_ERROR Never Thrown Directly)

## Problem Statement

The `CliErrorCode` union includes `NOT_FOUND` and `API_ERROR` which are documented in the contract help but never thrown as `CliError` instances in the codebase. They exist in the type but have no throw sites.

## Findings

- **Source:** Code Simplicity Reviewer
- **File:** `src/lib/cli-error.ts`, `src/cli.ts`
- **Evidence:** Grep for `code: 'NOT_FOUND'` and `code: 'API_ERROR'` shows no throw sites. These codes are documented but not used.

## Proposed Solutions

### Option A: Add throw sites where appropriate
- **Pros:** Contract matches implementation
- **Cons:** May require new error handling paths
- **Effort:** Medium
- **Risk:** Low

### Option B: Remove from type and contract docs
- **Pros:** Simpler, honest contract
- **Cons:** May want them later
- **Effort:** Small
- **Risk:** Low

### Option C: Keep as reserved codes, document as "reserved"
- **Pros:** Forward-compatible
- **Cons:** Slightly misleading
- **Effort:** Small
- **Risk:** Low

## Recommended Action

Keep codes reserved and document as such in the contract help text.

## Acceptance Criteria

- [x] All documented error codes either have throw sites or are marked as reserved
- [x] Contract help text matches reality

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Created from code review | Simplicity Reviewer flagged dead code |
| 2026-02-24 | Resolved by documenting reserved codes | Keeps forward compatibility |

## Resources

- PR branch: feat/agent-native-cli
