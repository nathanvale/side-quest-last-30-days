/**
 * Tests for src/lib/telemetry.ts -- runtime telemetry collection.
 *
 * Covers: collector lifecycle, recording helpers, finalize, envelope wrapping,
 * and emit behaviour.
 */

import { describe, expect, test } from 'bun:test'

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	createCollector,
	emitTelemetry,
	finalize,
	generateRunId,
	recordCacheHit,
	recordCacheMiss,
	recordError,
	recordPhase1Latency,
	recordPhase2Latency,
	recordScoringLatency,
	recordSourceExecuted,
	recordSourceSkipped,
	recordWarning,
	wrapInEnvelope,
} from '../src/lib/telemetry'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid FinalizeOpts for tests. */
const defaultOpts = {
	queryType: 'GENERAL' as const,
	strategy: 'single' as const,
	depth: 'default' as const,
	days: 30,
	fromDate: '2025-12-20',
	toDate: '2026-01-19',
	finalItemCount: 15,
	topTrends: [] as [],
}

// ---------------------------------------------------------------------------
// generateRunId
// ---------------------------------------------------------------------------
describe('generateRunId', () => {
	test('returns a non-empty string', () => {
		const id = generateRunId()
		expect(typeof id).toBe('string')
		expect(id.length).toBeGreaterThan(0)
	})

	test('returns unique values on repeated calls', () => {
		const ids = new Set(Array.from({ length: 20 }, () => generateRunId()))
		expect(ids.size).toBe(20)
	})
})

