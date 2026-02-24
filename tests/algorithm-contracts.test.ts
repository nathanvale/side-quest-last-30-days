import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dedupeReddit, dedupeYouTube } from '../src/lib/dedupe.js'
import {
	filterByDateRange,
	normalizeRedditItems,
	normalizeXItems,
	normalizeYouTubeItems,
} from '../src/lib/normalize.js'
import { defaultRedditItem, defaultWebSearchItem, defaultYouTubeItem } from '../src/lib/schema.js'
import { scoreRedditItems, scoreWebsearchItems } from '../src/lib/score.js'
import type { TrendScore } from '../src/lib/trend.js'
import { normalizeWebsearchItems } from '../src/lib/websearch.js'

const FIXED_NOW = new Date('2026-02-21T00:00:00Z')

function withFixedDate<T>(fn: () => T): T {
	const RealDate = Date
	const FixedDate = class extends RealDate {
		constructor(...args: unknown[]) {
			if (args.length === 0) {
				super(FIXED_NOW.getTime())
				return
			}
			super(...(args as ConstructorParameters<typeof Date>))
		}
		static override now() {
			return FIXED_NOW.getTime()
		}
	}
	// @ts-expect-error override Date for deterministic scoring
	globalThis.Date = FixedDate
	try {
		return fn()
	} finally {
		globalThis.Date = RealDate
	}
}

function loadNormalizeFixture() {
	const testDir = dirname(fileURLToPath(import.meta.url))
	const fixturePath = join(testDir, '..', 'fixtures', 'algorithm-baseline', 'normalize-sample.json')
	return JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
		from_date: string
		to_date: string
		reddit: Record<string, unknown>[]
		x: Record<string, unknown>[]
		youtube: Record<string, unknown>[]
		web: Record<string, unknown>[]
	}
}

