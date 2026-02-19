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

// ---------------------------------------------------------------------------
// orchestrator.ts -- phase 2
// ---------------------------------------------------------------------------

/** Create a mock adapter with searchSupplemental support. */
function supplementalAdapter(
	sourceType: 'reddit' | 'x' | 'web' | 'youtube',
	phase1Items: PhaseResult['items'] = [],
	supplementalItems: PhaseResult['items'] = [],
): SearchAdapter {
	return {
		sourceType,
		search: async () => ({
			items: phase1Items,
			source: sourceType,
			phase: 1 as const,
			error: null,
			fromCache: false,
			cacheAgeHours: null,
			durationMs: 10,
		}),
		searchSupplemental: async (_config, _entity, _entityType) => ({
			items: supplementalItems,
			source: sourceType,
			phase: 2 as const,
			error: null,
			fromCache: false,
			cacheAgeHours: null,
			durationMs: 5,
		}),
	}
}

/** Create a supplemental adapter that throws on phase 2. */
function failingSupplementalAdapter(
	sourceType: 'reddit' | 'x',
	phase1Items: PhaseResult['items'] = [],
): SearchAdapter {
	return {
		sourceType,
		search: async () => ({
			items: phase1Items,
			source: sourceType,
			phase: 1 as const,
			error: null,
			fromCache: false,
			cacheAgeHours: null,
			durationMs: 10,
		}),
		searchSupplemental: async () => {
			throw new Error(`${sourceType} supplemental failed`)
		},
	}
}

/** Reddit items that extractEntities can pull subreddits from. */
const REDDIT_ITEMS_WITH_ENTITIES = [
	{
		id: 'r1',
		title: 'Claude Code is amazing',
		url: 'https://reddit.com/r/localllama/1',
		subreddit: 'localllama',
		date: '2026-01-15',
		date_confidence: 'high',
		engagement: { score: 100, comments: 50, upvote_ratio: 0.95 },
		top_comments: [],
		comment_insights: [],
		relevance: 0.9,
		why_relevant: 'test',
		subs: { relevance: 90, recency: 50, engagement: 80 },
		score: 75,
	},
	{
		id: 'r2',
		title: 'AI models comparison',
		url: 'https://reddit.com/r/machinelearning/2',
		subreddit: 'machinelearning',
		date: '2026-01-16',
		date_confidence: 'high',
		engagement: { score: 200, comments: 80, upvote_ratio: 0.92 },
		top_comments: [],
		comment_insights: [],
		relevance: 0.8,
		why_relevant: 'test',
		subs: { relevance: 80, recency: 60, engagement: 90 },
		score: 80,
	},
]

/** X items that extractEntities can pull handles from. */
const X_ITEMS_WITH_ENTITIES = [
	{
		id: 'x1',
		text: 'Great work by @anthropicai on Claude',
		author_handle: '@testuser',
		date: '2026-01-15',
		date_confidence: 'high',
		engagement: { likes: 500, retweets: 100 },
		relevance: 0.9,
		why_relevant: 'test',
		subs: { relevance: 90, recency: 50, engagement: 85 },
		score: 80,
	},
	{
		id: 'x2',
		text: '@openai just released a new model',
		author_handle: '@airesearcher',
		date: '2026-01-16',
		date_confidence: 'high',
		engagement: { likes: 300, retweets: 60 },
		relevance: 0.85,
		why_relevant: 'test',
		subs: { relevance: 85, recency: 60, engagement: 70 },
		score: 75,
	},
]

