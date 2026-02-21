# last-30-days: The Story Behind the Code

*What happens when you teach an LLM to be a research assistant, then teach it to fact-check itself.*

---

## The Problem We're Actually Solving

You want to know what people are saying about a topic *right now* -- not what Google's SEO-optimized results think you should read, not what a chatbot hallucinated from 2023 training data, but what actual humans typed on Reddit and X in the last 30 days, ranked by how much other humans cared.

The core insight: **engagement is a better signal than relevance scores.** A post with 500 upvotes and 200 comments tells you more about community sentiment than ten keyword-matched articles. But engagement data doesn't live in search APIs -- it lives on the platforms themselves.

So last-30-days does something unusual: it uses LLMs *as search engines*, then goes behind their back to verify the results.

---

## The Architecture: A Newsroom

Think of this tool like a small newsroom.

```
                          ┌─────────────────┐
                          │    cli.ts        │  Editor-in-Chief
                          │  (orchestrator)  │  Coordinates everything
                          └──────┬──────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                   │
      ┌───────▼───────┐  ┌──────▼──────┐    ┌──────▼──────┐
      │ openai-reddit  │  │   xai-x     │    │  websearch  │
      │  (reporter 1)  │  │ (reporter 2)│    │ (stringer)  │
      └───────┬───────┘  └──────┬──────┘    └──────┬──────┘
              │                  │                   │
      ┌───────▼───────┐         │                   │
      │ reddit-enrich  │         │            Claude does this
      │ (fact-checker) │         │            part in-process
      └───────┬───────┘         │                   │
              │                  │                   │
      ┌───────▼──────────────────▼───────────────────▼──┐
      │                normalize + score + dedupe        │
      │                    (copy desk)                   │
      └──────────────────────┬──────────────────────────┘
                             │
                     ┌───────▼───────┐
                     │    render     │
                     │  (publisher)  │
                     └───────────────┘
```

**The reporters** (openai-reddit, xai-x) are LLMs with search tools. You give them a topic, they come back with leads. But like any reporter, they sometimes get details wrong -- engagement numbers especially.

**The fact-checker** (reddit-enrich) doesn't trust the reporters. It goes directly to `reddit.com/<post>.json` and fetches the *real* upvotes, comments, and upvote ratios. No API key needed -- Reddit's public JSON endpoint is free.

**The stringer** (websearch) is interesting. The CLI can't actually search the web itself -- it runs as a subprocess. So instead of faking it, it prints structured instructions to stdout telling Claude: "Hey, use your WebSearch tool to find these things." Architecturally honest delegation.

**The copy desk** (normalize, score, dedupe) standardizes everything into a `Report`, assigns weighted scores, and removes duplicates. This is where the "engagement is signal" philosophy becomes math.

### Why This Separation Matters

Each module has one job. `score.ts` doesn't know about HTTP. `http.ts` doesn't know about Reddit. This makes the pipeline testable without mocking the entire world -- you can unit test scoring with fake data, test HTTP retry logic without a real server, and test deduplication with synthetic posts.

It also means the library (`index.ts`) and CLI (`cli.ts`) can share all the logic without either one depending on the other. `index.ts` is a pure barrel re-export -- no side effects, no `process.exit()`, fully tree-shakeable. The `sideEffects: false` flag in `package.json` tells bundlers they can safely dead-code-eliminate any unused exports.

---

## The Technical Stack (And Why Each Piece)

### Bun

Runtime + package manager + test runner + bundler ecosystem. The CLI ships as `bunx --bun @side-quest/last-30-days`, and every millisecond of cold-start matters when Claude agents spawn it as a subprocess. Bun's startup time is the reason this works as a sub-agent tool at all.

### bunup

Bun-native build tool (alternative to tsup). Handles the dual entry point problem: `cli.ts` and `index.ts` both compile to `dist/`, with `splitting: true` so shared `lib/` code isn't duplicated. Also emits `.d.ts` files so consumers get type checking.

### Biome

Replaces ESLint + Prettier. One tool, one config file, faster than both combined. The project rule is explicit: **never create nested `biome.json` files.** Single root config only.

### Zero runtime dependencies (almost)

The only runtime dependency is `@side-quest/core` (shared utilities). No axios, no lodash, no zod. HTTP is native `fetch`. File I/O is `node:fs`. JSON parsing is built-in. This is deliberate -- a lean dependency tree means fast `bunx` cold-starts and fewer supply chain attack surfaces.

### Changesets

Semantic versioning workflow. Every user-facing change needs a `.changeset` file. This prevents "oops, we shipped a breaking change as a patch" situations.

---

## Deep Dive: The Scoring Algorithm

This is the most opinionated part of the codebase. The scoring system encodes a specific belief about information quality.

### The Philosophy

Not all signals are equal. A Reddit post's upvote count tells you more than a search engine's relevance score, but recency matters too -- a post from yesterday with 50 upvotes might be more valuable than a post from 25 days ago with 500.

### The Math

Each item gets three sub-scores, weighted differently:

