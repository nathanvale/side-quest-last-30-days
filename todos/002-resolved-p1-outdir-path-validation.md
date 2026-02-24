---
status: resolved
priority: p1
issue_id: "002"
tags: [code-review, security]
dependencies: []
---

# 002 - No --outdir Path Validation

## Problem Statement

The `--outdir` flag accepts any filesystem path without validation. A malicious or misconfigured agent could pass `--outdir=/etc` or `--outdir=../../sensitive-dir` to write output files to arbitrary locations.

**Why it matters:** Agents calling this CLI may construct paths dynamically. Without path validation, directory traversal attacks can write files outside the intended output area.

## Findings

- **Source:** Security Sentinel agent
- **File:** `src/cli.ts` (--outdir handling), `src/lib/parse-args.ts`
- **Evidence:** The outdir value is used directly in `fs.writeFileSync` calls without any path normalization or boundary checking.

## Proposed Solutions

### Option A: Resolve and validate path is under CWD or home
- **Pros:** Prevents directory traversal, simple to implement
- **Cons:** May be too restrictive for some use cases
- **Effort:** Small
- **Risk:** Low

```typescript
const resolved = path.resolve(outdir)
if (!resolved.startsWith(process.cwd()) && !resolved.startsWith(os.homedir())) {
  throw new CliError('--outdir must be under CWD or home directory', { code: 'INVALID_OUTDIR' })
}
```

### Option B: Just normalize and warn on absolute paths
- **Pros:** Less restrictive, still prevents `../` traversal
- **Cons:** Doesn't prevent writing to arbitrary absolute paths
- **Effort:** Small
- **Risk:** Medium

## Recommended Action

Validate relative `--outdir` paths to ensure they stay within the current
working directory. Allow absolute paths explicitly.

## Technical Details

- **Affected files:** `src/cli.ts`, `src/lib/parse-args.ts`
- **Components:** CLI output directory handling

## Acceptance Criteria

- [x] `--outdir=../../etc` is rejected or normalized safely
- [x] `--outdir=/tmp/output` works (valid absolute path)
- [x] `--outdir=./output` works (relative path)
- [ ] Test coverage for path traversal attempts

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Created from code review | Security Sentinel flagged path traversal risk |
| 2026-02-24 | Resolved with relative-path boundary validation | Absolute paths remain allowed |

## Resources

- PR branch: feat/agent-native-cli