// ---------------------------------------------------------------------------
// createCollector
// ---------------------------------------------------------------------------
describe('createCollector', () => {
	test('initializes with the provided runId and topic', () => {
		const c = createCollector('run-1', 'Claude Code')
		expect(c.runId).toBe('run-1')
		expect(c.topic).toBe('Claude Code')
	})

	test('startedAt is a recent Date', () => {
		const before = Date.now()
		const c = createCollector('x', 'test')
		const after = Date.now()
		expect(c.startedAt.getTime()).toBeGreaterThanOrEqual(before)
		expect(c.startedAt.getTime()).toBeLessThanOrEqual(after)
	})

	test('all arrays are initially empty', () => {
		const c = createCollector('x', 'test')
		expect(c.sources.requested).toEqual([])
		expect(c.sources.executed).toEqual([])
		expect(c.sources.skipped).toEqual([])
		expect(c.errors).toEqual([])
		expect(c.warnings).toEqual([])
	})

	test('all numeric counters start at zero', () => {
		const c = createCollector('x', 'test')
		expect(c.counts.rawCandidates).toBe(0)
		expect(c.counts.bySource.reddit).toBe(0)
		expect(c.counts.bySource.x).toBe(0)
		expect(c.counts.bySource.youtube).toBe(0)
		expect(c.counts.bySource.web).toBe(0)
		expect(c.cacheHits).toBe(0)
		expect(c.cacheMisses).toBe(0)
		expect(c.latency.phase1Ms).toBe(0)
		expect(c.latency.phase2Ms).toBe(0)
		expect(c.latency.scoringMs).toBe(0)
	})

	test('staleCacheUsed is false and staleCacheAgeHours is null', () => {
		const c = createCollector('x', 'test')
		expect(c.staleCacheUsed).toBe(false)
		expect(c.staleCacheAgeHours).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// recordSourceExecuted
// ---------------------------------------------------------------------------
describe('recordSourceExecuted', () => {
	test('adds source to executed list on first call', () => {
		const c = createCollector('x', 'test')
		recordSourceExecuted(c, 'reddit', 10)
		expect(c.sources.executed).toContain('reddit')
	})

	test('does not duplicate source in executed list', () => {
		const c = createCollector('x', 'test')
		recordSourceExecuted(c, 'reddit', 5)
		recordSourceExecuted(c, 'reddit', 3)
		expect(c.sources.executed.filter((s) => s === 'reddit').length).toBe(1)
	})

	test('accumulates rawCandidates count', () => {
		const c = createCollector('x', 'test')
		recordSourceExecuted(c, 'reddit', 10)
		recordSourceExecuted(c, 'x', 5)
		expect(c.counts.rawCandidates).toBe(15)
	})

	test('updates per-source count', () => {
		const c = createCollector('x', 'test')
		recordSourceExecuted(c, 'reddit', 7)
		expect(c.counts.bySource.reddit).toBe(7)
		expect(c.counts.bySource.x).toBe(0)
	})

	test('handles multiple sources independently', () => {
		const c = createCollector('x', 'test')
		recordSourceExecuted(c, 'reddit', 4)
		recordSourceExecuted(c, 'x', 6)
		recordSourceExecuted(c, 'youtube', 2)
		expect(c.counts.bySource.reddit).toBe(4)
		expect(c.counts.bySource.x).toBe(6)
		expect(c.counts.bySource.youtube).toBe(2)
	})
})

// ---------------------------------------------------------------------------
// recordSourceSkipped
// ---------------------------------------------------------------------------
describe('recordSourceSkipped', () => {
	test('adds skip detail to skipped array', () => {
		const c = createCollector('x', 'test')
		recordSourceSkipped(c, { source: 'youtube', reason_code: 'not_configured' })
		expect(c.sources.skipped).toHaveLength(1)
		expect(c.sources.skipped[0]?.source).toBe('youtube')
		expect(c.sources.skipped[0]?.reason_code).toBe('not_configured')
	})

	test('accumulates multiple skipped entries', () => {
		const c = createCollector('x', 'test')
		recordSourceSkipped(c, { source: 'youtube', reason_code: 'not_configured' })
		recordSourceSkipped(c, { source: 'web', reason_code: 'disabled_by_flag' })
		expect(c.sources.skipped).toHaveLength(2)
	})
})

// ---------------------------------------------------------------------------
// recordCacheHit / recordCacheMiss
// ---------------------------------------------------------------------------
describe('recordCacheHit / recordCacheMiss', () => {
	test('recordCacheHit increments cacheHits by 1', () => {
		const c = createCollector('x', 'test')
		recordCacheHit(c)
		recordCacheHit(c)
		expect(c.cacheHits).toBe(2)
	})

	test('recordCacheMiss increments cacheMisses by 1', () => {
		const c = createCollector('x', 'test')
		recordCacheMiss(c)
		expect(c.cacheMisses).toBe(1)
	})

	test('hits and misses are independent counters', () => {
		const c = createCollector('x', 'test')
		recordCacheHit(c)
		recordCacheMiss(c)
		recordCacheMiss(c)
		expect(c.cacheHits).toBe(1)
		expect(c.cacheMisses).toBe(2)
	})
})

// ---------------------------------------------------------------------------
// recordError / recordWarning
// ---------------------------------------------------------------------------
describe('recordError / recordWarning', () => {
	test('recordError appends to errors array', () => {
		const c = createCollector('x', 'test')
		recordError(c, 'API failed')
		recordError(c, 'Timeout')
		expect(c.errors).toEqual(['API failed', 'Timeout'])
	})

	test('recordWarning appends to warnings array', () => {
		const c = createCollector('x', 'test')
		recordWarning(c, 'rate limited')
		expect(c.warnings).toEqual(['rate limited'])
	})
})

// ---------------------------------------------------------------------------
// Latency helpers
// ---------------------------------------------------------------------------
describe('latency helpers', () => {
	test('recordPhase1Latency sets phase1Ms', () => {
		const c = createCollector('x', 'test')
		recordPhase1Latency(c, 420)
		expect(c.latency.phase1Ms).toBe(420)
	})

	test('recordPhase2Latency sets phase2Ms', () => {
		const c = createCollector('x', 'test')
		recordPhase2Latency(c, 150)
		expect(c.latency.phase2Ms).toBe(150)
	})

	test('recordScoringLatency sets scoringMs', () => {
		const c = createCollector('x', 'test')
		recordScoringLatency(c, 30)
		expect(c.latency.scoringMs).toBe(30)
	})
})

// ---------------------------------------------------------------------------
// finalize
// ---------------------------------------------------------------------------
describe('finalize', () => {
	test('produces a RunCompletedDataV1 with the correct contract_version', () => {
		const c = createCollector(generateRunId(), 'Bun 2.0')
		const data = finalize(c, defaultOpts)
		expect(data.contract_version).toBe('l30d.run.completed.v1')
	})

	test('run_id matches the collector runId', () => {
		const id = generateRunId()
		const c = createCollector(id, 'test')
		const data = finalize(c, defaultOpts)
		expect(data.run_id).toBe(id)
	})

	test('topic matches the collector topic', () => {
		const c = createCollector('x', 'Claude Code')
		const data = finalize(c, defaultOpts)
		expect(data.topic).toBe('Claude Code')
	})

	test('duration_ms is a positive number', () => {
		const c = createCollector('x', 'test')
		const data = finalize(c, defaultOpts)
		expect(data.duration_ms).toBeGreaterThanOrEqual(0)
	})

	test('counts.final_total matches finalItemCount option', () => {
		const c = createCollector('x', 'test')
		const data = finalize(c, { ...defaultOpts, finalItemCount: 12 })
		expect(data.counts.final_total).toBe(12)
	})

	test('counts.raw_candidates_total reflects recorded source executions', () => {
		const c = createCollector('x', 'test')
		recordSourceExecuted(c, 'reddit', 8)
		recordSourceExecuted(c, 'x', 4)
		const data = finalize(c, defaultOpts)
		expect(data.counts.raw_candidates_total).toBe(12)
	})

	test('quality_grade = A when finalItemCount > 20', () => {
		const c = createCollector('x', 'test')
		const data = finalize(c, { ...defaultOpts, finalItemCount: 21 })
		expect(data.data_quality.quality_grade).toBe('A')
	})

	test('quality_grade = B when finalItemCount > 10 and <= 20', () => {
		const c = createCollector('x', 'test')
		const data = finalize(c, { ...defaultOpts, finalItemCount: 11 })
		expect(data.data_quality.quality_grade).toBe('B')
	})

	test('quality_grade = C when finalItemCount > 5 and <= 10', () => {
		const c = createCollector('x', 'test')
		const data = finalize(c, { ...defaultOpts, finalItemCount: 6 })
		expect(data.data_quality.quality_grade).toBe('C')
	})

	test('quality_grade = D when finalItemCount > 0 and <= 5', () => {
		const c = createCollector('x', 'test')
		const data = finalize(c, { ...defaultOpts, finalItemCount: 3 })
		expect(data.data_quality.quality_grade).toBe('D')
	})

	test('quality_grade = F when finalItemCount = 0', () => {
		const c = createCollector('x', 'test')
		const data = finalize(c, { ...defaultOpts, finalItemCount: 0 })
		expect(data.data_quality.quality_grade).toBe('F')
	})

	test('status is success when no errors recorded', () => {
		const c = createCollector('x', 'test')
		const data = finalize(c, defaultOpts)
		expect(data.status).toBe('success')
	})

	test('status is partial_success when errors recorded', () => {
		const c = createCollector('x', 'test')
		recordError(c, 'Reddit API failed')
		const data = finalize(c, defaultOpts)
		expect(data.status).toBe('partial_success')
	})

	test('sources_skipped is undefined when no skips recorded', () => {
		const c = createCollector('x', 'test')
		const data = finalize(c, defaultOpts)
		expect(data.sources_skipped).toBeUndefined()
	})

	test('sources_skipped is present when skips are recorded', () => {
		const c = createCollector('x', 'test')
		recordSourceSkipped(c, { source: 'youtube', reason_code: 'not_configured' })
		const data = finalize(c, defaultOpts)
		expect(data.sources_skipped).toHaveLength(1)
	})

	test('warnings are undefined when none recorded', () => {
		const c = createCollector('x', 'test')
		const data = finalize(c, defaultOpts)
		expect(data.warnings).toBeUndefined()
	})

	test('warnings are present when recorded', () => {
		const c = createCollector('x', 'test')
		recordWarning(c, 'stale cache used')
		const data = finalize(c, defaultOpts)
		expect(data.warnings).toEqual(['stale cache used'])
	})

	test('latency fields reflect recorded values', () => {
		const c = createCollector('x', 'test')
		recordPhase1Latency(c, 300)
		recordPhase2Latency(c, 100)
		recordScoringLatency(c, 50)
		const data = finalize(c, defaultOpts)
		expect(data.latency.phase1_ms).toBe(300)
		expect(data.latency.phase2_ms).toBe(100)
		expect(data.latency.scoring_ms).toBe(50)
	})

	test('confidence score is 50 (placeholder)', () => {
		const c = createCollector('x', 'test')
		const data = finalize(c, defaultOpts)
		expect(data.confidence.score).toBe(50)
		expect(data.confidence.label).toBe('medium')
	})

	test('cost is all zeros', () => {
		const c = createCollector('x', 'test')
		const data = finalize(c, defaultOpts)
		expect(data.cost.estimated_total_usd).toBe(0)
		expect(data.cost.by_provider.openai).toBe(0)
		expect(data.cost.by_provider.xai).toBe(0)
	})

	test('data_quality schema_version is data_quality.v1', () => {
		const c = createCollector('x', 'test')
		const data = finalize(c, defaultOpts)
		expect(data.data_quality.schema_version).toBe('data_quality.v1')
	})

	test('range matches fromDate and toDate opts', () => {
		const c = createCollector('x', 'test')
		const data = finalize(c, {
			...defaultOpts,
			fromDate: '2025-12-01',
			toDate: '2025-12-31',
		})
		expect(data.range.from).toBe('2025-12-01')
		expect(data.range.to).toBe('2025-12-31')
	})
})

// ---------------------------------------------------------------------------
// wrapInEnvelope
// ---------------------------------------------------------------------------
describe('wrapInEnvelope', () => {
	test('type is l30d.run.completed', () => {
		const c = createCollector(generateRunId(), 'test')
		const data = finalize(c, defaultOpts)
		const env = wrapInEnvelope(data)
		expect(env.type).toBe('l30d.run.completed')
	})

	test('app is last-30-days', () => {
		const c = createCollector(generateRunId(), 'test')
		const data = finalize(c, defaultOpts)
		const env = wrapInEnvelope(data)
		expect(env.app).toBe('last-30-days')
	})

	test('source is cli', () => {
		const c = createCollector(generateRunId(), 'test')
		const data = finalize(c, defaultOpts)
		const env = wrapInEnvelope(data)
		expect(env.source).toBe('cli')
	})

	test('schemaVersion is 1.0.0', () => {
		const c = createCollector(generateRunId(), 'test')
		const data = finalize(c, defaultOpts)
		const env = wrapInEnvelope(data)
		expect(env.schemaVersion).toBe('1.0.0')
	})

	test('correlationId matches the run_id in data', () => {
		const id = generateRunId()
		const c = createCollector(id, 'test')
		const data = finalize(c, defaultOpts)
		const env = wrapInEnvelope(data)
		expect(env.correlationId).toBe(id)
	})

	test('id is a non-empty string', () => {
		const c = createCollector(generateRunId(), 'test')
		const data = finalize(c, defaultOpts)
		const env = wrapInEnvelope(data)
		expect(typeof env.id).toBe('string')
		expect(env.id.length).toBeGreaterThan(0)
	})

	test('timestamp is an ISO string', () => {
		const c = createCollector(generateRunId(), 'test')
		const data = finalize(c, defaultOpts)
		const env = wrapInEnvelope(data)
		expect(() => new Date(env.timestamp)).not.toThrow()
		expect(new Date(env.timestamp).toISOString()).toBe(env.timestamp)
	})

	test('data is the same RunCompletedDataV1 passed in', () => {
		const c = createCollector(generateRunId(), 'test')
		const data = finalize(c, defaultOpts)
		const env = wrapInEnvelope(data)
		expect(env.data).toBe(data)
	})
})

// ---------------------------------------------------------------------------
// emitTelemetry
// ---------------------------------------------------------------------------
describe('emitTelemetry', () => {
	test('quiet mode with no outdir is a no-op (does not throw)', () => {
		const c = createCollector(generateRunId(), 'test')
		const data = finalize(c, defaultOpts)
		const env = wrapInEnvelope(data)
		expect(() => emitTelemetry(env, 'quiet')).not.toThrow()
	})

	test('verbose mode with no outdir does not throw', () => {
		const c = createCollector(generateRunId(), 'test')
		const data = finalize(c, defaultOpts)
		const env = wrapInEnvelope(data)
		// verbose writes to stderr -- just verify no throw
		expect(() => emitTelemetry(env, 'verbose')).not.toThrow()
	})

	test('file mode writes report.metrics.json to the given outdir', () => {
		const outdir = join(tmpdir(), `telemetry-test-${Date.now()}`)
		const c = createCollector(generateRunId(), 'file-test')
		const data = finalize(c, defaultOpts)
		const env = wrapInEnvelope(data)

		emitTelemetry(env, 'file', outdir)

		const metricsPath = join(outdir, 'report.metrics.json')
		expect(existsSync(metricsPath)).toBe(true)

		const parsed = JSON.parse(readFileSync(metricsPath, 'utf-8')) as Record<string, unknown>
		expect(parsed.type).toBe('l30d.run.completed')
		expect(parsed.app).toBe('last-30-days')

		// Clean up
		rmSync(outdir, { recursive: true, force: true })
	})

	test('quiet mode with outdir writes report.metrics.json', () => {
		const outdir = join(tmpdir(), `telemetry-test-quiet-${Date.now()}`)
		const c = createCollector(generateRunId(), 'quiet-test')
		const data = finalize(c, defaultOpts)
		const env = wrapInEnvelope(data)

		emitTelemetry(env, 'quiet', outdir)

		const metricsPath = join(outdir, 'report.metrics.json')
		expect(existsSync(metricsPath)).toBe(true)

		// Clean up
		rmSync(outdir, { recursive: true, force: true })
	})
})
