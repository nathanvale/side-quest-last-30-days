/**
 * Runtime telemetry collection for last-30-days CLI runs.
 *
 * This module collects metrics during a CLI run and produces a
 * `RunCompletedDataV1` payload matching the telemetry contract in
 * `telemetry-contract.ts`. All collection functions are side-effect-free --
 * they mutate the `TelemetryCollector` passed in. The contract types are
 * intentionally immutable (governance rule); this module only PRODUCES them.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
	ConfidenceV1,
	CostSummaryV1,
	DataQualityV1,
	LatencySummaryV1,
	Phase2SummaryV1,
	RunCompletedDataV1,
	RunCompletedEnvelopeV1,
	SourceSkipDetailV1,
	TelemetrySource,
} from './telemetry-contract.js'

// ---------------------------------------------------------------------------
// Collector interface
// ---------------------------------------------------------------------------

/** Mutable telemetry collector used during a CLI run. */
export interface TelemetryCollector {
	runId: string
	topic: string
	startedAt: Date
	sources: {
		requested: TelemetrySource[]
		executed: TelemetrySource[]
		skipped: SourceSkipDetailV1[]
	}
	counts: {
		rawCandidates: number
		bySource: { reddit: number; x: number; youtube: number; web: number }
	}
	latency: {
		phase1Ms: number
		phase2Ms: number
		scoringMs: number
	}
	phase2: {
		enabled: boolean
		executed: boolean
		budgetTotal: number
		budgetUsed: number
		skippedReason: string | null
	}
	errors: string[]
	warnings: string[]
	cacheHits: number
	cacheMisses: number
	staleCacheUsed: boolean
	staleCacheAgeHours: number | null
}

// ---------------------------------------------------------------------------
// Factory + ID generation
// ---------------------------------------------------------------------------

/**
 * Generates a unique run identifier using `crypto.randomUUID()` when
 * available, falling back to a base-36 timestamp string for environments
 * that do not support the Web Crypto API.
 *
 * @returns A unique run identifier string.
 */
export function generateRunId(): string {
	try {
		return crypto.randomUUID()
	} catch {
		return Date.now().toString(36)
	}
}

/**
 * Creates a fresh `TelemetryCollector` with all counters zeroed and arrays
 * empty. Call this once at the beginning of a CLI run.
 *
 * @param runId - Unique run identifier, typically from `generateRunId()`.
 * @param topic - The topic being researched.
 * @returns A mutable collector ready for instrumentation.
 */
export function createCollector(
	runId: string,
	topic: string,
): TelemetryCollector {
	return {
		runId,
		topic,
		startedAt: new Date(),
		sources: {
			requested: [],
			executed: [],
			skipped: [],
		},
		counts: {
			rawCandidates: 0,
			bySource: { reddit: 0, x: 0, youtube: 0, web: 0 },
		},
		latency: {
			phase1Ms: 0,
			phase2Ms: 0,
			scoringMs: 0,
		},
		phase2: {
			enabled: false,
			executed: false,
			budgetTotal: 0,
			budgetUsed: 0,
			skippedReason: null,
		},
		errors: [],
		warnings: [],
		cacheHits: 0,
		cacheMisses: 0,
		staleCacheUsed: false,
		staleCacheAgeHours: null,
	}
}

// ---------------------------------------------------------------------------
// Recording helpers
// ---------------------------------------------------------------------------

/**
 * Records that a source was successfully executed and produced items.
 * Updates the `executed` source list and per-source item counts.
 *
 * @param collector - The active telemetry collector.
 * @param source    - Source identifier (e.g. `'reddit'`, `'x'`).
 * @param itemCount - Number of items returned by the source.
 */
export function recordSourceExecuted(
	collector: TelemetryCollector,
	source: TelemetrySource,
	itemCount: number,
): void {
	if (!collector.sources.executed.includes(source)) {
		collector.sources.executed.push(source)
	}
	collector.counts.rawCandidates += itemCount
	collector.counts.bySource[source] += itemCount
}

/**
 * Records that a source was skipped, including the reason code.
 * Adds to the `skipped` detail array on the collector.
 *
 * @param collector - The active telemetry collector.
 * @param skip      - Skip detail including source and reason code.
 */
export function recordSourceSkipped(
	collector: TelemetryCollector,
	skip: SourceSkipDetailV1,
): void {
	collector.sources.skipped.push(skip)
}

/**
 * Increments the cache-hit counter by one.
 *
 * @param collector - The active telemetry collector.
 */
export function recordCacheHit(collector: TelemetryCollector): void {
	collector.cacheHits += 1
}

/**
 * Increments the cache-miss counter by one.
 *
 * @param collector - The active telemetry collector.
 */
export function recordCacheMiss(collector: TelemetryCollector): void {
	collector.cacheMisses += 1
}

/**
 * Records the wall-clock duration of Phase 1 (primary source search).
 *
 * @param collector - The active telemetry collector.
 * @param ms        - Duration in milliseconds.
 */
