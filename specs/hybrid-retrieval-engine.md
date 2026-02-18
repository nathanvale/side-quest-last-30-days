# Plan: Hybrid Retrieval Engine

## Task Description
Ship a hybrid engine where two-phase discovery + entity drill-down drives recall, and the current typed/cached/tested TypeScript pipeline guarantees reliability and composability. This adds mvanhorn-inspired two-phase search, entity extraction, YouTube as a 4th source, trend-aware scoring, intent classification, watchlist persistence, briefing deltas, observability, and CI release gates -- all while preserving the existing engineering rigor (versioned cache, concurrency safety, typed schemas, 70+ tests).

## Objective
When complete, the CLI will:
1. Run two-phase retrieval (broad discovery -> entity drill-down) for significantly better recall
2. Extract and rank entities (@handles, r/subreddits, hashtags) from phase 1 to drive targeted phase 2 searches
3. Score results with momentum and source-diversity factors on top of the existing engagement/relevance/recency model
4. Classify query intent (PROMPTING, RECOMMENDATIONS, NEWS, GENERAL) to tune search budgets and scoring weights
5. Ingest YouTube videos with transcript snippets as a first-class source
6. Persist watchlist topics in SQLite for continuous monitoring with briefing/delta intelligence
7. Emit structured telemetry for every run, enforced by CI release gates
8. Measure all of the above against a benchmark harness with oracle-based KPIs