describe('retrieval/orchestrator phase 2', () => {
	test('strategy=single skips phase 2', async () => {
		const adapter = supplementalAdapter('reddit', REDDIT_ITEMS_WITH_ENTITIES, [
			{ ...REDDIT_ITEMS_WITH_ENTITIES[0]!, id: 'r-supp' },
		])
		const orchConfig = {
			...defaultOrchestratorConfig(),
			strategy: 'single' as const,
		}
		const results = await orchestrate([adapter], SEARCH_CONFIG, orchConfig)
		// Only phase 1 results
		expect(results).toHaveLength(1)
		expect(results[0]!.phase).toBe(1)
	})

	test('two-phase with no searchSupplemental returns phase 1 only', async () => {
		const adapter = mockAdapter('reddit', REDDIT_ITEMS_WITH_ENTITIES)
		const orchConfig = {
			...defaultOrchestratorConfig(),
			strategy: 'two-phase' as const,
		}
		const results = await orchestrate([adapter], SEARCH_CONFIG, orchConfig)
		// No adapters support supplemental, so only phase 1
		expect(results).toHaveLength(1)
		expect(results.every((r) => r.phase === 1)).toBe(true)
	})

	test('two-phase with supplemental adapter returns phase 1 + phase 2', async () => {
		const suppItem = {
			...REDDIT_ITEMS_WITH_ENTITIES[0]!,
			id: 'r-supplemental',
		}
		const adapter = supplementalAdapter('reddit', REDDIT_ITEMS_WITH_ENTITIES, [suppItem])
		const orchConfig = {
			...defaultOrchestratorConfig(),
			strategy: 'two-phase' as const,
		}
		const results = await orchestrate([adapter], SEARCH_CONFIG, orchConfig)
		// Phase 1 + at least one phase 2 result
		const phase1 = results.filter((r) => r.phase === 1)
		const phase2 = results.filter((r) => r.phase === 2)
		expect(phase1).toHaveLength(1)
		expect(phase2.length).toBeGreaterThan(0)
		// Phase 2 results should contain our supplemental items
		expect(phase2[0]!.source).toBe('reddit')
	})

	test('phase2Budget limits number of supplemental queries', async () => {
		let supplementalCallCount = 0
		const adapter: SearchAdapter = {
			sourceType: 'reddit',
			search: async () => ({
				items: REDDIT_ITEMS_WITH_ENTITIES,
				source: 'reddit' as const,
				phase: 1 as const,
				error: null,
				fromCache: false,
				cacheAgeHours: null,
				durationMs: 10,
			}),
			searchSupplemental: async () => {
				supplementalCallCount += 1
				return {
					items: [],
					source: 'reddit' as const,
					phase: 2 as const,
					error: null,
					fromCache: false,
					cacheAgeHours: null,
					durationMs: 5,
				}
			},
		}
		const orchConfig = {
			...defaultOrchestratorConfig(),
			strategy: 'two-phase' as const,
			phase2Budget: 1,
		}
		await orchestrate([adapter], SEARCH_CONFIG, orchConfig)
		// With budget=1, only 1 supplemental call should be made
		// even though there are 2 subreddits in the items
		expect(supplementalCallCount).toBe(1)
	})

	test('phase 2 failure does not affect phase 1 results', async () => {
		const adapter = failingSupplementalAdapter('reddit', REDDIT_ITEMS_WITH_ENTITIES)
		const orchConfig = {
			...defaultOrchestratorConfig(),
			strategy: 'two-phase' as const,
		}
		const results = await orchestrate([adapter], SEARCH_CONFIG, orchConfig)
		const phase1 = results.filter((r) => r.phase === 1)
		const phase2 = results.filter((r) => r.phase === 2)

		// Phase 1 should be intact
		expect(phase1).toHaveLength(1)
		expect(phase1[0]!.error).toBeNull()
		expect(phase1[0]!.items).toHaveLength(2)

		// Phase 2 should have error results but not crash
		expect(phase2.length).toBeGreaterThan(0)
		for (const r of phase2) {
			expect(r.error).toContain('supplemental failed')
		}
	})

	test('X adapter gets handles and hashtags for phase 2', async () => {
		const receivedEntities: string[] = []
		const adapter: SearchAdapter = {
			sourceType: 'x',
			search: async () => ({
				items: [
					...X_ITEMS_WITH_ENTITIES,
					{
						id: 'x3',
						text: 'Using #claudecode for tooling updates',
						author_handle: '@builder',
						date: '2026-01-17',
						date_confidence: 'high',
						engagement: { likes: 50, retweets: 10 },
						relevance: 0.8,
						why_relevant: 'test',
						subs: { relevance: 80, recency: 55, engagement: 60 },
						score: 70,
					},
				],
				source: 'x' as const,
				phase: 1 as const,
				error: null,
				fromCache: false,
				cacheAgeHours: null,
				durationMs: 10,
			}),
			searchSupplemental: async (_config, entity) => {
				receivedEntities.push(entity)
				return {
					items: [],
					source: 'x' as const,
					phase: 2 as const,
					error: null,
					fromCache: false,
					cacheAgeHours: null,
					durationMs: 5,
				}
			},
		}
		const orchConfig = {
			...defaultOrchestratorConfig(),
			strategy: 'two-phase' as const,
			phase2Budget: 10,
		}
		await orchestrate([adapter], SEARCH_CONFIG, orchConfig)
		// Should receive both handle and hashtag entities
		expect(receivedEntities.length).toBeGreaterThan(0)
		expect(receivedEntities.some((e) => e.startsWith('@'))).toBe(true)
		expect(receivedEntities.some((e) => e.startsWith('#'))).toBe(true)
	})

	test('empty phase 1 items produce no phase 2 queries', async () => {
		let supplementalCalled = false
		const adapter: SearchAdapter = {
			sourceType: 'reddit',
			search: async () => ({
				items: [],
				source: 'reddit' as const,
				phase: 1 as const,
				error: null,
				fromCache: false,
				cacheAgeHours: null,
				durationMs: 10,
			}),
			searchSupplemental: async () => {
				supplementalCalled = true
				return {
					items: [],
					source: 'reddit' as const,
					phase: 2 as const,
					error: null,
					fromCache: false,
					cacheAgeHours: null,
					durationMs: 5,
				}
			},
		}
		const orchConfig = {
			...defaultOrchestratorConfig(),
			strategy: 'two-phase' as const,
		}
		const results = await orchestrate([adapter], SEARCH_CONFIG, orchConfig)
		expect(supplementalCalled).toBe(false)
		// Only phase 1
		expect(results).toHaveLength(1)
	})
})
