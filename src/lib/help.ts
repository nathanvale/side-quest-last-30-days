/**
 * Topic-based help system for the wots CLI.
 *
 * Topics:
 * - `overview` (default) - Full usage with all flags
 * - `sources` - Source selection, API key setup
 * - `output` - Output modes, --json envelope, --jsonl streaming, --fields
 * - `contract` - Exit codes, JSON envelope schema, error codes (agent self-docs)
 */

import {
	EXIT_CONFLICT,
	EXIT_INTERRUPTED,
	EXIT_NOT_FOUND,
	EXIT_OK,
	EXIT_RUNTIME,
	EXIT_UNAUTHORIZED,
	EXIT_USAGE,
} from './exit-codes.js'

/** Valid help topic names. */
export const HELP_TOPICS = [
	'overview',
	'sources',
	'output',
	'contract',
] as const
export type HelpTopic = (typeof HELP_TOPICS)[number]

/** Check whether a string is a valid help topic. */
export function isValidHelpTopic(topic: string): topic is HelpTopic {
	return (HELP_TOPICS as readonly string[]).includes(topic)
}

/** Render help text for the overview topic. */
function renderOverview(): string {
	return `wots - Research any topic from the last 30 days across Reddit, X, and web.

Usage:
  wots <topic> [options]
  wots help [topic]

Output Modes:
  --emit=compact     (default) Scored markdown with URLs, engagement, relevance
                     Best for: AI agents synthesizing a response (~1-2K tokens)
  --emit=json        Full report as raw JSON dict (no envelope)
                     Best for: programmatic parsing, all fields included (~3-5K tokens)
  --emit=md          Verbose markdown with blockquoted text, all fields
                     Best for: humans reading directly (~4-8K tokens)
  --emit=context     Minimal top-7 sources by score, no engagement data
                     Best for: injecting into system prompts (~300-500 tokens)
  --emit=path        Print filesystem path to cached context file
  --json             JSON envelope: { status, schema_version, data|error }
                     Best for: machine-to-machine with structured error handling
  --jsonl            Streaming JSONL: one item per line + meta line
                     Best for: piping to jq, real-time processing

  NOTE: When stdout is piped (not a TTY), auto-switches to --json --quiet.
  Override with any explicit --emit to disable auto-detection.

Options:
  --quiet            Suppress progress display on stderr
  --non-interactive  Force non-TTY behavior (same as piped output)
  --fields=X,Y,Z    Project specific fields in JSON/JSONL/--emit=json output
  --sources=MODE     Source selection (default: auto)
                       auto     Use all available API keys
                       reddit   Reddit only (requires OPENAI_API_KEY)
                       x        X/Twitter only (requires XAI_API_KEY)
                       both     Reddit + X (requires both keys)
  --days=N           Lookback window in days (default: 30, range: 1-365)
  --quick            Faster research with fewer results
  --deep             Comprehensive research with more results
  --fast             Pin OpenAI model to gpt-4o (speed over breadth)
  --cheap            Pin OpenAI model to gpt-4o-mini-search-preview (lowest cost)
  --include-web      Include general web search alongside Reddit/X
  --include-youtube  Include YouTube video search (requires yt-dlp)
  --refresh          Bypass cache reads and force fresh search
  --no-cache         Disable cache reads and writes
  --outdir=PATH      Write output files to PATH instead of default location
  --strategy=MODE    Search strategy (default: single)
                       single     Phase 1 only (backward-compatible)
                       two-phase  Phase 1 + entity-driven supplemental
  --phase2-budget=N  Max supplemental queries per source (default: 5, range: 1-50)
  --query-type=TYPE  Query intent (default: auto)
                       auto            Auto-detect from topic
                       prompting       Optimized for how-to/technique queries
                       recommendations Best-of/comparison queries
                       news            Breaking/latest queries
                       general         Default balanced weights
  --mock             Use fixture data instead of real API calls
  --debug            Enable verbose debug logging
  --version          Print CLI version
  -h, --help         Show this help message

Config:
  API keys are loaded from environment variables or ~/.config/wots/.env
    OPENAI_API_KEY   Required for Reddit search (via OpenAI Responses API)
    XAI_API_KEY      Required for X search (via xAI Responses API)
  OpenAI model defaults to pinned gpt-4o-search-preview unless overridden

Examples:
  wots "Claude Code"
  wots "React Server Components" --deep --emit=json
  wots "Bun 1.2" --sources=reddit --include-web
  wots "Bun 1.2" --days=7 --json --quiet

  Agent examples:
  wots "topic" --emit=compact         # agent synthesizing for user
  wots "topic" --json --quiet          # machine-to-machine
  wots "topic" --jsonl --fields=score,title,url  # minimal streaming

Help topics:
  wots help sources   API keys and source selection
  wots help output    Output modes, field lists, and formatting
  wots help contract  Exit codes, schemas, error codes (for agents)

Watch subcommands:
  wots watch add "topic" [--every=daily|weekly]
  wots watch list
  wots watch remove "topic"
  wots watch history "topic" [--limit=10]

Briefing subcommands:
  wots briefing "topic" [--period=daily|weekly]`
}

