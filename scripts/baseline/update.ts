#!/usr/bin/env bun

import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDateConfidence } from '../../src/lib/dates.js'
import {
	dedupeReddit,
	dedupeWebsearch,
	dedupeX,
	dedupeYouTube,
} from '../../src/lib/dedupe.js'
import { filterByDateRange } from '../../src/lib/normalize.js'
import type {
	RedditItem,
	WebSearchItem,
	XItem,
	YouTubeItem,
} from '../../src/lib/schema.js'
import {
	defaultRedditItem,
	defaultWebSearchItem,
	defaultXItem,
	defaultYouTubeItem,
} from '../../src/lib/schema.js'
import {
	scoreRedditItems,
	scoreWebsearchItems,
	scoreXItems,
	scoreYouTubeItems,
	sortItems,
} from '../../src/lib/score.js'
import { computeTrendScores } from '../../src/lib/trend.js'

const FIXED_NOW = new Date('2026-02-21T00:00:00Z')
const FROM_DATE = '2026-01-22'
const TO_DATE = '2026-02-21'
const DAYS = 30
const ITEMS_PER_SOURCE = 18

const TOPICS = [
	{
		id: 'ai-assistants',
		label: 'AI coding assistants',
		seed: 'topic-ai-assistants',
	},
	{
		id: 'rust-runtime',
		label: 'Rust async runtime',
		seed: 'topic-rust-runtime',
	},
	{
		id: 'melbourne-events',
		label: 'Melbourne tech events',
		seed: 'topic-melbourne-events',
	},
	{
		id: 'e-bike',
		label: 'Electric bike commuting',
		seed: 'topic-e-bike',
	},
	{
		id: 'indie-games',
		label: 'Indie game releases',
		seed: 'topic-indie-games',
	},
]

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

function mulberry32(seed: number) {
	let t = seed >>> 0
	return () => {
		t += 0x6d2b79f5
		let r = Math.imul(t ^ (t >>> 15), 1 | t)
		r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296
	}
}

function seedFromString(value: string): number {
	let hash = 2166136261
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	return hash >>> 0
}

function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, n))
}

