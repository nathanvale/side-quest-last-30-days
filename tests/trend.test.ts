import { describe, expect, test } from 'bun:test'
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
import type { TrendScore } from '../src/lib/trend.js'
import {
	computeTrendScores,
	momentumScore,
	sourceDiversityBonus,
	trendScore,
} from '../src/lib/trend.js'

/** Helper: ISO date string for N hours ago. */
function hoursAgo(hours: number): string {
	return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

/** Helper: ISO date string for N days ago. */
function daysAgo(days: number): string {
	return hoursAgo(days * 24)
}

describe('momentumScore', () => {
	test('item with date < 48h ago and high score returns 1.0', () => {
		const item = defaultRedditItem({
			id: 'r1',
			title: 'Hot topic',
			url: 'https://reddit.com/r/test/1',
			subreddit: 'test',
			date: hoursAgo(12),
			engagement: { score: 120, num_comments: 30, upvote_ratio: 0.9 },
		})
		expect(momentumScore(item)).toBe(1.0)
	})

	test('item with date < 48h ago and low score returns 0.7', () => {
		const item = defaultRedditItem({
			id: 'r2',
			title: 'Lukewarm topic',
			url: 'https://reddit.com/r/test/2',
			subreddit: 'test',
			date: hoursAgo(24),
			engagement: { score: 12, num_comments: 1, upvote_ratio: 0.6 },
		})
		expect(momentumScore(item)).toBe(0.7)
	})

	test('item with date 3 days ago and high score returns 0.8', () => {
		const item = defaultRedditItem({
			id: 'r3',
			title: 'Trending topic',
			url: 'https://reddit.com/r/test/3',
			subreddit: 'test',
			date: daysAgo(3),
			engagement: { score: 95, num_comments: 24, upvote_ratio: 0.88 },
		})
		expect(momentumScore(item)).toBe(0.8)
	})

	test('item with date 3 days ago and low score returns 0.5', () => {
		const item = defaultRedditItem({
			id: 'r4',
			title: 'Meh topic',
			url: 'https://reddit.com/r/test/4',
			subreddit: 'test',
			date: daysAgo(3),
			engagement: { score: 8, num_comments: 0, upvote_ratio: 0.5 },
		})
		expect(momentumScore(item)).toBe(0.5)
	})

	test('item with date > 7 days ago returns 0.3', () => {
		const item = defaultRedditItem({
			id: 'r5',
			title: 'Old topic',
			url: 'https://reddit.com/r/test/5',
			subreddit: 'test',
			date: daysAgo(14),
			engagement: { score: 300, num_comments: 100, upvote_ratio: 0.95 },
		})
		expect(momentumScore(item)).toBe(0.3)
	})

	test('item with null date returns 0.2', () => {
		const item = defaultRedditItem({
			id: 'r6',
			title: 'Unknown date topic',
			url: 'https://reddit.com/r/test/6',
			subreddit: 'test',
			date: null,
			engagement: { score: 100, num_comments: 60, upvote_ratio: 0.9 },
		})
		expect(momentumScore(item)).toBe(0.2)
	})

	test('monotonicity: more recent + higher engagement = higher momentum', () => {
		const recent = defaultRedditItem({
			id: 'r7',
			title: 'Recent hot',
			url: 'https://reddit.com/r/test/7',
			subreddit: 'test',
			date: hoursAgo(6),
			engagement: { score: 150, num_comments: 40, upvote_ratio: 0.92 },
		})
		const older = defaultRedditItem({
			id: 'r8',
			title: 'Older cold',
			url: 'https://reddit.com/r/test/8',
			subreddit: 'test',
			date: daysAgo(10),
			engagement: { score: 6, num_comments: 0, upvote_ratio: 0.4 },
		})
		expect(momentumScore(recent)).toBeGreaterThan(momentumScore(older))
	})

	test('higher engagement increases momentum within the same recency bucket', () => {
		const highEngagement = defaultRedditItem({
			id: 'r9',
			title: 'High engagement',
			url: 'https://reddit.com/r/test/9',
			subreddit: 'test',
			date: hoursAgo(24),
			engagement: { score: 120, num_comments: 30, upvote_ratio: 0.9 },
		})
		const lowEngagement = defaultRedditItem({
			id: 'r10',
			title: 'Low engagement',
			url: 'https://reddit.com/r/test/10',
			subreddit: 'test',
			date: hoursAgo(24),
			engagement: { score: 4, num_comments: 0, upvote_ratio: 0.5 },
		})
		expect(momentumScore(highEngagement)).toBeGreaterThan(
			momentumScore(lowEngagement),
		)
	})
})

describe('sourceDiversityBonus', () => {
	const sharedTopic = 'kubernetes deployment strategies cluster'

	const redditItem = defaultRedditItem({
		id: 'r1',
		title: `${sharedTopic} guide`,
		url: 'https://reddit.com/r/k8s/1',
		subreddit: 'kubernetes',
		score: 50,
	})

	const xItem = defaultXItem({
		id: 'x1',
		text: `New ${sharedTopic} article published`,
		url: 'https://x.com/user/1',
		author_handle: '@k8sdev',
		score: 50,
	})

	const webItem = defaultWebSearchItem({
		id: 'w1',
		title: `${sharedTopic} best practices`,
		url: 'https://example.com/k8s',
		source_domain: 'example.com',
		snippet: `Learn about ${sharedTopic}`,
		score: 50,
	})

	const youtubeItem = defaultYouTubeItem({
		id: 'yt1',
		title: `${sharedTopic} tutorial`,
		url: 'https://youtube.com/watch?v=1',
		channel: 'K8sTutorials',
		score: 50,
	})

	test('item confirmed in 3+ source types returns 1.0', () => {
		const allItems = [redditItem, xItem, webItem, youtubeItem]
		expect(sourceDiversityBonus(redditItem, allItems)).toBe(1.0)
	})

	test('item confirmed in 2 source types returns 0.5', () => {
		const allItems = [redditItem, xItem]
		expect(sourceDiversityBonus(redditItem, allItems)).toBe(0.5)
	})

	test('item alone (1 type) returns 0.0', () => {
		const allItems = [redditItem]
		expect(sourceDiversityBonus(redditItem, allItems)).toBe(0.0)
	})

	test('empty allItems returns 0.0', () => {
		expect(sourceDiversityBonus(redditItem, [])).toBe(0.0)
	})
})

describe('trendScore', () => {
	test('combined formula: momentum * 0.7 + diversityBonus * 0.3', () => {
		const item = defaultRedditItem({
			id: 'r1',
			title: 'kubernetes deployment strategies cluster',
			url: 'https://reddit.com/r/k8s/1',
			subreddit: 'kubernetes',
			date: hoursAgo(6),
			score: 80,
		})
		const xItem = defaultXItem({
			id: 'x1',
			text: 'kubernetes deployment strategies cluster update',
			url: 'https://x.com/user/1',
			author_handle: '@k8sdev',
			score: 50,
		})
		const allItems = [item, xItem]

		const result = trendScore(item, allItems)
		const expectedMomentum = momentumScore(item)
		const expectedDiversity = sourceDiversityBonus(item, allItems)
		const expectedCombined = expectedMomentum * 0.7 + expectedDiversity * 0.3

		expect(result.momentum).toBe(expectedMomentum)
		expect(result.diversityBonus).toBe(expectedDiversity)
		expect(result.trendScore).toBeCloseTo(expectedCombined, 10)
	})

	test('known inputs produce expected output', () => {
		// Item with null date, alone -> momentum=0.2, diversity=0.0
		const item = defaultRedditItem({
			id: 'r1',
			title: 'solo item',
			url: 'https://reddit.com/r/test/1',
			subreddit: 'test',
			date: null,
			score: 10,
		})

		const result = trendScore(item, [item])
		expect(result.momentum).toBe(0.2)
		expect(result.diversityBonus).toBe(0.0)
		expect(result.trendScore).toBeCloseTo(0.14, 10)
	})
})

describe('computeTrendScores', () => {
	test('returns Map with entry per item', () => {
		const items = [
			defaultRedditItem({
				id: 'r1',
				title: 'Topic alpha',
				url: 'https://reddit.com/r/test/1',
				subreddit: 'test',
				score: 50,
			}),
			defaultXItem({
				id: 'x1',
				text: 'Topic alpha tweet',
				url: 'https://x.com/user/1',
				author_handle: '@dev',
				score: 50,
			}),
		]

		const scores = computeTrendScores(items)
		expect(scores.size).toBe(2)
		expect(scores.has('r1')).toBe(true)
		expect(scores.has('x1')).toBe(true)
	})

	test('each entry has valid TrendScore', () => {
		const items = [
			defaultRedditItem({
				id: 'r1',
				title: 'Valid item',
				url: 'https://reddit.com/r/test/1',
				subreddit: 'test',
				date: hoursAgo(1),
				score: 90,
			}),
		]

		const scores = computeTrendScores(items)
		const ts = scores.get('r1')!

		expect(ts.momentum).toBeGreaterThanOrEqual(0)
		expect(ts.momentum).toBeLessThanOrEqual(1)
		expect(ts.diversityBonus).toBeGreaterThanOrEqual(0)
		expect(ts.diversityBonus).toBeLessThanOrEqual(1)
		expect(ts.trendScore).toBeGreaterThanOrEqual(0)
		expect(ts.trendScore).toBeLessThanOrEqual(1)
	})
})

describe('backward compatibility', () => {
	test('scoreRedditItems without trendScores produces identical results', () => {
		const makeItems = () => [
			defaultRedditItem({
				id: 'r1',
				title: 'Test post one',
				url: 'https://reddit.com/r/test/1',
				subreddit: 'test',
				date: daysAgo(2),
				engagement: { score: 100, num_comments: 50, upvote_ratio: 0.9 },
				relevance: 0.8,
				date_confidence: 'high',
			}),
			defaultRedditItem({
				id: 'r2',
				title: 'Test post two',
				url: 'https://reddit.com/r/test/2',
				subreddit: 'test',
				date: daysAgo(5),
				engagement: { score: 20, num_comments: 5, upvote_ratio: 0.6 },
				relevance: 0.6,
				date_confidence: 'med',
			}),
			defaultRedditItem({
				id: 'r3',
				title: 'Test post three no engagement',
				url: 'https://reddit.com/r/test/3',
				subreddit: 'test',
				date: null,
				engagement: null,
				relevance: 0.5,
				date_confidence: 'low',
			}),
		]

		const itemsA = scoreRedditItems(makeItems(), 30)
		const itemsB = scoreRedditItems(makeItems(), 30, undefined)

		for (let i = 0; i < itemsA.length; i++) {
			expect(itemsA[i]!.score).toBe(itemsB[i]!.score)
			expect(itemsA[i]!.subs).toEqual(itemsB[i]!.subs)
		}
	})

	test('scoreXItems without trendScores produces identical results', () => {
		const makeItems = () => [
			defaultXItem({
				id: 'x1',
				text: 'Test tweet one',
				url: 'https://x.com/user/1',
				author_handle: '@user1',
				date: daysAgo(1),
				engagement: { likes: 500, reposts: 50, replies: 20, quotes: 5 },
				relevance: 0.9,
				date_confidence: 'high',
			}),
			defaultXItem({
				id: 'x2',
				text: 'Test tweet two',
				url: 'https://x.com/user/2',
				author_handle: '@user2',
				date: daysAgo(10),
				engagement: null,
				relevance: 0.4,
				date_confidence: 'low',
			}),
		]

		const itemsA = scoreXItems(makeItems(), 30)
		const itemsB = scoreXItems(makeItems(), 30, undefined)

		for (let i = 0; i < itemsA.length; i++) {
			expect(itemsA[i]!.score).toBe(itemsB[i]!.score)
			expect(itemsA[i]!.subs).toEqual(itemsB[i]!.subs)
		}
	})

	test('scoreWebsearchItems without trendScores produces identical results', () => {
		const makeItems = () => [
			defaultWebSearchItem({
				id: 'w1',
				title: 'Web result one',
				url: 'https://example.com/1',
				source_domain: 'example.com',
				snippet: 'A test snippet',
				date: daysAgo(3),
				relevance: 0.7,
				date_confidence: 'high',
			}),
			defaultWebSearchItem({
				id: 'w2',
				title: 'Web result two',
				url: 'https://example.com/2',
				source_domain: 'example.com',
				snippet: 'Another snippet',
				date: null,
				relevance: 0.5,
				date_confidence: 'low',
			}),
		]

		const itemsA = scoreWebsearchItems(makeItems(), 30)
		const itemsB = scoreWebsearchItems(makeItems(), 30, undefined)

		for (let i = 0; i < itemsA.length; i++) {
			expect(itemsA[i]!.score).toBe(itemsB[i]!.score)
			expect(itemsA[i]!.subs).toEqual(itemsB[i]!.subs)
		}
	})

	test('scoreYouTubeItems without trendScores produces identical results', () => {
		const makeItems = () => [
			defaultYouTubeItem({
				id: 'yt1',
				title: 'Video one',
				url: 'https://youtube.com/watch?v=1',
				channel: 'TestChan',
				date: daysAgo(2),
				views: 10000,
				likes: 500,
				comments: 100,
				relevance: 0.85,
				date_confidence: 'high',
			}),
			defaultYouTubeItem({
				id: 'yt2',
				title: 'Video two',
				url: 'https://youtube.com/watch?v=2',
				channel: 'TestChan2',
				date: daysAgo(20),
				views: 50,
				likes: 2,
				comments: 0,
				relevance: 0.3,
				date_confidence: 'low',
			}),
		]

		const itemsA = scoreYouTubeItems(makeItems(), 30)
		const itemsB = scoreYouTubeItems(makeItems(), 30, undefined)

		for (let i = 0; i < itemsA.length; i++) {
			expect(itemsA[i]!.score).toBe(itemsB[i]!.score)
			expect(itemsA[i]!.subs).toEqual(itemsB[i]!.subs)
		}
	})

	test('scoring WITH trendScores changes the score', () => {
		const items = [
			defaultRedditItem({
				id: 'r1',
				title: 'Test post',
				url: 'https://reddit.com/r/test/1',
				subreddit: 'test',
				date: daysAgo(2),
				engagement: {
					score: 100,
					num_comments: 50,
					upvote_ratio: 0.9,
				},
				relevance: 0.8,
				date_confidence: 'high',
			}),
		]

		const trendMap = new Map<string, TrendScore>()
		trendMap.set('r1', {
			momentum: 1.0,
			diversityBonus: 1.0,
			trendScore: 1.0,
		})

		const withoutTrend = scoreRedditItems([{ ...items[0]! }], 30)
		const withTrend = scoreRedditItems([{ ...items[0]! }], 30, trendMap)

		// Scores should differ when trend data is provided
		expect(withTrend[0]!.score).not.toBe(withoutTrend[0]!.score)
	})

	test('scoring WITH trendScores sets trend metadata fields', () => {
		const items = [
			defaultRedditItem({
				id: 'r1',
				title: 'Trend metadata',
				url: 'https://reddit.com/r/test/1',
				subreddit: 'test',
				date: daysAgo(1),
				engagement: {
					score: 80,
					num_comments: 20,
					upvote_ratio: 0.85,
				},
				relevance: 0.8,
				date_confidence: 'high',
			}),
		]

		const trendMap = new Map<string, TrendScore>()
		trendMap.set('r1', {
			momentum: 0.9,
			diversityBonus: 0.5,
			trendScore: 0.78,
		})

		const scored = scoreRedditItems(items, 30, trendMap)
		expect(scored[0]!.momentum).toBe(0.9)
		expect(scored[0]!.trend_score).toBe(78)
		expect(scored[0]!.subs.trend_score).toBe(78)
	})

	test('trendWeight option changes impact of trend contribution', () => {
		const baseItem = defaultRedditItem({
			id: 'r1',
			title: 'Weight override',
			url: 'https://reddit.com/r/test/1',
			subreddit: 'test',
			date: daysAgo(2),
			engagement: {
				score: 20,
				num_comments: 2,
				upvote_ratio: 0.6,
			},
			relevance: 0.6,
			date_confidence: 'high',
		})

		const trendMap = new Map<string, TrendScore>()
		trendMap.set('r1', {
			momentum: 1.0,
			diversityBonus: 1.0,
			trendScore: 1.0,
		})

		const defaultWeighted = scoreRedditItems([{ ...baseItem }], 30, trendMap)[0]!
		const higherTrendWeighted = scoreRedditItems([{ ...baseItem }], 30, trendMap, {
			trendWeight: 0.2,
		})[0]!

		expect(higherTrendWeighted.score).toBeGreaterThan(defaultWeighted.score)
	})
})
