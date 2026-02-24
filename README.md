# @side-quest/last-30-days

[![npm version](https://img.shields.io/npm/v/@side-quest/last-30-days)](https://www.npmjs.com/package/@side-quest/last-30-days)
[![CI](https://github.com/nathanvale/side-quest-last-30-days/actions/workflows/pr-quality.yml/badge.svg)](https://github.com/nathanvale/side-quest-last-30-days/actions/workflows/pr-quality.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Bun >=1.2](https://img.shields.io/badge/bun-%3E%3D1.2-brightgreen)](https://bun.sh)

Research any topic from the last 30 days across Reddit, X, YouTube, and web -- engagement-ranked results.

---

## Features

- **Multi-source search** -- Reddit (via OpenAI Responses API), X/Twitter (via xAI Responses API), YouTube (via yt-dlp), and general web search
- **Engagement-ranked results** -- multi-factor scoring: relevance x recency x engagement, with trend-aware momentum scoring
- **Smart deduplication** -- N-gram Jaccard similarity (70% threshold) for Reddit/X; exact video-ID matching for YouTube
- **Two-phase retrieval** -- phase 1 parallel search + optional phase 2 entity-driven supplemental queries
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

Both API keys are optional -- the CLI falls back gracefully to whatever sources are available.

---

## Installation

```bash
# bun (global CLI)
bun add -g @side-quest/last-30-days

# Library only (no global install)
bun add @side-quest/last-30-days
```

---

## Quick Start

```bash
# Research a topic using all available sources
last-30-days "Claude Code"

# Deep search with JSON output
last-30-days "React Server Components" --deep --emit=json

# Reddit only, last 7 days
last-30-days "Bun 1.2" --sources=reddit --days=7

# Include YouTube results
last-30-days "AI agents" --include-youtube --emit=json

# Two-phase retrieval (extracts entities from phase 1, runs supplemental queries)
last-30-days "TypeScript 5.9" --strategy=two-phase
```

---

## Configuration

API keys are loaded from environment variables first, then from `~/.config/last-30-days/.env`.

```bash
# ~/.config/last-30-days/.env
OPENAI_API_KEY=sk-...
XAI_API_KEY=xai-...

# Optional: pin or control model selection
OPENAI_MODEL_POLICY=auto          # auto | pinned
OPENAI_MODEL_PIN=gpt-5            # only used when policy=pinned
XAI_MODEL_POLICY=latest           # latest | stable
XAI_MODEL_PIN=grok-4-1-fast       # only used when policy=pinned

# Optional: override cache TTL (hours)
LAST_30_DAYS_CACHE_TTL=1
```

Cache files live at `~/.cache/last-30-days/`. Output files (context mode) write to `~/.local/share/last-30-days/out/`.

---

## CLI Reference

```
last-30-days <topic> [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--emit=MODE` | `compact` | Output format: `compact`, `json`, `md`, `context`, `path` |
| `--sources=MODE` | `auto` | Source selection: `auto`, `reddit`, `x`, `both`, `web` |
| `--days=N` | `30` | Lookback window in days (1-365) |
| `--quick` | - | Fewer results, faster |
| `--deep` | - | More results, comprehensive |
| `--include-web` | - | Add general web search alongside Reddit/X |
| `--include-youtube` | - | Add YouTube video search (requires yt-dlp) |
| `--strategy=MODE` | `single` | Search strategy: `single` or `two-phase` |
| `--phase2-budget=N` | `5` | Max supplemental queries per source in phase 2 (1-50) |
| `--refresh` | - | Bypass cache reads, force fresh search |
| `--no-cache` | - | Disable cache reads and writes entirely |
| `--outdir=PATH` | - | Write output files to PATH instead of default location |
| `--mock` | - | Use fixture data instead of real API calls |
| `--debug` | - | Enable verbose debug logging |
| `-h`, `--help` | - | Show help message |

### Output modes

| Mode | Description |
|------|-------------|
| `compact` | Markdown summary optimized for Claude to synthesize (default) |
| `json` | Full `Report` object as JSON |
| `md` | Full markdown report |
| `context` | Writes a reusable context snippet to disk |
| `path` | Prints the path to the context file on disk |

### Sources

| Value | Requirement |
|-------|-------------|
| `auto` | Uses all keys that are configured |
| `reddit` | `OPENAI_API_KEY` |
| `x` | `XAI_API_KEY` |
| `both` | Both keys |
| `web` | No keys required (web-search fallback) |

---

## Library Usage

`@side-quest/last-30-days` ships a fully-typed barrel export. All core functions are available for programmatic use.

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
} from '@side-quest/last-30-days'

const scored = scoreRedditItems(rawItems)
const sorted = sortItems(scored)
const unique = dedupeReddit(scored)
```

### Trend-aware scoring

```typescript
import { computeTrendScores } from '@side-quest/last-30-days'

const trendScores = computeTrendScores([...redditItems, ...xItems, ...youtubeItems])
```

### YouTube search (requires yt-dlp)

```typescript
import { isYtDlpAvailable, searchYouTube } from '@side-quest/last-30-days'

if (isYtDlpAvailable()) {
  const results = await searchYouTube('Claude Code', 30, 'default')
}
```

### Two-phase retrieval orchestration

```typescript
import {
  orchestrate,
  defaultOrchestratorConfig,
} from '@side-quest/last-30-days'
import type { SearchAdapter, AdapterSearchConfig } from '@side-quest/last-30-days'

const results = await orchestrate(
  adapters,
  config,
  { ...defaultOrchestratorConfig(), strategy: 'two-phase', phase2Budget: 5 },
)
```

### Entity extraction

```typescript
import { extractEntities } from '@side-quest/last-30-days'

const entities = extractEntities([...redditItems, ...xItems])
// entities.handles, entities.subreddits, entities.hashtags, entities.terms
```

### Schema types

```typescript
import type {
  Report,
  RedditItem,
  XItem,
  YouTubeItem,
  WebSearchItem,
} from '@side-quest/last-30-days'
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

Both are independent entry points compiled by bunup with code splitting.

### Key Design Decisions

- **WebSearch delegation** -- The CLI outputs structured JSON instructions for Claude to use its WebSearch tool. It does not search the web itself.
- **Versioned cache keys** -- Keys hash topic + source + depth + model + prompt version + date range.
- **Stale cache fallback** -- On transient 429 rate-limit errors, cache entries up to 24 hours old are served rather than failing hard.
- **Deduplication strategies** -- Reddit and X use 3-character N-gram Jaccard similarity at 70% threshold. YouTube uses exact video ID matching because IDs are structural identifiers, not fuzzy text.
- **Trend scoring** -- `trendScore = momentum * 0.7 + sourceDiversityBonus * 0.3`. High-engagement items beat high-keyword-match low-engagement items.

---

## Development

### Setup

```bash
bun install
bun run dev          # Watch mode
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
| `tests/youtube.test.ts` | YouTube parsing, scoring, deduplication, serialization |
| `tests/youtube-adapter.test.ts` | `buildYouTubeSearchArgs` unit tests |
| `tests/entity-extract.test.ts` | Entity extraction logic |
| `tests/trend.test.ts` | Trend scoring and momentum |
| `tests/retrieval-contracts.test.ts` | Retrieval adapter interface contracts |
| `tests/eval-metrics.test.ts` | Evaluation metric functions |
| `tests/eval-oracle.test.ts` | Test oracle |
| `tests/telemetry-contract.test.ts` | Telemetry schema validation |
| `tests/algorithm-baseline.test.ts` | Golden snapshot baseline for scoring + ranking |
| `tests/algorithm-contracts.test.ts` | Scoring, normalization, dedupe contract tests |

The `--mock` flag enables fixture-based testing without API keys. Fixtures live in `fixtures/`.

**Coverage gate:** 80% minimum on lines, branches, and functions (enforced in CI).

### Algorithm Baselines

Golden snapshots lock scoring + ranking behavior for deterministic fixtures in
`fixtures/algorithm-baseline/`. If algorithm behavior changes intentionally,
regenerate the baseline and review the diff:

```bash
bun run update:baseline
```

### Lock Runbook (Scenario-Based)

Use this workflow to decide whether a change is safe to lock as baseline.

Deterministic gate (always required):

```bash
bun run typecheck
bun test --recursive
bun run compare:legacy
```

Live reliability gate (required for retrieval/runtime behavior changes):

```bash
bun run eval:matrix --topicLimit=10 --repeats=1 --timeoutMs=45000
# optional stricter confidence pass
bun run eval:matrix --topicLimit=10 --repeats=3 --timeoutMs=60000
```

Debug when Reddit drops to zero:

```bash
bun run eval:reddit:debug --topic="React Server Components vulnerability" --days=30
```

Scenario playbook:

| Scenario | Required checks | Lock rule |
|----------|------------------|-----------|
| OpenAI/xAI model change (policy, pin, fallback order, prompt model hints) | Deterministic gate + live reliability gate | Lock only if matrix gate passes and no new catastrophic zero-rate regression |
| Algorithm refactor (scoring, normalize, dedupe, date filtering, trend) | Deterministic gate + baseline update (`bun run update:baseline`) + live reliability gate | Lock only with reviewed baseline diff and passing matrix gate |
| Reliability-only changes (retry/backoff/cache/stale fallback/timeout) | Deterministic gate + live reliability gate | Lock only if reliability gates improve or remain non-regressive |
| CLI/reporting/telemetry refactor (no ranking logic changes) | Deterministic gate | Lock if deterministic gate passes; live matrix optional but recommended |
| Docs-only changes | none | No lock workflow required |

Primary lock artifact:

- `docs/issues/2026-02-23-algorithm-winner-scorecard.md`

Primary matrix artifacts:

- `reports/live-compare.matrix-*.assessment.json`
- `reports/live-compare.matrix-*.json`
- `reports/live-compare.matrix-*.csv`

### Live -> Fixture Transition Plan (Cost-Controlled)

Goal: build confidence with live data, then stop continuous API spend.

Phase 1: Burn-in (time-boxed, live)

- Run live matrix nightly for a short window only.
- Exit criteria: `7` consecutive nightly passes, or `10` total passing runs.
- Command:

```bash
bun run eval:matrix --topicLimit=10 --repeats=2 --timeoutMs=90000
```

Phase 2: Lock baseline

- Freeze winner decision in scorecard.
- Freeze deterministic fixtures as baseline (`fixtures/algorithm-baseline/`).
- Keep lock artifacts (`*.assessment.json`, `*.json`, `*.csv`, visuals markdown).

Phase 3: Pivot to fixture-first nightly (no API keys)

- Nightly CI runs deterministic checks only:
  - `bun run typecheck`
  - `bun test --recursive`
  - `bun run compare:legacy`
- No OpenAI/xAI keys required for this nightly path.

Phase 4: Low-cost live sentinel

- Run live sentinel weekly (or manual), not nightly.
- Scope: `2` topics, `1` repeat.
- Command:

```bash
bun run eval:live --repeats=1 --sources=reddit,x --topics="Bun runtime|TypeScript 5.9" --refresh --timeoutMs=90000 --out=reports/live-compare.sentinel.json --csv=reports/live-compare.sentinel.csv
```

Re-open full live matrix only when:

- OpenAI/xAI model policy/pin changes,
- retrieval/scoring/date/dedupe logic changes,
- sentinel fails twice consecutively,
- or maintainer explicitly requests a fresh lock reassessment.

### Local Smoke Tests (Current vs Legacy)

Use live APIs to sanity-check the algorithm “in the wild”. Run locally only.

1. Choose 3–5 active topics (example: Bun 1.3 features, React Server Components security fixes, Node.js 24/25 release changes).
2. Run current repo for each topic (same date window): `last-30-days "Bun 1.3 features" --emit=json --include-web`.
3. Run legacy repo for the same topics and flags.
4. Save outputs to `reports/smoke/current/` and `reports/smoke/legacy/`.
5. Compare top‑10 overlap and any obvious ranking regressions.

### Code Style

- **Formatter:** Biome -- tabs, single quotes, trailing commas, 80-character line width
- **Test files:** 100-character line width
- **TypeScript:** strict mode, `verbatimModuleSyntax`, bundler module resolution
- **JSDoc required** on all exported functions

---

## CI/CD

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `pr-quality.yml` | PR, push to main | Lint, typecheck, tests, coverage gate (80%), shell script lint |
| `publish.yml` | Push to main, manual | Stable releases (changesets), pre-releases, canary snapshots |
| `commitlint.yml` | PR | Enforce conventional commits |
| `pr-title.yml` | PR | Validate PR title format |
| `security.yml` | Schedule | OSV dependency scanning |
| `codeql.yml` | Schedule | CodeQL static analysis |
| `dependency-review.yml` | PR | Supply chain security review |
| `dependabot-auto-merge.yml` | Dependabot PR | Auto-merge patch/minor updates |
| `dismiss-stale-bot-reviews.yml` | PR synchronize | Auto-dismiss stale bot CHANGES_REQUESTED reviews |
| `package-hygiene.yml` | PR | publint + attw package correctness |
| `workflow-lint.yml` | PR | actionlint on workflow files |
| `reliability-nightly-fixture.yml` | Daily schedule, manual | Fixture-first confidence checks (no API keys) |
| `reliability-weekly-sentinel.yml` | Weekly schedule, manual | Low-cost live sentinel matrix (small topic set) |
| `reliability-nightly.yml` | Manual | Full live matrix reassessment (on demand) |

Runtime support is Bun-only. Release workflows still use Node 24 in CI for npm trusted publishing and Changesets compatibility.

---

## Contributing

All commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) format, enforced by commitlint + Husky:

```
feat: add YouTube source adapter
fix(youtube): honor lookback window and preserve id case in dedupe
docs: rebuild CLAUDE.md
```

### Changeset workflow

1. Create a feature branch from `main`
2. Make changes
3. Run `bun run version:gen` to create a changeset
4. Push the branch and open a PR
5. CI checks must pass (lint, typecheck, tests with 80% coverage)
6. Merge the PR -- the Changesets bot opens a "Version Packages" PR
7. Merge the Version PR to trigger publish to npm

---

## License

MIT -- see [LICENSE](./LICENSE).

---

Built by [Nathan Vale](https://github.com/nathanvale)