export function recordPhase1Latency(
	collector: TelemetryCollector,
	ms: number,
): void {
	collector.latency.phase1Ms = ms
}

/**
 * Records the wall-clock duration of Phase 2 (supplemental entity search).
 *
 * @param collector - The active telemetry collector.
 * @param ms        - Duration in milliseconds.
 */
export function recordPhase2Latency(
	collector: TelemetryCollector,
	ms: number,
): void {
	collector.latency.phase2Ms = ms
}

/**
 * Records the wall-clock duration of the scoring and deduplication stage.
 *
 * @param collector - The active telemetry collector.
 * @param ms        - Duration in milliseconds.
 */
export function recordScoringLatency(
	collector: TelemetryCollector,
	ms: number,
): void {
	collector.latency.scoringMs = ms
}

/**
 * Appends an error message to the collector's error list.
 *
 * @param collector - The active telemetry collector.
 * @param error     - Human-readable error description.
 */
export function recordError(
	collector: TelemetryCollector,
	error: string,
): void {
	collector.errors.push(error)
}

/**
 * Appends a warning message to the collector's warning list.
 *
 * @param collector - The active telemetry collector.
 * @param warning   - Human-readable warning description.
 */
export function recordWarning(
	collector: TelemetryCollector,
	warning: string,
): void {
	collector.warnings.push(warning)
}

// ---------------------------------------------------------------------------
// Finalize
// ---------------------------------------------------------------------------

/** Options required to finalize a telemetry payload. */
export interface FinalizeOpts {
	/** Query intent class. */
	queryType: 'PROMPTING' | 'RECOMMENDATIONS' | 'NEWS' | 'GENERAL'
	/** Retrieval strategy used. */
	strategy: 'single' | 'two-phase'
	/** Depth preset used. */
	depth: 'quick' | 'default' | 'deep'
	/** Lookback window in days. */
	days: number
	/** ISO date string for the start of the range. */
	fromDate: string
	/** ISO date string for the end of the range. */
	toDate: string
	/** Final de-duped item count after scoring. */
	finalItemCount: number
	/** Top trends (empty for now, wired in a future PR). */
	topTrends: []
}

/**
 * Derives a letter grade from an item count using simple thresholds.
 * Used as a quick data-quality indicator in dashboards.
 *
 * @param count - Number of final items in the report.
 * @returns One of `'A' | 'B' | 'C' | 'D' | 'F'`.
 */
function gradeFromCount(count: number): 'A' | 'B' | 'C' | 'D' | 'F' {
	if (count > 20) return 'A'
	if (count > 10) return 'B'
	if (count > 5) return 'C'
	if (count > 0) return 'D'
	return 'F'
}

/**
 * Finalizes the telemetry collector into a complete `RunCompletedDataV1`
 * payload ready for wrapping in an envelope or emitting directly.
 *
 * Cost fields are all zero for v1 -- proper cost tracking is deferred.
 * Confidence score is a fixed 50 placeholder; proper calculation is deferred.
 *
 * @param collector - The collector with all recorded metrics.
 * @param opts      - Run-level options needed to fill contract fields.
 * @returns A fully-populated `RunCompletedDataV1` object.
 */