| Component | Weight | What it measures |
|-----------|--------|-----------------|
| Relevance | 45% | How well the content matches the query (LLM's judgment) |
| Recency | 25% | How recent the content is (exponential decay) |
| Engagement | 30% | How much humans interacted with it |

For Reddit, engagement is: `0.55 * log1p(score) + 0.4 * log1p(comments) + 0.05 * upvote_ratio * 10`

For X, it's: `0.55 * log1p(likes) + 0.25 * log1p(reposts) + 0.15 * log1p(replies) + 0.05 * log1p(quotes)`

### Trend-Aware Extension (PR-007)

When trend metadata exists for an item, scoring reserves **10%** for a trend component (`trendWeight`, configurable in `score.ts`) and scales the base weights proportionally. The trend component itself is:

- `momentum` (0..1): date freshness plus source-native engagement proxy
- `sourceDiversityBonus` (0..1): confirmation across multiple source types
- `trendScore = momentum * 0.7 + sourceDiversityBonus * 0.3`

Trend values are attached to item output as `momentum`, `trend_score`, and `subs.trend_score`.

The `log1p` is important. Without it, a viral post with 50,000 upvotes would dominate everything else. The logarithm compresses the scale so a 100-upvote post and a 50,000-upvote post are different but not *500x* different. Both clearly resonated with people.

Engagement scores are then normalized to 0-100 across the result set -- relative ranking within a given search, not absolute values. A post with the highest engagement in your results gets 100, the lowest gets 0. This prevents cross-topic score comparisons from being meaningless.

### WebSearch Gets Penalized

Web results have no engagement metrics. They're scored on relevance and recency only (reweighted to 55%/45%), then hit with a flat 15-point source penalty. The reasoning: without engagement data, you can't distinguish a thoughtful article from SEO spam. The penalty keeps web results visible but lower-ranked than verified community discussions.

### Confidence Penalties

Dates from LLM search results aren't always accurate. Each item carries a `date_confidence` field (`high`, `med`, `low`). Low-confidence dates take a 10-point penalty, medium takes 5. If the LLM isn't sure when something was posted, the item sinks in the ranking rather than potentially misleading you with a wrong recency score.

---

## The Resilience Layer: Where the Dragons Live

This is the code that handles the internet being the internet.

### Rate Limiting Isn't One Thing

The `RateLimitError` class (`http.ts:55`) has a `retryable: boolean` field. This distinction matters:

- **Transient 429** (rate limit): you're sending too many requests per minute. Wait and try again. The code does exponential backoff with jitter, respects `Retry-After` headers, and parses the Go-style `x-ratelimit-reset-requests` durations (`"1m30s"`, `"6m0s"`).

- **Non-retryable 429** (quota/billing): your account is out of credits or deactivated. No amount of retrying will help. The code checks for signals like `insufficient_quota` and `billing_hard_limit_reached` in the response body and throws immediately.

On a transient rate limit, instead of showing an error, the cache falls back to stale data (up to 24 hours old). The user gets slightly outdated results but doesn't see a failure. This is a deliberate UX choice: somewhat-old data beats no data.

### The Thundering Herd

Multiple Claude agents might invoke the CLI simultaneously for different topics. Without coordination, they'd all hit the APIs at the same time and trigger rate limits.

The cache (`cache.ts:220`) uses file-based locking: `openSync(lockPath, 'wx')` (exclusive create -- fails if the file already exists). If another process holds the lock, the current one polls every 100ms for up to 5 seconds, then checks if the other process populated the cache. Stale locks (older than 5 minutes) are auto-cleaned.

```
Process A: cache miss -> acquire lock -> call API -> write cache -> release lock
Process B: cache miss -> lock held -> wait 100ms -> wait 100ms -> cache hit! -> done
```

This turns N concurrent API calls into 1 API call + (N-1) cache reads.

### Atomic Writes

Cache writes use the temp-file-then-rename pattern:

```typescript
const tmpPath = `${cachePath}.tmp.${process.pid}.${Date.now()}.${Math.random()...}`
writeFileSync(tmpPath, JSON.stringify(data))
renameSync(tmpPath, cachePath)  // atomic on POSIX
```

A concurrent reader either sees the old file or the new one, never a half-written JSON blob. The random suffix prevents collisions between concurrent processes.

---

## Patterns Worth Knowing

### LLM-as-Search

The most distinctive pattern in this codebase. Instead of calling Reddit's search API (which requires OAuth, has strict rate limits, and returns results ranked by Reddit's algorithm), the tool asks an LLM with a web search tool to find Reddit posts about a topic. The LLM returns structured JSON in its output text, which gets parsed with a regex: `/\{[\s\S]*"items"[\s\S]*\}/`.

Why this works: LLMs with search tools are better at understanding intent than keyword search. Ask Reddit's API for "best TypeScript testing frameworks" and you get posts with those exact words. Ask an LLM and it also finds "how do you test your TS projects" and "we switched from Jest to Vitest and here's why."

The trade-off: LLM outputs aren't deterministic, and the engagement numbers they report are approximations. That's why the enrichment step exists -- trust the LLM for discovery, verify with the source.

### Model Auto-Selection

