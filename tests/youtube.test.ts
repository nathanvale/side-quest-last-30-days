import { describe, expect, test } from 'bun:test'

import {
	dedupeYouTube,
	defaultYouTubeItem,
	normalizeYouTubeItems,
	parseYouTubeResults,
	scoreYouTubeItems,
	youtubeEngagementScore,
} from '../src/index'
import type { YouTubeItem } from '../src/lib/schema'
import { reportFromDict, reportToDict } from '../src/lib/schema'

// ---------------------------------------------------------------------------
// youtubeEngagementScore
// ---------------------------------------------------------------------------
describe('youtubeEngagementScore', () => {
	test('returns 0 for all zeros', () => {
		expect(youtubeEngagementScore(0, 0, 0)).toBe(0)
	})

	test('views dominate the score (0.65 weight)', () => {
		const viewsOnly = youtubeEngagementScore(10000, 0, 0)
		const likesOnly = youtubeEngagementScore(0, 10000, 0)
		expect(viewsOnly).toBeGreaterThan(likesOnly)
	})

	test('likes contribute more than comments', () => {
		const likesOnly = youtubeEngagementScore(0, 1000, 0)
		const commentsOnly = youtubeEngagementScore(0, 0, 1000)
		expect(likesOnly).toBeGreaterThan(commentsOnly)
	})

	test('formula uses log1p correctly', () => {
		const score = youtubeEngagementScore(1000, 100, 10)
		const expected = 0.65 * Math.log1p(1000) + 0.3 * Math.log1p(100) + 0.05 * Math.log1p(10)
		expect(score).toBeCloseTo(expected, 10)
	})
})

// ---------------------------------------------------------------------------
// parseYouTubeResults
// ---------------------------------------------------------------------------
describe('parseYouTubeResults', () => {
	test('parses yt-dlp flat-playlist format', () => {
		const raw = [
			{
				id: 'abc123',
				title: 'Test Video',
				uploader: 'TestChannel',
				upload_date: '20260210',
				view_count: 5000,
				like_count: 200,
				comment_count: 15,
			},
		]
		const results = parseYouTubeResults(raw)
		expect(results).toHaveLength(1)
		expect(results[0]!.id).toBe('abc123')
		expect(results[0]!.title).toBe('Test Video')
		expect(results[0]!.channel).toBe('TestChannel')
		expect(results[0]!.url).toBe('https://www.youtube.com/watch?v=abc123')
		expect(results[0]!.date).toBe('2026-02-10')
		expect(results[0]!.views).toBe(5000)
		expect(results[0]!.likes).toBe(200)
		expect(results[0]!.comments).toBe(15)
	})

	test('falls back to channel field if no uploader', () => {
		const raw = [
			{
				id: 'xyz',
				title: 'Video',
				channel: 'FallbackChannel',
				upload_date: '20260101',
			},
		]
		const results = parseYouTubeResults(raw)
		expect(results[0]!.channel).toBe('FallbackChannel')
	})

	test('handles missing upload_date', () => {
		const raw = [
			{
				id: 'no-date',
				title: 'No Date Video',
				uploader: 'Someone',
			},
		]
		const results = parseYouTubeResults(raw)
		expect(results[0]!.date).toBeNull()
	})

	test('handles malformed upload_date', () => {
		const raw = [
			{
				id: 'bad-date',
				title: 'Bad Date',
				uploader: 'Someone',
				upload_date: '2026',
			},
		]
		const results = parseYouTubeResults(raw)
		expect(results[0]!.date).toBeNull()
	})

	test('handles empty array', () => {
		expect(parseYouTubeResults([])).toHaveLength(0)
	})

	test('handles missing fields gracefully', () => {
		const raw = [{}]
		const results = parseYouTubeResults(raw)
		expect(results).toHaveLength(1)
		expect(results[0]!.id).toBe('')
		expect(results[0]!.title).toBe('')
		expect(results[0]!.views).toBe(0)
	})
})

