/**
 * Entity extraction and ranking for research results.
 *
 * Extracts handles, subreddits, hashtags, and repeated terms from
 * Reddit, X, and web search items. Ranks by frequency weighted
 * by engagement.
 */

import type { RedditItem, WebSearchItem, XItem } from './schema.js'

/** Extracted entity with metadata. */
export interface ExtractedEntity {
	/** Normalized value (e.g., "@anthropicai", "r/localllama"). */
	value: string
	/** Entity type discriminant. */
	type: 'handle' | 'subreddit' | 'hashtag' | 'term'
	/** How many items mention this entity. */
	frequency: number
	/** Sum of engagement scores of mentioning items. */
	engagementWeight: number
}

/** Result of entity extraction from a set of items. */
export interface EntityResult {
	/** @handles from X items. */
	handles: ExtractedEntity[]
	/** r/subreddits from Reddit items. */
	subreddits: ExtractedEntity[]
	/** #hashtags from any source. */
	hashtags: ExtractedEntity[]
	/** Repeated noun phrases. */
	terms: ExtractedEntity[]
}

/** Handle regex: 1-15 alphanumeric or underscore chars. */
const HANDLE_RE = /@(\w{1,15})/g

/** Subreddit regex in text. */
const SUBREDDIT_RE = /r\/(\w+)/g

/** Hashtag regex: 2-30 word chars. */
const HASHTAG_RE = /#(\w{2,30})/g

/**
 * Common English stopwords to filter from extracted terms.
 * Kept as a Set for O(1) lookup.
 */
const TERM_STOPWORDS = new Set([
	'the',
	'a',
	'an',
	'is',
	'are',
	'was',
	'were',
	'have',
	'has',
	'had',
	'do',
	'does',
	'did',
	'will',
	'would',
	'could',
	'should',
	'may',
	'might',
	'can',
	'this',
	'that',
	'these',
	'those',
	'it',
	'its',
	'i',
	'you',
	'we',
	'they',
	'he',
	'she',
	'my',
	'your',
	'our',
	'their',
	'what',
	'which',
	'who',
	'how',
	'when',
	'where',
	'why',
	'not',
	'no',
	'yes',
	'all',
	'any',
	'some',
	'just',
	'more',
	'most',
	'very',
	'also',
	'too',
	'so',
	'than',
	'then',
	'now',
	'here',
	'there',
	'about',
	'up',
	'out',
	'in',
	'on',
	'at',
	'by',
	'for',
	'with',
	'from',
	'to',
	'of',
	'and',
	'or',
	'but',
	'if',
	'as',
	'be',
	'been',
	'being',
	'am',
	'are',
	'is',
	'was',
	'were',
	'do',
	'did',
	'done',
	'get',
	'got',
	'into',
	'over',
	'after',
	'before',
	'new',
	'like',
	'only',
	'even',
	'still',
	'much',
	'many',
	'such',
	'well',
	'way',
	'use',
	'using',
	'used',
	'one',
	'two',
])

/** Handle stopwords -- known bot accounts. */
const HANDLE_STOPWORDS = new Set(['bot', 'automod'])

/**
 * Extract all regex matches from a string.
 * Returns lowercased capture group 1 values.
 */
function matchAll(text: string, re: RegExp): string[] {
	const results: string[] = []
	for (const m of text.matchAll(re)) {
		if (m[1]) results.push(m[1].toLowerCase())
	}
	return results
}

/**
 * Accumulate an entity into a map, merging frequency and engagement.
 */
function accumulate(
	map: Map<string, ExtractedEntity>,
	key: string,
	type: ExtractedEntity['type'],
	prefix: string,
	engagement: number,
): void {
	const existing = map.get(key)
	if (existing) {
		existing.frequency += 1
		existing.engagementWeight += engagement
	} else {
		map.set(key, {
			value: `${prefix}${key}`,
			type,
			frequency: 1,
			engagementWeight: engagement,
		})
	}
}

/**
 * Extract @handles from X items.
 *
 * Pulls handles from `text` and `author_handle` fields.
 * Deduplicates case-insensitively, accumulates frequency and
 * engagement weight (sum of likes).
 */
export function extractHandles(items: XItem[]): ExtractedEntity[] {
	const map = new Map<string, ExtractedEntity>()

	for (const item of items) {
		const likes = item.engagement?.likes ?? 0
		const seen = new Set<string>()

		// Extract from text
		for (const h of matchAll(item.text, HANDLE_RE)) {
			seen.add(h)
		}

		// Extract from author_handle
		const author = item.author_handle.replace(/^@/, '').toLowerCase()
		if (author) seen.add(author)

		// Accumulate once per item per handle
		for (const h of seen) {
			accumulate(map, h, 'handle', '@', likes)
		}
	}

	return [...map.values()]
}

/**
 * Extract subreddits from Reddit items.
 *
 * Pulls from the `subreddit` field (always present) and r/ mentions
 * in the title. Deduplicates case-insensitively, accumulates frequency
 * and engagement weight (sum of Reddit score).
 */