describe('algorithm contracts', () => {
	test('normalization preserves core fields and date confidence', () => {
		const fixture = loadNormalizeFixture()
		const reddit = normalizeRedditItems(fixture.reddit, fixture.from_date, fixture.to_date)
		const x = normalizeXItems(fixture.x, fixture.from_date, fixture.to_date)
		const youtube = normalizeYouTubeItems(fixture.youtube, fixture.from_date, fixture.to_date)
		const web = normalizeWebsearchItems(fixture.web, fixture.from_date, fixture.to_date)

		expect(reddit[0]!.id).toBe('r-sample-1')
		expect(reddit[0]!.date_confidence).toBe('high')
		expect(reddit[0]!.engagement?.score).toBe(120)
		expect(x[0]!.author_handle).toBe('sample')
		expect(x[0]!.date_confidence).toBe('high')
		expect(youtube[0]!.views).toBe(12345)
		expect(youtube[0]!.date_confidence).toBe('high')
		expect(web[0]!.source_domain).toBe('example.com')
		expect(web[0]!.date_confidence).toBe('high')
	})

	test('recency decay favors recent items', () => {
		withFixedDate(() => {
			const recent = defaultRedditItem({
				id: 'recent',
				title: 'Recent item',
				url: 'https://reddit.com/r/test/recent',
				subreddit: 'test',
				date: '2026-02-21',
				date_confidence: 'high',
				relevance: 0.8,
				engagement: { score: 100, num_comments: 10, upvote_ratio: 0.9 },
			})
			const older = defaultRedditItem({
				id: 'older',
				title: 'Older item',
				url: 'https://reddit.com/r/test/older',
				subreddit: 'test',
				date: '2026-02-01',
				date_confidence: 'high',
				relevance: 0.8,
				engagement: { score: 100, num_comments: 10, upvote_ratio: 0.9 },
			})
			const scored = scoreRedditItems([recent, older], 30)
			expect(scored[0]!.score).toBeGreaterThan(scored[1]!.score)
		})
	})

	test('trend weighting influences scores', () => {
		withFixedDate(() => {
			const base = {
				title: 'Trend test',
				url: 'https://reddit.com/r/test/trend',
				subreddit: 'test',
				date: '2026-02-20',
				date_confidence: 'high',
				relevance: 0.7,
				engagement: { score: 50, num_comments: 5, upvote_ratio: 0.8 },
			}
			const hot = defaultRedditItem({ ...base, id: 'hot' })
			const cold = defaultRedditItem({ ...base, id: 'cold' })
			const trendScores = new Map<string, TrendScore>([
				[hot.id, { momentum: 1, diversityBonus: 1, trendScore: 1 }],
				[cold.id, { momentum: 0, diversityBonus: 0, trendScore: 0 }],
			])
			const scored = scoreRedditItems([hot, cold], 30, trendScores, {
				trendWeight: 0.5,
			})
			const hotScore = scored.find((item) => item.id === 'hot')!.score
			const coldScore = scored.find((item) => item.id === 'cold')!.score
			expect(hotScore).toBeGreaterThan(coldScore)
		})
	})

	test('penalties apply to unknown engagement and low date confidence', () => {
		withFixedDate(() => {
			const base = {
				title: 'Penalty test',
				url: 'https://reddit.com/r/test/penalty',
				subreddit: 'test',
				date: '2026-02-20',
				relevance: 0.7,
			}
			const withEngagement = defaultRedditItem({
				...base,
				id: 'eng',
				date_confidence: 'high',
				engagement: { score: 50, num_comments: 5, upvote_ratio: 0.8 },
			})
			const withoutEngagement = defaultRedditItem({
				...base,
				id: 'no-eng',
				date_confidence: 'low',
				engagement: null,
			})
			const scored = scoreRedditItems([withEngagement, withoutEngagement], 30)
			const engScore = scored.find((item) => item.id === 'eng')!.score
			const noEngScore = scored.find((item) => item.id === 'no-eng')!.score
			expect(engScore).toBeGreaterThan(noEngScore)
		})
	})

	test('web search confidence bonuses and penalties apply', () => {
		withFixedDate(() => {
			const base = {
				id: 'web-1',
				title: 'Web baseline',
				url: 'https://example.com/web',
				source_domain: 'example.com',
				snippet: 'Snippet',
				relevance: 0.6,
			}
			const high = defaultWebSearchItem({
				...base,
				id: 'web-high',
				date: '2026-02-20',
				date_confidence: 'high',
			})
			const low = defaultWebSearchItem({
				...base,
				id: 'web-low',
				date: null,
				date_confidence: 'low',
			})
			const scored = scoreWebsearchItems([high, low], 30)
			const highScore = scored.find((item) => item.id === 'web-high')!.score
			const lowScore = scored.find((item) => item.id === 'web-low')!.score
			expect(highScore).toBeGreaterThan(lowScore)
		})
	})

	test('dedupe keeps highest scored near-duplicate and YouTube video ID', () => {
		const a = defaultRedditItem({
			id: 'dup-1',
			title: 'Duplicate title example',
			url: 'https://reddit.com/r/test/dup-1',
			subreddit: 'test',
			score: 80,
		})
		const b = defaultRedditItem({
			id: 'dup-2',
			title: 'Duplicate title example!',
			url: 'https://reddit.com/r/test/dup-2',
			subreddit: 'test',
			score: 60,
		})
		const deduped = dedupeReddit([a, b])
		expect(deduped.length).toBe(1)
		expect(deduped[0]!.id).toBe('dup-1')

		const ytA = defaultYouTubeItem({
			id: 'yt-1',
			title: 'YouTube dup',
			url: 'https://www.youtube.com/watch?v=video123',
			channel: 'Channel A',
		})
		const ytB = defaultYouTubeItem({
			id: 'yt-2',
			title: 'YouTube dup other',
			url: 'https://youtu.be/video123',
			channel: 'Channel B',
		})
		const dedupedYT = dedupeYouTube([ytA, ytB])
		expect(dedupedYT.length).toBe(1)
		const remainingId = dedupedYT[0]!.id
		expect(['yt-1', 'yt-2'].includes(remainingId)).toBe(true)
	})

	test('filterByDateRange drops out-of-window items', () => {
		const items = [
			defaultRedditItem({
				id: 'in-range',
				title: 'In range',
				url: 'https://reddit.com/r/test/in-range',
				subreddit: 'test',
				date: '2026-02-10',
			}),
			defaultRedditItem({
				id: 'out-range',
				title: 'Out range',
				url: 'https://reddit.com/r/test/out-range',
				subreddit: 'test',
				date: '2025-12-01',
			}),
		]
		const filtered = filterByDateRange(items, '2026-01-22', '2026-02-21')
		expect(filtered.length).toBe(1)
		expect(filtered[0]!.id).toBe('in-range')
	})

	test('filterByDateRange keeps null-date items by default', () => {
		const items = [
			defaultRedditItem({
				id: 'null-date',
				title: 'Null date',
				url: 'https://reddit.com/r/test/null-date',
				subreddit: 'test',
				date: null,
			}),
			defaultRedditItem({
				id: 'out-range',
				title: 'Out range',
				url: 'https://reddit.com/r/test/out-range-2',
				subreddit: 'test',
				date: '2025-12-01',
			}),
		]
		const filtered = filterByDateRange(items, '2026-01-22', '2026-02-21')
		expect(filtered.length).toBe(1)
		expect(filtered[0]!.id).toBe('null-date')
	})

	test('filterByDateRange can require explicit dates', () => {
		const items = [
			defaultRedditItem({
				id: 'null-date',
				title: 'Null date required',
				url: 'https://reddit.com/r/test/null-date-required',
				subreddit: 'test',
				date: null,
			}),
			defaultRedditItem({
				id: 'in-range',
				title: 'In range explicit',
				url: 'https://reddit.com/r/test/in-range-explicit',
				subreddit: 'test',
				date: '2026-02-10',
			}),
		]
		const filtered = filterByDateRange(items, '2026-01-22', '2026-02-21', true)
		expect(filtered.length).toBe(1)
		expect(filtered[0]!.id).toBe('in-range')
	})
})
