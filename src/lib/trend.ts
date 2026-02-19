/**
 * Trend-aware scoring -- momentum and source-diversity factors.
 *
 * Momentum measures how "hot" an item is based on recency and
 * engagement velocity. Source diversity rewards topics confirmed
 * across multiple source types.
 */

import type { RedditItem, WebSearchItem, XItem, YouTubeItem } from './schema.js'

type AnyItem = RedditItem | XItem | WebSearchItem | YouTubeItem

/** Trend score for a single item. */
export interface TrendScore {
	momentum: number // 0-1, how "hot" this item is
	diversityBonus: number // 0-1, bonus for cross-source confirmation
	trendScore: number // combined: momentum * 0.7 + diversityBonus * 0.3
}

type SourceType = 'reddit' | 'x' | 'youtube' | 'web'
const HIGH_ENGAGEMENT_THRESHOLD = 2.5

/** Detect which source type an item belongs to. */
function getSourceType(item: AnyItem): SourceType {
	if ('subreddit' in item) return 'reddit'
	if ('author_handle' in item) return 'x'
	if ('channel' in item) return 'youtube'
	return 'web'
}

/** Extract searchable text from an item. */
function getItemText(item: AnyItem): string {
	if ('subreddit' in item) return (item as RedditItem).title
	if ('author_handle' in item) return (item as XItem).text
	if ('channel' in item) return (item as YouTubeItem).title
	const web = item as WebSearchItem
	return `${web.title} ${web.snippet}`
}

/**
 * Extract significant words from text for cross-source matching.
 * Words must be longer than 4 characters and are lowercased.
 */
function tokenize(text: string): Set<string> {
	const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
	return new Set(words.filter((w) => w.length > 4))
}

/** Safe log1p that handles null and negative values. */
function log1pSafe(value: number | null | undefined): number {
	if (value == null || value < 0) return 0
	return Math.log1p(value)
}

/**
 * Compute cross-source comparable engagement signal.
 *
 * Mirrors each source's native engagement shape so momentum can
 * reason about "velocity proxy" without relying on the final
 * post-scoring `item.score` value.
 */
function engagementSignal(item: AnyItem): number {
	if ('subreddit' in item) {
		const e = item.engagement
		if (!e) return 0
		const ratio = e.upvote_ratio ?? 0.5
		return (
			0.55 * log1pSafe(e.score) +
			0.4 * log1pSafe(e.num_comments) +
			0.05 * Math.max(0, ratio) * 10
		)
	}

	if ('author_handle' in item) {
		const e = item.engagement
		if (!e) return 0
		return (
			0.55 * log1pSafe(e.likes) +
			0.25 * log1pSafe(e.reposts) +
			0.15 * log1pSafe(e.replies) +
			0.05 * log1pSafe(e.quotes)
		)
	}

	if ('channel' in item) {
		return (
			0.65 * log1pSafe(item.views) +
			0.3 * log1pSafe(item.likes) +
			0.05 * log1pSafe(item.comments)
		)
	}

	return 0
}

/**
 * Compute momentum score for a single item.
 *
 * Uses recency (date) and engagement (score) as a proxy for
 * engagement velocity. Returns 0-1.
 */
export function momentumScore(item: AnyItem): number {
	if (!item.date) return 0.2

	const now = Date.now()
	const itemDate = new Date(item.date).getTime()
	if (Number.isNaN(itemDate)) return 0.2

	const hoursAgo = (now - itemDate) / (1000 * 60 * 60)
	const within48h = hoursAgo <= 48
	const within7d = hoursAgo <= 7 * 24
	const highEngagement = engagementSignal(item) >= HIGH_ENGAGEMENT_THRESHOLD

	if (within48h && highEngagement) return 1.0
	if (within48h) return 0.7
	if (within7d && highEngagement) return 0.8
	if (within7d) return 0.5
	return 0.3
}

/**
 * Compute source diversity bonus for an item.
 *
 * Checks if the item's topic appears in items from other source types.
 * Uses significant-word overlap as a heuristic. Returns 0-1.
 */
export function sourceDiversityBonus(
	item: AnyItem,
	allItems: AnyItem[],
): number {
	if (allItems.length === 0) return 0.0

	const itemSource = getSourceType(item)
	const itemWords = tokenize(getItemText(item))
	if (itemWords.size === 0) return 0.0

	const matchingSources = new Set<SourceType>()

	for (const other of allItems) {
		const otherSource = getSourceType(other)
		if (otherSource === itemSource) continue
		if (matchingSources.has(otherSource)) continue

		const otherWords = tokenize(getItemText(other))
		// Check if at least 2 significant words overlap
		let overlap = 0
		for (const w of itemWords) {
			if (otherWords.has(w)) {
				overlap++
				if (overlap >= 2) break
			}
		}
		if (overlap >= 2) {
			matchingSources.add(otherSource)
		}
	}

	// Count confirmed source types (including the item's own source)
	const totalSources = matchingSources.size + 1
	if (totalSources >= 4) return 1.0
	if (totalSources >= 3) return 1.0
	if (totalSources >= 2) return 0.5
	return 0.0
}

/**
 * Compute the combined trend score for a single item.
 *
 * Formula: momentum * 0.7 + diversityBonus * 0.3
 */
export function trendScore(item: AnyItem, allItems: AnyItem[]): TrendScore {
	const momentum = momentumScore(item)
	const diversity = sourceDiversityBonus(item, allItems)
	return {
		momentum,
		diversityBonus: diversity,
		trendScore: momentum * 0.7 + diversity * 0.3,
	}
}

/**
 * Compute trend scores for all items, keyed by item.id for O(1) lookup.
 */
export function computeTrendScores(items: AnyItem[]): Map<string, TrendScore> {
	const result = new Map<string, TrendScore>()
	for (const item of items) {
		result.set(item.id, trendScore(item, items))
	}
	return result
}
