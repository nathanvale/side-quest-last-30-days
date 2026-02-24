---
status: resolved
priority: p3
issue_id: "009"
tags: [code-review, agent-native]
dependencies: []
---

# 009 - Add --version Flag and Schema Version to Envelope

## Problem Statement

The CLI lacks a `--version` flag and the JSON envelope doesn't include a schema version. Agents can't programmatically check which version they're talking to or detect breaking changes.

## Findings

- **Source:** Agent-Native Reviewer
- **Evidence:** No --version flag in parse-args.ts. JSON envelope has no version field.

## Proposed Solutions

### Option A: Add --version flag + schema_version field in envelope
- **Pros:** Full version introspection for agents
- **Cons:** Must maintain schema version discipline
- **Effort:** Small
- **Risk:** Low

## Recommended Action

Add `--version` flag and include `schema_version` in JSON envelopes.

## Acceptance Criteria

- [x] `wots --version` prints version from package.json
- [x] JSON envelope includes `"schema_version": "1"` field
- [x] Help text documents --version

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Created from code review | Agent-Native Reviewer suggested |
| 2026-02-24 | Resolved with version flag + schema_version field | Enables agent introspection |

## Resources

- PR branch: feat/agent-native-cli