export function extractSubreddits(items: RedditItem[]): ExtractedEntity[] {
	const map = new Map<string, ExtractedEntity>()

	for (const item of items) {
		const score = item.engagement?.score ?? 0
		const seen = new Set<string>()

		// Include subreddit field only when non-empty after normalization.
		const subreddit = item.subreddit.trim().toLowerCase()
		if (subreddit) seen.add(subreddit)

		// Extract r/ mentions from title
		for (const s of matchAll(item.title, SUBREDDIT_RE)) {
			seen.add(s)
		}

		for (const s of seen) {
			accumulate(map, s, 'subreddit', 'r/', score)
		}
	}

	return [...map.values()]
}

/**
 * Get text content from any item type for text-based extraction.
 */
function getItemText(item: RedditItem | XItem | WebSearchItem): string {
	if ('subreddit' in item) return item.title
	if ('author_handle' in item) return item.text
	return `${item.title} ${item.snippet}`
}

/**
 * Get engagement value from any item type.
 * Reddit uses score, X uses likes, web has no engagement.
 */
function getItemEngagement(item: RedditItem | XItem | WebSearchItem): number {
	if ('subreddit' in item) return item.engagement?.score ?? 0
	if ('author_handle' in item) return item.engagement?.likes ?? 0
	return 0
}

/**
 * Extract #hashtags from mixed item types.
 *
 * Searches title, text, or snippet fields depending on item type.
 * Deduplicates case-insensitively, accumulates frequency and
 * engagement weight.
 */
export function extractHashtags(
	items: (RedditItem | XItem | WebSearchItem)[],
): ExtractedEntity[] {
	const map = new Map<string, ExtractedEntity>()

	for (const item of items) {
		const engagement = getItemEngagement(item)
		const text = getItemText(item)
		const seen = new Set<string>()

		for (const h of matchAll(text, HASHTAG_RE)) {
			seen.add(h)
		}

		for (const h of seen) {
			accumulate(map, h, 'hashtag', '#', engagement)
		}
	}

	return [...map.values()]
}

/**
 * Extract repeated terms from mixed item types.
 *
 * Tokenizes text, removes stopwords, and returns terms that appear
 * in at least `minCount` items. No engagement weighting for terms.
 *
 * @param items - Mixed array of research items
 * @param minCount - Minimum number of items a term must appear in (default: 3)
 */
export function extractRepeatedTerms(
	items: (RedditItem | XItem | WebSearchItem)[],
	minCount = 3,
): ExtractedEntity[] {
	const termCounts = new Map<string, number>()

	for (const item of items) {
		const text = getItemText(item)
		const tokens = text
			.toLowerCase()
			.split(/\s+/)
			.filter((t) => t.length > 0)
		const unique = new Set(tokens)

		for (const token of unique) {
			if (TERM_STOPWORDS.has(token)) continue
			termCounts.set(token, (termCounts.get(token) ?? 0) + 1)
		}
	}

	const results: ExtractedEntity[] = []
	for (const [term, count] of termCounts) {
		if (count >= minCount) {
			results.push({
				value: term,
				type: 'term',
				frequency: count,
				engagementWeight: 0,
			})
		}
	}

	return results
}

/**
 * Rank entities by frequency weighted by engagement.
 *
 * Sort formula: `frequency * (1 + Math.log1p(engagementWeight))`
 * Uses stable sort to preserve original order for ties.
 */
export function rankEntities(entities: ExtractedEntity[]): ExtractedEntity[] {
	const score = (e: ExtractedEntity): number => {
		const engagement =
			Number.isFinite(e.engagementWeight) && e.engagementWeight > 0
				? e.engagementWeight
				: 0
		return e.frequency * (1 + Math.log1p(engagement))
	}

	return [...entities].sort((a, b) => score(b) - score(a))
}

/**
 * Filter out common non-informative entities.
 *
 * - Handles: removes known bot accounts (@bot, @automod)
 * - Terms: removes common English stopwords
 * - Hashtags: no filtering (hashtags are usually intentional)
 * - Subreddits: no filtering
 */
export function filterStopwords(
	entities: ExtractedEntity[],
): ExtractedEntity[] {
	return entities.filter((e) => {
		if (e.type === 'handle') {
			const raw = e.value.replace(/^@/, '').toLowerCase()
			return !HANDLE_STOPWORDS.has(raw)
		}
		if (e.type === 'term') {
			return !TERM_STOPWORDS.has(e.value.toLowerCase())
		}
		return true
	})
}

/**
 * Main entry point: extract all entity types from mixed items.
 *
 * Separates items by type using field discriminants, runs all
 * extraction functions, filters stopwords, ranks each list,
 * and returns the combined EntityResult.
 *
 * @param items - Mixed array of Reddit, X, and web search items
 */
export function extractEntities(
	items: (RedditItem | XItem | WebSearchItem)[],
): EntityResult {
	const redditItems: RedditItem[] = []
	const xItems: XItem[] = []

	for (const item of items) {
		if ('subreddit' in item) {
			redditItems.push(item as RedditItem)
		} else if ('author_handle' in item) {
			xItems.push(item as XItem)
		}
	}

	return {
		handles: rankEntities(filterStopwords(extractHandles(xItems))),
		subreddits: rankEntities(filterStopwords(extractSubreddits(redditItems))),
		hashtags: rankEntities(filterStopwords(extractHashtags(items))),
		terms: rankEntities(filterStopwords(extractRepeatedTerms(items))),
	}
}
