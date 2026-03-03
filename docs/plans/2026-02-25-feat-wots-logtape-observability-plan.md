---
title: "feat: Add LogTape Structured Observability to wots CLI"
type: feat
status: active
date: 2026-02-25
origin: docs/logtape-cli-observability-spec.md
---

# feat: Add LogTape Structured Observability to wots CLI

## Overview

Add structured logging and observability to `@side-quest/word-on-the-street` using LogTape -- replacing ad-hoc `[debug]` stderr writes with a unified, hierarchical, context-aware logging system that serves three consumers simultaneously: humans (interactive terminal), developers (debugging failures), and AI agents (machine-readable diagnostics).

## Problem Statement

The wots CLI has **four distinct observability gaps** that compound into a poor debugging experience:

1. **Silent cache layer**: Cache hits, misses, stale fallbacks, and lock contention produce zero diagnostic output. When a user gets stale data, there's no way to know why without reading source code.

2. **Swallowed errors**: 10+ `catch` blocks in `cache.ts`, `render.ts`, and the Reddit task retry logic silently discard errors. Transient API failures, cache write failures, and render errors vanish without trace.

3. **Two disconnected debug systems**: The `--debug` flag in `cli.ts` writes `[debug]` to stderr at runtime. The `DEBUG` constant in `http.ts` reads `WOTS_DEBUG` at import time. The flag sets the env var after import, creating a race condition where `--debug` doesn't enable HTTP debug logging.

4. **No structured diagnostics for AI agents**: Beat Reporter sub-agents run `wots --json --quiet` and get a JSON envelope on stdout. When the envelope contains `"status": "error"`, the agent has no diagnostic context -- just an error message string. There's no structured trace of what went wrong.

**Impact**: Debugging a "why did my search return stale data?" question currently requires: adding `console.error()` calls to source, rebuilding, re-running, reading terminal output, then removing the debug code. With LogTape, it's `wots "topic" --debug` and reading structured output.

## Proposed Solution

Add `@logtape/logtape` (zero dependencies, 5.3 KB min+gz) as the second runtime dependency. Wire it into the CLI entry point with a synchronous configuration module that maps existing flags (`--debug`, `--quiet`) to LogTape log levels. **v1 ships Phase 1 only**: unified logging, race condition fix, ProgressDisplay mode refactor, minimal cache warnings with remediation context, and a robust shutdown path via try/finally. `--verbose` is deferred to Phase 2 (no distinct info-level content in Phase 1). Async context propagation (`withContext()`) and fingers-crossed auto-flush are designed but deferred to Phases 2 and 3 -- evaluate need after real usage.

## Technical Approach

### Architecture

```
Phase 1 (v1):
┌─────────────────────────────────────────────────────┐
│  cli.ts main()                                      │
│                                                     │
│  1. parseCliArgs()          (before LogTape)        │
│  2. setupLogging(flags)     (configures LogTape)    │
│  3. ... search orchestration ...                    │
│  4. shutdownLogging()       (before process.exit)   │
│                                                     │
│  Sink: consoleSink(stderr)  -- direct, no buffering │
└─────────────────────────────────────────────────────┘

Phase 2 adds: withContext() around Promise.all() branches
Phase 3 adds: fingersCrossed() wrapper on the sink for default mode
Phase 4 adds: fileSink, otelSink (as-needed)
```

**Category hierarchy**:
```
wots                          # Root -- catch-all
├── wots.cli                  # Arg parsing, flag resolution, entry/exit
├── wots.cache                # Cache hits, misses, stale fallbacks, locks
├── wots.http                 # HTTP retries, rate limits, response status
├── wots.search               # Search orchestration
│   ├── wots.search.reddit    # OpenAI Responses API calls
│   ├── wots.search.x         # xAI API calls
│   └── wots.search.youtube   # yt-dlp invocations
├── wots.enrich               # Reddit enrichment via JSON API (Phase 2)
└── wots.score                # Top-N scoring summary only (Phase 2)

Future categories (add when logging is needed):
  wots.render                 # Output formatting decisions
  wots.watchlist              # SQLite ops, briefing generation
```

Note: `wots.search.web` is intentionally excluded. Web search is performed by the Beat Reporter agent (via WebSearch/WebFetch), not by the wots CLI. The CLI only generates `web_search_instructions` in the JSON envelope.

### Implementation Phases

> **Scope decision (from Codex review):** Only Phase 1 ships as v1. Phase 2 and Phase 3
> are deferred -- they add value but are not required for the core observability win
> (unified logging, race condition fix, structured debug output). Evaluate need after
> Phase 1 ships and real usage surfaces gaps.

#### Phase 1: Foundation (v1 -- ships now)

**Goal**: Replace ad-hoc debug writes with LogTape. Add minimal cache warnings with remediation context. Zero user-visible behavior change in default mode; structured debug output when `--debug` is active. `--verbose` deferred to Phase 2.

**Tasks**:

- [ ] Add `@logtape/logtape` as runtime dependency in `package.json`
  - File: `/Users/nathanvale/code/side-quest-last-30-days/package.json`

