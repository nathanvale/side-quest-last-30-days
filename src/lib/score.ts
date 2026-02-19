/** Popularity-aware scoring for last-30-days skill. */

import { recencyScore } from './dates.js'
import type {
	Engagement,
	RedditItem,
	WebSearchItem,
	XItem,
	YouTubeItem,
} from './schema.js'
import type { TrendScore } from './trend.js'

type SortableItem = RedditItem | XItem | WebSearchItem | YouTubeItem

interface ScoreOptions {
	trendWeight?: number
}

// Score weights for Reddit/X (has engagement)
const WEIGHT_RELEVANCE = 0.45
const WEIGHT_RECENCY = 0.25
const WEIGHT_ENGAGEMENT = 0.3

// WebSearch weights (no engagement, reweighted to 100%)
const WEBSEARCH_WEIGHT_RELEVANCE = 0.55
const WEBSEARCH_WEIGHT_RECENCY = 0.45
const WEBSEARCH_SOURCE_PENALTY = 15

// WebSearch date confidence adjustments
const WEBSEARCH_VERIFIED_BONUS = 10
const WEBSEARCH_NO_DATE_PENALTY = 20

// Default trend contribution when trend data is available
const DEFAULT_WEIGHT_TREND = 0.1

// Default engagement score for unknown
const DEFAULT_ENGAGEMENT = 35
const UNKNOWN_ENGAGEMENT_PENALTY = 10

/** Safe log1p that handles null and negative values. */
function log1pSafe(x: number | null | undefined): number {
	if (x == null || x < 0) return 0.0
	return Math.log1p(x)
}

/** Compute raw engagement score for Reddit item. */
function computeRedditEngagementRaw(
	engagement: Engagement | null,
): number | null {
	if (!engagement) return null
	if (engagement.score == null && engagement.num_comments == null) return null

	const score = log1pSafe(engagement.score)
	const comments = log1pSafe(engagement.num_comments)
	const ratio = (engagement.upvote_ratio ?? 0.5) * 10

	return 0.55 * score + 0.4 * comments + 0.05 * ratio
}

/** Compute raw engagement score for X item. */
function computeXEngagementRaw(engagement: Engagement | null): number | null {
	if (!engagement) return null
	if (engagement.likes == null && engagement.reposts == null) return null

	const likes = log1pSafe(engagement.likes)
	const reposts = log1pSafe(engagement.reposts)
	const replies = log1pSafe(engagement.replies)
	const quotes = log1pSafe(engagement.quotes)

	return 0.55 * likes + 0.25 * reposts + 0.15 * replies + 0.05 * quotes
}

/** Normalize a list of values to 0-100 scale. */
function normalizeTo100(
	values: (number | null)[],
	defaultVal = 50,
): (number | null)[] {
	const valid = values.filter((v): v is number => v !== null)
	if (valid.length === 0) {
		return values.map((v) => (v === null ? defaultVal : 50))
	}

	const minVal = Math.min(...valid)
	const maxVal = Math.max(...valid)
	const rangeVal = maxVal - minVal

	if (rangeVal === 0) {
		return values.map((v) => (v === null ? null : 50))
	}

	return values.map((v) => {
		if (v === null) return null
		return ((v - minVal) / rangeVal) * 100
	})
}

/** Clamp configurable trend weight to 0..1, defaulting to 10%. */
function resolveTrendWeight(options?: ScoreOptions): number {
	const value = options?.trendWeight
	if (value == null || !Number.isFinite(value)) return DEFAULT_WEIGHT_TREND
	return Math.max(0, Math.min(1, value))
}

/**
 * Compute base component weights after reserving trend weight.
 * Base proportions remain 45/25/30 for relevance/recency/engagement.
 */
function weightedMix(trendWeight: number): {
	relevance: number
	recency: number
	engagement: number
} {
	const baseWeight = 1 - trendWeight
	return {
		relevance: WEIGHT_RELEVANCE * baseWeight,
		recency: WEIGHT_RECENCY * baseWeight,
		engagement: WEIGHT_ENGAGEMENT * baseWeight,
	}
}

/**
 * Compute web component weights after reserving trend weight.
 * Base proportions remain 55/45 for relevance/recency.
 */
function weightedWebMix(trendWeight: number): {
	relevance: number
	recency: number
} {
	const baseWeight = 1 - trendWeight
	return {
		relevance: WEBSEARCH_WEIGHT_RELEVANCE * baseWeight,
		recency: WEBSEARCH_WEIGHT_RECENCY * baseWeight,
	}
}

