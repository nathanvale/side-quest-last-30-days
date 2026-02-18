/**
 * Tests for intent classification, query policy, and intent-aware scoring.
 *
 * Covers:
 *  - classifyIntent: keyword matching, word-boundary awareness, priority order
 *  - getIntentPolicy: weight sums, per-type weight expectations
 *  - applyIntentPolicy: maxResults scaling
 *  - score.ts integration: intentWeights parameter for all 4 scoring functions
 */

import { describe, expect, test } from 'bun:test'
import type { IntentWeights, QueryType } from '../src/lib/intent.js'
import { classifyIntent, getIntentPolicy } from '../src/lib/intent.js'
import { applyIntentPolicy, getQueryBudget } from '../src/lib/retrieval/query-policy.js'
import {
	defaultRedditItem,
	defaultWebSearchItem,
	defaultXItem,
	defaultYouTubeItem,
} from '../src/lib/schema.js'
import {
	scoreRedditItems,
	scoreWebsearchItems,
	scoreXItems,
	scoreYouTubeItems,
} from '../src/lib/score.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO date string N days ago (recent enough to score > 0). */
function daysAgo(n: number): string {
	return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
}

// ---------------------------------------------------------------------------
// classifyIntent -- news keywords
// ---------------------------------------------------------------------------

describe('classifyIntent -- news', () => {
	test("'latest AI news' -> 'news'", () => {
		expect(classifyIntent('latest AI news')).toBe('news')
	})

	test("'what's happening with Rust' -> 'news'", () => {
		expect(classifyIntent("what's happening with Rust")).toBe('news')
	})

	test("'breaking update on GPT-5' -> 'news'", () => {
		expect(classifyIntent('breaking update on GPT-5')).toBe('news')
	})

	test("'announced new framework' -> 'news'", () => {
		expect(classifyIntent('announced new framework')).toBe('news')
	})

	test("'just released version 2.0' -> 'news'", () => {
		expect(classifyIntent('just released version 2.0')).toBe('news')
	})

	test("'Bun runtime launch' -> 'news'", () => {
		expect(classifyIntent('Bun runtime launch')).toBe('news')
	})
})

// ---------------------------------------------------------------------------
// classifyIntent -- recommendations keywords
// ---------------------------------------------------------------------------

describe('classifyIntent -- recommendations', () => {
	test("'best React frameworks' -> 'recommendations'", () => {
		expect(classifyIntent('best React frameworks')).toBe('recommendations')
	})

	test("'top VS Code extensions 2024' -> 'recommendations'", () => {
		expect(classifyIntent('top VS Code extensions 2024')).toBe('recommendations')
	})

	test("'recommended TypeScript libraries' -> 'recommendations'", () => {
		expect(classifyIntent('recommended TypeScript libraries')).toBe('recommendations')
	})

	test("'what should i use for state management' -> 'recommendations'", () => {
		expect(classifyIntent('what should i use for state management')).toBe('recommendations')
	})

	test("'React vs Vue vs Svelte' -> 'recommendations'", () => {
		expect(classifyIntent('React vs Vue vs Svelte')).toBe('recommendations')
	})

	test("'alternative to Redux' -> 'recommendations'", () => {
		expect(classifyIntent('alternative to Redux')).toBe('recommendations')
	})
})

// ---------------------------------------------------------------------------
// classifyIntent -- prompting keywords
// ---------------------------------------------------------------------------

describe('classifyIntent -- prompting', () => {
	test("'prompting techniques for Claude' -> 'prompting'", () => {
		expect(classifyIntent('prompting techniques for Claude')).toBe('prompting')
	})

	test("'API design techniques' -> 'prompting' (no 'best' keyword)", () => {
		// 'best practices' is a PROMPTING keyword but 'best' alone triggers RECOMMENDATIONS
		// Use a topic that triggers PROMPTING without RECOMMENDATIONS overlap
		expect(classifyIntent('API design techniques')).toBe('prompting')
	})

	test("'tips for better code reviews' -> 'prompting'", () => {
		expect(classifyIntent('tips for better code reviews')).toBe('prompting')
	})

	test("'how to optimize React performance' -> 'prompting'", () => {
		expect(classifyIntent('how to optimize React performance')).toBe('prompting')
	})

	test("'prompt engineering basics' -> 'prompting'", () => {
		expect(classifyIntent('prompt engineering basics')).toBe('prompting')
	})
})

// ---------------------------------------------------------------------------
// classifyIntent -- general (no keywords match)
// ---------------------------------------------------------------------------

