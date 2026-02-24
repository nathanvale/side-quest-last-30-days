---
status: resolved
priority: p2
issue_id: "007"
tags: [code-review, architecture]
dependencies: []
---

# 007 - Config Default Changed from 'auto' to 'pinned' (Behavioral Change)

## Problem Statement

The `MODEL_SELECTION` config default was changed from `'auto'` to `'pinned'` in this PR. This is a silent behavioral change bundled with a refactor -- users who relied on auto-selection of the latest model will now get a pinned model without knowing why.

**Why it matters:** This changes the default model selection strategy for all users. It should be an explicit, documented decision, not a side effect of a refactoring PR.

## Findings

- **Source:** TypeScript Reviewer, Architecture Strategist
- **File:** `src/lib/config.ts`
- **Evidence:** Default value changed in config without corresponding changelog entry or documentation update.

## Proposed Solutions

### Option A: Revert to 'auto' default, make 'pinned' opt-in via flag
- **Pros:** Non-breaking, backwards compatible
- **Cons:** May not achieve the intended goal
- **Effort:** Small
- **Risk:** Low

### Option B: Keep 'pinned' default but document in changelog
- **Pros:** Intentional decision is documented
- **Cons:** Still a breaking behavioral change
- **Effort:** Small
- **Risk:** Medium

## Recommended Action

Revert default model policy back to `auto` and keep `pinned` opt-in.

## Technical Details

- **Affected files:** `src/lib/config.ts`

## Acceptance Criteria

- [x] Default model selection strategy is intentional and documented
- [x] Changelog entry if behavior change is kept (not applicable)
- [x] Users can override via flag or env var

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Created from code review | TypeScript Reviewer flagged as silent breaking change |
| 2026-02-24 | Resolved by restoring auto default | Avoids unintentional behavior change |

## Resources

- PR branch: feat/agent-native-cli
