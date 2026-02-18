import { z } from 'zod'
import type {
	ConfidenceReasonCode,
	ConfidenceV1,
	DataQualityGrade,
	DataQualityV1,
	Phase2SkipReason,
	RunCompletedDataV1,
	RunCompletedEnvelopeV1,
	SourceSkipReasonCode,
	TelemetrySource,
	TrendCategory,
} from '../../src/lib/telemetry-contract'

/** Compile-time helper to ensure schema <-> interface compatibility. */
type AssertExtends<_T extends U, U> = true

const telemetrySourceSchema = z.enum(['reddit', 'x', 'youtube', 'web'])

const confidenceLabelSchema = z.enum(['high', 'medium', 'low'])

const confidenceReasonCodeSchema = z.enum([
	'low_freshness',
	'low_source_confirmation',
	'low_citation_validity',
	'low_data_completeness',
	'rate_limited',
	'stale_cache_used',
	'partial_source_failure',
	'low_volume',
])

const confidenceSchema = z
	.object({
		schema_version: z.literal('confidence.v1'),
		calculation_version: z.literal('conf-v1'),
		score: z.number().int().min(0).max(100),
		label: confidenceLabelSchema,
		factors: z
			.object({
				freshness: z.number().int().min(0).max(100),
				source_confirmation: z.number().int().min(0).max(100),
				citation_validity: z.number().int().min(0).max(100),
				data_completeness: z.number().int().min(0).max(100),
				execution_health: z.number().int().min(0).max(100),
			})
			.strict(),
		weights: z
			.object({
				freshness: z.literal(0.3),
				source_confirmation: z.literal(0.25),
				citation_validity: z.literal(0.25),
				data_completeness: z.literal(0.1),
				execution_health: z.literal(0.1),
			})
			.strict(),
		reason_codes: z.array(confidenceReasonCodeSchema),
		explanation: z.string().min(1).max(500),
		extensions: z.record(z.unknown()).optional(),
	})
	.strict()

const dataQualityGradeSchema = z.enum(['A', 'B', 'C', 'D', 'F'])

const dataQualitySchema = z
	.object({
		schema_version: z.literal('data_quality.v1'),
		computation_version: z.literal('dq-v1'),
		total_items: z.number().int().min(0),
		dated_items: z.number().int().min(0),
		undated_items: z.number().int().min(0),
		in_range_items: z.number().int().min(0),
		fresh_72h_items: z.number().int().min(0),
		trends_total: z.number().int().min(0),
		multi_source_trends: z.number().int().min(0),
		citations_checked: z.number().int().min(0),
		citations_resolvable: z.number().int().min(0),
		rate_limited_source_count: z.number().int().min(0),
		partial_source_failure_count: z.number().int().min(0),
		stale_cache_used: z.boolean(),
		stale_cache_age_hours: z.number().min(0).nullable(),
		execution_health_score: z.number().int().min(0).max(100),
		ratios: z
			.object({
				dated_ratio: z.number().min(0).max(1),
				in_range_ratio: z.number().min(0).max(1),
				fresh_72h_ratio: z.number().min(0).max(1),
				multi_source_trend_ratio: z.number().min(0).max(1),
				citation_resolvable_ratio: z.number().min(0).max(1),
			})
			.strict(),
		quality_score: z.number().int().min(0).max(100),
		quality_grade: dataQualityGradeSchema,
		extensions: z.record(z.unknown()).optional(),
	})
	.strict()

const sourceSkipReasonCodeSchema = z.enum([
	'not_configured',
	'disabled_by_flag',
	'quick_mode_skip',
	'rate_limited',
	'budget_exceeded',
	'tool_unavailable',
	'timeout',
])

const phase2SkipReasonSchema = z
	.enum([
		'disabled',
		'quick_mode_default',
		'no_entities',
		'rate_limited',
		'stale_fallback_active',
		'budget_exceeded',
	])
	.nullable()

const trendCategorySchema = z.enum([
	'product',
	'company',
	'person',
	'technology',
	'framework',
	'topic',
	'other',
])

