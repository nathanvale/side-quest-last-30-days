# LogTape Observability for CLI Tools

## A Staff Engineer's Technical Specification

**Status**: Draft
**Author**: Nathan Vale
**Date**: 2026-02-25
**Scope**: Structured logging, AI-agent observability, and production debugging for Bun CLI tools -- with `@side-quest/word-on-the-street` (wots) as the reference implementation.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Why Logging in CLI Tools is Different](#2-why-logging-in-cli-tools-is-different)
3. [Why LogTape](#3-why-logtape)
4. [Core Concepts](#4-core-concepts)
5. [Architecture for CLI Tools](#5-architecture-for-cli-tools)
6. [Implementation Guide](#6-implementation-guide)
7. [AI Agent Observability](#7-ai-agent-observability)
8. [Testing](#8-testing)
9. [The Library/CLI Boundary](#9-the-librarycli-boundary)
10. [Gotchas and Pitfalls](#10-gotchas-and-pitfalls)
11. [When NOT to Use LogTape](#11-when-not-to-use-logtape)
12. [Migration Guide](#12-migration-guide)
13. [Performance](#13-performance)
14. [Comparison Matrix](#14-comparison-matrix)
15. [Decision Framework](#15-decision-framework)
16. [Resources](#16-resources)
17. [Glossary](#17-glossary)

---

## 1. Executive Summary

LogTape is a zero-dependency, runtime-agnostic structured logging library designed with a "library-first" philosophy. Its defining property: **if nobody calls `configure()`, all logging is a silent no-op.** This makes it uniquely suited to CLI tools that serve three audiences simultaneously:

1. **Humans** running the CLI interactively (want clean output, no noise)
2. **Developers** debugging failures (want structured context, async traces)
3. **AI agents** calling the CLI as a subprocess (want machine-readable diagnostics)

This spec documents everything a staff engineer needs to evaluate, adopt, and operate LogTape in a Bun CLI tool -- covering architecture, implementation patterns, gotchas, performance, and the specific concerns of AI-agent observability.

---

## 2. Why Logging in CLI Tools is Different

### 2.1 The Fundamental Tension

Backend servers have one output consumer: a log aggregator. CLIs have three:

| Consumer | Wants | Channel |
|----------|-------|---------|
| End user | Clean program output, no noise | `stdout` |
| Developer | Structured debug context | `stderr` |
| AI agent | Machine-parseable diagnostics | `stderr` (JSON Lines) |

**Rule #1**: Program output goes to `stdout`. Logs go to `stderr`. Always. This lets `wots "topic" | jq .` work while debug logs appear alongside.

### 2.2 CLIs vs Backends -- Key Differences

| Concern | Backend Server | CLI Tool |
|---------|---------------|----------|
| Default output | JSON Lines to aggregator | Human-readable to stderr |
| stdout | N/A (or health checks) | Sacred -- reserved for program output |
| Lifetime | Long-running process | Seconds to minutes |
| Verbosity control | Per-service config file | `--verbose` / `--debug` flags |
| Config source | Environment vars, config service | CLI args or `--log-config=path` |
| Default formatter | Always JSON Lines | Human-readable; JSON when piped |
| Log volume | High (requests/sec) | Low (one run = one execution) |
| Buffering tradeoff | Throughput > durability ok | Durability > throughput (short-lived) |
| Consumer | Machines (Datadog, Grafana) | Humans (terminal) + AI agents |
| Shutdown | Graceful drain period | Process exits immediately |

### 2.3 The Three Output Tiers

A well-designed CLI has distinct output tiers. LogTape replaces tier 2, not tier 1 or tier 3:

```
Tier 1: Program output (stdout)
  - The actual result: JSON envelopes, compact tables, markdown
  - NEVER touched by logging

Tier 2: Diagnostic output (stderr)         <-- LogTape lives here
  - Progress indicators, debug messages, warnings
  - Controlled by --verbose / --debug / --quiet

Tier 3: Side-channel output (files, telemetry)
  - Rotating log files, OpenTelemetry spans
  - For post-mortem analysis
```

---

## 3. Why LogTape

### 3.1 The Selection Criteria

For a Bun CLI tool, the logging library must satisfy:

1. **Zero-dependency** -- CLI tools are distributed via `bunx`; every dependency is download time
2. **No-op by default** -- library consumers who don't configure logging must see zero output
3. **First-class Bun support** -- not "works on Bun" but "tested and benchmarked on Bun"
4. **Structured + human-readable** -- same log call, different formatters per context
5. **Async context propagation** -- `Promise.all()` orchestration needs implicit context
6. **Small bundle** -- CLI cold start matters

### 3.2 How LogTape Meets Each Criterion

| Criterion | LogTape | Pino | Winston |
|-----------|---------|------|---------|
| Dependencies | 0 | 1 | 17 |
| Bundle (min+gz) | 5.3 KB | 3.1 KB | 38.3 KB |
| No-op default | Yes (core design) | No (requires config) | No |
| Bun support | Full (official) | Limited (unofficial) | Limited |
| Structured logging | Yes | Yes | Yes |
| Async context | `withContext()` + `AsyncLocalStorage` | Via `pino.child()` (manual) | Via `child()` (manual) |
| Tree-shakable | Yes | No | No |
| Human formatter | Built-in (ANSI, text) | Requires `pino-pretty` (dev dep) | Built-in |
| JSON formatter | Built-in (`jsonLinesFormatter`) | Default (JSON only) | Built-in |

### 3.3 The "Library-First" Design

This is LogTape's philosophical differentiator. From the author (Hong Minhee):

> LogTape was created because I needed logging in Fedify (an ActivityPub library) without forcing end-users to configure anything. If a Fedify user never calls `configure()`, they see zero output, zero warnings, zero overhead.

For CLI tools that are also importable as libraries (like wots with its `src/index.ts` barrel export), this is critical. The library export has `getLogger()` calls throughout, but consumers who `import { searchReddit } from "@side-quest/word-on-the-street"` never see log output unless they opt in.

---

## 4. Core Concepts

### 4.1 Categories (Hierarchical Namespacing)

Categories are string arrays forming a tree. Log messages propagate upward to parent loggers:

```typescript
import { getLogger } from "@logtape/logtape";

// These form a hierarchy:
const root   = getLogger(["wots"]);
const cache  = getLogger(["wots", "cache"]);
const reddit = getLogger(["wots", "search", "reddit"]);

// A log from ["wots", "search", "reddit"] reaches:
//   - ["wots", "search", "reddit"]  (exact match)
//   - ["wots", "search"]            (parent)
//   - ["wots"]                      (grandparent)
```

**Why this matters for CLIs**: You can set `["wots"]` to `"warning"` for normal use, but dial `["wots", "search", "reddit"]` to `"debug"` when investigating a specific search failure -- without touching other categories.

### 4.2 Sinks (Where Logs Go)

A sink is a function `(record: LogRecord) => void`. LogTape provides built-in sinks and you can write custom ones:

| Sink | Use Case | Package |
|------|----------|---------|
| Console | Development, interactive CLI | `@logtape/logtape` (built-in) |
| Stream | Write to `process.stderr` as a `WritableStream` | `@logtape/logtape` (built-in) |
| File | Persistent log files | `@logtape/file` |
| Rotating File | Size/time-based rotation | `@logtape/file` |
| OpenTelemetry | Production observability | `logtape-otel` |
| Sentry | Error tracking + traces | `@logtape/sentry` |
| CloudWatch | AWS logging | `@logtape/cloudwatch-logs` |
| Custom | Anything | Inline function |

**CLI-specific pattern**: Use Console sink to stderr for interactive mode, Stream sink with JSON Lines formatter when stdout is piped:

```typescript
import {
  configure,
  getConsoleSink,
  getStreamSink,
} from "@logtape/logtape";
import stream from "node:stream";

const isPiped = !process.stderr.isTTY;

await configure({
  sinks: {
    stderr: isPiped
      ? getStreamSink(stream.Writable.toWeb(process.stderr), {
          formatter: jsonLinesFormatter,
        })
      : getConsoleSink(),
  },
  loggers: [
    { category: ["wots"], sinks: ["stderr"], lowestLevel: "warning" },
  ],
});
```

### 4.3 Formatters (How Logs Look)

Three built-in formatters, each serving a different consumer:

**Default Text Formatter** -- human-readable:
```
2026-02-25 10:34:10.465 +11:00 [INF] wots·search·reddit: Search started
```

**ANSI Color Formatter** -- colorized terminal output:
```
2026-02-25 10:34:10.465 +11 INF wots·search·reddit: Search started
```
(With color codes for level, category, and timestamps)

**JSON Lines Formatter** -- machine-readable:
```json
{"@timestamp":"2026-02-25T10:34:10.465Z","level":"INFO","category":"wots.search.reddit","message":"Search started","topic":"Claude Code","source":"reddit"}
```

**Pretty Formatter** (via `@logtape/pretty`) -- development output with emojis and alignment:
```
 INFO wots > search > reddit  Search started  topic=Claude Code
```

### 4.4 Contexts (The Killer Feature for CLIs)

Contexts attach key-value properties to log messages without threading them through function signatures.

**Explicit context** -- set on a logger instance:

```typescript
const logger = getLogger(["wots", "search"]);
const ctx = logger.with({ topic: "Claude Code", depth: "deep" });
ctx.info("Search started");
// Output: ... Search started  topic=Claude Code  depth=deep
```

**Implicit context** -- propagates across async boundaries:

```typescript
import { withContext } from "@logtape/logtape";

// Set once at the top of the call stack
withContext({ topic: "Claude Code", runId: "abc123" }, async () => {
  // Every log message in this async tree gets topic + runId
  await searchReddit();   // logs here carry the context
  await searchX();        // logs here carry the context too
  await searchYouTube();  // and here
});
```

**Lazy context** -- evaluated at log time, not at creation:

```typescript
import { lazy } from "@logtape/logtape";

const logger = getLogger(["wots"]).with({
  elapsed: lazy(() => `${Date.now() - startTime}ms`),
});
```

**Priority order** (highest to lowest):
1. Log message properties (inline)
2. Explicit context (`.with()`)
3. Implicit context (`withContext()`)

### 4.5 Levels

Six severity levels, highest to lowest:

| Level | Method | CLI Use Case |
|-------|--------|-------------|
| `fatal` | `logger.fatal()` | Unrecoverable errors (process will exit) |
| `error` | `logger.error()` | Operation failed but process continues |
| `warning` | `logger.warn()` | Degraded operation (stale cache, rate limit) |
| `info` | `logger.info()` | Key lifecycle events (search started/completed) |
| `debug` | `logger.debug()` | Detailed internal state (cache hits, API payloads) |
| `trace` | `logger.trace()` | Extremely verbose (scoring loop iterations) |

**CLI mapping**:
- No flags: `lowestLevel: "warning"` (only problems surface)
- `--verbose`: `lowestLevel: "info"` (lifecycle events)
- `--debug`: `lowestLevel: "debug"` (full diagnostic detail)

### 4.6 Log Message Syntax

Two styles, both producing structured output:

**Template literals** (concise, great for simple messages):
```typescript
logger.info`Search completed: ${count} items from ${source}`;
```

**Function calls** (structured, named properties):
```typescript
logger.info("Search completed: {count} items from {source}", {
  count: items.length,
  source: "reddit",
  cacheHit: fromCache,
});
```

The function call style is preferred for CLI tools because:
1. Property names are explicit (not positional)
2. You can add properties that aren't in the message template
3. AI agents can parse the structured properties

### 4.7 Lazy Evaluation

Defer expensive computations so they only run if the level is enabled:

```typescript
// This computes even if debug is disabled:
logger.debug("Cache stats: {stats}", { stats: computeStats() });  // BAD

// This only computes if debug is enabled:
logger.debug(l => l`Cache stats: ${computeStats()}`);              // GOOD

// Or with function call style:
logger.debug("Cache stats: {stats}", () => ({
  stats: computeStats(),
}));
```

For async operations, check the level first:

```typescript
if (logger.isEnabledFor("debug")) {
  const stats = await fetchRemoteStats();
  logger.debug("Remote stats: {stats}", { stats });
}
```

### 4.8 Fingers Crossed Sink

A powerful pattern for CLI tools: buffer debug/trace logs silently, but **flush the entire buffer when an error occurs**. This gives you full diagnostic context on failures without noise on success:

```typescript
import { configure, fingersCrossed, getConsoleSink } from "@logtape/logtape";

await configure({
  sinks: {
    console: fingersCrossed(getConsoleSink(), {
      triggerLevel: "error",     // Flush buffer when error+ is logged
      maxBufferSize: 500,        // Cap buffered records
    }),
  },
  loggers: [
    { category: ["wots"], sinks: ["console"], lowestLevel: "debug" },
  ],
});
```

**How it works**:
1. Debug and info logs are silently buffered
2. When an error or fatal log arrives, the entire buffer is flushed
3. Subsequent logs pass through immediately (the "crossed" state)

**CLI use case**: Run `wots "topic"` -- on success, no debug noise. On failure, you get the full debug trace leading up to the error. No `--debug` flag needed.

**Isolation modes**:
- `isolateByCategory: "descendant"` -- separate buffers per category subtree
- `isolateByContext: { keys: ["requestId"] }` -- separate buffers per context value

---

## 5. Architecture for CLI Tools

### 5.1 Category Hierarchy Design

Design categories around your CLI's functional boundaries, not file structure:

```
wots                          # Root -- catch-all
├── wots.cli                  # Arg parsing, flag resolution, entry/exit
├── wots.cache                # Cache hits, misses, stale fallbacks, locks
├── wots.search               # Search orchestration
│   ├── wots.search.reddit    # OpenAI Responses API calls
│   ├── wots.search.x         # xAI API calls
│   ├── wots.search.youtube   # yt-dlp invocations
│   └── wots.search.web       # Web search instructions
├── wots.score                # Relevance/recency/engagement scoring
├── wots.render               # Output formatting decisions
└── wots.watchlist            # SQLite ops, briefing generation
```

**Naming rules**:
- Start with your package name (`wots`) to avoid collisions
- Use functional boundaries, not file names
- Keep depth to 3 levels max (root.domain.subdomain)
- The root category is the single knob for "all logging on/off"

### 5.2 Sink Configuration Strategy

```typescript
// src/logging.ts
import { AsyncLocalStorage } from "node:async_hooks";
import {
  type LogRecord,
  ansiColorFormatter,
  configure,
  getConsoleSink,
  getTextFormatter,
  jsonLinesFormatter,
} from "@logtape/logtape";

export interface LoggingOptions {
  debug: boolean;
  verbose: boolean;
  quiet: boolean;
  json: boolean;
}

/**
 * Configure LogTape for CLI execution.
 *
 * Selects formatter based on output mode:
 * - Interactive TTY: ANSI color formatter to stderr
 * - JSON mode (--json/--jsonl) or piped: JSON Lines to stderr
 * - Quiet mode: errors only
 */
export async function setupLogging(opts: LoggingOptions): Promise<void> {
  const level = opts.debug
    ? "debug"
    : opts.verbose
      ? "info"
      : opts.quiet
        ? "error"
        : "warning";

  const isInteractive = process.stderr.isTTY && !opts.json;

  await configure({
    // Enable implicit context propagation for async operations
    contextLocalStorage: new AsyncLocalStorage(),
    sinks: {
      stderr: getConsoleSink({
        formatter: isInteractive ? ansiColorFormatter : jsonLinesFormatter,
      }),
    },
    loggers: [
      {
        category: ["wots"],
        sinks: ["stderr"],
        lowestLevel: level,
      },
    ],
  });
}
```

### 5.3 Flag-to-Level Mapping

| User Intent | Flag | Level | What They See |
|------------|------|-------|---------------|
| Normal use | (none) | `warning` | Only problems |
| Curious | `--verbose` | `info` | Lifecycle events |
| Debugging | `--debug` | `debug` | Full diagnostic detail |
| Silent | `--quiet` | `error` | Only errors |
| AI agent | `--json --quiet` | `error` + JSON | Machine-readable errors only |
| AI agent debugging | `--json --debug` | `debug` + JSON | Full structured diagnostics |

### 5.4 The Config-from-File Pattern

LogTape 2.0 ships `@logtape/config` for external configuration. This enables power-user workflows:

```bash
# User creates a custom logging config
cat > ~/.config/wots/logtape.json << 'EOF'
{
  "sinks": {
    "console": { "$factory": "#console" },
    "file": { "$factory": "@logtape/file#getFileSink", "path": "/tmp/wots.log" }
  },
  "loggers": [
    { "category": ["wots"], "sinks": ["console"], "lowestLevel": "warning" },
    { "category": ["wots", "search", "reddit"], "sinks": ["file"], "lowestLevel": "debug" }
  ]
}
EOF

# Use it
wots "Claude Code" --log-config=~/.config/wots/logtape.json
```

**When to add this**: Not in v1. Add it when users request per-category debugging without `--debug` flooding everything.

---

## 6. Implementation Guide

### 6.1 Installation

```bash
bun add @logtape/logtape
```

This is the only required package. Ecosystem packages are optional:

| Package | When to Add |
|---------|------------|
| `@logtape/file` | If you want rotating file sinks |
| `@logtape/otel` | If you want OpenTelemetry export |
| `@logtape/sentry` | If you want Sentry error tracking |
| `@logtape/config` | If you want config-from-file |
| `@logtape/redaction` | If logs might contain PII |
| `@logtape/pretty` | If you want emoji-rich dev output |

### 6.2 Entry Point Wiring

Call `setupLogging()` as the first async operation in your CLI's `main()`:

```typescript
// src/cli.ts
import { setupLogging } from "./logging";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["wots", "cli"]);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Configure logging before anything else
  await setupLogging({
    debug: args.debug,
    verbose: args.verbose ?? false,
    quiet: args.quiet,
    json: args.json || args.jsonl,
  });

  logger.info("CLI started: {topic} (depth={depth}, sources={sources})", {
    topic: args.topic,
    depth: args.depth,
    sources: args.sources,
  });

  // ... rest of CLI logic
}
```

### 6.3 Wrapping Parallel Search Tasks with Context

This is where LogTape's value is most visible. The wots CLI runs Reddit, X, and YouTube searches in parallel via `Promise.all()`. Wrapping each with `withContext()` gives every log message inside the search automatic source identification:

```typescript
import { withContext, getLogger } from "@logtape/logtape";

const logger = getLogger(["wots", "search"]);

const promises: Promise<void>[] = [];

if (runReddit) {
  promises.push(
    withContext({ source: "reddit", topic }, async () => {
      logger.info("Search started");

      const result = await searchRedditTask(/* ... */);

      if (result.fromCache) {
        logger.debug("Cache hit (age={ageHours}h)", {
          ageHours: result.cacheAgeHours,
        });
      }

      if (result.rateLimited) {
        logger.warn("Rate limited (stale={usedStale}, age={ageHours}h)", {
          usedStale: result.usedStaleCache,
          ageHours: result.cacheAgeHours,
        });
      }

      if (result.error) {
        logger.error("Search failed: {error}", { error: result.error });
      }

      logger.info("Search complete: {count} items", {
        count: result.items.length,
        fromCache: result.fromCache,
      });

      redditItems = result.items;
    })
  );
}

// X and YouTube follow the same pattern...

await Promise.all(promises);
```

**What this produces** (with `--debug --json`):

```jsonl
{"@timestamp":"...","level":"INFO","category":"wots.search","message":"Search started","source":"reddit","topic":"Claude Code"}
{"@timestamp":"...","level":"DEBUG","category":"wots.search","message":"Cache hit (age=2.3h)","source":"reddit","topic":"Claude Code","ageHours":2.3}
{"@timestamp":"...","level":"INFO","category":"wots.search","message":"Search started","source":"x","topic":"Claude Code"}
{"@timestamp":"...","level":"WARN","category":"wots.search","message":"Rate limited (stale=true, age=18.2h)","source":"x","topic":"Claude Code","usedStale":true,"ageHours":18.2}
```

An AI agent reading this stderr stream can immediately identify: Reddit succeeded from cache, X was rate-limited and served stale data.

### 6.4 Cache Logging

The cache layer is high-value for structured logging -- it's where most "why is my data stale?" questions get answered:

```typescript
// src/lib/cache.ts
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["wots", "cache"]);

export function loadCache(key: string): CacheResult | null {
  const entry = readCacheFile(key);

  if (!entry) {
    logger.debug("Cache miss: {key}", { key });
    return null;
  }

  if (isExpired(entry)) {
    logger.debug("Cache expired: {key} (age={ageHours}h, ttl={ttlHours}h)", {
      key,
      ageHours: entry.ageHours,
      ttlHours: entry.ttlHours,
    });
    return null;
  }

  logger.debug("Cache hit: {key} (age={ageHours}h, version={version})", {
    key,
    ageHours: entry.ageHours,
    version: entry.version,
  });
  return entry.data;
}
```

### 6.5 What NOT to Log

| Don't Log | Why | Instead |
|-----------|-----|---------|
| Raw API responses | Huge, may contain user data | Log item counts and status codes |
| Scoring loop iterations | 50+ items * multiple factors = noise | Log final top-5 scores |
| Every cache key check | High frequency, low signal | Log hits and misses only |
| Progress display updates | These are UI, not diagnostics | Keep `ProgressDisplay` on stderr as-is |
| API keys or tokens | Security risk | Log `"key=present"` / `"key=missing"` |

---

## 7. AI Agent Observability

### 7.1 The Problem

When a Claude Code sub-agent runs `wots "Claude Code" --json --quiet`, it gets a JSON envelope on stdout. If the envelope contains `"status": "error"`, the agent has no diagnostic context -- just an error message.

### 7.2 The Solution

With LogTape, the agent can run `wots "Claude Code" --json --debug` and parse structured JSON Lines from stderr:

```typescript
// Agent-side pseudocode
const proc = Bun.spawn(["wots", topic, "--json", "--debug"], {
  stdout: "pipe",
  stderr: "pipe",
});

const result = JSON.parse(await new Response(proc.stdout).text());
const diagnostics = (await new Response(proc.stderr).text())
  .split("\n")
  .filter(Boolean)
  .map(line => JSON.parse(line));

if (result.status === "error") {
  // diagnostics contains the full structured trace:
  // - Which sources were attempted
  // - Which ones failed and why
  // - Cache state at time of failure
  // - Rate limit details
}
```

### 7.3 Context Properties for Agent Consumption

Design context properties that agents can programmatically filter:

| Property | Type | Purpose |
|----------|------|---------|
| `source` | `"reddit" \| "x" \| "youtube" \| "web"` | Which search source |
| `topic` | `string` | The search topic |
| `phase` | `"search" \| "score" \| "render"` | Pipeline stage |
| `fromCache` | `boolean` | Whether result came from cache |
| `rateLimited` | `boolean` | Whether source was rate-limited |
| `usedStaleCache` | `boolean` | Whether stale cache was served |
| `cacheAgeHours` | `number` | How old the cached data is |
| `itemCount` | `number` | Number of results returned |

### 7.4 The `withContext()` + `Promise.all()` Pattern

This is the core observability pattern for CLI tools that orchestrate parallel async work:

```
┌──────────────┐
│  main()      │  context: { topic: "Claude Code", runId: "abc" }
│              │
│  ┌───────────┤
│  │ Promise.all([
│  │   withContext({ source: "reddit" }, searchReddit),
│  │   withContext({ source: "x" }, searchX),
│  │   withContext({ source: "youtube" }, searchYouTube),
│  │ ])
│  │
│  │  Each branch inherits { topic, runId } and adds { source }
│  │  Every log inside carries all three properties automatically
│  └───────────┤
└──────────────┘
```

### 7.5 Sentry Integration for Long-Running CLI Processes

For CLI daemons (like `wots briefing` on a cron), add Sentry for error tracking:

```typescript
import * as Sentry from "@sentry/bun";
import { getSentrySink } from "@logtape/sentry";
import { AsyncLocalStorage } from "node:async_hooks";

// CRITICAL: Initialize Sentry BEFORE LogTape
Sentry.init({ dsn: "..." });

await configure({
  contextLocalStorage: new AsyncLocalStorage(),
  sinks: {
    console: getConsoleSink(),
    sentry: getSentrySink({
      contextLocalStorage: new AsyncLocalStorage(),
    }),
  },
  loggers: [
    { category: ["wots"], sinks: ["console", "sentry"], lowestLevel: "warning" },
  ],
});
```

**Gotcha**: Sentry must be initialized before `configure()`. If reversed, the Sentry sink silently drops all events. No error is thrown.

---

## 8. Testing

### 8.1 Reset Between Tests

LogTape is a global singleton. Reset it between tests to prevent leakage:

```typescript
import { configure, reset } from "@logtape/logtape";
import { afterEach, beforeEach, describe, it, expect } from "bun:test";

describe("searchReddit", () => {
  const buffer: LogRecord[] = [];

  beforeEach(async () => {
    buffer.length = 0;
    await configure({
      sinks: {
        buffer: buffer.push.bind(buffer),
      },
      loggers: [
        { category: ["wots"], sinks: ["buffer"], lowestLevel: "debug" },
      ],
    });
  });

  afterEach(async () => {
    await reset();
  });

  it("logs cache hit on cached result", async () => {
    await searchReddit("Claude Code", { fromCache: true });

    const cacheLog = buffer.find(
      (r) => r.category.join(".") === "wots.cache"
        && r.level === "debug"
    );
    expect(cacheLog).toBeDefined();
  });
});
```

### 8.2 Buffer Sink Pattern

LogTape doesn't ship a built-in memory sink, but the pattern is trivial:

```typescript
const buffer: LogRecord[] = [];

await configure({
  sinks: {
    buffer: buffer.push.bind(buffer),
  },
  loggers: [
    { category: ["wots"], sinks: ["buffer"], lowestLevel: "trace" },
  ],
});
```

### 8.3 Testing Implicit Contexts

When testing code that uses `withContext()`, you must configure `contextLocalStorage`:

```typescript
import { AsyncLocalStorage } from "node:async_hooks";

beforeEach(async () => {
  await configure({
    contextLocalStorage: new AsyncLocalStorage(),
    sinks: { buffer: buffer.push.bind(buffer) },
    loggers: [
      { category: ["wots"], sinks: ["buffer"], lowestLevel: "debug" },
    ],
  });
});
```

### 8.4 What to Assert On

| Assert | Don't Assert |
|--------|-------------|
| Log level is correct for the event | Exact message text (brittle) |
| Category matches expected module | Timestamp values |
| Context properties are present | Log ordering across parallel tasks |
| Error logs include error details | Number of debug logs (implementation detail) |

---

## 9. The Library/CLI Boundary

### 9.1 The Dual-Export Pattern

wots has two entry points:

```
src/cli.ts    -- CLI entry point (owns I/O, configures LogTape)
src/index.ts  -- Library barrel export (pure, no side effects)
```

**Rules**:
- `cli.ts` calls `configure()`. Nobody else does.
- Library code (`src/lib/*.ts`) calls `getLogger()` freely.
- If a consumer imports from `@side-quest/word-on-the-street`, they configure their own LogTape -- or don't, and get silence.

### 9.2 Library Authors: What to Do

```typescript
// src/lib/openai-reddit.ts
import { getLogger } from "@logtape/logtape";

// Use your package name as the root category
const logger = getLogger(["wots", "search", "reddit"]);

export async function searchReddit(topic: string): Promise<RedditResult> {
  logger.info("Calling OpenAI Responses API: {topic}", { topic });
  // ...
}
```

### 9.3 Library Authors: What NOT to Do

```typescript
// NEVER do this in library code:
import { configure } from "@logtape/logtape";
await configure({ /* ... */ });  // Conflicts with consumer's config

// NEVER do this:
console.log("Debug: searching reddit");  // Not structured, not suppressible

// NEVER do this:
if (process.env.DEBUG) { /* ... */ }  // Side-channel, not LogTape-aware
```

### 9.4 Consumer Configuration

When someone imports wots as a library, they control logging:

```typescript
import { configure, getConsoleSink } from "@logtape/logtape";
import { searchReddit } from "@side-quest/word-on-the-street";

// Consumer configures LogTape for their app
await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    // See wots internal logs at debug level
    { category: ["wots"], sinks: ["console"], lowestLevel: "debug" },
    // Or suppress them entirely
    // { category: ["wots"], sinks: [], lowestLevel: "fatal" },
  ],
});

const result = await searchReddit("Claude Code");
```

---

## 10. Gotchas and Pitfalls

### 10.1 Non-Blocking Mode Loses Logs on Crash

LogTape's non-blocking mode buffers logs asynchronously. If the process hard-crashes (segfault, `process.exit(1)`), unwritten buffered logs are lost.

**Mitigation**: Don't use `nonBlocking: true` for CLI tools. CLIs are short-lived -- the throughput gain doesn't justify the durability risk. Reserve non-blocking mode for high-throughput backend servers.

```typescript
// CLI: use blocking mode (default)
getConsoleSink()

// Backend: non-blocking is fine
getConsoleSink({ nonBlocking: { bufferSize: 1000, flushInterval: 50 } })
```

### 10.2 Edge Function Teardown

If wots ever runs in Cloudflare Workers or similar edge runtimes, you must explicitly call `dispose()` inside `ctx.waitUntil()`. Skip this and logs vanish on worker termination.

```typescript
import { dispose } from "@logtape/logtape";

export default {
  async fetch(request, env, ctx) {
    await configure({ /* ... */ });
    ctx.waitUntil(dispose());
    return new Response("...");
  }
};
```

**For CLI tools**: Not relevant. The process lifecycle handles cleanup.

### 10.3 Sentry Init Order

If using `@logtape/sentry`, **Sentry must be initialized before LogTape's `configure()`**. Reversing the order causes silent event loss -- no error, no warning.

```typescript
// CORRECT:
Sentry.init({ dsn: "..." });
await configure({ sinks: { sentry: getSentrySink() } });

// WRONG (silently drops Sentry events):
await configure({ sinks: { sentry: getSentrySink() } });
Sentry.init({ dsn: "..." });
```

### 10.4 OpenTelemetry Nested Object Serialization

A bug fixed in Jan 2026 caused `logtape-otel` to flatten nested objects to JSON strings instead of proper `map<string, AnyValue>` structures. This broke queryability in backends like Axiom and Honeycomb. Ensure you're on the latest `logtape-otel` version.

### 10.5 Redaction is Partial

LogTape's `@logtape/redaction` supports pattern-based masking, but the docs explicitly note it's "not foolproof." Don't rely on it as your sole PII protection -- sanitize sensitive data before it reaches log calls.

### 10.6 Duplicate Categories Cause ConfigError

Configuring the same category twice in the `loggers` array throws `ConfigError`:

```typescript
// WRONG: duplicate category
loggers: [
  { category: ["wots", "search"], sinks: ["console"], lowestLevel: "info" },
  { category: ["wots", "search"], sinks: ["file"], lowestLevel: "debug" },  // THROWS
]

// CORRECT: one entry, multiple sinks
loggers: [
  { category: ["wots", "search"], sinks: ["console", "file"], lowestLevel: "debug" },
]
```

### 10.7 Don't Mix Sync and Async Configuration

`configure()` / `reset()` and `configureSync()` / `resetSync()` are separate tracks. Never mix them:

```typescript
// WRONG:
await configure({ /* ... */ });
resetSync();  // Undefined behavior

// CORRECT:
await configure({ /* ... */ });
await reset();
```

### 10.8 Bun Stream Sink Requires Manual WritableStream

Unlike Node.js and Deno, Bun doesn't expose `process.stderr` as a `WritableStream`. You must wrap it manually:

```typescript
// Node.js: clean
import stream from "node:stream";
getStreamSink(stream.Writable.toWeb(process.stderr))

// Bun: requires manual WritableStream wrapper
let writer: FileSink | undefined;
const stderrStream = new WritableStream({
  start() { writer = Bun.stderr.writer(); },
  write(chunk) { writer?.write(chunk); },
  close() { writer?.close(); },
});
getStreamSink(stderrStream)

// Simpler alternative: just use getConsoleSink() with a formatter
// Console sink works fine on Bun without wrapping
getConsoleSink({ formatter: jsonLinesFormatter })
```

**Recommendation**: Use `getConsoleSink()` on Bun. The stream sink's manual wrapping isn't worth it unless you need specific stream behavior.

---

## 11. When NOT to Use LogTape

### 11.1 Simple Scripts

If your CLI is a single-file script with one code path:

```typescript
#!/usr/bin/env bun
const result = await fetch(url);
console.log(JSON.stringify(result));
```

Just use `console.error()` for debug messages. LogTape adds complexity without proportional value.

### 11.2 No Async Orchestration

If your CLI doesn't do parallel async work (no `Promise.all()`, no concurrent API calls), LogTape's context propagation -- its biggest CLI feature -- provides no benefit over simple `console.error("[reddit]", message)` prefixing.

### 11.3 Bundle Size is Sacred

LogTape is 5.3 KB min+gz -- small, but not zero. If your CLI has zero runtime dependencies and you want to keep it that way, the cost is a non-zero dependency for a debugging convenience.

### 11.4 You Don't Debug in Production

If your CLI is a personal tool that you only debug by reading source code, structured logging is overhead. It earns its keep when:
- Other people use your CLI
- AI agents call your CLI
- Failures happen in environments you can't reproduce

### 11.5 Decision Checklist

Add LogTape if **2+ are true**:

- [ ] CLI orchestrates parallel async operations
- [ ] CLI is called by AI agents as a subprocess
- [ ] CLI has multiple failure modes (rate limits, cache, API errors)
- [ ] CLI is distributed to other users
- [ ] You need per-module verbosity control
- [ ] You want structured diagnostics without parsing human-readable output

---

## 12. Migration Guide

### 12.1 Phase 1: Foundation (~30 minutes)

Add LogTape, create the configuration module, wire it into the CLI entry point. Replace existing `[debug]` stderr writes with logger calls.

**Before**:
```typescript
if (args.debug) {
  process.stderr.write(`[debug] query-type=${resolvedQueryType}\n`);
}
```

**After**:
```typescript
logger.debug("Query type resolved: {queryType}", {
  queryType: resolvedQueryType,
});
```

The `--debug` flag now controls LogTape's level instead of guarding individual writes.

### 12.2 Phase 2: Async Context (~1 hour)

Wrap each `Promise.all()` branch with `withContext()`. Add cache hit/miss logging in the cache module.

### 12.3 Phase 3: Fingers Crossed (~30 minutes)

Add the `fingersCrossed` sink so failures automatically dump the debug trace. This eliminates the need for users to re-run with `--debug` after a failure.

### 12.4 Phase 4: Ecosystem (optional, as needed)

| Need | Package | Effort |
|------|---------|--------|
| Rotating log files | `@logtape/file` | ~30 min |
| OpenTelemetry export | `logtape-otel` | ~1 hour |
| Sentry error tracking | `@logtape/sentry` | ~1 hour |
| Config-from-file | `@logtape/config` | ~30 min |
| PII redaction | `@logtape/redaction` | ~30 min |

### 12.5 What to Keep

- **`ProgressDisplay`** -- LogTape is not a progress UI. Keep your spinners.
- **`console.log()` for program output** -- LogTape handles diagnostics, not program output.
- **Exit codes** -- LogTape doesn't replace `process.exit()` semantics.
- **`--quiet` flag** -- Map it to `lowestLevel: "error"`.

---

## 13. Performance

### 13.1 Benchmarks on Bun

From LogTape's official comparison (logtape.org/comparison):

**Console logging (nanoseconds per iteration on Bun)**:

| Library | Bun (ns) | Relative |
|---------|----------|----------|
| LogTape | 225 | 1.0x (baseline) |
| Pino | 874 | 3.9x slower |
| Winston | 1,770 | 7.9x slower |
| Bunyan | 2,020 | 9.0x slower |
| Signale | 2,110 | 9.4x slower |
| log4js | 3,540 | 15.7x slower |

**Null benchmark (disabled logging, Bun)**:

| Library | Bun (ns) |
|---------|----------|
| LogTape | 187 |
| log4js | 261 |
| Winston | 569 |
| Pino | 715 |

**What this means for CLIs**: A typical wots run logs ~20-50 messages. At 225ns each, that's ~11 microseconds total -- invisible. Even at debug level with hundreds of messages, logging adds < 1ms to a CLI that runs for 5-30 seconds.

### 13.2 No-Op Overhead

When LogTape is imported but `configure()` is never called (the library consumer case), the no-op cost is ~187ns per log call on Bun. For a library that logs 100 times during a function call, that's ~19 microseconds of overhead -- effectively zero.

### 13.3 Context Propagation Cost

`withContext()` uses `AsyncLocalStorage`, which adds ~200-500ns per async operation on Bun. For `Promise.all()` with 3-4 branches, this is < 2 microseconds total.

### 13.4 When Performance Matters

The only scenario where logging overhead is measurable is inside tight scoring loops:

```typescript
// DON'T log inside the scoring loop (50+ items * multiple factors):
for (const item of items) {
  logger.trace("Scoring item: {id}", { id: item.id });  // Thousands of calls
  item.score = computeScore(item);
}

// DO log the result:
logger.debug("Scoring complete: top={topScore}, median={median}, count={count}", {
  topScore: items[0].score,
  median: items[Math.floor(items.length / 2)].score,
  count: items.length,
});
```

---

## 14. Comparison Matrix

### 14.1 Full Feature Comparison

| Feature | LogTape | Pino | Winston | Console |
|---------|---------|------|---------|---------|
| **Bundle (min+gz)** | 5.3 KB | 3.1 KB | 38.3 KB | 0 KB |
| **Dependencies** | 0 | 1 | 17 | 0 |
| **Bun support** | Full | Limited | Limited | Full |
| **No-op default** | Yes | No | No | N/A |
| **Structured logging** | Yes | Yes | Yes | No |
| **Async context** | Built-in | Manual child() | Manual child() | No |
| **Human formatter** | Built-in | pino-pretty (dev dep) | Built-in | Built-in |
| **JSON formatter** | Built-in | Default | Built-in | No |
| **Tree-shakable** | Yes | No | No | N/A |
| **Hierarchical categories** | Yes | No (flat) | No (flat) | No |
| **Fingers crossed** | Built-in | No | No | No |
| **Config from file** | @logtape/config | pino.transport() | Built-in | No |
| **Lazy evaluation** | Built-in | No | No | No |
| **Template literals** | Yes | No | No | No |
| **OTel integration** | logtape-otel | pino-opentelemetry | winston-otel | No |
| **Sentry integration** | @logtape/sentry | @sentry/node | @sentry/node | No |
| **Pino bridge** | @logtape/adaptor-pino | N/A | N/A | No |
| **Edge runtime** | Yes | No | No | Yes |

### 14.2 When to Pick Each

| Choose | When |
|--------|------|
| **LogTape** | Bun CLI, library-first design needed, async context, zero deps |
| **Pino** | Node.js backend migrating to Bun, existing Pino infrastructure |
| **Winston** | Legacy Node.js app, need built-in transports, don't care about bundle |
| **Console** | Single-file script, no structured logging needed |

---

## 15. Decision Framework

### 15.1 For wots Specifically

| Factor | Assessment |
|--------|-----------|
| Parallel async orchestration | Yes -- Reddit, X, YouTube, web in `Promise.all()` |
| Called by AI agents | Yes -- Beat Reporter sub-agents via `bunx` |
| Multiple failure modes | Yes -- rate limits, stale cache, API errors, yt-dlp failures |
| Distributed to users | Yes -- published on npm |
| Library export | Yes -- `src/index.ts` barrel for programmatic use |
| Current debug pattern | Manual `[debug]` stderr writes guarded by flag |

**Verdict**: LogTape is a clear fit. All six checklist items are true.

### 15.2 For Any Bun CLI Tool

```
Is your CLI a single-file script with one code path?
  → Yes: Use console.error(). Stop here.
  → No: Continue.

Does your CLI orchestrate parallel async work?
  → Yes: LogTape's withContext() is high-value.
  → No: LogTape still works, but the context feature is wasted.

Is your CLI called by AI agents or other machines?
  → Yes: JSON Lines on stderr is essential. LogTape provides this.
  → No: Human-readable stderr may be sufficient.

Do you export a library alongside the CLI?
  → Yes: LogTape's no-op default is critical.
  → No: Any logging library works.

How many runtime dependencies does your CLI have?
  → Zero: Adding LogTape (5.3 KB, 0 deps) is a small cost.
  → Many: One more dependency is irrelevant. Pick the best tool.
```

---

## 16. Resources

### 16.1 Official Documentation

- [LogTape Home](https://logtape.org/) -- main documentation site
- [Quick Start](https://logtape.org/manual/start) -- installation and basic setup
- [Configuration](https://logtape.org/manual/config) -- full `configure()` reference
- [Categories](https://logtape.org/manual/categories) -- hierarchical logger design
- [Sinks](https://logtape.org/manual/sinks) -- all sink types and custom sinks
- [Formatters](https://logtape.org/manual/formatters) -- text, ANSI, JSON Lines, Pretty
- [Contexts](https://logtape.org/manual/contexts) -- explicit, implicit, lazy contexts
- [Library Authors](https://logtape.org/manual/library) -- guide for library-first design
- [Testing](https://logtape.org/manual/testing) -- reset, buffer sinks, test isolation
- [Comparison](https://logtape.org/comparison) -- benchmarks and feature matrix vs alternatives

### 16.2 Ecosystem Packages

| Package | Purpose | Docs |
|---------|---------|------|
| [@logtape/file](https://logtape.org/sinks/file) | File + rotating file sinks | logtape.org |
| [logtape-otel](https://github.com/dahlia/logtape-otel) | OpenTelemetry sink | GitHub |
| [@logtape/sentry](https://logtape.org/sinks/sentry) | Sentry error tracking | logtape.org |
| [@logtape/config](https://logtape.org/manual/config) | Config from JSON/YAML/TOML | logtape.org |
| [@logtape/redaction](https://logtape.org/manual/formatters) | Pattern-based PII masking | logtape.org |
| [@logtape/pretty](https://logtape.org/manual/formatters) | Emoji-rich dev formatter | logtape.org |
| [@logtape/adaptor-pino](https://github.com/dahlia/logtape) | Bridge to Pino infrastructure | GitHub |
| [@logtape/cloudwatch-logs](https://logtape.org/sinks/cloudwatch-logs) | AWS CloudWatch | logtape.org |

### 16.3 Community Resources

- [Logging in Node.js/Deno/Bun 2026](https://hackers.pub/@hongminhee/2026/logging-nodejs-deno-bun-2026) -- author's comprehensive guide (hackers.pub)
- [Trace-Connected Structured Logging with LogTape and Sentry](https://blog.sentry.io/trace-connected-structured-logging-with-logtape-and-sentry/) -- Sentry's official integration guide
- [Fedify Case Study](https://hackers.pub/@hongminhee/2025/logtape-fedify-case-study) -- the origin story and library-first design rationale
- [LogTape GitHub](https://github.com/dahlia/logtape) -- source, issues, discussions
- [LogTape on JSR](https://jsr.io/@logtape/logtape) -- Deno/JSR registry
- [Better Stack: Top 8 Node.js Logging Libraries](https://betterstack.com/community/guides/logging/best-nodejs-logging-libraries/) -- broader ecosystem context
- [Show HN: Universal Logger for Node/Deno/Bun](https://news.ycombinator.com/item?id=41557107) -- Hacker News discussion

### 16.4 Related X Posts

- [@hongminhee: LogTape 2.0.0 release](https://x.com/hongminhee/status/2011717024276496444) -- v2 features: lazy(), JSON config, async lazy eval
- [@hongminhee: Optique 0.8.0 CLI integration](https://x.com/hongminhee/status/1998253989264249272) -- LogTape config via CLI args
- [@TechSquidTV: "For you AND your AI"](https://x.com/TechSquidTV/status/2021999136539804061) -- AI agent log consumption pattern
- [@zeeg (Sentry CEO): using LogTape](https://x.com/zeeg/status/2009028094993289653) -- Sentry CEO adoption signal

---

## 17. Glossary

| Term | Definition |
|------|-----------|
| **Category** | A string array (e.g., `["wots", "search", "reddit"]`) that namespaces a logger. Forms a hierarchy where logs propagate upward to parent categories. |
| **Sink** | A function that receives log records and writes them somewhere (console, file, network). Signature: `(record: LogRecord) => void`. |
| **Formatter** | A function that converts a `LogRecord` into a string for text-based sinks. Examples: text, ANSI color, JSON Lines. |
| **Explicit context** | Key-value pairs attached to a logger instance via `.with()`. Inherited by child loggers. |
| **Implicit context** | Key-value pairs set via `withContext()` that propagate through the entire async call tree via `AsyncLocalStorage`. |
| **Lazy context** | Context values wrapped in `lazy(() => value)` that evaluate at log time, not at `.with()` time. |
| **Fingers crossed** | A sink wrapper that buffers low-severity logs and flushes the entire buffer when a high-severity event occurs. Named after the Monolog (PHP) pattern. |
| **No-op default** | LogTape's behavior when `configure()` has not been called: all log calls silently return without side effects. Zero output, zero overhead beyond the function call. |
| **Library-first** | Design philosophy where the logging library assumes it will be used inside other libraries, not just applications. The library never calls `configure()` -- the consuming application does. |
| **JSON Lines** | Newline-delimited JSON format where each line is a complete JSON object. Standard format for machine-readable structured logs. |
| **Category prefix** | A `withCategoryPrefix()` call that prepends a namespace to all logger categories within an async scope. Used by SDKs wrapping internal libraries. |
| **Buffer sink** | A testing pattern where logs are pushed to an in-memory array for assertion: `buffer.push.bind(buffer)`. |
| **Tri-modal output** | A CLI pattern with three output modes: human-readable (compact), machine-readable (JSON envelope), and streaming (JSONL). Each serves a different consumer. |
