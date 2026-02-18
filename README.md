# @side-quest/last-30-days

Research any topic from the last 30 days across Reddit, X, YouTube, and web search. Engagement-ranked results with scoring, deduplication, and trend analysis.

## Installation

```bash
bun add @side-quest/last-30-days
```

Or use as a CLI:

```bash
bunx @side-quest/last-30-days "your topic"
```

## Configuration

API keys are loaded from environment variables or `~/.config/last-30-days/.env`:

```bash
OPENAI_API_KEY=sk-...   # Required for Reddit search (via OpenAI Responses API)
XAI_API_KEY=xai-...     # Required for X search (via xAI Responses API)
```

## CLI Usage

```bash
# Basic search
last-30-days "Claude Code"

# Deep search with JSON output
last-30-days "React Server Components" --deep --emit=json

# News-optimized query with YouTube
last-30-days "GPT-5 release" --query-type=news --include-youtube

# Two-phase search (broad discovery + entity drill-down)
last-30-days "Rust async" --strategy=two-phase

# Quick search, web included
last-30-days "Bun 1.2" --quick --include-web
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--emit=MODE` | `compact` | Output: compact, json, md, context, path |
| `--sources=MODE` | `auto` | Source: auto, reddit, x, both |
| `--days=N` | `30` | Lookback window (1-365) |
| `--quick` | - | Faster with fewer results |
| `--deep` | - | Comprehensive with more results |
| `--include-web` | - | Include web search |
| `--include-youtube` | - | Include YouTube (requires yt-dlp) |
| `--strategy=MODE` | `single` | Search: single, two-phase |
| `--phase2-budget=N` | `5` | Max supplemental queries per source |
| `--query-type=TYPE` | `auto` | Intent: auto, prompting, recommendations, news, general |
| `--telemetry=MODE` | `quiet` | Telemetry: quiet, verbose, file |
| `--refresh` | - | Bypass cache reads |
| `--no-cache` | - | Disable cache entirely |
| `--outdir=PATH` | - | Write output files to PATH |
| `--mock` | - | Use fixture data |
| `--debug` | - | Verbose logging |

### Watchlist

Monitor topics over time with persistent tracking:

```bash
# Add a topic to watch
last-30-days watch add "AI agents" --every=weekly

# List watched topics
last-30-days watch list

# View run history
last-30-days watch history "AI agents" --limit=5

# Remove a topic
last-30-days watch remove "AI agents"
```

### Briefings

Generate briefings from watchlist run history:

```bash
# Daily briefing (compares last 2 runs)
last-30-days briefing "AI agents"

# Weekly briefing (compares last 8 runs)
last-30-days briefing "AI agents" --period=weekly
```

## Architecture

```
CLI (Editor-in-Chief)
  |
  |-- Two-Phase Retrieval
  |     |-- Phase 1: Parallel broad search across all sources
  |     |-- Entity Extraction: @handles, r/subreddits, #hashtags, terms
  |     |-- Phase 2: Entity-driven supplemental search
  |
  |-- Sources (Reporters)
  |     |-- Reddit (via OpenAI Responses API)
  |     |-- X/Twitter (via xAI Responses API)
  |     |-- YouTube (via yt-dlp, opt-in)
  |     |-- Web Search (delegated to Claude)
  |
  |-- Scoring (Copy Desk)
  |     |-- Engagement-weighted scoring per source
  |     |-- Trend scoring (momentum + source diversity)
  |     |-- Intent-aware weight adjustment
  |     |-- N-gram Jaccard deduplication
  |
  |-- Persistence
  |     |-- SQLite watchlist (bun:sqlite)
  |     |-- Delta detection between runs
  |     |-- Briefing generation
  |
  |-- Observability
        |-- Structured telemetry (l30d.run.completed.v1)
        |-- Per-phase latency tracking
        |-- Cache hit/miss metrics
```

## Development

```bash
bun install          # Install dependencies
bun run dev          # Watch mode
bun run build        # Build
bun run validate     # Full pipeline: lint + typecheck + build + test
bun run eval         # Benchmark harness
bun run eval:pr      # Regression check against baseline
```

## License

MIT