const topTrendSchema = z
	.object({
		trend_id: z.string().regex(/^[A-Za-z0-9._:-]{3,128}$/),
		entity: z.string().min(1).max(200),
		category: trendCategorySchema,
		rank: z.number().int().min(1),
		score: z.number().min(0).max(100),
		delta_score: z.number().min(-100).max(100).optional(),
		source_count: z.number().int().min(1).max(4),
		sources: z.array(telemetrySourceSchema).min(1),
		evidence_urls: z.array(z.string().url()).min(1).max(5),
		summary: z.string().max(300).optional(),
		confidence: confidenceSchema,
	})
	.strict()

export const runCompletedDataSchema = z
	.object({
		contract_version: z.literal('l30d.run.completed.v1'),
		run_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
		topic: z.string().min(1).max(500),
		query_type: z.enum(['PROMPTING', 'RECOMMENDATIONS', 'NEWS', 'GENERAL']),
		strategy: z.enum(['single', 'two-phase']),
		depth: z.enum(['quick', 'default', 'deep']),
		days: z.number().int().min(1).max(365),
		range: z
			.object({
				from: z.string().date(),
				to: z.string().date(),
			})
			.strict(),
		started_at: z.string().datetime({ offset: true }),
		completed_at: z.string().datetime({ offset: true }),
		duration_ms: z.number().int().min(0),
		status: z.enum(['success', 'partial_success']),
		sources_requested: z.array(telemetrySourceSchema),
		sources_executed: z.array(telemetrySourceSchema),
		sources_skipped: z
			.array(
				z
					.object({
						source: telemetrySourceSchema,
						reason_code: sourceSkipReasonCodeSchema,
						message: z.string().max(300).optional(),
					})
					.strict(),
			)
			.optional(),
		phase2: z
			.object({
				enabled: z.boolean(),
				executed: z.boolean(),
				budget_total: z.number().int().min(0),
				budget_used: z.number().int().min(0),
				skipped_reason: phase2SkipReasonSchema,
			})
			.strict(),
		counts: z
			.object({
				raw_candidates_total: z.number().int().min(0),
				final_total: z.number().int().min(0),
				by_source: z
					.object({
						reddit: z.number().int().min(0),
						x: z.number().int().min(0),
						youtube: z.number().int().min(0),
						web: z.number().int().min(0),
					})
					.strict(),
			})
			.strict(),
		latency: z
			.object({
				phase1_ms: z.number().int().min(0),
				phase2_ms: z.number().int().min(0),
				scoring_ms: z.number().int().min(0),
				total_ms: z.number().int().min(0),
			})
			.strict(),
		cost: z
			.object({
				estimated_total_usd: z.number().min(0),
				by_provider: z
					.object({
						openai: z.number().min(0),
						xai: z.number().min(0),
						youtube: z.number().min(0),
						web: z.number().min(0),
					})
					.strict(),
			})
			.strict(),
		top_trends: z.array(topTrendSchema).max(20),
		data_quality: dataQualitySchema,
		confidence: confidenceSchema,
		warnings: z.array(z.string().max(200)).optional(),
		extensions: z.record(z.unknown()).optional(),
	})
	.strict()

export const runCompletedEnvelopeSchema = z
	.object({
		schemaVersion: z.literal('1.0.0'),
		id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
		timestamp: z.string().datetime({ offset: true }),
		type: z.literal('l30d.run.completed'),
		app: z.literal('last-30-days'),
		appRoot: z.string().min(1),
		source: z.literal('cli'),
		correlationId: z.string().regex(/^[a-f0-9]{8}$|^[A-Za-z0-9_-]{8,64}$/),
		data: runCompletedDataSchema,
	})
	.strict()

/** Validate and parse a run.completed envelope. Throws on invalid payload. */
export function parseRunCompletedEnvelope(
	payload: unknown,
): RunCompletedEnvelopeV1 {
	return runCompletedEnvelopeSchema.parse(payload) as RunCompletedEnvelopeV1
}