/** Render help text for the sources topic. */
function renderSources(): string {
	return `wots help sources - API Keys and Source Selection

Sources:
  --sources=auto     (default) Use all available API keys
  --sources=reddit   Reddit only via OpenAI Responses API
  --sources=x        X/Twitter only via xAI Responses API
  --sources=both     Reddit + X (requires both keys)
  --sources=web      Web-only mode (delegates to Claude's WebSearch tool)
  --include-web      Add web search alongside Reddit/X
  --include-youtube  Add YouTube search (requires yt-dlp)

API Keys:
  Set in environment variables or ~/.config/wots/.env:

    OPENAI_API_KEY   Required for --sources=reddit or --sources=both
    XAI_API_KEY      Required for --sources=x or --sources=both

  With --sources=auto:
    - Both keys set: searches Reddit + X
    - Only OPENAI_API_KEY: searches Reddit only
    - Only XAI_API_KEY: searches X only
    - Neither key: falls back to web-only mode

YouTube:
  --include-youtube requires yt-dlp to be installed:
    brew install yt-dlp   (macOS)
    pip install yt-dlp    (pip)`
}

/** Render help text for the output topic. */
function renderOutput(): string {
	return `wots help output - Output Modes and Formatting

Choosing a Mode:
  Agent synthesizing for a user?   --emit=compact  (default, recommended)
  Parsing output programmatically? --json --quiet
  Streaming to another process?    --jsonl --fields=score,title,url
  Injecting into a system prompt?  --emit=context
  Human reading the report?        --emit=md

Output Modes (mutually exclusive):

  --emit=compact     (default) Scored markdown: top 15 items with score, URL,
                     subreddit/handle, date, engagement stats, why_relevant.
                     ~1-2K tokens. Best mode for AI agent consumption.

  --emit=json        Full report as raw JSON dict (no envelope).
                     All fields: engagement, subs, top_comments, comment_insights.
                     ~3-5K tokens. Use --fields to reduce.

  --emit=md          Verbose markdown with blockquoted full text, all metadata.
                     ~4-8K tokens. Designed for humans, not agents.

  --emit=context     Minimal: top 7 sources by score, source type + title only.
                     ~300-500 tokens. No URLs, no engagement, no why_relevant.

  --emit=path        Print filesystem path to wots.context.md file.

  --json             JSON envelope wrapping full report (includes schema_version):
                       Success: { "status": "data", "schema_version": "1", "data": { ... } }
                       Error:   { "status": "error", "schema_version": "1", "message": "...", "error": {...} }
                     Includes all fields from --emit=json plus status wrapper.

  --jsonl            Streaming JSONL: one JSON object per line.
                     Last line is always a meta object with status="meta".
                     Note: --fields only works with --json, --jsonl, or --emit=json.

Auto-Detection (important for agents):
  When stdout is NOT a TTY (piped), the CLI auto-switches to --json --quiet.
  This means agents calling via Bash get JSON by default.
  Override: pass any explicit --emit to disable auto-detection.
  Force non-TTY: --non-interactive

Fields per Mode:

  compact includes per item:
    Reddit: id, score, subreddit, date, date_confidence, engagement{score,num_comments},
            title, url, why_relevant, comment_insights (top 3)
    X:      id, score, author_handle, date, date_confidence, engagement{likes,reposts},
            text (first 200 chars), url, why_relevant
    Web:    id, score, source_domain, date, title, url, snippet (first 150 chars), why_relevant
    YouTube: id, score, channel, date, views, likes, title, url, why_relevant

  json/--json includes all of the above plus:
    subs{relevance,recency,engagement}, relevance (raw float), top_comments[],
    full text (not truncated), trend_score, momentum, report metadata

  context includes per item:
    source type, title/text (first 50 chars) -- no URLs, no scores, no engagement

--fields Projection:
  Reduces output to only specified fields (works with --json, --jsonl, --emit=json):
    --fields=score,title,url
    --fields=score,engagement.likes,url
  Note: using --fields with non-JSON emit modes returns a CONFLICT_FLAGS error.

--json Envelope Example:
    {
      "status": "data",
      "schema_version": "1",
      "data": {
        "topic": "...",
        "days": 30,
        "reddit": [...],
        "x": [...]
      }
    }

--jsonl Streaming Example:
    {"source":"reddit","id":"r1","title":"...","score":85}
    {"source":"x","id":"x1","text":"...","score":78}
    {"status":"meta","topic":"...","reddit_count":10,"x_count":8}

Progress Control:
  --quiet              Suppress all progress output on stderr
  --non-interactive    Force non-TTY behavior regardless of terminal`
}

