import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	computeConfidenceScore,
	computeDataQualityScore,
	computeExecutionHealthScore,
	getConfidenceLabel,
	getDataQualityGrade,
	parseRunCompletedEnvelope,
} from './validator'

/** Validate the canonical run.completed sample fixture. */
function main(): void {
	const fixturePath = join(
		process.cwd(),
		'fixtures',
		'telemetry',
		'run.completed.v1.sample.json',
	)
	const raw = readFileSync(fixturePath, 'utf-8')
	const payload = JSON.parse(raw) as unknown

	const envelope = parseRunCompletedEnvelope(payload)
	const dq = envelope.data.data_quality
	const conf = envelope.data.confidence

	const health = computeExecutionHealthScore({
		rateLimitedSourceCount: dq.rate_limited_source_count,
		partialSourceFailureCount: dq.partial_source_failure_count,
		staleCacheUsed: dq.stale_cache_used,
	})
	const expectedDq = computeDataQualityScore({
		inRangeRatio: dq.ratios.in_range_ratio,
		fresh72hRatio: dq.ratios.fresh_72h_ratio,
		multiSourceTrendRatio: dq.ratios.multi_source_trend_ratio,
		citationResolvableRatio: dq.ratios.citation_resolvable_ratio,
		executionHealthScore: health,
	})
	const expectedDqGrade = getDataQualityGrade(expectedDq)
	const expectedConf = computeConfidenceScore({
		freshness: conf.factors.freshness,
		sourceConfirmation: conf.factors.source_confirmation,
		citationValidity: conf.factors.citation_validity,
		dataCompleteness: conf.factors.data_completeness,
		executionHealth: conf.factors.execution_health,
	})
	const expectedConfLabel = getConfidenceLabel(expectedConf)

	if (health !== dq.execution_health_score) {
		throw new Error(
			`execution_health_score mismatch: expected ${health}, got ${dq.execution_health_score}`,
		)
	}
	if (expectedDq !== dq.quality_score) {
		throw new Error(
			`quality_score mismatch: expected ${expectedDq}, got ${dq.quality_score}`,
		)
	}
	if (expectedDqGrade !== dq.quality_grade) {
		throw new Error(
			`quality_grade mismatch: expected ${expectedDqGrade}, got ${dq.quality_grade}`,
		)
	}
	if (expectedConf !== conf.score) {
		throw new Error(
			`confidence.score mismatch: expected ${expectedConf}, got ${conf.score}`,
		)
	}
	if (expectedConfLabel !== conf.label) {
		throw new Error(
			`confidence.label mismatch: expected ${expectedConfLabel}, got ${conf.label}`,
		)
	}

	console.log(
		JSON.stringify(
			{
				status: 'ok',
				fixture: fixturePath,
				contract: envelope.data.contract_version,
				run_id: envelope.data.run_id,
				quality_score: dq.quality_score,
				confidence_score: conf.score,
			},
			null,
			2,
		),
	)
}

main()
