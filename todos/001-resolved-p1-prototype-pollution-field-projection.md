---
status: resolved
priority: p1
issue_id: "001"
tags: [code-review, security]
dependencies: []
---

# 001 - Prototype Pollution in field-projection.ts getByPath

## Problem Statement

The `getByPath()` function in `src/lib/field-projection.ts` traverses object properties using user-supplied dot-path strings from `--fields`. An attacker (or misconfigured agent) can pass `--fields=__proto__,constructor.prototype` to access or leak prototype chain properties.

**Why it matters:** This is a known OWASP vulnerability class. While the current impact is read-only (projection, not assignment), it could leak internal object metadata and is a vector for future exploitation if the code evolves.

## Findings

- **Source:** Security Sentinel agent
- **File:** `src/lib/field-projection.ts`, `getByPath()` function
- **Evidence:** No allowlist or denylist on path segments. Any dot-separated string is walked directly on the object.

## Proposed Solutions

### Option A: Denylist dangerous keys
- **Pros:** Minimal code change, targeted fix
- **Cons:** Denylist can be incomplete
- **Effort:** Small
- **Risk:** Low

```typescript
const DENIED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
// In getByPath, reject paths containing denied segments
```

### Option B: Allowlist valid field names from schema
- **Pros:** Most secure, self-documenting
- **Cons:** Must maintain allowlist as schema evolves
- **Effort:** Medium
- **Risk:** Low

### Option C: Use Object.hasOwn() check at each step
- **Pros:** Only traverses own properties, simple
- **Cons:** Slightly less explicit than allowlist
- **Effort:** Small
- **Risk:** Low

## Recommended Action

Implement denylist checks for dangerous keys and require own-property traversal
in `getByPath()` to prevent prototype chain access.

## Technical Details

- **Affected files:** `src/lib/field-projection.ts`
- **Components:** CLI field projection (`--fields` flag)

## Acceptance Criteria

- [x] `--fields=__proto__` returns empty/undefined, not Object.prototype
- [x] `--fields=constructor.prototype` returns empty/undefined
- [x] Existing valid field paths still work
- [x] Test coverage for prototype pollution attempts

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Created from code review | Security Sentinel flagged prototype pollution vector |
| 2026-02-24 | Resolved with denylist + own-property checks | Prevents prototype chain access in field projection |

## Resources

- [OWASP Prototype Pollution](https://owasp.org/www-community/attacks/Prototype_Pollution)
- PR branch: feat/agent-native-cli