/** Render help text for the contract topic (agent self-docs). */
function renderContract(): string {
	return `wots help contract - Agent Interface Contract

Quick Start for Agents:
  # Best for agent synthesis (recommended):
  wots "topic" --emit=compact
  # Machine-to-machine with error handling:
  wots "topic" --json --quiet
  # Minimal streaming:
  wots "topic" --jsonl --fields=score,title,url --quiet

Auto-Detection (read this first):
  When stdout is NOT a TTY (piped/subprocessed), the CLI auto-switches to
  --json --quiet. This means agents calling via Bash get JSON envelope by
  default without asking for it.

  To get compact markdown instead, pass --emit=compact explicitly.
  To force non-TTY behavior in a TTY: --non-interactive

Exit Codes:
  ${EXIT_OK}    EXIT_OK           Success (stdout has data)
  ${EXIT_RUNTIME}    EXIT_RUNTIME      API errors, unexpected failures
  ${EXIT_USAGE}    EXIT_USAGE        Bad arguments, unknown flags, invalid values
  ${EXIT_NOT_FOUND}    EXIT_NOT_FOUND    Zero results for topic (not an API error)
  ${EXIT_UNAUTHORIZED}    EXIT_UNAUTHORIZED  Missing/invalid API key for required source
  ${EXIT_CONFLICT}    EXIT_CONFLICT     Conflicting flags (e.g. --quick + --deep)
  ${EXIT_INTERRUPTED}  EXIT_INTERRUPTED  SIGINT (Ctrl-C)

  Agents should check exit code before parsing stdout.
  Exit 0 = parse stdout. Exit 1-5 = read stdout (JSON envelope) and stderr (duplicate).

JSON Envelope (--json):
  Success: { "status": "data", "schema_version": "1", "data": { ... } }
  Error:   { "status": "error", "schema_version": "1", "message": "...", "error": { "name": "CliError", "code": "..." } }

  Partial success: If Reddit fails but X succeeds (or vice versa), exit code
  is still 0. Check data.reddit_error / data.x_error for per-source errors.

Error Codes:
  UNKNOWN_FLAG        Unknown CLI flag
  INVALID_EMIT        Invalid --emit value
  INVALID_SOURCES     Invalid --sources value
  INVALID_STRATEGY    Invalid --strategy value
  INVALID_DAYS        Invalid --days value
  INVALID_BUDGET      Invalid --phase2-budget value
  INVALID_QUERY_TYPE  Invalid --query-type value
  INVALID_PERIOD      Invalid --period value
  INVALID_EVERY       Invalid --every value
  INVALID_LIMIT       Invalid --limit value
  INVALID_OUTDIR      Invalid --outdir path
  MISSING_TOPIC       No topic provided
  MISSING_API_KEY     Required API key not set
  CONFLICT_QUICK_DEEP --quick and --deep used together
  CONFLICT_FAST_CHEAP --fast and --cheap used together
  CONFLICT_FLAGS      Mutually exclusive flags (e.g. --json + --jsonl)
  UNKNOWN_SUBCOMMAND  Unknown subcommand
  UNKNOWN_HELP_TOPIC  Unknown help topic
  NOT_FOUND           Reserved (planned: zero results for topic)
  API_ERROR           Reserved (planned: API call failed)
  RUNTIME_ERROR       Unexpected error

Caching:
  Results are cached by topic + source + depth + model + date range.
  Stale cache (5+ days) is served as fallback on transient 429 errors.
  Use --refresh to bypass cache reads. Use --no-cache to disable entirely.
  Check data.from_cache and data.cache_age_hours in JSON output.`
}

/**
 * Render help text for a given topic.
 *
 * @param topic - The help topic to render. Defaults to 'overview'.
 * @returns The help text as a string.
 */
export function renderHelp(topic: string = 'overview'): string {
	switch (topic) {
		case 'sources':
			return renderSources()
		case 'output':
			return renderOutput()
		case 'contract':
			return renderContract()
		default:
			return renderOverview()
	}
}