/** Compute scores for Reddit items. */
export function scoreRedditItems(
	items: RedditItem[],
	maxDays = 30,
	trendScores?: Map<string, TrendScore>,
	options?: ScoreOptions,
): RedditItem[] {
	if (items.length === 0) return items

	const trendWeight = resolveTrendWeight(options)
	const mix = weightedMix(trendWeight)
	const engRaw = items.map((item) =>
		computeRedditEngagementRaw(item.engagement),
	)
	const engNormalized = normalizeTo100(engRaw)

	for (let i = 0; i < items.length; i++) {
		const item = items[i]!
		const relScore = Number.isFinite(item.relevance)
			? Math.floor(item.relevance * 100)
			: 50
		const recScore = recencyScore(item.date, maxDays)
		const engScore =
			engNormalized[i] != null
				? Math.floor(engNormalized[i]!)
				: DEFAULT_ENGAGEMENT

		const ts = trendScores?.get(item.id)

		let overall: number
		if (ts) {
			const trendComponent = Math.floor(ts.trendScore * 100)
			item.subs = {
				relevance: relScore,
				recency: recScore,
				engagement: engScore,
				trend_score: trendComponent,
			}
			item.momentum = ts.momentum
			item.trend_score = trendComponent
			overall =
				mix.relevance * relScore +
				mix.recency * recScore +
				mix.engagement * engScore +
				trendWeight * ts.trendScore * 100
		} else {
			item.subs = {
				relevance: relScore,
				recency: recScore,
				engagement: engScore,
			}
			item.momentum = undefined
			item.trend_score = undefined
			overall =
				WEIGHT_RELEVANCE * relScore +
				WEIGHT_RECENCY * recScore +
				WEIGHT_ENGAGEMENT * engScore
		}

		if (engRaw[i] === null) overall -= UNKNOWN_ENGAGEMENT_PENALTY
		if (item.date_confidence === 'low') overall -= 10
		else if (item.date_confidence === 'med') overall -= 5

		item.score = Math.max(0, Math.min(100, Math.floor(overall)))
	}

	return items
}

/** Compute scores for X items. */
export function scoreXItems(
	items: XItem[],
	maxDays = 30,
	trendScores?: Map<string, TrendScore>,
	options?: ScoreOptions,
): XItem[] {
	if (items.length === 0) return items

	const trendWeight = resolveTrendWeight(options)
	const mix = weightedMix(trendWeight)
	const engRaw = items.map((item) => computeXEngagementRaw(item.engagement))
	const engNormalized = normalizeTo100(engRaw)

	for (let i = 0; i < items.length; i++) {
		const item = items[i]!
		const relScore = Number.isFinite(item.relevance)
			? Math.floor(item.relevance * 100)
			: 50
		const recScore = recencyScore(item.date, maxDays)
		const engScore =
			engNormalized[i] != null
				? Math.floor(engNormalized[i]!)
				: DEFAULT_ENGAGEMENT

		const ts = trendScores?.get(item.id)

		let overall: number
		if (ts) {
			const trendComponent = Math.floor(ts.trendScore * 100)
			item.subs = {
				relevance: relScore,
				recency: recScore,
				engagement: engScore,
				trend_score: trendComponent,
			}
			item.momentum = ts.momentum
			item.trend_score = trendComponent
			overall =
				mix.relevance * relScore +
				mix.recency * recScore +
				mix.engagement * engScore +
				trendWeight * ts.trendScore * 100
		} else {
			item.subs = {
				relevance: relScore,
				recency: recScore,
				engagement: engScore,
			}
			item.momentum = undefined
			item.trend_score = undefined
			overall =
				WEIGHT_RELEVANCE * relScore +
				WEIGHT_RECENCY * recScore +
				WEIGHT_ENGAGEMENT * engScore
		}

		if (engRaw[i] === null) overall -= UNKNOWN_ENGAGEMENT_PENALTY
		if (item.date_confidence === 'low') overall -= 10
		else if (item.date_confidence === 'med') overall -= 5

		item.score = Math.max(0, Math.min(100, Math.floor(overall)))
	}

	return items
}

