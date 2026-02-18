import { describe, expect, test } from 'bun:test'
import type { EvalCluster, EvalItem } from '../src/lib/eval-metrics'
import {
	citationValidity,
	crossSourceConfirmation,
	freshnessAtK,
	medianRunCost,
	momentumPrecisionAtK,
	performanceP95,
	regressionSafety,
	runReliability,
	trendRecallAtK,
	watchlistDeltaUtility,
} from '../src/lib/eval-metrics'

// ---------------------------------------------------------------------------
// freshnessAtK
// ---------------------------------------------------------------------------
describe('freshnessAtK', () => {
	test('returns median age of top K items in hours', () => {
		const now = new Date()
		const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
		const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString()
		const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString()
		const items: EvalItem[] = [
			{ date: twoHoursAgo, score: 90, url: 'https://a.com' },
			{ date: fourHoursAgo, score: 80, url: 'https://b.com' },
			{ date: sixHoursAgo, score: 70, url: 'https://c.com' },
		]
		const result = freshnessAtK(items, 3)
		// Median of ~2, ~4, ~6 should be ~4
		expect(result).toBeGreaterThan(3.5)
		expect(result).toBeLessThan(4.5)
	})

	test('returns 0 for empty array', () => {
		expect(freshnessAtK([], 5)).toBe(0)
	})

	test('returns 0 for k=0', () => {
		const items: EvalItem[] = [{ date: '2025-01-01', score: 50, url: 'https://a.com' }]
		expect(freshnessAtK(items, 0)).toBe(0)
	})

	test('treats null dates as maxDays * 24 hours', () => {
		const items: EvalItem[] = [
			{ date: null, score: 90, url: 'https://a.com' },
			{ date: null, score: 80, url: 'https://b.com' },
		]
		const result = freshnessAtK(items, 2, 30)
		expect(result).toBe(720) // 30 * 24
	})

	test('handles k > items.length gracefully', () => {
		const now = new Date()
		const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString()
		const items: EvalItem[] = [{ date: oneHourAgo, score: 90, url: 'https://a.com' }]
		const result = freshnessAtK(items, 10)
		expect(result).toBeGreaterThan(0.5)
		expect(result).toBeLessThan(1.5)
	})
})

// ---------------------------------------------------------------------------
// trendRecallAtK
// ---------------------------------------------------------------------------
describe('trendRecallAtK', () => {
	test('finds oracle entities in item URLs', () => {
		const items: EvalItem[] = [
			{ date: null, score: 90, url: 'https://reddit.com/r/reactjs/post1' },
			{ date: null, score: 80, url: 'https://x.com/reactjs/status/123' },
		]
		const oracle = ['r/reactjs', 'reactjs']
		expect(trendRecallAtK(items, oracle, 2)).toBe(1)
	})

	test('returns 0 when no entities found', () => {
		const items: EvalItem[] = [{ date: null, score: 90, url: 'https://example.com' }]
		expect(trendRecallAtK(items, ['r/reactjs', '#RSC'], 1)).toBe(0)
	})

	test('returns 1 for empty oracle', () => {
		const items: EvalItem[] = [{ date: null, score: 90, url: 'https://a.com' }]
		expect(trendRecallAtK(items, [], 1)).toBe(1)
	})

	test('returns 0 for empty items', () => {
		expect(trendRecallAtK([], ['entity'], 5)).toBe(0)
	})

	test('returns 0 for k=0', () => {
		const items: EvalItem[] = [{ date: null, score: 90, url: 'https://a.com' }]
		expect(trendRecallAtK(items, ['a.com'], 0)).toBe(0)
	})

	test('case-insensitive matching', () => {
		const items: EvalItem[] = [{ date: null, score: 90, url: 'https://Reddit.com/R/ReactJS' }]
		expect(trendRecallAtK(items, ['r/reactjs'], 1)).toBe(1)
	})

	test('matches handle and hashtag entities against URL-compatible variants', () => {
		const items: EvalItem[] = [
			{
				date: null,
				score: 90,
				url: 'https://x.com/anthropicai/status/123',
			},
			{
				date: null,
				score: 80,
				url: 'https://example.com/topics/claude',
			},
		]
		expect(trendRecallAtK(items, ['@AnthropicAI', '#claude'], 2)).toBe(1)
	})

	test('matches multi-word entities in title/snippet/content corpus', () => {
		const items: EvalItem[] = [
			{
				date: null,
				score: 90,
				url: 'https://example.com/post/1',
				title: 'A practical guide to server actions',
			},
			{
				date: null,
				score: 80,
				url: 'https://example.com/post/2',
				snippet: 'How to reason about chain of thought in evaluations',
			},
		]
		expect(trendRecallAtK(items, ['server actions', 'chain of thought'], 2)).toBe(1)
	})
})

// ---------------------------------------------------------------------------
// momentumPrecisionAtK
// ---------------------------------------------------------------------------
describe('momentumPrecisionAtK', () => {
	test('counts items with positive momentum', () => {
		const items = [
			{ date: null, score: 90, url: 'https://a.com', momentum: 5 },
			{ date: null, score: 80, url: 'https://b.com', momentum: 0 },
			{ date: null, score: 70, url: 'https://c.com', momentum: -1 },
			{ date: null, score: 60, url: 'https://d.com', momentum: 3 },
		]
		expect(momentumPrecisionAtK(items, 4)).toBe(0.5)
	})

	test('treats missing momentum as 0', () => {
		const items: EvalItem[] = [{ date: null, score: 90, url: 'https://a.com' }]
		expect(momentumPrecisionAtK(items, 1)).toBe(0)
	})

	test('returns 0 for empty array', () => {
		expect(momentumPrecisionAtK([], 5)).toBe(0)
	})

	test('returns 0 for k=0', () => {
		const items = [{ date: null, score: 90, url: 'https://a.com', momentum: 10 }]
		expect(momentumPrecisionAtK(items, 0)).toBe(0)
	})
})