- [ ] Create `src/lib/logging.ts` -- LogTape configuration module
  - `setupLogging(opts: LoggingOptions): void` (synchronous -- `configure()` is sync in Phase 1; no async sinks or context)
  - Flag-to-level mapping: none=warning, --debug=debug, --quiet=error
  - Formatter selection: ANSI color when interactive TTY, JSON Lines when --json or stderr not TTY
  - Do NOT create `AsyncLocalStorage` yet -- defer to Phase 2 when `withContext()` is wired up
  - Export a `shutdownLogging(): Promise<void>` function that calls `await dispose()` (single point of teardown)
  - `shutdownLogging()` must be idempotent -- safe to call before `setupLogging()`, after failed `setupLogging()`, or multiple times
  - Accept an optional `disposeFn` parameter for testing: `shutdownLogging(disposeFn?: () => Promise<void>)` -- defaults to LogTape's `dispose()`, but tests can inject a mock to verify timeout behavior

- [ ] Wire `setupLogging()` into `cli.ts` main() after `parseCliArgs()`, before any search logic
  - File: `/Users/nathanvale/code/side-quest-last-30-days/src/cli.ts` ~line 710 (after flag resolution)

- [ ] Replace all `[debug]` stderr writes in `cli.ts` with logger calls
  - Line 731-732: `[debug] strategy=... phase2Budget=...` -> `logger.debug("Strategy resolved: {strategy}, budget={budget}", ...)`
  - Line 804-808: `[debug] query-type=...` -> `logger.debug("Query type resolved: {queryType}", ...)`
  - Lines 1160-1167: `[debug] counts reddit raw=...` -> `logger.debug("Result counts: {reddit} reddit, {x} X, {youtube} YouTube", ...)`

- [ ] Replace `http.ts` DEBUG constant and log() helper with LogTape
  - Remove module-level `DEBUG` constant (lines 10-12) and `log()` function (lines 14-17)
  - Replace with `const logger = getLogger(["wots", "http"])`
  - Replace `log(msg)` calls with `logger.debug(msg)` -- the level check is now dynamic, fixing the race condition
  - File: `/Users/nathanvale/code/side-quest-last-30-days/src/lib/http.ts`

- [ ] Remove `process.env.WOTS_DEBUG = '1'` assignment in `cli.ts` (line 730)
  - No longer needed -- LogTape's level configuration handles this
  - Note: `tests/smoke-test-prompt.md` references `WOTS_DEBUG=1` -- update that doc to reference `--debug` instead
  - The `export const DEBUG` in `http.ts` is not imported anywhere -- safe to remove entirely

- [ ] **`--verbose` deferred to Phase 2** (DX review finding: no distinct Phase 1 info-level content exists yet; shipping `--verbose` now risks being "different noise mode" rather than useful signal. Phase 2 adds lifecycle events and search progress that justify `--verbose`.)

- [ ] Add `mode` property to `ProgressDisplay` to prevent stderr interleaving with LogTape
  - File: `/Users/nathanvale/code/side-quest-last-30-days/src/lib/ui.ts`
  - `"animated"` (default) -- spinners, current behavior
  - `"static"` (reserved for Phase 2 `--verbose`) -- phase names without animation, no spinner control chars
  - `"off"` (`--debug`, `--quiet`) -- suppressed entirely

  **Call-site inventory** (verified via grep -- only 1 construction site):
  - `cli.ts` line 853: `new ProgressDisplay(args.topic, true, outputArgs.quiet)`

  **Compatibility strategy** (addresses Architect review -- ProgressDisplay is public API via `src/index.ts`):

  Add a constructor overload that preserves the existing positional signature:
  ```typescript
  // Overload 1: legacy positional args (preserves public API)
  constructor(topic: string, showBanner?: boolean, quiet?: boolean);
  // Overload 2: new options object (internal use)
  constructor(opts: {
    topic: string;
    showBanner?: boolean;
    mode?: 'animated' | 'static' | 'off';
  });
  // Implementation
  constructor(
    topicOrOpts: string | { topic: string; showBanner?: boolean; mode?: 'animated' | 'static' | 'off' },
    showBanner?: boolean,
    quiet?: boolean,
  ) {
    if (typeof topicOrOpts === 'string') {
      // Legacy path: quiet maps to mode: 'off'
      this.topic = topicOrOpts;
      this.showBanner = showBanner ?? true;
      this.mode = quiet ? 'off' : 'animated';
    } else {
      this.topic = topicOrOpts.topic;
      this.showBanner = topicOrOpts.showBanner ?? true;
      this.mode = topicOrOpts.mode ?? 'animated';
    }
  }
  ```

  This means library consumers calling `new ProgressDisplay("topic", true, false)` continue to work unchanged. The internal call site in `cli.ts` switches to the options form:
  ```typescript
  const progressMode = args.debug || outputArgs.quiet ? 'off' : 'animated';
  const progress = new ProgressDisplay({
    topic: args.topic,
    mode: progressMode,
  });
  ```