// ---------------------------------------------------------------------------
// normalizeYouTubeItems
// ---------------------------------------------------------------------------
describe('normalizeYouTubeItems', () => {
	test('produces typed YouTubeItem objects', () => {
		const raw = [
			{
				id: 'v1',
				title: 'Test',
				url: 'https://www.youtube.com/watch?v=v1',
				channel: 'Ch1',
				date: '2026-02-10',
				views: 1000,
				likes: 50,
				comments: 5,
				transcript_snippet: '',
				relevance: 0.8,
				why_relevant: 'Relevant video',
			},
		]
		const items = normalizeYouTubeItems(raw, '2026-01-01', '2026-02-19')
		expect(items).toHaveLength(1)
		expect(items[0]!.id).toBe('v1')
		expect(items[0]!.views).toBe(1000)
		expect(items[0]!.engagement).not.toBeNull()
		expect(items[0]!.date_confidence).toBe('high')
	})

	test('sets low date confidence for null dates', () => {
		const raw = [
			{
				id: 'v2',
				title: 'No Date',
				url: 'https://www.youtube.com/watch?v=v2',
				channel: 'Ch',
				date: null,
				views: 0,
				likes: 0,
				comments: 0,
			},
		]
		const items = normalizeYouTubeItems(raw, '2026-01-01', '2026-02-19')
		expect(items[0]!.date_confidence).toBe('low')
	})
})

// ---------------------------------------------------------------------------
// scoreYouTubeItems
// ---------------------------------------------------------------------------
describe('scoreYouTubeItems', () => {
	test('returns empty array for empty input', () => {
		expect(scoreYouTubeItems([])).toHaveLength(0)
	})

	test('produces valid scores in 0-100 range', () => {
		const items: YouTubeItem[] = [
			defaultYouTubeItem({
				id: 'v1',
				title: 'Popular',
				url: 'https://www.youtube.com/watch?v=v1',
				channel: 'Ch1',
				date: '2026-02-15',
				date_confidence: 'high',
				views: 100000,
				likes: 5000,
				comments: 300,
				relevance: 0.9,
			}),
			defaultYouTubeItem({
				id: 'v2',
				title: 'Unpopular',
				url: 'https://www.youtube.com/watch?v=v2',
				channel: 'Ch2',
				date: '2026-02-01',
				date_confidence: 'high',
				views: 100,
				likes: 5,
				comments: 1,
				relevance: 0.3,
			}),
		]

		const scored = scoreYouTubeItems(items, 30)
		for (const item of scored) {
			expect(item.score).toBeGreaterThanOrEqual(0)
			expect(item.score).toBeLessThanOrEqual(100)
			expect(Number.isFinite(item.score)).toBe(true)
		}
		// Popular item should score higher
		expect(scored[0]!.score).toBeGreaterThan(scored[1]!.score)
	})

	test('low date confidence applies penalty', () => {
		const highConf = defaultYouTubeItem({
			id: 'v1',
			title: 'T',
			url: 'u',
			channel: 'c',
			date: '2026-02-10',
			date_confidence: 'high',
			views: 1000,
			likes: 50,
			comments: 5,
			relevance: 0.7,
		})
		const lowConf = defaultYouTubeItem({
			id: 'v2',
			title: 'T',
			url: 'u2',
			channel: 'c',
			date: '2026-02-10',
			date_confidence: 'low',
			views: 1000,
			likes: 50,
			comments: 5,
			relevance: 0.7,
		})

		const [scoredHigh] = scoreYouTubeItems([highConf], 30)
		const [scoredLow] = scoreYouTubeItems([lowConf], 30)
		expect(scoredHigh!.score).toBeGreaterThan(scoredLow!.score)
	})
})

