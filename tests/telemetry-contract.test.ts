import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	computeConfidenceScore,
	computeDataQualityScore,
	computeExecutionHealthScore,
	getConfidenceLabel,
	getDataQualityGrade,
	parseRunCompletedEnvelope,
	validateRunCompletedEnvelope,
} from '../scripts/telemetry/validator'

describe('telemetry contract v1', () => {
	const fixturePath = join(process.cwd(), 'fixtures', 'telemetry', 'run.completed.v1.sample.json')
	const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as unknown

	test('sample payload parses as run.completed envelope', () => {
		const envelope = parseRunCompletedEnvelope(fixture)
		expect(envelope.type).toBe('l30d.run.completed')
		expect(envelope.app).toBe('last-30-days')
		expect(envelope.data.contract_version).toBe('l30d.run.completed.v1')
	})

	test('safe validator returns shape errors for invalid payload', () => {
		const invalid = {
			...(fixture as Record<string, unknown>),
			data: {
				...((fixture as Record<string, unknown>).data as Record<string, unknown>),
				run_id: 'bad',
			},
		}

		const result = validateRunCompletedEnvelope(invalid)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.errors.length).toBeGreaterThan(0)
			expect(result.errors.join(' ')).toContain('run_id')
		}
	})

	test('formula lock: execution health score', () => {
		expect(
			computeExecutionHealthScore({
				rateLimitedSourceCount: 0,
				partialSourceFailureCount: 0,
				staleCacheUsed: false,
			}),
		).toBe(100)
		expect(
			computeExecutionHealthScore({
				rateLimitedSourceCount: 2,
				partialSourceFailureCount: 1,
				staleCacheUsed: true,
			}),
		).toBe(55)
	})

	test('formula lock: data quality score and grade', () => {
		const score = computeDataQualityScore({
			inRangeRatio: 0.84375,
			fresh72hRatio: 0.65625,
			multiSourceTrendRatio: 0.6,
			citationResolvableRatio: 0.9583333333,
			executionHealthScore: 100,
		})
		expect(score).toBe(78)
		expect(getDataQualityGrade(score)).toBe('B')
	})

	test('formula lock: confidence score and label', () => {
		const score = computeConfidenceScore({
			freshness: 67,
			sourceConfirmation: 60,
			citationValidity: 96,
			dataCompleteness: 84,
			executionHealth: 100,
		})
		expect(score).toBe(78)
		expect(getConfidenceLabel(score)).toBe('medium')
	})
})
