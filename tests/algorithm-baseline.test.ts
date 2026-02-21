import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dedupeReddit, dedupeWebsearch, dedupeX, dedupeYouTube } from '../src/lib/dedupe.js'
import { filterByDateRange } from '../src/lib/normalize.js'
import type { RedditItem, WebSearchItem, XItem, YouTubeItem } from '../src/lib/schema.js'
import {
	scoreRedditItems,
	scoreWebsearchItems,
	scoreXItems,
	scoreYouTubeItems,
	sortItems,
} from '../src/lib/score.js'
import { computeTrendScores } from '../src/lib/trend.js'

type BaselineFixture = {
	meta: {
		version: string
		generated_at: string
		days: number
		from_date: string
		to_date: string
		items_per_source: number
	}
	policy: {
		score_delta: {
			absolute: number
			percent: number
			baseline_floor: number
		}
		ranking: {
			top_n_strict: number
			max_drift: number
		}
		tie_breakers: string[]
	}
	topics: BaselineTopic[]
}

type BaselineTopic = {
	id: string
	topic: string
	inputs: {
		reddit: RedditItem[]
		x: XItem[]
		youtube: YouTubeItem[]
		web: WebSearchItem[]
	}
	expected: {
		reddit: RedditItem[]
		x: XItem[]
		youtube: YouTubeItem[]
		web: WebSearchItem[]
	}
}

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

function loadFixture(): BaselineFixture {
	const testDir = dirname(fileURLToPath(import.meta.url))
	const fixturePath = join(testDir, '..', 'fixtures', 'algorithm-baseline', 'v1.json')
	return JSON.parse(readFileSync(fixturePath, 'utf-8')) as BaselineFixture
}

function scoreTolerance(
	baselineScore: number,
	actualScore: number,
	policy: BaselineFixture['policy']['score_delta'],
): number {
	const baseline = Math.max(baselineScore, policy.baseline_floor)
	const allowed = Math.max(policy.absolute, policy.percent * baseline)
	return Math.abs(actualScore - baselineScore) - allowed
}

function compareRanking<T extends { id: string; score: number }>(
	source: string,
	topic: string,
	expected: T[],
	actual: T[],
	policy: BaselineFixture['policy'],
): { scoreMismatch: number; rankMismatch: number; details: string[] } {
	const details: string[] = []
	const expectedIds = expected.map((item) => item.id)
	const actualIds = actual.map((item) => item.id)

	if (expectedIds.length !== actualIds.length) {
		details.push(`${source}: expected ${expectedIds.length} items, got ${actualIds.length}`)
	}

	const expectedById = new Map(expected.map((item) => [item.id, item]))
	const actualById = new Map(actual.map((item) => [item.id, item]))

	let scoreMismatch = 0
	for (const expectedItem of expected) {
		const actualItem = actualById.get(expectedItem.id)
		if (!actualItem) {
			details.push(`${source}: missing ${expectedItem.id}`)
			scoreMismatch += 1
			continue
		}
		if (scoreTolerance(expectedItem.score, actualItem.score, policy.score_delta) > 0) {
			scoreMismatch += 1
			if (details.length < 8) {
				details.push(
					`${source}: score delta ${expectedItem.id} expected=${expectedItem.score} actual=${actualItem.score}`,
				)
			}
		}
	}

	const topN = policy.ranking.top_n_strict
	const expectedTop = expectedIds.slice(0, topN)
	const actualTop = actualIds.slice(0, topN)
	let rankMismatch = 0

	if (expectedTop.join('|') !== actualTop.join('|')) {
		rankMismatch += 1
		details.push(`${source}: top-${topN} order changed for ${topic}`)
	}

	const maxDrift = policy.ranking.max_drift
	for (let i = topN; i < expectedIds.length; i++) {
		const id = expectedIds[i]!
		const actualIndex = actualIds.indexOf(id)
		if (actualIndex === -1) {
			rankMismatch += 1
			if (details.length < 8) details.push(`${source}: missing ${id}`)
			continue
		}
		const expectedItem = expectedById.get(id)
		const actualItem = actualById.get(id)
		if (!expectedItem || !actualItem) continue

		const scoreDelta = scoreTolerance(expectedItem.score, actualItem.score, policy.score_delta) > 0

		if (scoreDelta) continue
		const drift = Math.abs(actualIndex - i)
		if (drift > maxDrift) {
			rankMismatch += 1
			if (details.length < 8) {
				details.push(`${source}: ${id} drifted by ${drift} slots (max ${maxDrift})`)
			}
		}
	}

	return { scoreMismatch, rankMismatch, details }
}

describe('algorithm baseline', () => {
	test('matches deterministic snapshots with tolerance', () => {
		const baseline = loadFixture()

		const failures: string[] = []
		withFixedDate(() => {
			for (const topic of baseline.topics) {
				const { from_date, to_date, days } = baseline.meta

				const filteredReddit = filterByDateRange(topic.inputs.reddit, from_date, to_date)
				const filteredX = filterByDateRange(topic.inputs.x, from_date, to_date)
				const filteredYouTube = filterByDateRange(topic.inputs.youtube, from_date, to_date)
				const filteredWeb = filterByDateRange(topic.inputs.web, from_date, to_date)

				const trendScores = computeTrendScores([
					...filteredReddit,
					...filteredX,
					...filteredYouTube,
					...filteredWeb,
				])

				const scoredReddit = scoreRedditItems(filteredReddit, days, trendScores)
				const scoredX = scoreXItems(filteredX, days, trendScores)
				const scoredYouTube = scoreYouTubeItems(filteredYouTube, days, trendScores)
				const scoredWeb = scoreWebsearchItems(filteredWeb, days, trendScores)

				const actualReddit = dedupeReddit(sortItems(scoredReddit) as RedditItem[])
				const actualX = dedupeX(sortItems(scoredX) as XItem[])
				const actualYouTube = dedupeYouTube(sortItems(scoredYouTube) as YouTubeItem[])
				const actualWeb = dedupeWebsearch(sortItems(scoredWeb) as WebSearchItem[])

				const sources = [
					{
						name: 'reddit',
						expected: topic.expected.reddit,
						actual: actualReddit,
					},
					{
						name: 'x',
						expected: topic.expected.x,
						actual: actualX,
					},
					{
						name: 'youtube',
						expected: topic.expected.youtube,
						actual: actualYouTube,
					},
					{
						name: 'web',
						expected: topic.expected.web,
						actual: actualWeb,
					},
				]

				for (const source of sources) {
					const { scoreMismatch, rankMismatch, details } = compareRanking(
						source.name,
						topic.topic,
						source.expected,
						source.actual,
						baseline.policy,
					)
					if (scoreMismatch > 0 || rankMismatch > 0) {
						failures.push(
							`${topic.topic} (${source.name}): ${scoreMismatch} score deltas, ${rankMismatch} rank mismatches`,
						)
						failures.push(...details)
					}
				}
			}
		})

		if (failures.length > 0) {
			const message = [
				'Algorithm baseline mismatch detected.',
				...failures.slice(0, 16),
				'If this change is intentional, run:',
				'  bun run update:baseline',
				'Then review the diff in fixtures and commit.',
			].join('\n')
			throw new Error(message)
		}

		expect(failures.length).toBe(0)
	})
})
