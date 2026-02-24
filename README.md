# @side-quest/word-on-the-street

[![npm version](https://img.shields.io/npm/v/@side-quest/word-on-the-street)](https://www.npmjs.com/package/@side-quest/word-on-the-street)
[![CI](https://github.com/nathanvale/side-quest-word-on-the-street/actions/workflows/pr-quality.yml/badge.svg)](https://github.com/nathanvale/side-quest-word-on-the-street/actions/workflows/pr-quality.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Bun >=1.2](https://img.shields.io/badge/bun-%3E%3D1.2-brightgreen)](https://bun.sh)

Research any topic from the last 30 days across Reddit, X, YouTube, and web -- engagement-ranked results.

---

## Features

- **Multi-source search** -- Reddit (via OpenAI Responses API), X/Twitter (via xAI Responses API), YouTube (via yt-dlp), and general web search
- **Engagement-ranked results** -- multi-factor scoring: relevance x recency x engagement, with trend-aware momentum scoring
- **Smart deduplication** -- N-gram Jaccard similarity (70% threshold) for Reddit/X; exact video-ID matching for YouTube
- **Two-phase retrieval** -- phase 1 parallel search + optional phase 2 entity-driven supplemental queries
- **Watchlist** -- track topics over time with SQLite-backed run history and delta detection
- **Filesystem cache** -- versioned cache keys, file locking, atomic writes, stale-cache fallback on rate-limit errors
- **Multiple output modes** -- compact markdown, full JSON, full markdown report, reusable context snippet, or file path
- **CLI + library** -- usable as a command-line tool or imported as a typed Bun package
- **Mock mode** -- fixture-based testing without API keys (`--mock`)
- **Zero runtime deps** -- only `@side-quest/core`; everything else is native (`fetch`, `node:fs`, built-in JSON)

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| [Bun](https://bun.sh) `>=1.2` | Runtime (Bun-only) |
| `OPENAI_API_KEY` | Required for Reddit search |
| `XAI_API_KEY` | Required for X/Twitter search |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) in `PATH` | Required for `--include-youtube` |

Both API keys are optional -- the CLI falls back gracefully to whatever sources are configured.

---

## Installation

```bash
# Global CLI install
bun add -g @side-quest/word-on-the-street

# Library only (programmatic use)
bun add @side-quest/word-on-the-street
```

---

## Quick Start

```bash
# Research a topic using all available sources
wots "Claude Code"

# Deep search with JSON output
wots "React Server Components" --deep --emit=json

# Reddit only, last 7 days
wots "Bun 1.2" --sources=reddit --days=7

# Include YouTube results
wots "AI agents" --include-youtube --emit=json

# Two-phase retrieval (extracts entities from phase 1, runs supplemental queries)
wots "TypeScript 5.9" --strategy=two-phase
```

---

## Configuration

API keys are loaded from environment variables first, then from `~/.config/wots/.env`.

```bash
# ~/.config/wots/.env
OPENAI_API_KEY=sk-...
XAI_API_KEY=xai-...

# Optional: control model selection
OPENAI_MODEL_POLICY=pinned              # auto | pinned
OPENAI_MODEL_PIN=gpt-4o-search-preview  # only used when policy=pinned
XAI_MODEL_POLICY=latest                 # latest | stable
XAI_MODEL_PIN=grok-4-1-fast            # only used when policy=pinned

# Optional: override cache TTL (hours)
WOTS_CACHE_TTL=1
```

| Path | Purpose |
|------|---------|
| `~/.config/wots/.env` | API keys and model policy |
| `~/.cache/wots/` | Search result cache |
| `~/.local/share/wots/out/` | Context snippet output (default) |

---

## Model Policy

By default, the CLI pins OpenAI to `gpt-4o-search-preview`. Override with env vars or flags:

- `OPENAI_MODEL_POLICY=pinned` + `OPENAI_MODEL_PIN=<model>` -- env var override
- `--fast` -- pins `gpt-4o` for speed
- `--cheap` -- pins `gpt-4o-mini-search-preview` for cost

Env vars take precedence over flags when both are set.

---

## CLI Reference

### Search (default command)

```
wots <topic> [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--emit=MODE` | `compact` | Output format: `compact`, `json`, `md`, `context`, `path` |
| `--sources=MODE` | `auto` | Source selection: `auto`, `reddit`, `x`, `both`, `web` |
| `--days=N` | `30` | Lookback window in days (1-365) |
| `--quick` | - | Fewer results, faster |
| `--deep` | - | More results, comprehensive |
| `--fast` | - | Pin OpenAI model to `gpt-4o` |
| `--cheap` | - | Pin OpenAI model to `gpt-4o-mini-search-preview` |
| `--include-web` | - | Add general web search alongside Reddit/X |
| `--include-youtube` | - | Add YouTube video search (requires yt-dlp) |
| `--strategy=MODE` | `single` | Search strategy: `single` or `two-phase` |
| `--phase2-budget=N` | `5` | Max supplemental queries per source in phase 2 (1-50) |
| `--query-type=TYPE` | `auto` | Intent hint: `auto`, `prompting`, `recommendations`, `news`, `general` |
| `--refresh` | - | Bypass cache reads, force fresh search |
| `--no-cache` | - | Disable cache reads and writes entirely |
| `--outdir=PATH` | - | Write output files to PATH instead of default location |
| `--mock` | - | Use fixture data instead of real API calls |
| `--debug` | - | Enable verbose debug logging |
| `--json` | - | Structured envelope output for agents: `{ status, schema_version, data\|error }` |
| `--jsonl` | - | Newline-delimited JSON records |
| `--fields=SPEC` | - | Field projection (only with `--json`, `--jsonl`, or `--emit=json`) |
| `--quiet` | - | Suppress progress display |
| `--version` | - | Print CLI version |
| `-h`, `--help` | - | Show help message |

### Output modes

| Mode | Description |
|------|-------------|
| `compact` | Markdown summary optimized for Claude to synthesize (default) |
| `json` | Raw `Report` dict as JSON (no envelope) |
| `md` | Full markdown report |
| `context` | Writes a reusable context snippet to disk |
| `path` | Prints the path to the context file on disk |

Notes:
- `--json` returns an agent-friendly envelope `{ status, schema_version, data|error }`; `--emit=json` returns the raw report dict
- `--fields` only applies with `--json`, `--jsonl`, or `--emit=json`

### Sources

| Value | Requires |
|-------|----------|
| `auto` | Uses all keys that are configured |
| `reddit` | `OPENAI_API_KEY` |
| `x` | `XAI_API_KEY` |
| `both` | Both keys |
| `web` | No keys required |

### Watch subcommand

Track topics over time. Run history is persisted to a local SQLite database.

```bash
# Add a topic to the watchlist
wots watch add "Claude Code" --every=daily

# List all watched topics
wots watch list

# Remove a topic
wots watch remove "Claude Code"

# Show run history for a topic
wots watch history "Claude Code" --limit=10
```

### Briefing subcommand

Generate a structured briefing from watchlist run history.

```bash
wots briefing "Claude Code" --period=daily
wots briefing "Claude Code" --period=weekly
```

---

## Library Usage

`@side-quest/word-on-the-street` ships a fully-typed barrel export (`src/index.ts`). All core functions are available for programmatic use without side effects.

### Scoring and deduplication

```typescript
import {
  scoreRedditItems,
  scoreXItems,
  scoreYouTubeItems,
  dedupeReddit,
  dedupeX,
  dedupeYouTube,
  sortItems,
} from '@side-quest/word-on-the-street'

const scored = scoreRedditItems(rawItems)
const sorted = sortItems(scored)
const unique = dedupeReddit(scored)
```

### Trend-aware scoring

```typescript
import { computeTrendScores } from '@side-quest/word-on-the-street'

// trendScore = momentum * 0.7 + sourceDiversityBonus * 0.3
const trendScores = computeTrendScores([...redditItems, ...xItems, ...youtubeItems])
```

### YouTube search (requires yt-dlp)

```typescript
import { isYtDlpAvailable, searchYouTube } from '@side-quest/word-on-the-street'

if (isYtDlpAvailable()) {
  const results = await searchYouTube('Claude Code', 30, 'default')
}
```

### Two-phase retrieval orchestration

```typescript
import {
  orchestrate,
  defaultOrchestratorConfig,
} from '@side-quest/word-on-the-street'
import type { SearchAdapter, AdapterSearchConfig } from '@side-quest/word-on-the-street'

const results = await orchestrate(
  adapters,
  config,
  { ...defaultOrchestratorConfig(), strategy: 'two-phase', phase2Budget: 5 },
)
```

### Entity extraction

```typescript
import { extractEntities } from '@side-quest/word-on-the-street'

const entities = extractEntities([...redditItems, ...xItems])
// entities.handles, entities.subreddits, entities.hashtags, entities.terms
```

### Delta detection

```typescript
import { computeDelta } from '@side-quest/word-on-the-street'

const delta = computeDelta(previousEntities, currentEntities)
// delta.newEntities, delta.goneEntities, delta.risingVoices, delta.fallingVoices
```

### Watchlist management

```typescript
import { addTopic, listTopics, removeTopic, recordRun, getHistory } from '@side-quest/word-on-the-street'

await addTopic('Claude Code', 'daily')
const topics = listTopics()
await recordRun('Claude Code', { durationMs: 1200, itemCount: 42, status: 'success', errorMessage: null, summaryJson: null })
const history = getHistory('Claude Code', 10)
```

### Schema types

```typescript
import type {
  Report,
  RedditItem,
  XItem,
  YouTubeItem,
  WebSearchItem,
  Engagement,
  SubScores,
} from '@side-quest/word-on-the-street'
```

---

## Architecture

### The Newsroom Metaphor

The codebase is structured as an editorial newsroom:

```
CLI (Editor-in-Chief)        src/cli.ts
  |
  |-- openai-reddit.ts       Reporter   -> Reddit via OpenAI Responses API
  |-- xai-x.ts               Reporter   -> X/Twitter via xAI Responses API
  |-- youtube.ts             Reporter   -> YouTube via yt-dlp
  |-- websearch.ts           Stringer   -> Delegates to Claude's WebSearch tool
  |-- reddit-enrich.ts       Fact-Check -> Verifies engagement via Reddit JSON API
  |-- entity-extract.ts      Research   -> Extracts @handles, r/subs, #tags, terms
  |-- trend.ts               Analysis   -> Momentum + source diversity scoring
  |-- score.ts + dedupe.ts   Copy Desk  -> Normalizes, ranks, deduplicates
  |-- render.ts              Layout     -> Output: compact, JSON, markdown, context
  |-- retrieval/             Desk       -> Two-phase adapter orchestration
```

### Entry Points

| File | Role |
|------|------|
| `src/index.ts` | Pure barrel export -- no side effects. All library exports. |
| `src/cli.ts` | CLI orchestration and I/O. All side effects live here. |

Both are independent entry points compiled by bunup with code splitting into `dist/`.

### Source Modules (`src/lib/`)

| Module | Responsibility |
|--------|---------------|
| `cache.ts` | Filesystem cache with TTL, versioning, file locking, atomic writes |
| `config.ts` | Loads env vars from `~/.config/wots/.env` |
| `dates.ts` | Date range math, recency scoring |
| `dedupe.ts` | N-gram Jaccard similarity deduplication |
| `delta.ts` | Detects new/gone entities and rising/falling voices between runs |
| `entity-extract.ts` | Extracts @handles, r/subreddits, #hashtags, and repeated terms |
| `http.ts` | Retry logic, rate-limit parsing, error types |
| `intent.ts` | Classifies query intent to tune retrieval policy |
| `models.ts` | Auto-selects latest model from OpenAI/xAI APIs |
| `normalize.ts` | Converts raw API responses to standard schema |
| `openai-reddit.ts` | Reddit search via OpenAI Responses API |
| `reddit-enrich.ts` | Fetches real engagement data from Reddit public JSON |
| `render.ts` | Output formatting (compact, JSON, markdown, context snippet) |
| `retrieval/` | Two-phase orchestrator, query policy, adapter contracts |
| `schema.ts` | TypeScript interfaces + Report factory functions |
| `score.ts` | Multi-factor scoring: relevance x recency x engagement |
| `store.ts` | SQLite database singleton (watchlist persistence) |
| `trend.ts` | Momentum + source diversity scoring |
| `ui.ts` | Terminal progress display |
| `watchlist.ts` | CRUD operations for watched topics and run history |
| `websearch.ts` | Date extraction patterns for web results |
| `xai-x.ts` | X search via xAI Responses API |

### Key Design Decisions

- **WebSearch delegation** -- The CLI outputs structured JSON instructions for Claude to use its WebSearch tool rather than making direct HTTP requests.
- **Versioned cache keys** -- Keys hash topic + source + depth + model + prompt version + date range. Prompt version bumps automatically invalidate stale entries.
- **Stale cache fallback** -- On transient 429 rate-limit errors, entries up to 24 hours old are served rather than failing hard.
- **Deduplication strategies** -- Reddit and X use 3-character N-gram Jaccard similarity at 70% threshold. YouTube uses exact video ID matching because IDs are structural identifiers, not fuzzy text.
- **Trend scoring** -- `trendScore = momentum * 0.7 + sourceDiversityBonus * 0.3`. High-engagement items beat high-keyword-match low-engagement items.
- **Library vs CLI separation** -- `src/index.ts` has no side effects; `src/cli.ts` owns all I/O. They compile to separate entry points.

---

## Development

### Setup

```bash
bun install
bun run dev          # Watch mode (src/index.ts)
```

### Scripts

```bash
# Build
bun run build        # Compile via bunup -> dist/
bun run clean        # Remove dist/

# Quality
bun run lint         # Biome lint check
bun run lint:fix     # Biome lint auto-fix
bun run format       # Biome format (write)
bun run check        # Biome lint + format (write)
bun run typecheck    # tsc --noEmit
bun run validate     # Full pipeline: lint + typecheck + build + test

# Testing
bun test             # Run all tests
bun test --watch     # Watch mode
bun test --coverage  # With coverage
bun run update:baseline  # Regenerate algorithm baseline fixtures

# Package hygiene
bun run hygiene      # publint + attw checks
bun run pack:dry     # Inspect package contents

# Versioning
bun run version:gen  # Interactive changeset generation
```

### Testing

Tests use the Bun native test runner. All test files live in `tests/`.

| File | Scope |
|------|-------|
| `tests/index.test.ts` | Integration tests -- CLI subprocess via `Bun.spawnSync()` |
| `tests/cli-output.test.ts` | CLI output format and envelope contracts |
| `tests/parse-args.test.ts` | Argument parser unit tests |
| `tests/youtube.test.ts` | YouTube parsing, scoring, deduplication, serialization |
| `tests/youtube-adapter.test.ts` | `buildYouTubeSearchArgs` unit tests |
| `tests/entity-extract.test.ts` | Entity extraction logic |
| `tests/trend.test.ts` | Trend scoring and momentum |
| `tests/intent.test.ts` | Intent classification |
| `tests/watchlist.test.ts` | Watchlist CRUD and run history |
| `tests/briefing.test.ts` | Briefing generation and rendering |
| `tests/retrieval-contracts.test.ts` | Retrieval adapter interface contracts |
| `tests/algorithm-baseline.test.ts` | Golden snapshot baseline for scoring + ranking |
| `tests/algorithm-contracts.test.ts` | Scoring, normalization, dedupe contract tests |
| `tests/field-projection.test.ts` | Field projection logic |
| `tests/output.test.ts` | Output envelope helpers |
| `tests/eval-metrics.test.ts` | Evaluation metric functions |
| `tests/eval-oracle.test.ts` | Test oracle |
| `tests/telemetry-contract.test.ts` | Telemetry schema validation |
| `tests/openai-reddit-edge.test.ts` | OpenAI Reddit edge cases |

The `--mock` flag enables fixture-based testing without API keys. Fixtures live in `fixtures/`.

**Coverage gate:** 80% minimum on lines, branches, and functions (enforced in CI).

### Algorithm Baselines

Golden snapshots in `fixtures/algorithm-baseline/` lock scoring and ranking behavior for deterministic fixtures. If algorithm behavior changes intentionally, regenerate the baseline and review the diff:

```bash
bun run update:baseline
```

| Scenario | Required checks | Lock rule |
|----------|-----------------|-----------|
| Model change (policy, pin, fallback order) | Deterministic gate | Lock only with reviewed baseline diff |
| Algorithm refactor (scoring, normalize, dedupe, trend) | Deterministic gate + `bun run update:baseline` | Lock only with reviewed baseline diff |
| Reliability changes (retry/cache/stale fallback) | Deterministic gate | Lock only if deterministic gate passes |
| CLI/reporting/telemetry refactor | Deterministic gate | Lock if deterministic gate passes |
| Docs-only changes | None | No lock workflow required |

### Code Style

- **Formatter:** Biome -- tabs, single quotes, trailing commas, 80-character line width
- **Test files:** 100-character line width
- **TypeScript:** strict mode, `verbatimModuleSyntax`, bundler module resolution
- **JSDoc required** on all exported functions

---

## CI/CD

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `pr-quality.yml` | PR, push to main | Lint, typecheck, tests, 80% coverage gate, shell script lint |
| `publish.yml` | Push to main, manual | Stable releases via changesets with OIDC provenance |
| `release.yml` | Manual | Release coordination |
| `commitlint.yml` | PR | Enforce conventional commits |
| `pr-title.yml` | PR | Validate PR title format |
| `security.yml` | Schedule | OSV dependency scanning |
| `codeql.yml` | Schedule | CodeQL static analysis |
| `dependency-review.yml` | PR | Supply chain security review |
| `dependabot-auto-merge.yml` | Dependabot PR | Auto-merge patch/minor updates |
| `package-hygiene.yml` | PR | publint + attw package correctness checks |
| `workflow-lint.yml` | PR | actionlint on workflow YAML files |
| `dismiss-stale-bot-reviews.yml` | PR synchronize | Auto-dismiss stale bot CHANGES_REQUESTED reviews |
| `version-packages-auto-merge.yml` | Changesets PR | Auto-merge version bump PRs |
| `autogenerate-changeset.yml` | PR | Auto-generate changesets for dependency updates |

Runtime support is Bun-only. Release workflows use Node 24 in CI for npm trusted publishing and Changesets compatibility.

---

## Contributing

All commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) format, enforced by commitlint + Husky:

```
feat: add YouTube source adapter
fix(youtube): honor lookback window and preserve id case in dedupe
docs: rebuild README
```

### Changeset workflow

1. Create a feature branch from `main`
2. Make changes
3. Run `bun run version:gen` to create a changeset
4. Push the branch and open a PR
5. CI checks must pass (lint, typecheck, tests with 80% coverage)
6. Merge the PR -- the Changesets bot opens a "Version Packages" PR
7. Merge the Version PR to trigger publish to npm with provenance signing

---

## License

MIT -- see [LICENSE](./LICENSE).

---

Built by [Nathan Vale](https://github.com/nathanvale)