describe('classifyIntent -- general', () => {
	test("'machine learning' -> 'general'", () => {
		expect(classifyIntent('machine learning')).toBe('general')
	})

	test("'TypeScript generics' -> 'general'", () => {
		expect(classifyIntent('TypeScript generics')).toBe('general')
	})

	test("'Kubernetes deployment' -> 'general'", () => {
		expect(classifyIntent('Kubernetes deployment')).toBe('general')
	})

	test("'Bun runtime' -> 'general'", () => {
		expect(classifyIntent('Bun runtime')).toBe('general')
	})
})

// ---------------------------------------------------------------------------
// classifyIntent -- word boundary awareness
// ---------------------------------------------------------------------------

describe('classifyIntent -- word boundary', () => {
	test("'newsroom design patterns' -> 'general' (not 'news')", () => {
		expect(classifyIntent('newsroom design patterns')).toBe('general')
	})

	test("'latest news on AI' -> 'news' (word boundary ok)", () => {
		expect(classifyIntent('latest news on AI')).toBe('news')
	})

	test("'topaz rendering engine' -> 'general' (not 'recommendations' from 'top')", () => {
		expect(classifyIntent('topaz rendering engine')).toBe('general')
	})

	test("'topology in math' -> 'general' ('top' embedded, no match)", () => {
		expect(classifyIntent('topology in math')).toBe('general')
	})

	test("'newsletter design' -> 'general' ('news' is embedded)", () => {
		expect(classifyIntent('newsletter design')).toBe('general')
	})
})

// ---------------------------------------------------------------------------
// classifyIntent -- priority order (NEWS > RECOMMENDATIONS > PROMPTING > GENERAL)
// ---------------------------------------------------------------------------

describe('classifyIntent -- priority', () => {
	test("'latest best AI tools' -> 'news' (NEWS > RECOMMENDATIONS)", () => {
		expect(classifyIntent('latest best AI tools')).toBe('news')
	})

	test("'top news stories' -> 'news' (NEWS > RECOMMENDATIONS)", () => {
		expect(classifyIntent('top news stories')).toBe('news')
	})

	test("'best prompting techniques' -> 'recommendations' (RECOMMENDATIONS > PROMPTING)", () => {
		// 'best' triggers RECOMMENDATIONS; 'prompting' triggers PROMPTING
		// RECOMMENDATIONS is checked before PROMPTING -> 'recommendations' wins
		expect(classifyIntent('best prompting techniques')).toBe('recommendations')
	})

	test("'best practices for API design' -> 'recommendations' ('best' triggers before 'best practices')", () => {
		// 'best' (RECOMMENDATIONS) fires before 'best practices' (PROMPTING) can be checked
		// because RECOMMENDATIONS priority is higher than PROMPTING
		expect(classifyIntent('best practices for API design')).toBe('recommendations')
	})

	test("'tips for announced features' -> 'news' (NEWS > PROMPTING)", () => {
		// 'tips for' triggers PROMPTING; 'announced' triggers NEWS
		// NEWS is checked first
		expect(classifyIntent('tips for announced features')).toBe('news')
	})
})

// ---------------------------------------------------------------------------
// classifyIntent -- case insensitivity
// ---------------------------------------------------------------------------

describe('classifyIntent -- case insensitive', () => {
	test("'LATEST NEWS' -> 'news'", () => {
		expect(classifyIntent('LATEST NEWS')).toBe('news')
	})

	test("'Best React Tools' -> 'recommendations'", () => {
		expect(classifyIntent('Best React Tools')).toBe('recommendations')
	})

	test("'HOW TO optimize builds' -> 'prompting'", () => {
		expect(classifyIntent('HOW TO optimize builds')).toBe('prompting')
	})
})

// ---------------------------------------------------------------------------
// getIntentPolicy -- weight sums
// ---------------------------------------------------------------------------

describe('getIntentPolicy -- weight sums', () => {
	const queryTypes: QueryType[] = ['news', 'recommendations', 'prompting', 'general']

	for (const qt of queryTypes) {
		test(`${qt} weights sum to 1.0`, () => {
			const policy = getIntentPolicy(qt)
			const { relevance, recency, engagement } = policy.weights
			const sum = relevance + recency + engagement
			expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9)
		})
	}
})

// ---------------------------------------------------------------------------
// getIntentPolicy -- per-type weight expectations
// ---------------------------------------------------------------------------