- [ ] Add minimal cache warning logging with remediation context (pulled forward from Phase 2)
  - Add `const logger = getLogger(["wots", "cache"])` to `cache.ts`
  - Each warning must include: (1) what happened, (2) what the CLI did about it, (3) whether user action is needed. This prevents raw warnings from alarming users.
  - `warn` on cache write failure (`cache.ts` lines 231-237):
    `logger.warn("Cache write failed for {key}: {error}. Using fresh data. No action needed unless repeated.", { key, error: e.message })`
  - `warn` on corrupted cache read (`cache.ts` line 159):
    `logger.warn("Cache file corrupted for {key}. Ignored, fetching fresh data. Run with --no-cache to force.", { key })`
  - `warn` on stale lock detection (`cache.ts` line 305):
    `logger.warn("Stale lock detected for {key} (age: {age}ms). Overriding. Likely a crashed previous run.", { key, age })`
  - These are the highest-value cache diagnostics; remaining debug-level cache logging defers to Phase 2

- [ ] **Error emission ownership rule** (addresses Architect review on duplicate stderr writes):
  `writeError()` in `output.ts` is the sole owner of user-facing terminal errors. LogTape `error`-level messages are for diagnostic traces only (e.g., "all retries exhausted for reddit API" with structured context). The rule:
  - `writeError()` -- user-facing error messages (validation failures, fatal errors). Writes to stderr (and stdout in JSON mode for envelope errors).
  - `logger.error()` -- diagnostic context for the same failure (retry count, response codes, timing). Never duplicates the user-facing message.
  - In Phase 1, `logger.error()` is not used at all (no error-level diagnostic logging). All error-level logging defers to Phase 2's catch block migration.
  - This avoids double-write: `writeError("Search failed")` on stderr + `logger.error("Search failed")` on stderr.

- [ ] Wire shutdown into all termination paths (see Shutdown Design below)

**Shutdown design** (addresses Architect review -- prefer try/finally over scattered process.exit()):

Restructure `main()` to use try/finally so shutdown is guaranteed regardless of exit path:

```typescript
// cli.ts -- restructured termination
async function main(): Promise<number> {
  const args = parseCliArgs();
  setupLogging({ debug: args.debug, quiet: args.quiet, json: args.json });
  try {
    // ... search orchestration ...
    return 0;
  } catch (e) {
    writeError(/* ... */);
    return exitCodeFromError(e);
  } finally {
    await shutdownLogging();
  }
}

// Entry point
process.on('SIGINT', async () => {
  await shutdownLogging();
  process.exit(EXIT_INTERRUPTED);
});

main().then((code) => process.exit(code));
```

This replaces the current `.then()/.catch()` chain with a single try/finally that guarantees `shutdownLogging()` runs on normal exit, error exit, and (best-effort) SIGINT. SIGINT remains a separate handler because `finally` doesn't run on signal-induced exits.

**Why this is safe for Phase 1**: Without fingers-crossed (Phase 3), `dispose()` only flushes the synchronous console sink -- effectively a no-op. The shutdown path is established now so Phase 3 can add buffered sinks without changing termination logic.

**`shutdownLogging()` implementation** -- idempotent with timeout guard and DI hook for testing:
```typescript
let configured = false;

export function setupLogging(opts: LoggingOptions): void {
  configure({ /* ... */ });
  configured = true;
}

export async function shutdownLogging(
  disposeFn: () => Promise<void> = dispose,
): Promise<void> {
  if (!configured) return; // no-op if setup never ran or already shut down
  configured = false;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 500));
  await Promise.race([disposeFn(), timeout]);
}
```

