/**
 * Telemetry contract types for l30d.run.completed v1.
 *
 * These interfaces mirror the schemas in specs/telemetry/*.schema.json and are
 * intended as the single TypeScript source-of-truth for builders and validators.
 */

/** Supported query intent classes used by retrieval policy. */
export type QueryType = 'PROMPTING' | 'RECOMMENDATIONS' | 'NEWS' | 'GENERAL'

/** Supported retrieval strategies. */
export type RetrievalStrategy = 'single' | 'two-phase'

/** Supported depth presets. */
export type RetrievalDepth = 'quick' | 'default' | 'deep'

/** Source identifiers in telemetry payloads. */
export type TelemetrySource = 'reddit' | 'x' | 'youtube' | 'web'

/** Confidence labels used in UI and CI checks. */
export type ConfidenceLabel = 'high' | 'medium' | 'low'

/** Data-quality letter grades used in dashboards. */
export type DataQualityGrade = 'A' | 'B' | 'C' | 'D' | 'F'

/** Canonical confidence reason codes. */
export type ConfidenceReasonCode =
	| 'low_freshness'
	| 'low_source_confirmation'
	| 'low_citation_validity'
	| 'low_data_completeness'
	| 'rate_limited'
	| 'stale_cache_used'
	| 'partial_source_failure'
	| 'low_volume'

/** Source skip reason codes for run payloads. */
export type SourceSkipReasonCode =
	| 'not_configured'
	| 'disabled_by_flag'
	| 'quick_mode_skip'
	| 'rate_limited'
	| 'budget_exceeded'
	| 'tool_unavailable'
	| 'timeout'

/** Phase-2 skip reasons for run payloads. */
export type Phase2SkipReason =
	| 'disabled'
	| 'quick_mode_default'
	| 'no_entities'
	| 'rate_limited'
	| 'stale_fallback_active'
	| 'budget_exceeded'
	| null

/** Trend category for top trend cards. */
export type TrendCategory =
	| 'product'
	| 'company'
	| 'person'
	| 'technology'
	| 'framework'
	| 'topic'
	| 'other'

/** Optional map for forward-compatible extension fields. */
export type Extensions = Record<string, unknown>

/** Confidence factor subscores (0-100). */
export interface ConfidenceFactorsV1 {
	freshness: number
	source_confirmation: number
	citation_validity: number
	data_completeness: number
	execution_health: number
}

/** Confidence weights (locked for v1). */
export interface ConfidenceWeightsV1 {
	freshness: 0.3
	source_confirmation: 0.25
	citation_validity: 0.25
	data_completeness: 0.1
	execution_health: 0.1
}

/** Confidence payload used at trend-level and run-level. */
export interface ConfidenceV1 {
	schema_version: 'confidence.v1'
	calculation_version: 'conf-v1'
	score: number
	label: ConfidenceLabel
	factors: ConfidenceFactorsV1
	weights: ConfidenceWeightsV1
	reason_codes: ConfidenceReasonCode[]
	explanation: string
	extensions?: Extensions
}

/** Ratio metrics derived from the run output. */
export interface DataQualityRatiosV1 {
	dated_ratio: number
	in_range_ratio: number
	fresh_72h_ratio: number
	multi_source_trend_ratio: number
	citation_resolvable_ratio: number
}

/** Run-level quality and health metrics. */
export interface DataQualityV1 {
	schema_version: 'data_quality.v1'
	computation_version: 'dq-v1'
	total_items: number
	dated_items: number
	undated_items: number
	in_range_items: number
	fresh_72h_items: number
	trends_total: number
	multi_source_trends: number
	citations_checked: number
	citations_resolvable: number
	rate_limited_source_count: number
	partial_source_failure_count: number
	stale_cache_used: boolean
	stale_cache_age_hours: number | null
	execution_health_score: number
	ratios: DataQualityRatiosV1
	quality_score: number
	quality_grade: DataQualityGrade
	extensions?: Extensions
}

/** Source skip detail for partially-executed runs. */
export interface SourceSkipDetailV1 {
	source: TelemetrySource
	reason_code: SourceSkipReasonCode
	message?: string
}

/** Phase-2 execution summary. */
export interface Phase2SummaryV1 {
	enabled: boolean
	executed: boolean
	budget_total: number
	budget_used: number
	skipped_reason: Phase2SkipReason
}

/** Source-wise item counts in final report. */
export interface CountBySourceV1 {
	reddit: number
	x: number
	youtube: number
	web: number
}

/** Item count summary across the run. */
export interface CountsSummaryV1 {
	raw_candidates_total: number
	final_total: number
	by_source: CountBySourceV1
}

/** Latency breakdown by stage. */
export interface LatencySummaryV1 {
	phase1_ms: number
	phase2_ms: number
	scoring_ms: number
	total_ms: number
}

/** Provider-level cost breakdown. */
export interface CostByProviderV1 {
	openai: number
	xai: number
	youtube: number
	web: number
}

/** Cost summary for the run. */
export interface CostSummaryV1 {
	estimated_total_usd: number
	by_provider: CostByProviderV1
}

/** A ranked trend emitted with run.completed. */
export interface TopTrendV1 {
	trend_id: string
	entity: string
	category: TrendCategory
	rank: number
	score: number
	delta_score?: number
	source_count: number
	sources: TelemetrySource[]
	evidence_urls: string[]
	summary?: string
	confidence: ConfidenceV1
}

/** Date range in YYYY-MM-DD format. */
export interface DateRangeV1 {
	from: string
	to: string
}

/** Core run.completed data payload. */
export interface RunCompletedDataV1 {
	contract_version: 'l30d.run.completed.v1'
	run_id: string
	topic: string
	query_type: QueryType
	strategy: RetrievalStrategy
	depth: RetrievalDepth
	days: number
	range: DateRangeV1
	started_at: string
	completed_at: string
	duration_ms: number
	status: 'success' | 'partial_success'
	sources_requested: TelemetrySource[]
	sources_executed: TelemetrySource[]
	sources_skipped?: SourceSkipDetailV1[]
	phase2: Phase2SummaryV1
	counts: CountsSummaryV1
	latency: LatencySummaryV1
	cost: CostSummaryV1
	top_trends: TopTrendV1[]
	data_quality: DataQualityV1
	confidence: ConfidenceV1
	warnings?: string[]
	extensions?: Extensions
}

/** Generic observability envelope used by side-quest observability server. */
export interface TelemetryEnvelopeV1<T = unknown> {
	schemaVersion: '1.0.0'
	id: string
	timestamp: string
	type: string
	app: string
	appRoot: string
	source: 'cli' | 'hook'
	correlationId: string
	data: T
}

/** Final event contract for l30d.run.completed. */
export interface RunCompletedEnvelopeV1
	extends TelemetryEnvelopeV1<RunCompletedDataV1> {
	type: 'l30d.run.completed'
	app: 'last-30-days'
	source: 'cli'
}