// ---------------------------------------------------------------------------
// dedupeYouTube
// ---------------------------------------------------------------------------
describe('dedupeYouTube', () => {
	test('removes duplicate URLs', () => {
		const items: YouTubeItem[] = [
			defaultYouTubeItem({
				id: 'v1',
				title: 'First',
				url: 'https://www.youtube.com/watch?v=abc',
				channel: 'Ch',
				score: 80,
			}),
			defaultYouTubeItem({
				id: 'v2',
				title: 'Duplicate',
				url: 'https://www.youtube.com/watch?v=abc',
				channel: 'Ch',
				score: 60,
			}),
		]

		const deduped = dedupeYouTube(items)
		expect(deduped).toHaveLength(1)
		expect(deduped[0]!.title).toBe('First')
	})

	test('keeps items with different URLs', () => {
		const items: YouTubeItem[] = [
			defaultYouTubeItem({
				id: 'v1',
				title: 'First',
				url: 'https://www.youtube.com/watch?v=abc',
				channel: 'Ch',
			}),
			defaultYouTubeItem({
				id: 'v2',
				title: 'Second',
				url: 'https://www.youtube.com/watch?v=def',
				channel: 'Ch',
			}),
		]

		expect(dedupeYouTube(items)).toHaveLength(2)
	})

	test('URL comparison is case-insensitive', () => {
		const items: YouTubeItem[] = [
			defaultYouTubeItem({
				id: 'v1',
				title: 'First',
				url: 'https://www.YouTube.com/watch?v=ABC',
				channel: 'Ch',
			}),
			defaultYouTubeItem({
				id: 'v2',
				title: 'Dup',
				url: 'https://www.youtube.com/watch?v=abc',
				channel: 'Ch',
			}),
		]

		expect(dedupeYouTube(items)).toHaveLength(1)
	})

	test('handles empty array', () => {
		expect(dedupeYouTube([])).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// defaultYouTubeItem
// ---------------------------------------------------------------------------
describe('defaultYouTubeItem', () => {
	test('fills in defaults for optional fields', () => {
		const item = defaultYouTubeItem({
			id: 'test',
			title: 'Test',
			url: 'https://youtube.com/watch?v=test',
			channel: 'TestChannel',
		})
		expect(item.date).toBeNull()
		expect(item.date_confidence).toBe('low')
		expect(item.views).toBe(0)
		expect(item.likes).toBe(0)
		expect(item.comments).toBe(0)
		expect(item.transcript_snippet).toBe('')
		expect(item.engagement).toBeNull()
		expect(item.relevance).toBe(0.5)
		expect(item.score).toBe(0)
	})

	test('partial overrides work', () => {
		const item = defaultYouTubeItem({
			id: 'test',
			title: 'Test',
			url: 'u',
			channel: 'c',
			views: 5000,
			relevance: 0.9,
		})
		expect(item.views).toBe(5000)
		expect(item.relevance).toBe(0.9)
	})
})

// ---------------------------------------------------------------------------
// Report serialization with YouTube
// ---------------------------------------------------------------------------
describe('report serialization with YouTube', () => {
	test('reportToDict includes youtube items', () => {
		const { createReport } = require('../src/lib/schema')
		const report = createReport('test', '2026-01-01', '2026-02-19', 'both')
		report.youtube = [
			defaultYouTubeItem({
				id: 'v1',
				title: 'Video',
				url: 'https://youtube.com/watch?v=v1',
				channel: 'Ch',
				views: 100,
			}),
		]
		const dict = reportToDict(report)
		const ytArr = dict.youtube as unknown[]
		expect(ytArr).toHaveLength(1)
	})

	test('reportFromDict handles missing youtube field', () => {
		const dict = {
			topic: 'test',
			days: 7,
			range: { from: '2026-02-12', to: '2026-02-19' },
			generated_at: '2026-02-19T00:00:00Z',
			mode: 'both',
			reddit: [],
			x: [],
			web: [],
			// youtube field intentionally omitted
		}
		const report = reportFromDict(dict as Record<string, unknown>)
		expect(report.youtube).toHaveLength(0)
		expect(report.youtube_error).toBeNull()
	})

	test('reportFromDict round-trips youtube items', () => {
		const { createReport } = require('../src/lib/schema')
		const report = createReport('test', '2026-01-01', '2026-02-19', 'both')
		report.youtube = [
			defaultYouTubeItem({
				id: 'v1',
				title: 'Video',
				url: 'https://youtube.com/watch?v=v1',
				channel: 'Ch',
				views: 500,
				likes: 25,
				comments: 3,
			}),
		]
		const dict = reportToDict(report)
		const restored = reportFromDict(dict as Record<string, unknown>)
		expect(restored.youtube).toHaveLength(1)
		expect(restored.youtube[0]!.id).toBe('v1')
		expect(restored.youtube[0]!.views).toBe(500)
	})
})