The `disposeFn` parameter (defaults to LogTape's `dispose()`) enables tests to inject a mock that verifies timeout behavior, slow disposal, and error handling -- without monkeypatching global module state.

**Success criteria**:
- `wots "topic"` (default mode) produces identical stdout/stderr output as before (no regressions)
- `wots "topic" --debug` produces structured LogTape output instead of `[debug]` prefix lines. ProgressDisplay spinners are suppressed (intentional behavior change -- debug users want log data, not animation).
- No regressions in default mode; targeted test updates permitted for changed `[debug]` -> LogTape format
- `--debug` now enables HTTP debug logging (race condition fixed)
- `shutdownLogging()` is called on every exit path via try/finally (normal, error) and SIGINT handler
- `shutdownLogging()` is idempotent -- safe before setup, after failed setup, or when called twice
- Cache write failures, corrupted cache reads, and stale locks surface as warnings with remediation context
- `writeError()` remains sole owner of user-facing error messages; logger never emits duplicate error text
- Log invariant tests pass: no logs in stdout, no envelope fragments in stderr, --quiet stderr empty on success

**Estimated effort**: ~3 hours (increased from 2h to account for ProgressDisplay refactor and shutdown wiring)

**Concrete output fixtures** (addresses DX review -- each mode must have a golden example):

```
# Default mode (no flags) -- successful run, cache healthy
$ wots "Claude Code" --mock
stdout: [normal compact output, unchanged]
stderr: [ProgressDisplay spinners only, unchanged]

# Default mode -- cache corruption during run
$ wots "Claude Code" --mock
stdout: [normal compact output, unchanged]
stderr: ⠋ Researching Claude Code...
        [warn] Cache file corrupted for reddit:claude-code. Ignored, fetching fresh data.
        ⠙ Analyzing results...
        [compact output]

# --debug mode -- TTY
$ wots "Claude Code" --debug --mock
stdout: [normal compact output, unchanged]
stderr: [debug] Strategy resolved: balanced, budget=30
        [debug] Query type: recommendations
        [debug] HTTP GET https://api.reddit.com/... 200 (142ms)
        [debug] Cache miss: reddit:claude-code
        [debug] HTTP GET https://api.x.ai/... 200 (89ms)
        [debug] Cache hit: x:claude-code (age: 12m)
        [debug] Result counts: 15 reddit, 10 X, 5 YouTube

# --debug mode -- non-TTY (piped)
$ wots "Claude Code" --debug --mock 2>debug.log
stderr (JSON Lines):
  {"ts":"...","level":"debug","cat":"wots.cli","msg":"Strategy resolved: balanced, budget=30"}
  {"ts":"...","level":"debug","cat":"wots.http","msg":"GET https://api.reddit.com/... 200 (142ms)"}

# --quiet mode
$ wots "Claude Code" --quiet --mock
stdout: [normal compact output, unchanged]
stderr: [empty unless error-level event occurs]

# --json mode
$ wots "Claude Code" --json --mock
stdout: {"status":"success","data":{...}}
stderr: [empty in default mode; JSON Lines if --debug also active]
```

Note: These are approval fixtures, not snapshot tests. Implementation tests should use semantic assertions (regex for key fragments, JSON parse + field checks) rather than full-line matching to avoid formatter drift.

**Test isolation strategy** (addresses Test Engineer review):

1. **Non-TTY format risk** (tests use `Bun.spawnSync()` which is non-TTY):
   - LogTape auto-detects non-TTY and switches to JSON Lines formatter on stderr
   - Tests that assert stderr content must account for this. Strategy: in `setupLogging()`, respect a `WOTS_LOG_FORMAT=text` env var override that forces human-readable format regardless of TTY detection. Set this in test harness.
   - This makes tests deterministic across TTY/non-TTY without disabling logging

2. **Cache warning leakage in `--mock` tests**:
   - `--mock` mode uses fixture data, not real cache. Cache warnings should never fire in mock mode.
   - Add a guard: `if (opts.mock) return;` at the top of cache read/write functions, skipping cache entirely. This is the existing behavior -- verify it with an assertion.
   - For tests that DO use real cache (non-mock integration tests), set `WOTS_CACHE_DIR` to a temp directory per test process. Add this env var to the cache module.

3. **Explicit stdout/stderr invariant test**:
   - Add a new test file: `tests/log-invariants.test.ts`
   - Tests:
     - `stdout contains only program output (no log messages)` -- for default, --debug, --quiet modes
     - `stderr contains no JSON envelope fragments` -- for all modes
     - `--quiet stderr is empty on success` -- no warnings, no progress, no logs
   - These tests use `Bun.spawnSync()` with `--mock` and parse stdout/stderr separately

4. **setupLogging() failure and idempotent shutdownLogging()**:
   - Test: call `shutdownLogging()` before `setupLogging()` -- should no-op
   - Test: call `setupLogging()` with invalid config, then `shutdownLogging()` -- should no-op (not throw)
   - Test: call `shutdownLogging()` twice -- second call is no-op
   - Test: inject a slow `disposeFn` (>500ms) -- verify `shutdownLogging()` returns within 600ms (timeout fires)
   - All via the `disposeFn` DI parameter, no monkeypatching needed

---

#### Phase 2: Async Context, --verbose Flag, and Silent Module Logging (deferred -- evaluate after Phase 1)

**Goal**: Add implicit context propagation to parallel search orchestration. Add `--verbose` flag with lifecycle events. Log remaining cache operations and silenced errors.

**Trigger**: Ship Phase 1, use it for a week, then evaluate whether async context, lifecycle logging, and per-source log tagging are needed for real debugging sessions.

**Tasks**:

- [ ] Add `--verbose` flag to `parse-args.ts` (deferred from Phase 1 -- no distinct info-level content until lifecycle logging exists)
  - Maps to LogTape `info` level -- shows search started/completed per source, enrichment progress
  - ProgressDisplay mode: `static` (phase names without animation)
  - File: `/Users/nathanvale/code/side-quest-last-30-days/src/lib/parse-args.ts`

- [ ] Add `AsyncLocalStorage` to `setupLogging()` (deferred from Phase 1)
  - `contextLocalStorage: new AsyncLocalStorage()` passed to LogTape's `configure()`

- [ ] Wrap each `Promise.all()` branch in `cli.ts` with `withContext()`
  - File: `/Users/nathanvale/code/side-quest-last-30-days/src/cli.ts` ~lines 922-1000
  - Context properties: `{ source: "reddit"|"x"|"youtube", topic }`
  - Every log message inside the branch automatically carries these properties

- [ ] Add remaining structured logging to `cache.ts` (beyond Phase 1 warnings)
  - File: `/Users/nathanvale/code/side-quest-last-30-days/src/lib/cache.ts`
  - `debug` on cache hit (key, age, version)
  - `debug` on cache miss (key)
  - `debug` on cache expired (key, age, ttl)
  - `warn` on stale cache fallback (key, staleAge, reason)
  - `warn` on lock contention (key, waitTime)

- [ ] Add structured logging to remaining silent catch blocks:

  | Location | Current Behavior | New Log Level | Rationale |
  |----------|-----------------|---------------|-----------|
  | `cache.ts` line 172 (mtime read) | Silent swallow | `debug` | Benign -- file might not exist yet |
  | `cache.ts` line 272 (lock release) | Silent swallow | `debug` | Benign -- lock file already gone |
  | `cli.ts` ~line 329 (reddit retry) | Retry + fallback | `info` | Informational -- retry succeeded |
  | `cli.ts` ~line 364 (reddit exhausted) | Error captured | `error` | All retries failed |
  | `render.ts` (file write) | Silent swallow | `warn` | Output file failed but report still renders |

- [ ] Add search lifecycle logging
  - `info` on search started (per source, with topic)
  - `info` on search completed (per source, item count, fromCache, duration)
  - `warn` on rate limit (source, usedStaleCache, cacheAge)
  - `error` on search failed (source, error message)

- [ ] Add enrichment logging (`wots.enrich` category)
  - `info` on enrichment started (item count)
  - `debug` on per-item enrichment (url, cache hit/miss)
  - `warn` on enrichment failure (url, error)

- [ ] Add scoring summary logging (`wots.score` category)
  - `debug` on scoring complete (top score, median, item count) -- NOT per-item

- [ ] Add top-level run context
  - `withContext({ topic, depth, sources, runId: crypto.randomUUID().slice(0, 8) }, ...)`
  - Wraps the entire search orchestration so every log carries the run ID

**Success criteria**:
- `wots "topic" --debug` produces a complete structured trace of the search pipeline
- Each parallel search branch is identifiable by `source` context property
- Cache hit/miss/stale events are visible at debug level
- Previously-silent errors surface at appropriate levels
- AI agents can parse JSON Lines stderr to identify which source failed and why

**Estimated effort**: ~3 hours

---

#### Phase 3: Fingers Crossed Sink (deferred -- evaluate after Phase 2)

**Goal**: Auto-flush debug traces on error without requiring `--debug`. Users who run `wots "topic"` normally see no debug output -- but when something fails, they get the full diagnostic trace.

**Trigger**: Phase 2 is complete and there are concrete failure cases where users needed `--debug` retroactively. Without evidence of this pain point, simple level-based logging from Phase 1 is sufficient.

**Tasks**:

- [ ] Modify `setupLogging()` to use `fingersCrossed()` wrapper
  - **When active**: Default mode (no flags) only
  - **When inactive**: `--verbose` (user wants immediate info output), `--debug` (already showing everything), `--quiet` (user wants silence)
  - Logger level is `debug` when fingers-crossed is active (the sink handles suppression)
  - When `--verbose` is active, logger level is `info` with direct console sink (no buffering)

  ```typescript
  // Pseudocode for the three-mode setup
  const useFingersCrossed = !opts.debug && !opts.verbose && !opts.quiet;
  const loggerLevel = useFingersCrossed ? "debug" : flagBasedLevel;
  const sink = useFingersCrossed
    ? fingersCrossed(consoleSink, { triggerLevel: "error", maxBufferSize: 200 })
    : consoleSink;
  ```

  **Design rationale**: `--verbose` users opted into seeing info-level output immediately. Buffering it behind fingers-crossed would suppress the output they asked for. Fingers-crossed is for the zero-flag default case where users want silence on success and diagnostics on failure.

- [ ] `shutdownLogging()` already handles `dispose()` with timeout (from Phase 1) -- no changes needed. The fingers-crossed buffer is flushed by the existing shutdown path.

- [ ] Test the auto-flush behavior
  - Run with `--mock` + a scenario that triggers an error
  - Verify debug-level logs appear on stderr only when an error occurs
  - Verify success runs produce zero debug output

**Success criteria**:
- `wots "topic"` on success: zero debug output on stderr (only progress + final output)
- `wots "topic"` on error: full debug trace auto-flushed to stderr before exit
- `wots "topic" --quiet` on error: only the error message, no debug trace
- `wots "topic" --debug`: all debug output immediately (bypass fingers-crossed)

---

#### Phase 4: Ecosystem (Optional, As-Needed)

**Goal**: Add production-grade observability integrations when the use case arises.

| Need | Package | Effort | Trigger |
|------|---------|--------|---------|
| Rotating log files | `@logtape/file` | ~30 min | `wots briefing` running on cron needs persistent logs |
| OpenTelemetry export | `logtape-otel` | ~1 hour | Production observability pipeline (Axiom, Honeycomb) |
| Sentry error tracking | `@logtape/sentry` | ~1 hour | Need error aggregation across users |
| Config-from-file | `@logtape/config` | ~30 min | Power users want per-category debug without `--debug` flooding |
| PII redaction | `@logtape/redaction` | ~30 min | Logs might contain usernames or API keys |

**Not planned for v1**: These are documented here for future reference, not as part of this feature.

## Alternative Approaches Considered

### 1. Pino

**Pros**: Smallest bundle (3.1 KB), industry standard for Node.js, massive ecosystem.
**Cons**: Limited Bun support (unofficial), no no-op default (breaks library export pattern), JSON-only by default (requires `pino-pretty` dev dep for human output), no built-in async context (requires manual `child()` threading).
**Why rejected**: The library-first no-op default is critical for wots's dual CLI/library export. Pino also lacks `fingersCrossed` and `withContext()`.

### 2. Winston

**Pros**: Most popular (12M+ weekly npm downloads), rich transport ecosystem, built-in formatters.
**Cons**: 38.3 KB bundle with 17 dependencies, limited Bun support, no no-op default, no async context propagation.
**Why rejected**: 17 dependencies is unacceptable for a CLI with one runtime dep. Bundle size is 7x LogTape.

### 3. Console.error() with structured JSON

**Pros**: Zero dependencies, zero learning curve, works everywhere.
**Cons**: No level filtering, no async context, no formatter switching, no hierarchical categories, no fingers-crossed pattern, no library-first design.
**Why rejected**: Doesn't solve the core problems (per-module verbosity, async context, auto-flush on error). Just a marginally better version of what we already have.

### 4. Keep existing ad-hoc [debug] pattern

**Pros**: No new dependency, no migration effort.
**Cons**: Doesn't solve the http.ts race condition, cache silence, swallowed errors, or AI agent diagnostic needs. Maintains two disconnected debug systems.
**Why rejected**: The status quo has real user-facing pain points.

## System-Wide Impact

### Interaction Graph

- `cli.ts main()` calls `setupLogging()` which calls `configure()` -- this is a **global singleton** that affects all `getLogger()` calls in the process
- In Phase 1, the sink is a direct console sink writing to stderr -- no buffering, no AsyncLocalStorage
- Every `getLogger()` call in library code (`cache.ts`, `http.ts`, etc.) resolves to the configured sinks
- `shutdownLogging()` is called on all exit paths (normal, error, SIGINT) via a single teardown function with 500ms timeout guard
- Phase 2 adds `AsyncLocalStorage` for context propagation; Phase 3 adds fingers-crossed buffering

### Error & Failure Propagation

- **LogTape config failure**: If `configure()` throws (e.g., duplicate categories), the error propagates to `main()` and the CLI exits with `EXIT_RUNTIME`. Since `setupLogging()` is synchronous, this is a simple try/catch in main(). `shutdownLogging()` is safe to call after a failed setup (idempotent no-op when `configured === false`).
- **Sink write failure**: LogTape logs sink errors to the meta logger (`["logtape", "meta"]`). A failing stderr write doesn't crash the CLI -- the log is silently dropped.
- **`dispose()` failure**: If `dispose()` throws during shutdown, the try/finally in main() still completes. Buffered logs are lost but program output is unaffected.
- **Double shutdown**: `shutdownLogging()` guards with a `configured` flag. Second call is a no-op.

### State Lifecycle Risks

- **AsyncLocalStorage leak**: `withContext()` scopes context to the callback's lifetime. If a `Promise.all()` branch leaks a promise that resolves after the scope closes, its logs lose context properties. This is non-critical -- logs still emit, just without the implicit context.
- **Fingers-crossed buffer overflow**: Capped at `maxBufferSize: 200`. If a run generates 200+ debug messages before an error, the oldest are dropped. For wots's typical 20-50 log messages per run, this is well within bounds.

### API Surface Parity

- **CLI interface**: Existing `--debug` and `--quiet` flags change internal mechanism but preserve external behavior. `--verbose` deferred to Phase 2.
- **Library export (`src/index.ts`)**: Zero change. Library consumers see no difference because LogTape is a no-op until configured.
- **JSON envelope schema**: No change. LogTape writes to stderr, not stdout.
- **Exit codes**: No change.
- **Beat Reporter agent contract**: `--quiet` suppresses ProgressDisplay AND sets LogTape to `error` level. The agent's `--json --quiet` invocation pattern is preserved. **Critically, `error`-level messages still emit to stderr** -- if a search fails, the agent gets the error diagnostic even in quiet mode. Only `debug`, `info`, and `warn` are suppressed.

### Integration Test Scenarios

1. **Stderr suppression under --quiet**: Verify `stderr.not.toContain('researching')` still passes -- LogTape at `error` level produces no info/debug/warning output.
2. **Error message format in stderr**: Verify `stderr.toContain('Invalid --emit')` still passes -- these are pre-LogTape validation errors that bypass `setupLogging()`.
3. **JSON envelope on stdout unchanged**: Verify `--json` output structure is identical -- LogTape never touches stdout.
4. **Non-TTY auto-detection**: Verify `Bun.spawnSync()` (non-TTY) still auto-switches to JSON mode -- LogTape formatter adapts but doesn't interfere with stdout auto-detection.
5. **--mock mode**: Verify `--mock` still works with LogTape configured -- mock data path is independent of logging.

## Acceptance Criteria

> **Note:** Criteria are split by phase. Phase 1 criteria must pass before shipping v1.
> Phase 2/3 criteria are documented for when those phases are implemented.

### Phase 1 (v1) Functional Requirements

- [ ] `@logtape/logtape` added as runtime dependency (second dep after `@side-quest/core`)
- [ ] `src/lib/logging.ts` created with synchronous `setupLogging()` and async idempotent `shutdownLogging()`
- [ ] All `[debug]` and `[DEBUG]` stderr writes replaced with `getLogger()` calls
- [ ] `http.ts` module-level `DEBUG` race condition eliminated
- [ ] Interactive TTY uses ANSI color formatter on stderr
- [ ] `--json` mode and piped stderr uses JSON Lines formatter
- [ ] `WOTS_LOG_FORMAT=text` env var override for test determinism in non-TTY
- [ ] `--quiet` suppresses both ProgressDisplay and LogTape output (error level still emits)
- [ ] Cache warnings include remediation context (what happened, what CLI did, whether user action needed)
- [ ] `shutdownLogging()` called via try/finally in main() and SIGINT handler
- [ ] `writeError()` is sole owner of user-facing errors; no `logger.error()` in Phase 1
- [ ] ProgressDisplay constructor preserves backward-compatible positional overload

### Phase 1 (v1) Non-Functional Requirements

- [ ] Zero change to stdout output in any mode (compact, JSON, JSONL, markdown, context, path)
- [ ] Zero change to exit codes
- [ ] Zero change to JSON envelope schema
- [ ] **Default mode parity**: All existing tests pass without modification when no new flags are active (verified via `WOTS_LOG_FORMAT=text` for non-TTY determinism)
- [ ] **New flag tests**: Targeted test updates permitted for changed `[debug]` -> LogTape format
- [ ] **Log invariant tests**: Dedicated `tests/log-invariants.test.ts` proving no logs leak to stdout, --quiet stderr is clean, no envelope fragments in stderr
- [ ] Bundle size increase < 6 KB (LogTape is 5.3 KB min+gz)
- [ ] No measurable latency increase on typical CLI runs (< 1ms total logging overhead)
- [ ] Library export (`src/index.ts`) produces zero logging output when unconfigured

### Phase 1 (v1) Quality Gates

- [ ] `bun run validate` passes (lint + typecheck + build + test)
- [ ] Integration tests covering --debug and --quiet modes with LogTape
- [ ] No `[debug]` or `[DEBUG]` string literals remain in src/ or tests/ (clean migration -- audit both)
- [ ] No `process.env.WOTS_DEBUG` writes remain in src/
- [ ] `shutdownLogging()` unit tests pass: idempotent, pre-setup no-op, timeout guard, double-call safe
- [ ] Log invariant tests pass in `tests/log-invariants.test.ts`
- [ ] `--mock` tests produce no cache warnings (verified by clean stderr assertion)

### Phase 2 (deferred) Acceptance Criteria

- [ ] `withContext()` wraps each `Promise.all()` search branch
- [ ] Cache operations logged at appropriate levels (hit=debug, miss=debug, stale=warn, error=warn)
- [ ] All silent catch blocks logged per the error level matrix
- [ ] AI agents can parse JSON Lines stderr to identify which source failed and why

### Phase 3 (deferred) Acceptance Criteria

- [ ] Fingers-crossed sink auto-flushes debug buffer on error
- [ ] Integration test for fingers-crossed auto-flush on error

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| Debug systems | 2 (disconnected, race condition) | 1 (unified LogTape) |
| Cache observability | 0 log messages | debug/warn per operation |
| Silenced errors | 10+ catch blocks | 0 -- all logged at appropriate level |
| AI agent diagnostics | Error message string only | Full structured JSON Lines trace |
| User effort to debug | Re-run with source code changes | `--debug` flag |
| Dependencies added | 0 | 1 (zero-dep, 5.3 KB) |

## Dependencies & Prerequisites

- `@logtape/logtape` ^2.0.0 (bounded range -- lockfile pins exact version; caret allows patch/minor updates)
- Bun >= 1.2.0 (already required by wots)
- No other prerequisites -- LogTape has zero dependencies

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| ProgressDisplay + LogTape interleaving on stderr | High (when --debug/--verbose active) | Medium (garbled terminal output) | Suppress ProgressDisplay spinners when `--verbose` or `--debug` is active. Replace with static "Phase: searching reddit..." lines. |
| Existing tests break due to new stderr output | Medium | Low (quick fix) | LogTape at `warning` level by default produces nothing new. Tests use `--mock` which doesn't trigger warnings. Validate all tests before merging. |
| Fingers-crossed sink + --quiet conflict | Medium (design ambiguity) | Low | `--quiet` disables fingers-crossed. If user wants quiet+auto-flush, they use default mode (no flags). Document in --help. |
| `configure()` called twice (library consumer + cli.ts) | Low | Medium (ConfigError) | Document in README: "If importing wots as a library, configure LogTape before calling wots functions, OR let wots configure it via CLI." The library export never calls `configure()`. |
| Pre-configuration errors miss LogTape | Low | Low | Arg parsing errors use existing error handling (pre-LogTape). This is acceptable -- these errors are user-facing validation messages, not diagnostic traces. |
| Non-blocking mode data loss | N/A | N/A | Explicitly DO NOT use non-blocking mode. CLIs are short-lived -- blocking mode is correct. |

### ProgressDisplay Interaction Strategy

This is the highest-risk UX concern. Addressed in Phase 1 (the `ProgressDisplay` mode task).

| Flag | ProgressDisplay Mode | LogTape Level | Phase 1 Behavior | Later Phases |
|------|---------------------|---------------|------------------|--------------|
| (none) | `animated` | `warning` | Spinners active, warnings with remediation context, no interleaving | Phase 3: fingers-crossed buffers `debug`; auto-flushes on error |
| `--verbose` | `static` | `info` | **(Phase 2)** Static phase names, info logs between phases | Phase 2 adds lifecycle events; Phase 3: no fingers-crossed |
| `--debug` | `off` | `debug` | LogTape debug output IS the progress indicator | Phase 3: bypass fingers-crossed |
| `--quiet` | `off` | `error` | Both suppressed, only `error`-level messages appear | Phase 3: no fingers-crossed |

**Flag precedence** (encoded in `resolveOutputMode()` helper):
- `--debug` wins over `--quiet` (debug intent overrides silence)
- `--quiet` wins over `--verbose` (silence intent overrides chattiness)
- `--debug --verbose` => debug (debug is superset of verbose)
- `--json` does not affect log level, only formatter selection

### Backwards Compatibility Contract

**Explicitly retired**: The `[debug]` and `[DEBUG]` prefix format. No consumers are known to parse this format. The Beat Reporter agent uses `--quiet` and never sees debug output.

**Preserved**:
- `--quiet` suppresses ProgressDisplay (tested in `field-projection.test.ts` line 251)
- Validation error messages on stderr (tested in 15+ assertions in `index.test.ts`)
- `--json` auto-detection when stdout is piped
- All exit codes and JSON envelope schema

## Resource Requirements

- **Developer**: 1 person (Nathan)
- **Estimated v1 effort**: ~3 hours (Phase 1 only)
- **Estimated total effort**: ~7.5 hours if all three phases ship (evaluate after each)
- **External dependencies**: None (LogTape is published, stable at v2.0.0+)
- **CI changes**: None (existing `bun run validate` covers everything)

## Future Considerations

- **Phase 4 ecosystem packages**: File sinks for `wots briefing` cron, OTel for production pipelines, Sentry for error aggregation. These are documented but not planned.
- **`@logtape/config` for power users**: Enable `--log-config=path` for per-category debug without `--debug` flooding everything. Add when users request it.
- **Telemetry contract integration**: The existing `telemetry-contract.ts` defines structured event types. LogTape could serve as the transport layer for telemetry events in a future version, unifying observability and telemetry under one system.
- **`@logtape/adaptor-pino`**: If a library consumer already uses Pino, the adaptor lets LogTape-instrumented wots code forward into their Pino pipeline. Document in README.

## Documentation Plan

- [ ] Add `wots help logging` topic (new) covering: flag mapping, JSON Lines format for agents, category hierarchy, library consumer configuration
- [ ] Add "Observability" section to README with examples for human/agent/library consumers
- [ ] Update README "Flags" section with `--verbose` (Phase 2, when flag ships)
- [ ] Reference spec: `docs/logtape-cli-observability-spec.md` (already written, 17 sections, 700+ lines)

## Sources & References

### Origin

- **Technical spec**: [docs/logtape-cli-observability-spec.md](/Users/nathanvale/code/side-quest-plugins/docs/logtape-cli-observability-spec.md) -- comprehensive LogTape evaluation covering architecture, implementation patterns, gotchas, performance, and comparison matrix. Written from research across official docs, community articles, and X posts.

### Internal References

- CLI entry point: `/Users/nathanvale/code/side-quest-last-30-days/src/cli.ts` (1313 lines)
- Cache layer: `/Users/nathanvale/code/side-quest-last-30-days/src/lib/cache.ts` (363 lines)
- HTTP utilities: `/Users/nathanvale/code/side-quest-last-30-days/src/lib/http.ts` (DEBUG race condition at lines 10-17)
- Progress display: `/Users/nathanvale/code/side-quest-last-30-days/src/lib/ui.ts` (304 lines)
- Output modes: `/Users/nathanvale/code/side-quest-last-30-days/src/lib/output.ts` (224 lines)
- Arg parser: `/Users/nathanvale/code/side-quest-last-30-days/src/lib/parse-args.ts`
- Telemetry contract: `/Users/nathanvale/code/side-quest-last-30-days/src/lib/telemetry-contract.ts`
- Integration tests (stderr assertions): `/Users/nathanvale/code/side-quest-last-30-days/tests/index.test.ts` (15+ stderr assertions)
- Integration tests (progress suppression): `/Users/nathanvale/code/side-quest-last-30-days/tests/field-projection.test.ts:251`

### External References

- [LogTape documentation](https://logtape.org/) -- official docs
- [LogTape GitHub](https://github.com/dahlia/logtape) -- source, issues, discussions
- [Logging in Node.js/Deno/Bun 2026](https://hackers.pub/@hongminhee/2026/logging-nodejs-deno-bun-2026) -- author's guide
- [Trace-Connected Structured Logging with LogTape and Sentry](https://blog.sentry.io/trace-connected-structured-logging-with-logtape-and-sentry/) -- Sentry integration
- [LogTape comparison table](https://logtape.org/comparison) -- benchmarks vs alternatives

### Related Work

- Newsroom Beat Reporter agent: `/Users/nathanvale/code/side-quest-plugins/plugins/newsroom/agents/beat-reporter.md` -- primary consumer of wots --json --quiet