// ---------------------------------------------------------------------------
// crossSourceConfirmation
// ---------------------------------------------------------------------------
describe('crossSourceConfirmation', () => {
	test('counts clusters meeting minSources threshold', () => {
		const clusters: EvalCluster[] = [
			{ sourceTypes: ['reddit', 'x', 'web'] },
			{ sourceTypes: ['reddit'] },
			{ sourceTypes: ['x', 'web'] },
		]
		expect(crossSourceConfirmation(clusters, 2)).toBeCloseTo(2 / 3)
	})

	test('returns 0 for empty clusters', () => {
		expect(crossSourceConfirmation([], 2)).toBe(0)
	})

	test('deduplicates source types within a cluster', () => {
		const clusters: EvalCluster[] = [{ sourceTypes: ['reddit', 'reddit', 'reddit'] }]
		// Only 1 unique source, needs 2
		expect(crossSourceConfirmation(clusters, 2)).toBe(0)
	})
})

// ---------------------------------------------------------------------------
// citationValidity
// ---------------------------------------------------------------------------
describe('citationValidity', () => {
	test('counts items with valid URLs', () => {
		const items: EvalItem[] = [
			{ date: null, score: 90, url: 'https://example.com/page' },
			{ date: null, score: 80, url: 'http://example.org' },
			{ date: null, score: 70, url: '' },
			{ date: null, score: 60, url: 'not-a-url' },
		]
		expect(citationValidity(items)).toBe(0.5)
	})

	test('returns 0 for empty array', () => {
		expect(citationValidity([])).toBe(0)
	})

	test('returns 1 when all URLs valid', () => {
		const items: EvalItem[] = [
			{ date: null, score: 90, url: 'https://a.com' },
			{ date: null, score: 80, url: 'http://b.com/path' },
		]
		expect(citationValidity(items)).toBe(1)
	})
})

// ---------------------------------------------------------------------------
// runReliability
// ---------------------------------------------------------------------------
describe('runReliability', () => {
	test('computes fraction of successful runs', () => {
		const runs = [{ success: true }, { success: true }, { success: false }, { success: true }]
		expect(runReliability(runs)).toBe(0.75)
	})

	test('returns 0 for empty array', () => {
		expect(runReliability([])).toBe(0)
	})

	test('returns 1 when all successful', () => {
		expect(runReliability([{ success: true }, { success: true }])).toBe(1)
	})
})

// ---------------------------------------------------------------------------
// performanceP95
// ---------------------------------------------------------------------------
describe('performanceP95', () => {
	test('computes 95th percentile', () => {
		// 20 values: 1..20. p95 = ceil(20*0.95)-1 = 19-1 = 18 -> value 19
		const durations = Array.from({ length: 20 }, (_, i) => i + 1)
		expect(performanceP95(durations)).toBe(19)
	})

	test('returns 0 for empty array', () => {
		expect(performanceP95([])).toBe(0)
	})

	test('single element returns that element', () => {
		expect(performanceP95([42])).toBe(42)
	})
})

// ---------------------------------------------------------------------------
// medianRunCost
// ---------------------------------------------------------------------------
describe('medianRunCost', () => {
	test('returns median of odd-length array', () => {
		expect(medianRunCost([1, 3, 5])).toBe(3)
	})

	test('returns median of even-length array', () => {
		expect(medianRunCost([1, 2, 3, 4])).toBe(2.5)
	})

	test('returns 0 for empty array', () => {
		expect(medianRunCost([])).toBe(0)
	})

	test('handles unsorted input', () => {
		expect(medianRunCost([5, 1, 3])).toBe(3)
	})
})

// ---------------------------------------------------------------------------
// watchlistDeltaUtility
// ---------------------------------------------------------------------------
describe('watchlistDeltaUtility', () => {
	test('computes fraction of useful ratings', () => {
		const ratings = [{ useful: true }, { useful: false }, { useful: true }]
		expect(watchlistDeltaUtility(ratings)).toBeCloseTo(2 / 3)
	})

	test('returns 0 for empty array', () => {
		expect(watchlistDeltaUtility([])).toBe(0)
	})

	test('returns 1 when all useful', () => {
		expect(watchlistDeltaUtility([{ useful: true }, { useful: true }])).toBe(1)
	})
})

// ---------------------------------------------------------------------------
// regressionSafety
// ---------------------------------------------------------------------------
describe('regressionSafety', () => {
	test('returns true when drop within threshold', () => {
		expect(regressionSafety(0.9, 0.95, 0.1)).toBe(true)
	})

	test('returns false when drop exceeds threshold', () => {
		expect(regressionSafety(0.5, 0.95, 0.1)).toBe(false)
	})

	test('returns true at exact threshold boundary', () => {
		// baseline - current = 0.05, threshold = 0.05 -> exactly equal -> true
		expect(regressionSafety(0.9, 0.95, 0.05)).toBe(true)
	})

	test('returns true when current exceeds baseline (improvement)', () => {
		expect(regressionSafety(1.0, 0.9, 0.02)).toBe(true)
	})
})
