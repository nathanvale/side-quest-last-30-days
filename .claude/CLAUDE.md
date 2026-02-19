# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`@side-quest/last-30-days` -- a CLI + library that researches any topic from the last 30 days across Reddit, X, and web search, returning engagement-ranked results. Single package (not a monorepo), published to npm with provenance signing.

## Commands

```bash
# Development
bun install                    # Install dependencies
bun run dev                    # Watch mode (src/index.ts)
bun run build                  # Compile via bunup -> dist/

# Quality
bun run lint                   # Biome lint check
bun run lint:fix               # Biome lint auto-fix
bun run format                 # Biome format
bun run check                  # Biome lint + format (write)
bun run typecheck              # tsc --noEmit (uses tsconfig.eslint.json)
bun run validate               # Full pipeline: lint + typecheck + build + test

# Testing
bun test                       # Run all tests
bun test --watch               # Watch mode
bun test --coverage            # With coverage
bun test tests/index.test.ts   # Single test file

# Package hygiene
bun run hygiene                # publint + attw checks
bun run pack:dry               # Inspect package contents

# Versioning
bun run version:gen            # Interactive changeset generation
```

## Architecture

### Newsroom Metaphor

The codebase follows an editorial newsroom pattern:

```
CLI (Editor-in-Chief) -- src/cli.ts
  |-- openai-reddit.ts (Reporter)    -> OpenAI Responses API for Reddit
  |-- xai-x.ts (Reporter)           -> xAI Responses API for X/Twitter
  |-- websearch.ts (Stringer)       -> Delegates to Claude's WebSearch tool
  |-- reddit-enrich.ts (Fact-Check) -> Verifies via Reddit public JSON
  |-- score.ts + dedupe.ts (Copy Desk) -> Normalizes, ranks, deduplicates
  |-- render.ts (Layout)            -> Output: compact, JSON, markdown, context
```

### Key Design Decisions

- **Library vs CLI separation**: `src/index.ts` is a pure barrel export (no side effects). `src/cli.ts` contains all orchestration and I/O. They are independent entry points.
- **WebSearch delegation**: The CLI doesn't search the web itself. It outputs structured JSON instructions for Claude to use its WebSearch tool. This is intentional.
- **Versioned cache keys**: Cache keys hash topic + source + depth + model + prompt version + date range. Stale cache (5+ days old) is served as fallback on transient rate-limit errors.
- **Cache concurrency**: File locking + atomic writes prevent thundering herd on cache misses.
- **N-gram deduplication**: Uses 3-character grams with Jaccard similarity at 70% threshold (not simple string matching).
- **Scoring philosophy**: Engagement weight > relevance weight. High-upvote posts beat high-keyword-match low-engagement posts.
- **Error classification**: Transient 429 (rate-limit) triggers stale cache fallback. Non-transient errors (quota, billing) fail hard.
- **--mock mode**: Loads fixtures from `fixtures/` directory, simulates having API keys. Used in tests and local dev.

### Source Modules (src/lib/)

| Module | Responsibility |
|--------|---------------|
| cache.ts | Filesystem cache with TTL, versioning, concurrency safety |
| config.ts | Loads env vars from `~/.config/last-30-days/.env` |
| dates.ts | Date range math, recency scoring |
| dedupe.ts | N-gram Jaccard similarity deduplication |
| http.ts | Retry logic, rate-limit parsing, error types |
| models.ts | Auto-selects latest model from OpenAI/xAI APIs |
| normalize.ts | Converts raw API responses to standard schema |
| openai-reddit.ts | Reddit search via OpenAI Responses API |
| reddit-enrich.ts | Fetches real engagement data from Reddit JSON |
| render.ts | Output formatting (compact, JSON, markdown, context snippet) |
| schema.ts | TypeScript interfaces + Report factory |
| score.ts | Multi-factor scoring: relevance x recency x engagement |
| ui.ts | Terminal progress display |
| websearch.ts | Date extraction patterns for web results |
| xai-x.ts | X search via xAI Responses API |

## Code Style

- **Formatter**: Biome (tabs, single quotes, semicolons as-needed, trailing commas)
- **Line width**: 80 default, 100 for test files
- **Never create nested biome.json** -- single root config only
- **TypeScript strict mode** with `verbatimModuleSyntax` and bundler module resolution
- **No runtime dependencies** except `@side-quest/core` -- uses native `fetch`, `node:fs`, built-in JSON
- **JSDoc required** on all exported functions

## Testing

Core CLI subprocess coverage lives in `tests/index.test.ts` (currently 1000+ lines, Bun native test runner). New test files should stay focused and only add subprocess coverage where it materially improves confidence. The `--mock` flag enables fixture-based testing without API keys.

## CI/CD

GitHub Actions with Changesets workflow:
- PRs run lint, typecheck, build, test (`pr-quality.yml`)
- Conventional commits enforced via commitlint
- Merging changesets to main triggers auto-publish to npm with OIDC provenance
- CodeQL + Trivy security scanning on schedule

## CLI Usage

```bash
last-30-days "topic" --days=7 --emit=json --outdir=/tmp/out --mock
```

Config lives at `~/.config/last-30-days/.env` (OPENAI_API_KEY, XAI_API_KEY).