export function finalize(
	collector: TelemetryCollector,
	opts: FinalizeOpts,
): RunCompletedDataV1 {
	const completedAt = new Date()
	const durationMs = completedAt.getTime() - collector.startedAt.getTime()

	const latency: LatencySummaryV1 = {
		phase1_ms: collector.latency.phase1Ms,
		phase2_ms: collector.latency.phase2Ms,
		scoring_ms: collector.latency.scoringMs,
		total_ms: durationMs,
	}

	const phase2: Phase2SummaryV1 = {
		enabled: collector.phase2.enabled,
		executed: collector.phase2.executed,
		budget_total: collector.phase2.budgetTotal,
		budget_used: collector.phase2.budgetUsed,
		// Phase2SkipReason union allows string literals + null
		skipped_reason: collector.phase2.skippedReason as
			| 'disabled'
			| 'quick_mode_default'
			| 'no_entities'
			| 'rate_limited'
			| 'stale_fallback_active'
			| 'budget_exceeded'
			| null,
	}

	const cost: CostSummaryV1 = {
		estimated_total_usd: 0,
		by_provider: { openai: 0, xai: 0, youtube: 0, web: 0 },
	}

	const grade = gradeFromCount(opts.finalItemCount)

	const dataQuality: DataQualityV1 = {
		schema_version: 'data_quality.v1',
		computation_version: 'dq-v1',
		total_items: opts.finalItemCount,
		dated_items: 0,
		undated_items: 0,
		in_range_items: opts.finalItemCount,
		fresh_72h_items: 0,
		trends_total: 0,
		multi_source_trends: 0,
		citations_checked: 0,
		citations_resolvable: 0,
		rate_limited_source_count: 0,
		partial_source_failure_count: collector.errors.length,
		stale_cache_used: collector.staleCacheUsed,
		stale_cache_age_hours: collector.staleCacheAgeHours,
		execution_health_score: collector.errors.length === 0 ? 100 : 50,
		ratios: {
			dated_ratio: 0,
			in_range_ratio: opts.finalItemCount > 0 ? 1 : 0,
			fresh_72h_ratio: 0,
			multi_source_trend_ratio: 0,
			citation_resolvable_ratio: 0,
		},
		quality_score: 0,
		quality_grade: grade,
	}

	const confidence: ConfidenceV1 = {
		schema_version: 'confidence.v1',
		calculation_version: 'conf-v1',
		score: 50,
		label: 'medium',
		factors: {
			freshness: 50,
			source_confirmation: 50,
			citation_validity: 50,
			data_completeness: 50,
			execution_health: collector.errors.length === 0 ? 100 : 50,
		},
		weights: {
			freshness: 0.3,
			source_confirmation: 0.25,
			citation_validity: 0.25,
			data_completeness: 0.1,
			execution_health: 0.1,
		},
		reason_codes: [],
		explanation:
			'Placeholder confidence score (v1 -- full calculation deferred)',
	}

	const hasErrors = collector.errors.length > 0
	const status: 'success' | 'partial_success' = hasErrors
		? 'partial_success'
		: 'success'

	return {
		contract_version: 'l30d.run.completed.v1',
		run_id: collector.runId,
		topic: collector.topic,
		query_type: opts.queryType,
		strategy: opts.strategy,
		depth: opts.depth,
		days: opts.days,
		range: { from: opts.fromDate, to: opts.toDate },
		started_at: collector.startedAt.toISOString(),
		completed_at: completedAt.toISOString(),
		duration_ms: durationMs,
		status,
		sources_requested: collector.sources.requested,
		sources_executed: collector.sources.executed,
		sources_skipped:
			collector.sources.skipped.length > 0
				? collector.sources.skipped
				: undefined,
		phase2,
		counts: {
			raw_candidates_total: collector.counts.rawCandidates,
			final_total: opts.finalItemCount,
			by_source: {
				reddit: collector.counts.bySource.reddit,
				x: collector.counts.bySource.x,
				youtube: collector.counts.bySource.youtube,
				web: collector.counts.bySource.web,
			},
		},
		latency,
		cost,
		top_trends: opts.topTrends,
		data_quality: dataQuality,
		confidence,
		warnings: collector.warnings.length > 0 ? collector.warnings : undefined,
	}
}

// ---------------------------------------------------------------------------
// Envelope + emit
// ---------------------------------------------------------------------------

/**
 * Wraps a `RunCompletedDataV1` payload in the standard telemetry envelope,
 * adding schema metadata, a unique event ID, and routing fields.
 *
 * @param data - The finalized run payload from `finalize()`.
 * @returns A fully-populated `RunCompletedEnvelopeV1`.
 */
export function wrapInEnvelope(
	data: RunCompletedDataV1,
): RunCompletedEnvelopeV1 {
	let eventId: string
	try {
		eventId = crypto.randomUUID()
	} catch {
		eventId = Date.now().toString(36)
	}

	return {
		schemaVersion: '1.0.0',
		id: eventId,
		timestamp: new Date().toISOString(),
		type: 'l30d.run.completed',
		app: 'last-30-days',
		appRoot: process.cwd(),
		source: 'cli',
		correlationId: data.run_id,
		data,
	}
}

/**
 * Emits a telemetry envelope according to the requested mode.
 *
 * - `quiet`  : Writes `report.metrics.json` to `outdir` when provided; no-op
 *              if outdir is absent.
 * - `verbose`: Writes JSON to stderr AND writes the file if outdir is set.
 * - `file`   : Always writes `report.metrics.json`; uses `process.cwd()` when
 *              no outdir is provided.
 *
 * All filesystem operations are wrapped in a try/catch so a disk error never
 * breaks the main search flow.
 *
 * @param envelope - The wrapped telemetry envelope to emit.
 * @param mode     - Emission mode: `'quiet' | 'verbose' | 'file'`.
 * @param outdir   - Optional output directory path.
 */
export function emitTelemetry(
	envelope: RunCompletedEnvelopeV1,
	mode: 'quiet' | 'verbose' | 'file',
	outdir?: string,
): void {
	const json = JSON.stringify(envelope, null, 2)

	if (mode === 'verbose') {
		process.stderr.write(`[telemetry] ${json}\n`)
	}

	const writeDir = outdir ?? (mode === 'file' ? process.cwd() : undefined)

	if (writeDir) {
		try {
			mkdirSync(writeDir, { recursive: true })
			writeFileSync(join(writeDir, 'report.metrics.json'), json, 'utf-8')
		} catch {
			// Telemetry write failure must never break the main flow.
		}
	}
}