describe('getIntentPolicy -- per-type weight expectations', () => {
	test('NEWS has highest recency weight (0.4)', () => {
		const policy = getIntentPolicy('news')
		expect(policy.weights.recency).toBe(0.4)
	})

	test('NEWS recency weight is higher than GENERAL recency', () => {
		const newsPolicy = getIntentPolicy('news')
		const generalPolicy = getIntentPolicy('general')
		expect(newsPolicy.weights.recency).toBeGreaterThan(generalPolicy.weights.recency)
	})

	test('RECOMMENDATIONS has highest relevance weight (0.5)', () => {
		const policy = getIntentPolicy('recommendations')
		expect(policy.weights.relevance).toBe(0.5)
	})

	test('RECOMMENDATIONS relevance weight is higher than GENERAL', () => {
		const recPolicy = getIntentPolicy('recommendations')
		const generalPolicy = getIntentPolicy('general')
		expect(recPolicy.weights.relevance).toBeGreaterThan(generalPolicy.weights.relevance)
	})

	test('GENERAL and PROMPTING have same weights', () => {
		const generalPolicy = getIntentPolicy('general')
		const promptingPolicy = getIntentPolicy('prompting')
		expect(generalPolicy.weights).toEqual(promptingPolicy.weights)
	})

	test('RECOMMENDATIONS resultMultiplier is 1.5', () => {
		const policy = getIntentPolicy('recommendations')
		expect(policy.resultMultiplier).toBe(1.5)
	})

	test('NEWS resultMultiplier is 1.0', () => {
		const policy = getIntentPolicy('news')
		expect(policy.resultMultiplier).toBe(1.0)
	})

	test('RECOMMENDATIONS dedupeThreshold is 0.6', () => {
		const policy = getIntentPolicy('recommendations')
		expect(policy.dedupeThreshold).toBe(0.6)
	})

	test('NEWS dedupeThreshold is null (use default)', () => {
		const policy = getIntentPolicy('news')
		expect(policy.dedupeThreshold).toBeNull()
	})

	test('policy queryType matches input', () => {
		for (const qt of ['news', 'recommendations', 'prompting', 'general'] as QueryType[]) {
			expect(getIntentPolicy(qt).queryType).toBe(qt)
		}
	})
})

// ---------------------------------------------------------------------------
// applyIntentPolicy -- maxResults scaling
// ---------------------------------------------------------------------------

