---
status: resolved
priority: p2
issue_id: "003"
tags: [code-review, agent-native]
dependencies: []
---

# 003 - Watch/Briefing Subcommands Lack JSON Output Mode

## Problem Statement

The `watch` and `briefing` subcommands parse `--json` but don't honor it. Agents calling `wots watch list --json` get plain text instead of a structured JSON envelope, breaking the agent-native contract.

**Why it matters:** If agents can search via `wots "topic" --json`, they should also be able to manage watches and briefings programmatically with the same envelope format.

## Findings

- **Source:** Agent-Native Reviewer
- **File:** `src/cli.ts` (watch/briefing handlers)
- **Evidence:** Watch subcommands output plain text via console.log. No JSON envelope wrapping.

## Proposed Solutions

### Option A: Add JSON envelope to watch/briefing output
- **Pros:** Full agent-native parity
- **Cons:** More code to maintain
- **Effort:** Medium
- **Risk:** Low

### Option B: Document as out-of-scope for v1
- **Pros:** Ship faster, reduce scope
- **Cons:** Breaks agent-native promise
- **Effort:** Small
- **Risk:** Medium (agents can't automate watch management)

## Recommended Action

Add JSON envelopes to watch/briefing subcommand outputs when `--json` (or
`--jsonl`) is provided.

## Technical Details

- **Affected files:** `src/cli.ts` (watch add/list/remove/history handlers)
- **Components:** Watch subcommands, briefing subcommand

## Acceptance Criteria

- [x] `wots watch list --json` returns `{ "status": "data", ... }`
- [x] `wots watch add "topic" --json` returns success envelope
- [x] `wots briefing "topic" --json` returns JSON envelope
- [x] Error cases return error envelope

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Created from code review | Agent-Native Reviewer flagged parity gap |
| 2026-02-24 | Resolved with JSON envelopes for watch/briefing | Enables agent-native management |

## Resources

- PR branch: feat/agent-native-cli