/** Safe validator for run.completed envelopes. */
export function validateRunCompletedEnvelope(payload: unknown):
	| {
			ok: true
			data: RunCompletedEnvelopeV1
	  }
	| {
			ok: false
			errors: string[]
	  } {
	const parsed = runCompletedEnvelopeSchema.safeParse(payload)
	if (parsed.success) {
		return { ok: true, data: parsed.data as RunCompletedEnvelopeV1 }
	}
	return {
		ok: false,
		errors: parsed.error.issues.map((issue) => {
			const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
			return `${path}: ${issue.message}`
		}),
	}
}

/**
 * Compute execution health score from run-level failure counters.
 * Formula lock: 100 - 10*rate_limited - 15*partial_failures - stale_penalty.
 */
export function computeExecutionHealthScore(input: {
	rateLimitedSourceCount: number
	partialSourceFailureCount: number
	staleCacheUsed: boolean
}): number {
	const raw =
		100 -
		10 * input.rateLimitedSourceCount -
		15 * input.partialSourceFailureCount -
		(input.staleCacheUsed ? 10 : 0)
	return Math.max(0, Math.min(100, Math.round(raw)))
}

/** Compute quality score using the locked v1 weighted formula. */
export function computeDataQualityScore(input: {
	inRangeRatio: number
	fresh72hRatio: number
	multiSourceTrendRatio: number
	citationResolvableRatio: number
	executionHealthScore: number
}): number {
	const raw =
		0.3 * input.inRangeRatio * 100 +
		0.25 * input.fresh72hRatio * 100 +
		0.2 * input.multiSourceTrendRatio * 100 +
		0.2 * input.citationResolvableRatio * 100 +
		0.05 * input.executionHealthScore
	return Math.max(0, Math.min(100, Math.round(raw)))
}

/** Convert quality score to locked v1 letter grade. */
export function getDataQualityGrade(score: number): DataQualityGrade {
	if (score >= 85) return 'A'
	if (score >= 70) return 'B'
	if (score >= 55) return 'C'
	if (score >= 40) return 'D'
	return 'F'
}

/** Compute run-level confidence score using locked v1 weights. */
export function computeConfidenceScore(input: {
	freshness: number
	sourceConfirmation: number
	citationValidity: number
	dataCompleteness: number
	executionHealth: number
}): number {
	const raw =
		0.3 * input.freshness +
		0.25 * input.sourceConfirmation +
		0.25 * input.citationValidity +
		0.1 * input.dataCompleteness +
		0.1 * input.executionHealth
	return Math.max(0, Math.min(100, Math.round(raw)))
}

/** Convert confidence score to locked v1 label. */
export function getConfidenceLabel(score: number): 'high' | 'medium' | 'low' {
	if (score >= 80) return 'high'
	if (score >= 60) return 'medium'
	return 'low'
}

// compile-time schema/interface alignment checks
export type RunCompletedDataFromSchema = z.infer<typeof runCompletedDataSchema>
export type RunCompletedEnvelopeFromSchema = z.infer<
	typeof runCompletedEnvelopeSchema
>

type _checkDataAssignabilityA = AssertExtends<
	RunCompletedDataFromSchema,
	RunCompletedDataV1
>
type _checkDataAssignabilityB = AssertExtends<
	RunCompletedDataV1,
	RunCompletedDataFromSchema
>

type _checkEnvelopeAssignabilityA = AssertExtends<
	RunCompletedEnvelopeFromSchema,
	RunCompletedEnvelopeV1
>
type _checkEnvelopeAssignabilityB = AssertExtends<
	RunCompletedEnvelopeV1,
	RunCompletedEnvelopeFromSchema
>

type _touchSource = TelemetrySource
type _touchReason =
	| ConfidenceReasonCode
	| SourceSkipReasonCode
	| Phase2SkipReason

type _touchTrendCategory = TrendCategory
type _touchContracts = ConfidenceV1 | DataQualityV1