For OpenAI, the code calls `/v1/models`, filters to mainline `gpt-5.x` models (excluding mini/nano/turbo/preview/pro variants), picks the highest semantic version, and caches the result for 7 days. If the selected model 404s or returns an access error, it cascades through fallbacks (`gpt-4o`, `gpt-4o-mini`).

For xAI, it uses named aliases (`grok-4-1-fast`) since xAI's API doesn't expose a `/models` endpoint the same way.

This means the CLI automatically picks up new model releases without code changes. When OpenAI ships GPT-5.1, the CLI just starts using it.

### Low-Result Retry with Topic Extraction

If a verbose query like "best prompting practices for Claude Code" yields fewer than 5 results, the CLI extracts the core subject ("claude code") and retries with a simpler query. The guard is important: it only retries if (a) results are low, (b) it's not using mock data, (c) no error occurred, and (d) it's not already rate-limited. No retry amplification under pressure.

### Cache Key Versioning

Cache keys include a `promptVersion` field. When you change the LLM prompt (new instructions, different output format), bump the version string and every cached result is automatically invalidated. No manual cache-busting, no stale semantic collisions.

```typescript
export const REDDIT_PROMPT_VERSION = '2026-02-11-v1'
```

### Deduplication via Jaccard Similarity

Reddit and X often surface the same discussion in different words. The dedupe module uses character trigrams (3-grams) and Jaccard similarity to find near-duplicates:

1. Normalize text (lowercase, strip punctuation, collapse whitespace)
2. Generate all 3-character sliding windows as a set
3. Compare sets: `|intersection| / |union|`
4. If similarity >= 0.7, keep the higher-scored item

WebSearch items take a simpler path -- URL-based dedup only, since web articles rarely have near-identical titles.

---

## The Output Contract

This matters because downstream consumers depend on specific output formats:

| Consumer | Format | Flag |
|----------|--------|------|
| Beat reporter agents (Haiku) | compact markdown | `--emit=compact` |
| Digest scripts (programmatic) | JSON `Report` object | `--emit=json` |
| Human readers | full markdown | `--emit=md` |
| Path-only (for further processing) | just the file path | `--emit=path` |

Breaking changes here break the research plugin. The JSON schema of `Report`, the section headers in compact output, the CLI flag names, and the exit codes are all part of the public API.

---

## The Build and Publish Pipeline

### Local

`bun run validate` runs the full quality pipeline: Biome lint/format, TypeScript type checking, build, and tests. This is the gate before any push.

### CI (PR Quality)

Five parallel jobs: lint, typecheck, test (with 80% coverage gate), quality delta, and shellcheck on CI scripts. All must pass before merge.

### Publish

Uses Changesets with a pragmatic workaround: Bun's module resolver is incompatible with Changesets' bundled JS, so a separate `npm install --prefix .npm-changesets` provides a Node-compatible Changesets binary.

The pipeline supports four intents: auto (normal merge flow), version (pre-release bump), publish (pre-release publish), and snapshot (canary builds). Uses OIDC trusted publishing with npm and a GitHub App token for version commits (because `GITHUB_TOKEN` commits don't trigger downstream workflows).

One Bun-specific quirk: the CI includes a "linker artifact cleanup" step. Bun 1.3.x's hoisted linker creates stray `@@@`-suffixed package folders in the project root, which pollute `bun test --recursive`. The cleanup step removes them before tests run.

---

## What's Next

The architecture naturally extends in a few directions:

- **More sources**: The normalize/score/dedupe pipeline is source-agnostic. Adding Hacker News, Mastodon, or Bluesky means writing a new search module and a normalizer -- the rest of the pipeline works unchanged.
- **Better engagement verification**: X posts currently use LLM-reported metrics (no free public JSON endpoint like Reddit has). If X's API becomes accessible, enrichment would close that accuracy gap.
- **Smarter deduplication**: The Jaccard similarity on character trigrams works well for near-identical posts but misses semantic duplicates (same discussion, different words). An embedding-based approach could catch those.

### Local Smoke Tests (Current vs Legacy)

When we need confidence “in the wild”, we run local smoke tests against live APIs (current repo vs legacy repo) using the same topics and date window.

1. Choose 3–5 active topics (example: Bun 1.3 features, React Server Components security fixes, Node.js 24/25 release changes).
2. Run current repo for each topic (same date window): `last-30-days "Bun 1.3 features" --emit=json --include-web`.
3. Run legacy repo for the same topics and flags.
4. Save outputs to `reports/smoke/current/` and `reports/smoke/legacy/`.
5. Compare top‑10 overlap and any obvious ranking regressions.

---

## Final Thoughts

The core engineering philosophy here is **trust but verify**. Use LLMs for what they're good at (understanding intent, finding relevant content) but don't trust their numbers. Go to the source for engagement data. Use caching to avoid hammering APIs. Degrade gracefully when things go wrong.

The code is deliberately boring in its structure -- kebab-case files, one concern per module, named exports only -- because the interesting complexity is in the domain: handling flaky APIs, scoring heterogeneous content fairly, and turning messy internet data into something a human (or another LLM) can actually use.

---

*Built for the side-quest ecosystem. Consumed by Claude agents, digest scripts, and occasionally humans.*