## Problem Statement
Compared to mvanhorn/last30days-skill (https://github.com/mvanhorn/last30days-skill), our tool has stronger engineering foundations (typed schemas, versioned cache, concurrency safety, comprehensive tests, CI/CD) but weaker recall (single-phase search), fewer sources (no YouTube), no intent classification, no persistent monitoring, and no trend/momentum scoring. The goal is to adopt the best ideas from their approach while preserving our reliability and composability advantages.

## Solution Approach
12 incremental PRs, each independently shippable, building from measurement infrastructure (eval harness) through retrieval contracts, entity extraction, two-phase search, YouTube integration, trend scoring, intent classification, watchlist/briefing persistence, observability, and finally CI release gates. Every PR includes tests, maintains backward compatibility, and runs the benchmark harness for regression detection.

## Relevant Files
Use these files to complete the task:

- `src/cli.ts` -- Main orchestrator (940 lines). Houses `searchRedditTask`, `searchXTask`, `main()`. This is where phase 2 orchestration, intent routing, and watchlist subcommands will be added.
- `src/lib/schema.ts` -- All typed interfaces (`Report`, `RedditItem`, `XItem`, `WebSearchItem`, `Engagement`, `SubScores`). Will be extended with `YouTubeItem`, `TrendScore`, `QueryType`, and retrieval contracts.
- `src/lib/score.ts` -- Scoring engine (217 lines). Weights: 45% relevance, 25% recency, 30% engagement. Will be extended with momentum and source-diversity factors.
- `src/lib/cache.ts` -- Versioned cache with file locking and atomic writes (341 lines). Cache keys must be extended for strategy/phase/entity dimensions.
- `src/lib/openai-reddit.ts` -- Reddit search via OpenAI Responses API. Will gain subreddit-scoped supplemental search for phase 2.
- `src/lib/xai-x.ts` -- X search via xAI Responses API. Will gain targeted @handle queries for phase 2.
- `src/lib/dedupe.ts` -- N-gram Jaccard deduplication. Will be extended for YouTube items and cross-phase dedup.
- `src/lib/normalize.ts` -- Normalization of raw API responses. Will be extended for YouTube items.
- `src/lib/render.ts` -- Output rendering (compact, JSON, md, context, path). Will be extended for YouTube items, trend scores, and briefing output.
- `src/lib/http.ts` -- HTTP client with retry logic and rate-limit classification. No changes expected.
- `src/lib/config.ts` -- Env var loading from `~/.config/last-30-days/.env`. May need YouTube-related config.
- `src/lib/dates.ts` -- Date range math and recency scoring. No changes expected.
- `src/lib/models.ts` -- Model auto-selection. No changes expected.
- `src/lib/websearch.ts` -- WebSearch date extraction. No changes expected.
- `src/lib/ui.ts` -- Terminal progress display. Will need YouTube progress steps.
- `src/index.ts` -- Barrel export. Must be updated as new modules are added.
- `tests/index.test.ts` -- Comprehensive test suite (1000+ lines). Each PR adds tests here or in new test files.
- `fixtures/` -- Mock data directory. Will gain YouTube fixtures and eval oracle data.
- `biome.json` -- Linting config. No changes.
- `package.json` -- Scripts and dependencies. May need `better-sqlite3` for watchlist.

### New Files
- `scripts/eval/run.ts` -- Benchmark harness runner
- `scripts/eval/oracle.ts` -- Oracle dataset and comparison logic
- `fixtures/eval/topics.json` -- Benchmark topic set
- `fixtures/eval/oracle.json` -- Expected entity/trend oracle data
- `src/lib/eval-metrics.ts` -- KPI calculation functions
- `tests/eval-metrics.test.ts` -- Unit tests for KPI formulas
- `src/lib/retrieval/types.ts` -- Retrieval interfaces (SearchAdapter, OrchestratorConfig, PhaseResult)
- `src/lib/retrieval/orchestrator.ts` -- Two-phase orchestrator
- `src/lib/retrieval/query-policy.ts` -- Query budget/weight policies per intent
- `src/lib/entity-extract.ts` -- Entity extraction and ranking from phase 1 results
- `tests/entity-extract.test.ts` -- Entity extraction fixture tests
- `src/lib/youtube.ts` -- YouTube source adapter (yt-dlp wrapper)
- `fixtures/youtube_sample.json` -- YouTube mock data
- `src/lib/trend.ts` -- Momentum and source-diversity scoring
- `src/lib/intent.ts` -- Query type classifier
- `src/lib/store.ts` -- SQLite persistence layer
- `src/lib/watchlist.ts` -- Watchlist CRUD and scheduling
- `src/lib/briefing.ts` -- Briefing generation from persisted runs
- `src/lib/delta.ts` -- Delta/change detection between runs
- `src/lib/telemetry.ts` -- Structured run telemetry
- `specs/hybrid-retrieval.md` -- Architecture documentation (this file, updated at PR-012)

## Implementation Phases

### Phase 1: Foundation (PR-001 + PR-002)
Lock measurement infrastructure and typed retrieval interfaces before any behavior changes. The eval harness establishes baseline KPIs. Retrieval contracts define the adapter pattern that all sources (existing and new) must implement. No user-visible changes.

### Phase 2: Core Implementation (PR-003 through PR-008)
The first user-visible win: entity extraction + two-phase search. Then YouTube as a 4th source, trend-aware scoring, and intent classification. Each PR is independently valuable and backward-compatible. Cache hardening ensures phase 2 doesn't break concurrency safety.

### Phase 3: Integration & Polish (PR-009 through PR-012)
Persistence layer (watchlist + briefings), observability telemetry, and CI release gates. These build on the retrieval and scoring improvements from Phase 2. The final PR wires the eval harness into CI so regressions block releases.

## Team Orchestration

- You operate as the team lead and orchestrate the team to execute the plan.
- IMPORTANT: You NEVER operate directly on the codebase. Use Task and Task* tools only.
- Take note of the session id (agentId) of each team member for resume operations.

### Model Selection Guide

| Role | Model | Rationale |
|------|-------|-----------|
| All builders | opus | Executes well-specified tasks reliably |
| All validators | opus | Mechanical checks: read files, run commands, report PASS/FAIL |

### Team Members

- Builder
  - Name: builder-eval
  - Role: Eval harness, KPI formulas, oracle dataset, benchmark runner
  - Agent Type: enterprise:builder-scotty
  - Model: opus
  - Resume: true

- Validator
  - Name: validator-eval
  - Role: Verify eval harness outputs valid scorecard, KPI formulas are correct, tests pass
  - Agent Type: enterprise:validator-mccoy
  - Model: opus
  - Resume: true

- Builder
  - Name: builder-retrieval
  - Role: Retrieval contracts, orchestrator, query policy, entity extraction, two-phase search
  - Agent Type: enterprise:builder-scotty
  - Model: opus
  - Resume: true

- Validator
  - Name: validator-retrieval
  - Role: Verify retrieval contracts are type-safe, orchestrator merges correctly, no existing test regressions
  - Agent Type: enterprise:validator-mccoy
  - Model: opus
  - Resume: true

- Builder
  - Name: builder-sources
  - Role: YouTube adapter, cache hardening for phase 2, source-specific scoring extensions
  - Agent Type: enterprise:builder-scotty
  - Model: opus
  - Resume: true

- Validator
  - Name: validator-sources
  - Role: Verify YouTube integration, cache key versioning, scoring formula correctness
  - Agent Type: enterprise:validator-mccoy
  - Model: opus
  - Resume: true

- Builder
  - Name: builder-intelligence
  - Role: Trend scoring, intent classification, watchlist/briefing persistence, telemetry
  - Agent Type: enterprise:builder-scotty
  - Model: opus
  - Resume: true

- Validator
  - Name: validator-intelligence
  - Role: Verify trend formulas, intent classifier accuracy, watchlist CRUD, telemetry schema
  - Agent Type: enterprise:validator-mccoy
  - Model: opus
  - Resume: true

- Builder
  - Name: builder-ci
  - Role: CI release gates, documentation, final integration
  - Agent Type: enterprise:builder-scotty
  - Model: opus
  - Resume: true

- Validator
  - Name: validator-final
  - Role: Full validation sweep: all tests, typecheck, lint, eval harness, no regressions
  - Agent Type: enterprise:validator-mccoy
  - Model: opus
  - Resume: true

## Step by Step Tasks

- Execute every step in order, top to bottom.
- Before starting, run TaskCreate for each task so all team members can see the full plan.

### 1. Eval Harness + Oracle Baseline (PR-001)
- **Task ID**: pr-001-eval-harness
- **Depends On**: none
- **Assigned To**: builder-eval
- **Agent Type**: enterprise:builder-scotty
- **Model**: opus
- **Parallel**: false
- Create `src/lib/eval-metrics.ts` with KPI calculation functions:
  - `freshnessAtK(items, k)` -- median age of top K results in hours
  - `trendRecallAtK(items, oracle, k)` -- fraction of oracle entities in top K
  - `momentumPrecisionAtK(items, k)` -- fraction of top K with positive 24h engagement velocity
  - `crossSourceConfirmation(clusters, minSources)` -- fraction of clusters with >= minSources source types
  - `citationValidity(items)` -- fraction of items with resolvable URLs matching cited claim
  - `runReliability(runs)` -- fraction of successful runs
  - `performanceP95(durations)` -- p95 of run durations in seconds
  - `medianRunCost(costs)` -- median cost per run
  - `watchlistDeltaUtility(ratings)` -- fraction of "useful change" ratings
  - `regressionSafety(current, baseline, threshold)` -- boolean: score drop <= threshold
- Create `tests/eval-metrics.test.ts` with unit tests for each KPI formula
- Create `fixtures/eval/topics.json` with 10 benchmark topics (mix of trending, niche, evergreen)
- Create `fixtures/eval/oracle.json` with expected entities/trends for each topic
- Create `scripts/eval/oracle.ts` with oracle comparison logic
- Create `scripts/eval/run.ts` that:
  - Loads topics and oracle data
  - Runs CLI with `--mock` for each topic
  - Computes all KPIs
  - Outputs machine-readable JSON scorecard
  - Exits non-zero if any KPI fails threshold
- Add `"eval": "bun run scripts/eval/run.ts"` to package.json scripts
- Run `bun run validate` to ensure no regressions
- Commit baseline scorecard to `fixtures/eval/baseline.json`

### 2. Validate Eval Harness (PR-001)
- **Task ID**: validate-pr-001
- **Depends On**: pr-001-eval-harness
- **Assigned To**: validator-eval
- **Agent Type**: enterprise:validator-mccoy
- **Model**: opus
- **Parallel**: false
- Verify `bun test` passes (all existing + new eval metric tests)
- Verify `bun run typecheck` passes
- Verify `bun run lint` passes
- Verify `bun run eval` produces valid JSON scorecard
- Verify baseline.json is committed and parseable
- Verify all KPI formulas handle edge cases (empty arrays, nulls, zeros)

### 3. Retrieval Contracts (PR-002)
- **Task ID**: pr-002-retrieval-contracts
- **Depends On**: validate-pr-001
- **Assigned To**: builder-retrieval
- **Agent Type**: enterprise:builder-scotty
- **Model**: opus
- **Parallel**: false
- Create `src/lib/retrieval/types.ts` with typed interfaces:
  - `SearchAdapter` -- common interface for Reddit, X, YouTube adapters
  - `AdapterConfig` -- source-specific config (API key, model, depth, cache opts)
  - `PhaseResult` -- items + metadata from a single search phase
  - `OrchestratorConfig` -- strategy, phase2 budget, timeouts
  - `MergePolicy` -- how to combine phase 1 + phase 2 results
- Create `src/lib/retrieval/orchestrator.ts`:
  - Accepts array of `SearchAdapter` instances
  - Runs phase 1 in parallel across adapters
  - Returns combined `PhaseResult` with dedup
  - Phase 2 is a no-op initially (wired in PR-004)
- Create `src/lib/retrieval/query-policy.ts`:
  - Default budget/weight configs per depth level (quick/default/deep)
  - Phase 2 budget caps (max supplemental queries per source)
- Wrap existing `searchRedditTask` and `searchXTask` as `SearchAdapter` implementations
  - Thin adapter layer, NOT a rewrite -- delegate to existing functions
- Update `src/index.ts` to export new retrieval types
- Add contract tests verifying adapter compliance and deterministic merge
- Run `bun run validate` to ensure no regressions
- CRITICAL: No behavior change in CLI output -- existing tests must all pass unchanged

### 4. Validate Retrieval Contracts (PR-002)
- **Task ID**: validate-pr-002
- **Depends On**: pr-002-retrieval-contracts
- **Assigned To**: validator-retrieval
- **Agent Type**: enterprise:validator-mccoy
- **Model**: opus
- **Parallel**: false
- Verify `bun test` passes (all existing + new contract tests)
- Verify `bun run typecheck` passes
- Verify `bun run eval` scorecard matches baseline (no regression)
- Verify new types are exported from `src/index.ts`
- Verify existing CLI behavior is unchanged (run `--mock --emit=json` and compare)

### 5. Entity Extraction Module (PR-003)
- **Task ID**: pr-003-entity-extraction
- **Depends On**: validate-pr-002
- **Assigned To**: builder-retrieval
- **Agent Type**: enterprise:builder-scotty
- **Model**: opus
- **Parallel**: false
- Create `src/lib/entity-extract.ts`:
  - `extractHandles(items)` -- extract @handles from X items' text and author_handle fields
  - `extractSubreddits(items)` -- extract r/subreddits from Reddit items
  - `extractHashtags(items)` -- extract #hashtags from X items' text
  - `extractRepeatedTerms(items, minCount)` -- find repeated noun phrases across items
  - `rankEntities(entities)` -- rank by frequency * engagement weight
  - `filterStopwords(entities)` -- remove common non-informative entities
  - `EntityResult` type with `handles`, `subreddits`, `hashtags`, `terms` fields
- Create `tests/entity-extract.test.ts`:
  - Fixture tests for noisy text (emojis, URLs, mentions mixed with text)
  - Dedup tests (same handle with different casing)
  - Ranking stability tests (deterministic ordering)
  - Stopword filtering tests
  - Empty/null input edge cases
- Export from `src/index.ts`
- Run `bun run validate`

### 6. Validate Entity Extraction (PR-003)
- **Task ID**: validate-pr-003
- **Depends On**: pr-003-entity-extraction
- **Assigned To**: validator-retrieval
- **Agent Type**: enterprise:validator-mccoy
- **Model**: opus
- **Parallel**: false
- Verify all entity extraction tests pass
- Verify typecheck and lint pass
- Verify extraction precision on labeled fixture set (spot-check 5 fixtures)
- Verify no existing test regressions

### 7. Two-Phase Supplemental Retrieval (PR-004)
- **Task ID**: pr-004-two-phase-search
- **Depends On**: validate-pr-003
- **Assigned To**: builder-retrieval
- **Agent Type**: enterprise:builder-scotty
- **Model**: opus
- **Parallel**: false
- Update `src/lib/retrieval/orchestrator.ts`:
  - After phase 1, call entity extraction on results
  - For Reddit: run subreddit-scoped supplemental searches using Reddit's public `.json` search endpoint (no API key needed)
  - For X: run `from:@handle topic` targeted queries for top extracted handles
  - Execute phase 2 queries in parallel with bounded concurrency
  - Merge phase 2 results with phase 1, deduplicating
  - Respect `--phase2-budget=N` cap (default: 5 supplemental queries per source)
- Update `src/lib/openai-reddit.ts`:
  - Add `searchRedditSupplemental(subreddit, topic, fromDate, toDate)` using Reddit's `.json` endpoint
- Update `src/lib/xai-x.ts`:
  - Add `searchXTargeted(apiKey, model, handle, topic, fromDate, toDate)` for handle-scoped queries
- Update `src/cli.ts`:
  - Add `--strategy=single|two-phase` flag (default: `two-phase`)
  - Add `--phase2-budget=N` flag (default: 5)
  - Wire orchestrator into main flow
  - When `--strategy=single`, skip phase 2 (backward-compatible)
- Update `parseArgs` to handle new flags
- Add integration tests verifying:
  - Phase 2 adds unique relevant items
  - No duplicates between phases
  - `--strategy=single` produces identical output to current behavior
  - Phase 2 budget cap is respected
- Run `bun run validate` and `bun run eval` for regression check

### 8. Validate Two-Phase Search (PR-004)
- **Task ID**: validate-pr-004
- **Depends On**: pr-004-two-phase-search
- **Assigned To**: validator-retrieval
- **Agent Type**: enterprise:validator-mccoy
- **Model**: opus
- **Parallel**: false
- Verify all tests pass including new integration tests
- Verify `--strategy=single` produces identical output to baseline
- Verify `--strategy=two-phase` produces strictly more results than single
- Verify eval scorecard shows recall improvement
- Verify no cache/concurrency regressions

### 9. Cache/Retry Hardening for Phase 2 (PR-005)
- **Task ID**: pr-005-cache-hardening
- **Depends On**: validate-pr-004
- **Assigned To**: builder-sources
- **Agent Type**: enterprise:builder-scotty
- **Model**: opus
- **Parallel**: false
- Update `src/lib/cache.ts`:
  - Extend `getSourceCacheKey` to include `strategy` and `phase` dimensions
  - Add `getPhase2CacheKey(topic, entity, entityType, source)` for supplemental results
  - Stale fallback covers phase 2 failures (serve phase 1 results if phase 2 rate-limited)
  - Bump `SEARCH_CACHE_SCHEMA_VERSION` to `'v3'`
- Update `src/cli.ts`:
  - Phase 2 transient failures degrade gracefully (log warning, serve phase 1 only)
  - No hard fail if supplemental search rate-limited
- Add tests:
  - Cache key version tests (v2 keys don't collide with v3)
  - Lock contention tests for concurrent phase 2 queries
  - Stale fallback tests for phase 2 transient 429s
  - Deterministic cache behavior under concurrent phase 1 + phase 2
- Run `bun run validate` and `bun run eval`

### 10. Validate Cache Hardening (PR-005)
- **Task ID**: validate-pr-005
- **Depends On**: pr-005-cache-hardening
- **Assigned To**: validator-sources
- **Agent Type**: enterprise:validator-mccoy
- **Model**: opus
- **Parallel**: false
- Verify cache key version bump doesn't break existing cached data (graceful miss)
- Verify no thundering herd regressions
- Verify phase 2 fallback produces phase 1 results when phase 2 fails
- Verify all tests pass

### 11. YouTube Source Adapter (PR-006)
- **Task ID**: pr-006-youtube-adapter
- **Depends On**: validate-pr-005
- **Assigned To**: builder-sources
- **Agent Type**: enterprise:builder-scotty
- **Model**: opus
- **Parallel**: false
- Create `src/lib/youtube.ts`:
  - `YouTubeItem` interface in `src/lib/schema.ts` (id, title, url, channel, date, views, likes, transcript_snippet, engagement, subs, score)
  - `searchYouTube(topic, days, depth)` -- shell out to `yt-dlp --flat-playlist --dump-json` for search
  - `getTranscript(videoId)` -- shell out to `yt-dlp --write-auto-sub --skip-download` for transcript
  - `isYtDlpAvailable()` -- check if yt-dlp is in PATH
  - Implement `SearchAdapter` interface from retrieval contracts
  - Engagement formula: `0.65 * log1p(views) + 0.30 * log1p(likes) + 0.05 * log1p(comments)`
- Create `fixtures/youtube_sample.json` with mock YouTube search results
- Update `src/lib/normalize.ts`:
  - Add `normalizeYouTubeItems(items, fromDate, toDate)`
- Update `src/lib/score.ts`:
  - Add `scoreYouTubeItems(items, maxDays)` with YouTube-specific weights
- Update `src/lib/dedupe.ts`:
  - Add `dedupeYouTube(items)` using URL-based dedup (titles are unreliable)
- Update `src/lib/render.ts`:
  - Include YouTube items in compact, JSON, md, and context outputs
- Update `src/cli.ts`:
  - Add `--include-youtube` flag
  - Update `--sources=...` to accept `youtube`
  - Auto-detect yt-dlp availability
  - Wire YouTube adapter into orchestrator
- Update `src/lib/ui.ts`:
  - Add YouTube progress steps
- Update `src/lib/schema.ts`:
  - Add `youtube: YouTubeItem[]` to `Report`
  - Add `youtube_error: string | null` to `Report`
  - Update `createReport`, `reportToDict`, `reportFromDict`
- Update `src/index.ts` to export YouTube types and functions
- Add tests:
  - YouTube parser/normalizer tests
  - YouTube scoring tests
  - YouTube dedup tests
  - CLI JSON output includes YouTube items
  - Graceful degradation when yt-dlp not installed
- Run `bun run validate` and `bun run eval`

### 12. Validate YouTube Integration (PR-006)
- **Task ID**: validate-pr-006
- **Depends On**: pr-006-youtube-adapter
- **Assigned To**: validator-sources
- **Agent Type**: enterprise:validator-mccoy
- **Model**: opus
- **Parallel**: false
- Verify YouTube items appear in report/ranking
- Verify graceful degradation when yt-dlp missing
- Verify YouTube scoring formula is correct
- Verify all tests pass, eval scorecard shows recall improvement
- Verify Report schema backward compatibility (old cached reports still parse)

### 13. Trend-Aware Scoring Model (PR-007)
- **Task ID**: pr-007-trend-scoring
- **Depends On**: validate-pr-006
- **Assigned To**: builder-intelligence
- **Agent Type**: enterprise:builder-scotty
- **Model**: opus
- **Parallel**: false
- Create `src/lib/trend.ts`:
  - `momentumScore(item)` -- 24h engagement velocity (if we have time-series data) or proxy from date + engagement
  - `sourceDiversityBonus(item, allItems)` -- bonus when topic confirmed across 2+ source types
  - `trendScore(item, allItems)` -- combined momentum + diversity factor
  - `TrendScore` interface added to `src/lib/schema.ts`
- Update `src/lib/score.ts`:
  - Add optional `trend_score` to `SubScores`
  - When trend data available, factor into overall score (configurable weight, default 10%)
  - Existing formulas unchanged when trend data absent (backward-compatible)
- Update `src/lib/schema.ts`:
  - Add `trend_score?: number` and `momentum?: number` to item types
- Add tests:
  - Deterministic scoring tests with known inputs
  - Edge cases: missing engagement, missing dates, single-source topics
  - Monotonicity checks (higher engagement velocity -> higher trend score)
  - Backward compatibility: items without trend data score identically to before
- Update EXPLAIN.md with trend scoring documentation
- Run `bun run validate` and `bun run eval`

### 14. Validate Trend Scoring (PR-007)
- **Task ID**: validate-pr-007
- **Depends On**: pr-007-trend-scoring
- **Assigned To**: validator-intelligence
- **Agent Type**: enterprise:validator-mccoy
- **Model**: opus
- **Parallel**: false
- Verify trend formulas produce expected outputs for fixture data
- Verify backward compatibility (existing items score unchanged)
- Verify Freshness@10 and Momentum Precision@10 improve on eval scorecard
- Verify no reliability regression

### 15. Intent Classification + Query Policy (PR-008)
- **Task ID**: pr-008-intent-classification
- **Depends On**: validate-pr-007
- **Assigned To**: builder-intelligence
- **Agent Type**: enterprise:builder-scotty
- **Model**: opus
- **Parallel**: false
- Create `src/lib/intent.ts`:
  - `QueryType` enum: `PROMPTING`, `RECOMMENDATIONS`, `NEWS`, `GENERAL`
  - `classifyIntent(topic)` -- rule-based classifier using keyword patterns:
    - PROMPTING: "prompt", "prompting", "best practices", "techniques"
    - RECOMMENDATIONS: "best", "top", "recommended", "what should I use"
    - NEWS: "news", "latest", "what's happening", "update"
    - GENERAL: default fallback
  - `getQueryPolicy(queryType, depth)` -- returns budget/weight overrides:
    - NEWS: higher recency weight (40%), lower relevance (35%), shorter lookback preference
    - RECOMMENDATIONS: more results requested, lower dedup threshold
    - PROMPTING: standard weights, focus on high-engagement posts
    - GENERAL: default weights
- Update `src/cli.ts`:
  - Add `--query-type=auto|prompting|recommendations|news|general` flag
  - When `auto`, run `classifyIntent(topic)` before search
  - Pass query policy to orchestrator for budget/weight adjustments
- Update `src/lib/retrieval/query-policy.ts`:
  - Integrate intent-based overrides with depth-based defaults
- Update `src/lib/score.ts`:
  - Accept optional weight overrides from query policy
- Add tests:
  - Classifier fixture tests (20+ test cases covering all 4 types)
  - Query policy tests (verify budget/weight changes per type)
  - Integration tests showing weight changes affect ranking
- Run `bun run validate` and `bun run eval`

### 16. Validate Intent Classification (PR-008)
- **Task ID**: validate-pr-008
- **Depends On**: pr-008-intent-classification
- **Assigned To**: validator-intelligence
- **Agent Type**: enterprise:validator-mccoy
- **Model**: opus
- **Parallel**: false
- Verify classifier correctly categorizes test fixtures
- Verify `--query-type=auto` matches manual classification on benchmark topics
- Verify NEWS queries produce fresher results
- Verify RECOMMENDATIONS queries produce more specific items
- Verify all tests pass

### 17. Watchlist Persistence (PR-009)
- **Task ID**: pr-009-watchlist
- **Depends On**: validate-pr-008
- **Assigned To**: builder-intelligence
- **Agent Type**: enterprise:builder-scotty
- **Model**: opus
- **Parallel**: false
- Create `src/lib/store.ts`:
  - SQLite-backed persistence using `bun:sqlite` (Bun's built-in SQLite)
  - `initDb()` -- create tables if not exist (watchlist_topics, run_history, run_items)
  - `getDb()` -- singleton connection to `~/.local/share/last-30-days/research.db`
  - Schema migrations with version tracking
- Create `src/lib/watchlist.ts`:
  - `addTopic(topic, schedule?)` -- add topic to watchlist with optional recurrence
  - `removeTopic(topic)` -- remove from watchlist
  - `listTopics()` -- list all watched topics with last run date
  - `runOne(topic)` -- run research and persist results
  - `runAll()` -- run all due topics
  - `getHistory(topic, limit?)` -- retrieve past runs for a topic
- Update `src/cli.ts`:
  - Add subcommand routing: `watch add`, `watch list`, `watch remove`, `watch run-one`, `watch run-all`
  - `watch add "topic" --every=weekly` (schedule metadata only, no cron)
  - `watch run-one "topic"` -- research and persist snapshot
  - `watch run-all` -- run all topics that are due
- Add tests:
  - DB migration tests (create, upgrade)
  - CRUD tests (add, list, remove, get history)
  - Run scheduling metadata tests
  - Idempotent add (same topic twice doesn't duplicate)
- Run `bun run validate`

### 18. Validate Watchlist (PR-009)
- **Task ID**: validate-pr-009
- **Depends On**: pr-009-watchlist
- **Assigned To**: validator-intelligence
- **Agent Type**: enterprise:validator-mccoy
- **Model**: opus
- **Parallel**: false
- Verify SQLite DB created correctly at expected path
- Verify CRUD operations work (add, list, remove)
- Verify run history persists and is queryable
- Verify all tests pass, no existing test regressions

### 19. Briefing + Delta Intelligence (PR-010)
- **Task ID**: pr-010-briefing-delta
- **Depends On**: validate-pr-009
- **Assigned To**: builder-intelligence
- **Agent Type**: enterprise:builder-scotty
- **Model**: opus
- **Parallel**: false
- Create `src/lib/delta.ts`:
  - `detectNewEntities(current, previous)` -- entities in current but not previous run
  - `detectRisingVoices(current, previous)` -- handles/subreddits with increasing engagement
  - `detectFallingVoices(current, previous)` -- handles/subreddits with decreasing engagement
  - `detectSentimentShift(current, previous)` -- topics where community tone changed
  - `DeltaReport` interface
- Create `src/lib/briefing.ts`:
  - `generateBriefing(topic, runs, format)` -- synthesize daily/weekly briefing from persisted runs
  - `BriefingFormat` enum: `daily`, `weekly`
  - Include delta analysis comparing latest vs previous run
  - Output markdown briefing with "What's New", "Rising", "Falling" sections
- Update `src/lib/render.ts`:
  - Add `renderBriefing(briefing)` for briefing output formatting
- Update `src/cli.ts`:
  - Add `briefing generate "topic" --period=daily|weekly`
  - Add `briefing show "topic"` -- display latest briefing
- Add tests:
  - Delta detection tests (new entities, rising/falling voices)
  - Briefing output snapshot tests
  - Empty history edge case
  - Single-run edge case (no delta possible)
- Run `bun run validate`

### 20. Validate Briefing (PR-010)
- **Task ID**: validate-pr-010
- **Depends On**: pr-010-briefing-delta
- **Assigned To**: validator-intelligence
- **Agent Type**: enterprise:validator-mccoy
- **Model**: opus
- **Parallel**: false
- Verify briefing generates from persisted run data
- Verify delta detection correctly identifies new/rising/falling entities
- Verify briefing markdown output is well-formatted
- Verify all tests pass

### 21. Observability + SLO Guardrails (PR-011)
- **Task ID**: pr-011-observability
- **Depends On**: validate-pr-010
- **Assigned To**: builder-ci
- **Agent Type**: enterprise:builder-scotty
- **Model**: opus
- **Parallel**: false
- Create `src/lib/telemetry.ts`:
  - `RunTelemetry` interface: run_id, topic, query_type, strategy, sources, duration_ms, cost_estimate, cache_hits, cache_misses, fallback_reasons, items_per_source, errors, timestamp
  - `createTelemetry(runId, topic)` -- start tracking
  - `recordPhase(telemetry, phase, source, result)` -- record per-phase metrics
  - `finalizeTelemetry(telemetry)` -- compute aggregates
  - `emitTelemetry(telemetry, format)` -- write to stderr (JSON) or file
- Update `src/cli.ts`:
  - Instrument all search phases with telemetry
  - Emit `report.metrics.json` alongside other output files
  - Add `--telemetry=quiet|verbose|file` flag (default: quiet -- file only)
- Update `src/lib/render.ts`:
  - Include telemetry summary in JSON emit mode
- Add tests:
  - Telemetry schema validation tests
  - Failure-path instrumentation tests (verify fallback reasons recorded)
  - Duration measurement accuracy tests
- Run `bun run validate`

### 22. Validate Observability (PR-011)
- **Task ID**: validate-pr-011
- **Depends On**: pr-011-observability
- **Assigned To**: validator-final
- **Agent Type**: enterprise:validator-mccoy
- **Model**: opus
- **Parallel**: false
- Verify telemetry JSON schema is valid
- Verify `report.metrics.json` is emitted on runs
- Verify failure paths record correct fallback reasons
- Verify all tests pass

### 23. CI Release Gates + Docs (PR-012)
- **Task ID**: pr-012-ci-gates
- **Depends On**: validate-pr-011
- **Assigned To**: builder-ci
- **Agent Type**: enterprise:builder-scotty
- **Model**: opus
- **Parallel**: false
- Update `.github/workflows/pr-quality.yml`:
  - Add `eval` job that runs `bun run eval`
  - Fail PR if any launch gate KPI regresses > 2% from baseline
  - Add cost budget check from telemetry
- Update `README.md`:
  - Document new flags: `--strategy`, `--phase2-budget`, `--include-youtube`, `--query-type`, `--telemetry`
  - Document watchlist/briefing subcommands
  - Add architecture diagram showing two-phase retrieval
- Update `EXPLAIN.md`:
  - Document entity extraction, two-phase search, trend scoring, intent classification
  - Document watchlist/briefing architecture
- Update `CHANGELOG.md`:
  - Document all new features
- Run `bun run validate` and `bun run eval`

### 24. Final Validation
- **Task ID**: validate-all
- **Depends On**: pr-012-ci-gates
- **Assigned To**: validator-final
- **Agent Type**: enterprise:validator-mccoy
- **Model**: opus
- **Parallel**: false
- Run `bun test` -- all tests pass
- Run `bun run typecheck` -- no type errors
- Run `bun run lint` -- no lint errors
- Run `bun run build` -- builds successfully
- Run `bun run eval` -- all KPIs meet launch gate thresholds
- Verify `--strategy=single` still produces identical output to pre-change baseline
- Verify `--mock` mode works with all new features
- Verify no regression in existing CLI behavior
- Verify all new modules exported from `src/index.ts`
- Verify JSDoc on all exported functions

## Acceptance Criteria

1. **Freshness@10**: Median age of top 10 results <= 48h overall, <= 24h for NEWS queries
2. **Trend Recall@20**: >= 80% of oracle trend entities appear in top 20 within 48h of first external signal
3. **Momentum Precision@10**: >= 70% of top 10 are positively accelerating (24h engagement velocity > 0)
4. **Cross-Source Confirmation**: At least 3/5 top trend clusters have >= 2 source types
5. **Citation Validity**: >= 98% links resolve and match cited claim
6. **Run Reliability**: >= 99% successful runs; transient failures degrade to stale cache without hard fail
7. **Performance**: p95 runtime <= 90s at default depth
8. **Cost**: Median default run cost within defined budget cap
9. **Watchlist Delta Utility**: >= 85% reviewer "useful change" rating on daily briefings
10. **Regression Safety**: Benchmark score does not drop > 2% across releases
11. All existing tests pass unchanged
12. `bun run validate` passes (lint + typecheck + build + test)
13. `bun run eval` produces passing scorecard
14. All new modules have JSDoc on exported functions
15. `--strategy=single` backward compatibility preserved

## Validation Commands
- `bun test` -- run all tests
- `bun run typecheck` -- verify no type errors (uses `tsconfig.eslint.json`)
- `bun run lint` -- Biome lint check
- `bun run build` -- compile via bunup
- `bun run validate` -- full pipeline: lint + typecheck + build + test
- `bun run eval` -- benchmark harness with KPI scorecard

## Notes

### Dependency Considerations
- **bun:sqlite**: Bun has built-in SQLite support (`bun:sqlite`), so no external dependency needed for watchlist persistence. This preserves our near-zero runtime dependency philosophy.
- **yt-dlp**: Optional system dependency for YouTube. Graceful degradation when not installed. Not a package dependency -- invoked via shell.
- **No new npm runtime dependencies**: All new functionality uses native Bun/Node APIs.

### Cache Migration
- PR-005 bumps `SEARCH_CACHE_SCHEMA_VERSION` from `'v2'` to `'v3'`. Old v2 cache entries will miss (not collide), which is the correct behavior -- they'll be re-fetched with the new strategy.

### Backward Compatibility
- `--strategy=single` flag preserves exact pre-change behavior for users who don't want phase 2.
- All existing CLI flags continue to work unchanged.
- JSON output schema is additive only (new fields, no removed fields).
- Cached v2 reports still parse via `reportFromDict` (it handles missing fields with defaults).

### Risk Mitigation
- PR-001 (eval harness) ships first so every subsequent PR can be measured against baseline.
- Each PR is independently revertable without affecting others.
- Phase 2 failures degrade gracefully to phase 1 results (never worse than current behavior).
- YouTube is behind `--include-youtube` flag (opt-in) until proven stable.

### Execution Order Rationale
1. **PR-001 + PR-002 first**: Lock measurement and interfaces before any behavior changes
2. **PR-003 + PR-004 next**: First user-visible win (two-phase recall uplift)
3. **PR-005**: Harden cache before adding more sources
4. **PR-006**: YouTube adds a whole new source type
5. **PR-007 + PR-008**: Scoring and classification build on the richer data from phases 1-6
6. **PR-009 + PR-010**: Persistence layer needs the full retrieval + scoring pipeline
7. **PR-011 + PR-012**: Observability and CI gates wrap everything up

## Telemetry Contract Pack (Locked)

The `l30d.run.completed` telemetry contract is frozen in these normative files:

- `specs/telemetry/l30d.run.completed.envelope.v1.schema.json`
- `specs/telemetry/run-completed-data.v1.schema.json`
- `specs/telemetry/data-quality.v1.schema.json`
- `specs/telemetry/confidence.v1.schema.json`
- `src/lib/telemetry-contract.ts`
- `scripts/telemetry/validator.ts`
- `fixtures/telemetry/run.completed.v1.sample.json`
- `tests/telemetry-contract.test.ts`

Builder and validator execution commands:

- `bun run telemetry:validate`
- `bun test tests/telemetry-contract.test.ts`

Governance rules:

1. v1 schema files are immutable except non-semantic typo/docs fixes.
2. Any breaking shape or formula change requires new `v2` schema files.
3. The sample fixture must remain valid against the runtime validator and formula locks.
4. `src/lib/telemetry-contract.ts` is the TypeScript source-of-truth for implementation.