/** Compute scores for WebSearch items WITHOUT engagement metrics. */
export function scoreWebsearchItems(
	items: WebSearchItem[],
	maxDays = 30,
	trendScores?: Map<string, TrendScore>,
	options?: ScoreOptions,
): WebSearchItem[] {
	if (items.length === 0) return items

	const trendWeight = resolveTrendWeight(options)
	const mix = weightedWebMix(trendWeight)
	for (const item of items) {
		const relScore = Number.isFinite(item.relevance)
			? Math.floor(item.relevance * 100)
			: 50
		const recScore = recencyScore(item.date, maxDays)

		const ts = trendScores?.get(item.id)

		let overall: number
		if (ts) {
			const trendComponent = Math.floor(ts.trendScore * 100)
			item.subs = {
				relevance: relScore,
				recency: recScore,
				engagement: 0,
				trend_score: trendComponent,
			}
			item.momentum = ts.momentum
			item.trend_score = trendComponent
			overall =
				mix.relevance * relScore +
				mix.recency * recScore +
				trendWeight * ts.trendScore * 100
		} else {
			item.subs = { relevance: relScore, recency: recScore, engagement: 0 }
			item.momentum = undefined
			item.trend_score = undefined
			overall =
				WEBSEARCH_WEIGHT_RELEVANCE * relScore +
				WEBSEARCH_WEIGHT_RECENCY * recScore
		}

		overall -= WEBSEARCH_SOURCE_PENALTY

		if (item.date_confidence === 'high') overall += WEBSEARCH_VERIFIED_BONUS
		else if (item.date_confidence === 'low')
			overall -= WEBSEARCH_NO_DATE_PENALTY

		item.score = Math.max(0, Math.min(100, Math.floor(overall)))
	}

	return items
}

/** Compute raw engagement score for YouTube item. */
function computeYouTubeEngagementRaw(item: YouTubeItem): number {
	return (
		0.65 * Math.log1p(item.views) +
		0.3 * Math.log1p(item.likes) +
		0.05 * Math.log1p(item.comments)
	)
}

/** Compute scores for YouTube items. */
export function scoreYouTubeItems(
	items: YouTubeItem[],
	maxDays = 30,
	trendScores?: Map<string, TrendScore>,
	options?: ScoreOptions,
): YouTubeItem[] {
	if (items.length === 0) return items

	const trendWeight = resolveTrendWeight(options)
	const mix = weightedMix(trendWeight)
	const engRaw = items.map((item) => computeYouTubeEngagementRaw(item))
	const engNormalized = normalizeTo100(engRaw)

	for (let i = 0; i < items.length; i++) {
		const item = items[i]!
		const relScore = Number.isFinite(item.relevance)
			? Math.floor(item.relevance * 100)
			: 50
		const recScore = recencyScore(item.date, maxDays)
		const engScore =
			engNormalized[i] != null
				? Math.floor(engNormalized[i]!)
				: DEFAULT_ENGAGEMENT

		const ts = trendScores?.get(item.id)

		let overall: number
		if (ts) {
			const trendComponent = Math.floor(ts.trendScore * 100)
			item.subs = {
				relevance: relScore,
				recency: recScore,
				engagement: engScore,
				trend_score: trendComponent,
			}
			item.momentum = ts.momentum
			item.trend_score = trendComponent
			overall =
				mix.relevance * relScore +
				mix.recency * recScore +
				mix.engagement * engScore +
				trendWeight * ts.trendScore * 100
		} else {
			item.subs = {
				relevance: relScore,
				recency: recScore,
				engagement: engScore,
			}
			item.momentum = undefined
			item.trend_score = undefined
			overall =
				WEIGHT_RELEVANCE * relScore +
				WEIGHT_RECENCY * recScore +
				WEIGHT_ENGAGEMENT * engScore
		}

		if (item.date_confidence === 'low') overall -= 10
		else if (item.date_confidence === 'med') overall -= 5

		item.score = Math.max(0, Math.min(100, Math.floor(overall)))
	}

	return items
}

/** Sort items by score (descending), then date, then source priority. */
export function sortItems<T extends SortableItem>(items: T[]): T[] {
	return [...items].sort((a, b) => {
		// Primary: score descending
		if (a.score !== b.score) return b.score - a.score

		// Secondary: date descending (recent first)
		const dateA = a.date ?? '0000-00-00'
		const dateB = b.date ?? '0000-00-00'
		if (dateA !== dateB) return dateB.localeCompare(dateA)

		// Tertiary: source priority (Reddit > X > WebSearch/YouTube)
		const priorityA = getSourcePriority(a)
		const priorityB = getSourcePriority(b)
		if (priorityA !== priorityB) return priorityA - priorityB

		// Quaternary: text for stability
		const textA = 'title' in a ? (a.title ?? '') : 'text' in a ? a.text : ''
		const textB = 'title' in b ? (b.title ?? '') : 'text' in b ? b.text : ''
		return textA.localeCompare(textB)
	})
}

function getSourcePriority(item: SortableItem): number {
	if ('subreddit' in item) return 0 // Reddit
	if ('author_handle' in item) return 1 // X
	return 2 // WebSearch or YouTube
}
