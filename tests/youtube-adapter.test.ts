import { describe, expect, test } from 'bun:test'

import { buildYouTubeSearchArgs } from '../src/adapters/youtube'

describe('buildYouTubeSearchArgs', () => {
	const now = new Date('2026-02-19T12:00:00.000Z')

	test('uses quick depth with recent-date search and dateafter filter', () => {
		const args = buildYouTubeSearchArgs('claude code', 30, 'quick', now)
		expect(args).toEqual([
			'yt-dlp',
			'--flat-playlist',
			'--dump-json',
			'--dateafter',
			'20260120',
			'ytsearchdate5:claude code',
		])
	})

	test('uses deep depth with 20 results', () => {
		const args = buildYouTubeSearchArgs('bun typescript', 7, 'deep', now)
		expect(args).toEqual([
			'yt-dlp',
			'--flat-playlist',
			'--dump-json',
			'--dateafter',
			'20260212',
			'ytsearchdate20:bun typescript',
		])
	})

	test('defaults to 10 results for standard depth', () => {
		const args = buildYouTubeSearchArgs('hello', 14, 'normal', now)
		expect(args[5]).toBe('ytsearchdate10:hello')
	})

	test('clamps lookback window to 1..365 days', () => {
		const minimum = buildYouTubeSearchArgs('topic', 0, 'normal', now)
		const maximum = buildYouTubeSearchArgs('topic', 999, 'normal', now)
		expect(minimum[4]).toBe('20260218')
		expect(maximum[4]).toBe('20250219')
	})
})