function dateFromOffset(offsetDays: number): string {
	const base = new Date(`${TO_DATE}T00:00:00Z`)
	base.setUTCDate(base.getUTCDate() - offsetDays)
	const year = base.getUTCFullYear()
	const month = String(base.getUTCMonth() + 1).padStart(2, '0')
	const day = String(base.getUTCDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

function pickDate(
	rng: () => number,
	index: number,
): { date: string | null; date_confidence: string } {
	if (index % 13 === 0) return { date: null, date_confidence: 'low' }
	if (index % 11 === 0) {
		const date = dateFromOffset(DAYS + 5)
		return {
			date,
			date_confidence: getDateConfidence(date, FROM_DATE, TO_DATE),
		}
	}
	const offset = Math.floor(rng() * DAYS)
	const date = dateFromOffset(offset)
	return { date, date_confidence: getDateConfidence(date, FROM_DATE, TO_DATE) }
}

function makeRedditItems(topic: string, seed: string): RedditItem[] {
	const rng = mulberry32(seedFromString(seed))
	const items: RedditItem[] = []
	for (let i = 0; i < ITEMS_PER_SOURCE; i++) {
		const id = `${seed}-r-${i + 1}`
		const titleBase =
			i % 9 === 0 ? `${topic} weekly roundup` : `${topic} insight ${i + 1}`
		const title = i % 9 === 1 ? `${titleBase} (analysis)` : titleBase
		const { date, date_confidence } = pickDate(rng, i)
		const relevance = clamp(0.3 + rng() * 0.7, 0, 1)
		const engagement = {
			score: Math.floor(rng() * 420),
			num_comments: Math.floor(rng() * 80),
			upvote_ratio: clamp(0.6 + rng() * 0.4, 0, 1),
		}
		items.push(
			defaultRedditItem({
				id,
				title,
				url: `https://reddit.com/r/${topic
					.replace(/\s+/g, '')
					.toLowerCase()}/comments/${id}`,
				subreddit: topic.replace(/\s+/g, '').toLowerCase(),
				date,
				date_confidence,
				engagement,
				relevance,
				why_relevant: `Signals for ${topic}`,
			}),
		)
	}
	return items
}

function makeXItems(topic: string, seed: string): XItem[] {
	const rng = mulberry32(seedFromString(seed))
	const items: XItem[] = []
	for (let i = 0; i < ITEMS_PER_SOURCE; i++) {
		const id = `${seed}-x-${i + 1}`
		const textBase =
			i % 8 === 0 ? `${topic} breakdown thread` : `${topic} chatter ${i + 1}`
		const text = i % 8 === 1 ? `${textBase} (follow-up)` : textBase
		const { date, date_confidence } = pickDate(rng, i)
		const relevance = clamp(0.25 + rng() * 0.75, 0, 1)
		const engagement = {
			likes: Math.floor(rng() * 320),
			reposts: Math.floor(rng() * 80),
			replies: Math.floor(rng() * 60),
			quotes: Math.floor(rng() * 20),
		}
		items.push(
			defaultXItem({
				id,
				text,
				url: `https://x.com/analyst/status/${id}`,
				author_handle: `analyst_${i + 1}`,
				date,
				date_confidence,
				engagement,
				relevance,
				why_relevant: `Signal for ${topic}`,
			}),
		)
	}
	return items
}

function makeYouTubeItems(topic: string, seed: string): YouTubeItem[] {
	const rng = mulberry32(seedFromString(seed))
	const items: YouTubeItem[] = []
	for (let i = 0; i < ITEMS_PER_SOURCE; i++) {
		const id = `${seed}-y-${i + 1}`
		const videoId = i % 10 === 0 ? `${seed}-video-1` : `${seed}-video-${i + 1}`
		const title = i % 7 === 0 ? `${topic} deep dive` : `${topic} recap ${i + 1}`
		const { date, date_confidence } = pickDate(rng, i)
		const relevance = clamp(0.2 + rng() * 0.8, 0, 1)
		const views = Math.floor(500 + rng() * 50_000)
		const likes = Math.floor(50 + rng() * 5_000)
		const comments = Math.floor(10 + rng() * 1_000)
		items.push(
			defaultYouTubeItem({
				id,
				title,
				url: `https://www.youtube.com/watch?v=${videoId}`,
				channel: `Channel ${i + 1}`,
				date,
				date_confidence,
				views,
				likes,
				comments,
				relevance,
				why_relevant: `Video signal for ${topic}`,
				engagement: {
					score: views,
					likes,
					replies: comments,
				},
			}),
		)
	}
	return items
}

function makeWebItems(topic: string, seed: string): WebSearchItem[] {
	const rng = mulberry32(seedFromString(seed))
	const items: WebSearchItem[] = []
	for (let i = 0; i < ITEMS_PER_SOURCE; i++) {
		const id = `${seed}-w-${i + 1}`
		const slug = topic.replace(/\s+/g, '-').toLowerCase()
		const duplicate = i % 12 === 0
		const url = duplicate
			? `https://news.example.com/${slug}/shared-report`
			: `https://news.example.com/${slug}/${i + 1}`
		const { date, date_confidence } = pickDate(rng, i)
		const relevance = clamp(0.2 + rng() * 0.8, 0, 1)
		items.push(
			defaultWebSearchItem({
				id,
				title: duplicate
					? `${topic} shared report`
					: `${topic} article ${i + 1}`,
				url,
				source_domain: 'news.example.com',
				snippet: `Coverage on ${topic} (${i + 1})`,
				date,
				date_confidence,
				relevance,
				why_relevant: `Coverage for ${topic}`,
			}),
		)
	}
	return items
}

function buildTopicPayload(topic: (typeof TOPICS)[number]) {
	const reddit = makeRedditItems(topic.label, `${topic.seed}-reddit`)
	const x = makeXItems(topic.label, `${topic.seed}-x`)
	const youtube = makeYouTubeItems(topic.label, `${topic.seed}-youtube`)
	const web = makeWebItems(topic.label, `${topic.seed}-web`)

	const filteredReddit = filterByDateRange(reddit, FROM_DATE, TO_DATE)
	const filteredX = filterByDateRange(x, FROM_DATE, TO_DATE)
	const filteredYouTube = filterByDateRange(youtube, FROM_DATE, TO_DATE)
	const filteredWeb = filterByDateRange(web, FROM_DATE, TO_DATE)

	const trendScores = computeTrendScores([
		...filteredReddit,
		...filteredX,
		...filteredYouTube,
		...filteredWeb,
	])

	const scoredReddit = scoreRedditItems(filteredReddit, DAYS, trendScores)
	const scoredX = scoreXItems(filteredX, DAYS, trendScores)
	const scoredYouTube = scoreYouTubeItems(filteredYouTube, DAYS, trendScores)
	const scoredWeb = scoreWebsearchItems(filteredWeb, DAYS, trendScores)

	const sortedReddit = sortItems(scoredReddit) as RedditItem[]
	const sortedX = sortItems(scoredX) as XItem[]
	const sortedYouTube = sortItems(scoredYouTube) as YouTubeItem[]
	const sortedWeb = sortItems(scoredWeb) as WebSearchItem[]

	return {
		id: topic.id,
		topic: topic.label,
		inputs: {
			reddit,
			x,
			youtube,
			web,
		},
		expected: {
			reddit: dedupeReddit(sortedReddit),
			x: dedupeX(sortedX),
			youtube: dedupeYouTube(sortedYouTube),
			web: dedupeWebsearch(sortedWeb),
		},
	}
}

function buildBaseline() {
	return withFixedDate(() => {
		const topics = TOPICS.map((topic) => buildTopicPayload(topic))
		return {
			meta: {
				version: 'v1',
				generated_at: FIXED_NOW.toISOString(),
				days: DAYS,
				from_date: FROM_DATE,
				to_date: TO_DATE,
				items_per_source: ITEMS_PER_SOURCE,
			},
			policy: {
				score_delta: {
					absolute: 0.01,
					percent: 0.005,
					baseline_floor: 1.0,
				},
				ranking: {
					top_n_strict: 10,
					max_drift: 2,
				},
				tie_breakers: ['source', 'id', 'title'],
			},
			topics,
		}
	})
}

const output = buildBaseline()
const scriptDir = dirname(fileURLToPath(import.meta.url))
const outputDir = join(scriptDir, '..', '..', 'fixtures', 'algorithm-baseline')
mkdirSync(outputDir, { recursive: true })
const outPath = join(outputDir, 'v1.json')
writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`)
execSync(`bunx biome format --write ${outPath}`, { stdio: 'ignore' })

process.stdout.write('Algorithm baseline fixtures updated.\n')
