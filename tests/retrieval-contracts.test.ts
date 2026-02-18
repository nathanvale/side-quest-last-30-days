import { describe, expect, test } from 'bun:test'

import { orchestrate } from '../src/lib/retrieval/orchestrator'
import { getQueryBudget } from '../src/lib/retrieval/query-policy'
import type { AdapterSearchConfig, PhaseResult, SearchAdapter } from '../src/lib/retrieval/types'
import { defaultMergePolicy, defaultOrchestratorConfig } from '../src/lib/retrieval/types'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Create a mock adapter that returns canned results. */
function mockAdapter(
	sourceType: 'reddit' | 'x' | 'web' | 'youtube',
	items: PhaseResult['items'] = [],
	opts: Partial<PhaseResult> = {},
): SearchAdapter {
	return {
		sourceType,
		search: async () => ({
			items,
			source: sourceType,
			phase: 1 as const,
			error: null,
			fromCache: false,
			cacheAgeHours: null,
			durationMs: 10,
			...opts,
		}),
	}
}

/** Create a mock adapter that throws. */
function failingAdapter(sourceType: 'reddit' | 'x'): SearchAdapter {
	return {
		sourceType,
		search: async () => {
			throw new Error(`${sourceType} search failed`)
		},
	}
}

/** Create a mock adapter that never resolves (for timeout tests). */
function hangingAdapter(sourceType: 'reddit' | 'x'): SearchAdapter {
	return {
		sourceType,
		search: () => new Promise<PhaseResult>(() => {}),
	}
}

const SEARCH_CONFIG: AdapterSearchConfig = {
	topic: 'test topic',
	fromDate: '2026-01-01',
	toDate: '2026-02-01',
	days: 30,
	depth: 'default',
	mock: true,
	cacheOpts: { skipRead: false, skipWrite: false },
}

// ---------------------------------------------------------------------------
// types.ts -- default factories
// ---------------------------------------------------------------------------
describe('retrieval/types', () => {
	test('defaultOrchestratorConfig returns expected shape', () => {
		const cfg = defaultOrchestratorConfig()
		expect(cfg.strategy).toBe('single')
		expect(cfg.phase2Budget).toBe(5)
		expect(cfg.timeoutMs).toBe(60_000)
	})

	test('defaultMergePolicy returns expected shape', () => {
		const mp = defaultMergePolicy()
		expect(mp.dedupeThreshold).toBe(0.7)
		expect(mp.maxItems).toBe(100)
		expect(mp.preferPhase1).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// query-policy.ts
// ---------------------------------------------------------------------------
describe('retrieval/query-policy', () => {
	test('quick budget', () => {
		const b = getQueryBudget('quick')
		expect(b.maxResults).toBe(10)
		expect(b.phase2Budget).toBe(2)
		expect(b.timeoutMs).toBe(30_000)
	})

	test('default budget', () => {
		const b = getQueryBudget('default')
		expect(b.maxResults).toBe(20)
		expect(b.phase2Budget).toBe(5)
		expect(b.timeoutMs).toBe(60_000)
	})

	test('deep budget', () => {
		const b = getQueryBudget('deep')
		expect(b.maxResults).toBe(50)
		expect(b.phase2Budget).toBe(10)
		expect(b.timeoutMs).toBe(120_000)
	})

	test('unknown depth falls back to default', () => {
		const b = getQueryBudget('unknown')
		expect(b.maxResults).toBe(20)
		expect(b.phase2Budget).toBe(5)
	})
})

// ---------------------------------------------------------------------------
// orchestrator.ts
// ---------------------------------------------------------------------------
describe('retrieval/orchestrator', () => {
	test('empty adapter array returns empty results', async () => {
		const results = await orchestrate([], SEARCH_CONFIG)
		expect(results).toEqual([])
	})

	test('single adapter returns one PhaseResult', async () => {
		const adapter = mockAdapter('reddit')
		const results = await orchestrate([adapter], SEARCH_CONFIG)
		expect(results).toHaveLength(1)
		expect(results[0]!.source).toBe('reddit')
		expect(results[0]!.phase).toBe(1)
		expect(results[0]!.error).toBeNull()
	})

	test('multiple adapters run in parallel', async () => {
		const adapters = [mockAdapter('reddit'), mockAdapter('x')]
		const results = await orchestrate(adapters, SEARCH_CONFIG)
		expect(results).toHaveLength(2)
		expect(results[0]!.source).toBe('reddit')
		expect(results[1]!.source).toBe('x')
	})

	test('adapter items are passed through', async () => {
		const items = [
			{
				id: 'r1',
				title: 'Test Post',
				url: 'https://reddit.com/r/test/1',
				subreddit: 'test',
				date: '2026-01-15',
				date_confidence: 'high',
				engagement: null,
				top_comments: [],
				comment_insights: [],
				relevance: 0.8,
				why_relevant: 'test',
				subs: { relevance: 80, recency: 50, engagement: 0 },
				score: 65,
			},
		]
		const adapter = mockAdapter('reddit', items)
		const results = await orchestrate([adapter], SEARCH_CONFIG)
		expect(results[0]!.items).toHaveLength(1)
		expect(results[0]!.items[0]!).toEqual(items[0])
	})

	test('failing adapter returns error PhaseResult', async () => {
		const adapters = [mockAdapter('reddit'), failingAdapter('x')]
		const results = await orchestrate(adapters, SEARCH_CONFIG)
		expect(results).toHaveLength(2)
		expect(results[0]!.error).toBeNull()
		expect(results[1]!.error).toContain('x search failed')
		expect(results[1]!.items).toEqual([])
		expect(results[1]!.source).toBe('x')
	})

	test('all adapters failing still returns results array', async () => {
		const adapters = [failingAdapter('reddit'), failingAdapter('x')]
		const results = await orchestrate(adapters, SEARCH_CONFIG)
		expect(results).toHaveLength(2)
		expect(results[0]!.error).toContain('reddit search failed')
		expect(results[1]!.error).toContain('x search failed')
	})

	test('timeout produces error PhaseResult', async () => {
		const adapter = hangingAdapter('reddit')
		const orchConfig = { ...defaultOrchestratorConfig(), timeoutMs: 50 }
		const results = await orchestrate([adapter], SEARCH_CONFIG, orchConfig)
		expect(results).toHaveLength(1)
		expect(results[0]!.error).toContain('timed out')
		expect(results[0]!.items).toEqual([])
	})

	test('cached result is passed through', async () => {
		const adapter = mockAdapter('reddit', [], {
			fromCache: true,
			cacheAgeHours: 2.5,
		})
		const results = await orchestrate([adapter], SEARCH_CONFIG)
		expect(results[0]!.fromCache).toBe(true)
		expect(results[0]!.cacheAgeHours).toBe(2.5)
	})

	test('mixed success and failure preserves order', async () => {
		const adapters = [failingAdapter('reddit'), mockAdapter('x'), failingAdapter('reddit')]
		const results = await orchestrate(adapters, SEARCH_CONFIG)
		expect(results).toHaveLength(3)
		expect(results[0]!.error).toBeTruthy()
		expect(results[1]!.error).toBeNull()
		expect(results[2]!.error).toBeTruthy()
	})

	test('durationMs is captured from adapter', async () => {
		const adapter = mockAdapter('reddit', [], { durationMs: 150 })
		const results = await orchestrate([adapter], SEARCH_CONFIG)
		expect(results[0]!.durationMs).toBe(150)
	})
})
