/** KPI calculation functions for the eval harness. */

/** Minimum fields needed to evaluate a search result item. */
export interface EvalItem {
	date: string | null
	score: number
	url: string
	title?: string
	snippet?: string
	content?: string
	engagement?: {
		score?: number | null
		likes?: number | null
		views?: number | null
	} | null
}

/** A cluster of results grouped by topic/entity. */
export interface EvalCluster {
	sourceTypes: string[] // e.g., ['reddit', 'x', 'web']
}

/**
 * Compute the median of a sorted numeric array.
 * Returns 0 for empty arrays.
 */
function median(sorted: number[]): number {
	if (sorted.length === 0) return 0
	const mid = Math.floor(sorted.length / 2)
	if (sorted.length % 2 === 1) return sorted[mid]!
	return (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * Build normalized match variants for a single oracle entity so
 * handles/hashtags and multi-word terms can match URL-style text.
 */
function toEntityVariants(entity: string): string[] {
	const normalized = entity
		.toLowerCase()
		.trim()
		.replace(/^[@#]+/, '')
		.replace(/\s+/g, ' ')

	if (!normalized) return []
	return [
		normalized,
		normalized.replace(/\s+/g, '-'),
		normalized.replace(/\s+/g, '_'),
		encodeURIComponent(normalized),
	]
}

/**
 * Median age (in hours) of the top K results. Lower is better.
 * Items are sorted by score descending and the top K are taken.
 * Items with null date are treated as maxDays * 24 hours old (default 30 days).
 */
export function freshnessAtK(
	items: EvalItem[],
	k: number,
	maxDays = 30,
): number {
	if (items.length === 0 || k <= 0) return 0
	const sorted = [...items].sort((a, b) => b.score - a.score)
	const topK = sorted.slice(0, k)
	const now = Date.now()
	const maxHours = maxDays * 24
	const ages = topK.map((item) => {
		if (!item.date) return maxHours
		const parsed = new Date(item.date)
		if (Number.isNaN(parsed.getTime())) return maxHours
		const hours = (now - parsed.getTime()) / (1000 * 60 * 60)
		return Math.max(0, hours)
	})
	ages.sort((a, b) => a - b)
	return median(ages)
}

/**
 * Fraction of oracle entities found in top K item text.
 * Uses a normalized corpus across url/title/snippet/content and
 * variants that handle @/# sigils and multi-word URL forms.
 * Returns 0-1.
 */
export function trendRecallAtK(
	items: EvalItem[],
	oracle: string[],
	k: number,
): number {
	if (oracle.length === 0) return 1
	if (items.length === 0 || k <= 0) return 0
	const sorted = [...items].sort((a, b) => b.score - a.score)
	const topK = sorted.slice(0, k)
	const corpus = topK
		.flatMap((item) => [
			item.url,
			item.title ?? '',
			item.snippet ?? '',
			item.content ?? '',
		])
		.map((v) => v.toLowerCase())
		.join(' ')
	const found = oracle.filter((entity) => {
		const variants = toEntityVariants(entity)
		return variants.some((variant) => corpus.includes(variant))
	})
	return found.length / oracle.length
}

/**
 * Fraction of top K items with positive momentum (> 0).
 * Items without a momentum field are treated as 0 (not positive).
 * Returns 0-1.
 */
export function momentumPrecisionAtK(
	items: Array<EvalItem & { momentum?: number }>,
	k: number,
): number {
	if (items.length === 0 || k <= 0) return 0
	const sorted = [...items].sort((a, b) => b.score - a.score)
	const topK = sorted.slice(0, k)
	const positive = topK.filter(
		(i) => typeof i.momentum === 'number' && i.momentum > 0,
	)
	return positive.length / topK.length
}

/**
 * Fraction of clusters with >= minSources distinct source types.
 * Returns 0-1.
 */
export function crossSourceConfirmation(
	clusters: EvalCluster[],
	minSources: number,
): number {
	if (clusters.length === 0) return 0
	const qualifying = clusters.filter(
		(c) => new Set(c.sourceTypes).size >= minSources,
	)
	return qualifying.length / clusters.length
}

/**
 * Fraction of items with a valid-looking URL (starts with http:// or https://).
 * Returns 0-1.
 */
export function citationValidity(items: EvalItem[]): number {
	if (items.length === 0) return 0
	const valid = items.filter((i) => i.url && /^https?:\/\/.+/.test(i.url))
	return valid.length / items.length
}

/**
 * Fraction of successful runs. Returns 0-1.
 */
export function runReliability(runs: Array<{ success: boolean }>): number {
	if (runs.length === 0) return 0
	return runs.filter((r) => r.success).length / runs.length
}

/**
 * p95 of durations in seconds.
 * Sort ascending, take 95th percentile. Empty array returns 0.
 */
export function performanceP95(durations: number[]): number {
	if (durations.length === 0) return 0
	const sorted = [...durations].sort((a, b) => a - b)
	const index = Math.ceil(sorted.length * 0.95) - 1
	return sorted[Math.max(0, index)]!
}

/**
 * Median of costs array. Empty array returns 0.
 */
export function medianRunCost(costs: number[]): number {
	if (costs.length === 0) return 0
	const sorted = [...costs].sort((a, b) => a - b)
	return median(sorted)
}

/**
 * Fraction of ratings marked "useful". Returns 0-1.
 */
export function watchlistDeltaUtility(
	ratings: Array<{ useful: boolean }>,
): number {
	if (ratings.length === 0) return 0
	return ratings.filter((r) => r.useful).length / ratings.length
}

/**
 * Returns true if the baseline-to-current score drop is within threshold.
 * Specifically: (baseline - current) <= threshold.
 */
export function regressionSafety(
	current: number,
	baseline: number,
	threshold: number,
): boolean {
	return baseline - current <= threshold
}