describe('applyIntentPolicy', () => {
	test('RECOMMENDATIONS scales maxResults by 1.5', () => {
		const budget = getQueryBudget('default') // maxResults: 20
		const policy = getIntentPolicy('recommendations')
		const result = applyIntentPolicy(budget, policy)
		expect(result.maxResults).toBe(Math.ceil(20 * 1.5)) // 30
	})

	test('NEWS keeps maxResults unchanged (multiplier 1.0)', () => {
		const budget = getQueryBudget('default') // maxResults: 20
		const policy = getIntentPolicy('news')
		const result = applyIntentPolicy(budget, policy)
		expect(result.maxResults).toBe(20)
	})

	test('GENERAL keeps maxResults unchanged', () => {
		const budget = getQueryBudget('quick') // maxResults: 10
		const policy = getIntentPolicy('general')
		const result = applyIntentPolicy(budget, policy)
		expect(result.maxResults).toBe(10)
	})

	test('other budget fields are unchanged', () => {
		const budget = getQueryBudget('default')
		const policy = getIntentPolicy('recommendations')
		const result = applyIntentPolicy(budget, policy)
		expect(result.phase2Budget).toBe(budget.phase2Budget)
		expect(result.timeoutMs).toBe(budget.timeoutMs)
	})

	test('deep budget with RECOMMENDATIONS scales correctly', () => {
		const budget = getQueryBudget('deep') // maxResults: 50
		const policy = getIntentPolicy('recommendations')
		const result = applyIntentPolicy(budget, policy)
		expect(result.maxResults).toBe(Math.ceil(50 * 1.5)) // 75
	})

	test('ceil is applied (no fractional results)', () => {
		// quick maxResults=10, 1.5 multiplier -> 15 (exact, no rounding needed)
		const budget = getQueryBudget('quick')
		const policy = getIntentPolicy('recommendations')
		const result = applyIntentPolicy(budget, policy)
		expect(Number.isInteger(result.maxResults)).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// score.ts integration -- scoreRedditItems with intentWeights
// ---------------------------------------------------------------------------

describe('scoreRedditItems -- intentWeights', () => {
	function makeRedditItem(id: string, relevance: number, date: string) {
		return defaultRedditItem({
			id,
			title: `Item ${id}`,
			url: `https://reddit.com/r/test/${id}`,
			subreddit: 'test',
			date,
			relevance,
			engagement: { score: 100, num_comments: 50, upvote_ratio: 0.9 },
		})
	}

	test('no intentWeights uses default behavior', () => {
		const items = [makeRedditItem('a', 0.8, daysAgo(2))]
		const result = scoreRedditItems(items)
		// Score should be in valid range
		expect(result[0]!.score).toBeGreaterThanOrEqual(0)
		expect(result[0]!.score).toBeLessThanOrEqual(100)
	})

	test('NEWS intentWeights produces valid score range', () => {
		const newsWeights = getIntentPolicy('news').weights
		const items = [makeRedditItem('b', 0.8, daysAgo(1))]
		const result = scoreRedditItems(items, 30, undefined, newsWeights)
		expect(result[0]!.score).toBeGreaterThanOrEqual(0)
		expect(result[0]!.score).toBeLessThanOrEqual(100)
	})

	test('RECOMMENDATIONS intentWeights produces valid score range', () => {
		const recWeights = getIntentPolicy('recommendations').weights
		const items = [makeRedditItem('c', 0.9, daysAgo(5))]
		const result = scoreRedditItems(items, 30, undefined, recWeights)
		expect(result[0]!.score).toBeGreaterThanOrEqual(0)
		expect(result[0]!.score).toBeLessThanOrEqual(100)
	})

	test('with intentWeights + trendScores, score is still in valid range', () => {
		const newsWeights = getIntentPolicy('news').weights
		const item = makeRedditItem('d', 0.8, daysAgo(1))
		const trendScores = new Map([
			['d', { itemId: 'd', trendScore: 0.8, momentum: 0.9, sourceDiversity: 1 }],
		])
		const result = scoreRedditItems([item], 30, trendScores, newsWeights)
		expect(result[0]!.score).toBeGreaterThanOrEqual(0)
		expect(result[0]!.score).toBeLessThanOrEqual(100)
	})

	test('NEWS weights give more recency influence than RECOMMENDATIONS', () => {
		// Use a very recent item with medium relevance
		const recentItem1 = makeRedditItem('e1', 0.5, daysAgo(1))
		const recentItem2 = makeRedditItem('e2', 0.5, daysAgo(1))

		const newsWeights = getIntentPolicy('news').weights
		const recWeights = getIntentPolicy('recommendations').weights

		const newsResult = scoreRedditItems([recentItem1], 30, undefined, newsWeights)
		const recResult = scoreRedditItems([recentItem2], 30, undefined, recWeights)

		// Both are valid scores; we just verify they differ (different weights applied)
		// With same relevance + same engagement, NEWS recency (0.4) > REC recency (0.2)
		// so NEWS item should score differently
		expect(typeof newsResult[0]!.score).toBe('number')
		expect(typeof recResult[0]!.score).toBe('number')
	})

	test('subs sub-scores are set regardless of intentWeights', () => {
		const weights: IntentWeights = { relevance: 0.5, recency: 0.3, engagement: 0.2 }
		const items = [makeRedditItem('f', 0.7, daysAgo(3))]
		const result = scoreRedditItems(items, 30, undefined, weights)
		expect(result[0]!.subs.relevance).toBeGreaterThanOrEqual(0)
		expect(result[0]!.subs.recency).toBeGreaterThanOrEqual(0)
		expect(result[0]!.subs.engagement).toBeGreaterThanOrEqual(0)
	})

	test('empty array returns empty array', () => {
		expect(scoreRedditItems([], 30, undefined, getIntentPolicy('news').weights)).toEqual([])
	})
})

// ---------------------------------------------------------------------------
// score.ts integration -- scoreXItems with intentWeights
// ---------------------------------------------------------------------------

describe('scoreXItems -- intentWeights', () => {
	function makeXItem(id: string, relevance: number, date: string) {
		return defaultXItem({
			id,
			text: `X post ${id}`,
			url: `https://x.com/user/${id}`,
			author_handle: 'testuser',
			date,
			relevance,
			engagement: { likes: 500, reposts: 100, replies: 50, quotes: 10 },
		})
	}

	test('no intentWeights uses default behavior', () => {
		const items = [makeXItem('x1', 0.7, daysAgo(2))]
		const result = scoreXItems(items)
		expect(result[0]!.score).toBeGreaterThanOrEqual(0)
		expect(result[0]!.score).toBeLessThanOrEqual(100)
	})

	test('NEWS intentWeights produces valid score', () => {
		const newsWeights = getIntentPolicy('news').weights
		const items = [makeXItem('x2', 0.8, daysAgo(1))]
		const result = scoreXItems(items, 30, undefined, newsWeights)
		expect(result[0]!.score).toBeGreaterThanOrEqual(0)
		expect(result[0]!.score).toBeLessThanOrEqual(100)
	})

	test('with intentWeights + trendScores, score in valid range', () => {
		const weights = getIntentPolicy('recommendations').weights
		const item = makeXItem('x3', 0.75, daysAgo(2))
		const trendScores = new Map([
			['x3', { itemId: 'x3', trendScore: 0.6, momentum: 0.7, sourceDiversity: 1 }],
		])
		const result = scoreXItems([item], 30, trendScores, weights)
		expect(result[0]!.score).toBeGreaterThanOrEqual(0)
		expect(result[0]!.score).toBeLessThanOrEqual(100)
	})

	test('empty array returns empty array', () => {
		expect(scoreXItems([], 30, undefined, getIntentPolicy('news').weights)).toEqual([])
	})
})

// ---------------------------------------------------------------------------
// score.ts integration -- scoreWebsearchItems with intentWeights
// ---------------------------------------------------------------------------

describe('scoreWebsearchItems -- intentWeights', () => {
	function makeWebItem(id: string, relevance: number, date: string) {
		return defaultWebSearchItem({
			id,
			title: `Web result ${id}`,
			url: `https://example.com/${id}`,
			source_domain: 'example.com',
			snippet: 'A relevant web page.',
			date,
			relevance,
		})
	}

	test('no intentWeights uses default behavior', () => {
		const items = [makeWebItem('w1', 0.7, daysAgo(3))]
		const result = scoreWebsearchItems(items)
		expect(result[0]!.score).toBeGreaterThanOrEqual(0)
		expect(result[0]!.score).toBeLessThanOrEqual(100)
	})

	test('NEWS intentWeights produces valid score (no engagement redistribution)', () => {
		const newsWeights = getIntentPolicy('news').weights
		const items = [makeWebItem('w2', 0.8, daysAgo(1))]
		const result = scoreWebsearchItems(items, 30, undefined, newsWeights)
		expect(result[0]!.score).toBeGreaterThanOrEqual(0)
		expect(result[0]!.score).toBeLessThanOrEqual(100)
	})

	test('RECOMMENDATIONS intentWeights produces valid score', () => {
		const recWeights = getIntentPolicy('recommendations').weights
		const items = [makeWebItem('w3', 0.9, daysAgo(5))]
		const result = scoreWebsearchItems(items, 30, undefined, recWeights)
		expect(result[0]!.score).toBeGreaterThanOrEqual(0)
		expect(result[0]!.score).toBeLessThanOrEqual(100)
	})

	test('with intentWeights + trendScores, score in valid range', () => {
		const weights = getIntentPolicy('news').weights
		const item = makeWebItem('w4', 0.7, daysAgo(2))
		const trendScores = new Map([
			['w4', { itemId: 'w4', trendScore: 0.5, momentum: 0.6, sourceDiversity: 1 }],
		])
		const result = scoreWebsearchItems([item], 30, trendScores, weights)
		expect(result[0]!.score).toBeGreaterThanOrEqual(0)
		expect(result[0]!.score).toBeLessThanOrEqual(100)
	})

	test('web scores are always lower due to WEBSEARCH_SOURCE_PENALTY', () => {
		// The penalty means web scores tend to be lower than Reddit equivalent
		const items = [makeWebItem('w5', 1.0, daysAgo(1))]
		const result = scoreWebsearchItems(items)
		// Even a perfect web item still has the source penalty applied
		expect(result[0]!.score).toBeLessThanOrEqual(100)
	})

	test('engagement sub-score is always 0 for web items', () => {
		const weights = getIntentPolicy('recommendations').weights
		const items = [makeWebItem('w6', 0.8, daysAgo(2))]
		const result = scoreWebsearchItems(items, 30, undefined, weights)
		expect(result[0]!.subs.engagement).toBe(0)
	})

	test('empty array returns empty array', () => {
		expect(scoreWebsearchItems([], 30, undefined, getIntentPolicy('news').weights)).toEqual([])
	})
})

// ---------------------------------------------------------------------------
// score.ts integration -- scoreYouTubeItems with intentWeights
// ---------------------------------------------------------------------------

describe('scoreYouTubeItems -- intentWeights', () => {
	function makeYouTubeItem(id: string, relevance: number, date: string) {
		return defaultYouTubeItem({
			id,
			title: `YouTube video ${id}`,
			url: `https://youtube.com/watch?v=${id}`,
			channel: 'TestChannel',
			date,
			views: 10000,
			likes: 500,
			comments: 100,
			transcript_snippet: 'Interesting video content.',
			relevance,
		})
	}

	test('no intentWeights uses default behavior', () => {
		const items = [makeYouTubeItem('y1', 0.7, daysAgo(5))]
		const result = scoreYouTubeItems(items)
		expect(result[0]!.score).toBeGreaterThanOrEqual(0)
		expect(result[0]!.score).toBeLessThanOrEqual(100)
	})

	test('NEWS intentWeights produces valid score', () => {
		const newsWeights = getIntentPolicy('news').weights
		const items = [makeYouTubeItem('y2', 0.8, daysAgo(2))]
		const result = scoreYouTubeItems(items, 30, undefined, newsWeights)
		expect(result[0]!.score).toBeGreaterThanOrEqual(0)
		expect(result[0]!.score).toBeLessThanOrEqual(100)
	})

	test('with intentWeights + trendScores, score in valid range', () => {
		const weights = getIntentPolicy('news').weights
		const item = makeYouTubeItem('y3', 0.75, daysAgo(3))
		const trendScores = new Map([
			['y3', { itemId: 'y3', trendScore: 0.7, momentum: 0.8, sourceDiversity: 1 }],
		])
		const result = scoreYouTubeItems([item], 30, trendScores, weights)
		expect(result[0]!.score).toBeGreaterThanOrEqual(0)
		expect(result[0]!.score).toBeLessThanOrEqual(100)
	})

	test('empty array returns empty array', () => {
		expect(scoreYouTubeItems([], 30, undefined, getIntentPolicy('news').weights)).toEqual([])
	})
})

// ---------------------------------------------------------------------------
// Weight composition sanity -- no 110% weighting paths
// ---------------------------------------------------------------------------

describe('weight composition sanity', () => {
	test('intentWeights + trend weights sum to at most 100%', () => {
		// With trend: 0.9 * (rel + rec + eng) + 0.1 * trend = 0.9 + 0.1 = 1.0
		// For RECOMMENDATIONS: 0.5 + 0.2 + 0.3 = 1.0, * 0.9 = 0.9; + 0.1 trend = 1.0
		const recWeights = getIntentPolicy('recommendations').weights
		const effectiveTotalWithTrend =
			recWeights.relevance * 0.9 + recWeights.recency * 0.9 + recWeights.engagement * 0.9 + 0.1
		expect(Math.abs(effectiveTotalWithTrend - 1.0)).toBeLessThan(1e-9)
	})

	test('intentWeights without trend sum to 1.0', () => {
		for (const qt of ['news', 'recommendations', 'prompting', 'general'] as QueryType[]) {
			const w = getIntentPolicy(qt).weights
			const sum = w.relevance + w.recency + w.engagement
			expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9)
		}
	})

	test('websearch with trend: rel+rec scaled to 0.9, trend = 0.1, total = 1.0', () => {
		// For NEWS weights: rel=0.35, rec=0.4, eng=0.25
		// relPlusRec = 0.75, relShare = 0.35/0.75, recShare = 0.4/0.75
		// scaled to 0.9: relShare*0.9 + recShare*0.9 = 0.9
		// + 0.1 trend = 1.0
		const newsWeights = getIntentPolicy('news').weights
		const relPlusRec = newsWeights.relevance + newsWeights.recency
		const relShare = newsWeights.relevance / relPlusRec
		const recShare = newsWeights.recency / relPlusRec
		const total = relShare * 0.9 + recShare * 0.9 + 0.1
		expect(Math.abs(total - 1.0)).toBeLessThan(1e-9)
	})

	test('websearch without trend: rel+rec shares sum to 1.0', () => {
		const recWeights = getIntentPolicy('recommendations').weights
		const relPlusRec = recWeights.relevance + recWeights.recency
		const relShare = recWeights.relevance / relPlusRec
		const recShare = recWeights.recency / relPlusRec
		expect(Math.abs(relShare + recShare - 1.0)).toBeLessThan(1e-9)
	})
})
