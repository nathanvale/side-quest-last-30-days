/** Near-duplicate detection for last-30-days skill. */

import type { RedditItem, WebSearchItem, XItem, YouTubeItem } from './schema.js'

/**
 * Normalize text for comparison.
 * Lowercase, remove punctuation, collapse whitespace.
 */
export function normalizeText(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\w\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

/** Remove trailing slashes without regex backtracking risk. */
function trimTrailingSlashes(value: string): string {
	let end = value.length
	while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1
	return value.slice(0, end)
}

/**
 * Extract canonical YouTube video ID from common URL formats.
 * ID case is preserved because YouTube IDs are case-sensitive.
 */
function extractYouTubeVideoId(url: string): string | null {
	const trimmed = url.trim()
	if (!trimmed) return null

	try {
		const parsed = new URL(trimmed)
		const host = parsed.hostname.toLowerCase()
		const pathParts = parsed.pathname.split('/').filter(Boolean)

		if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
			return pathParts[0] ?? null
		}

		if (
			host === 'youtube.com' ||
			host === 'www.youtube.com' ||
			host.endsWith('.youtube.com')
		) {
			const watchId = parsed.searchParams.get('v')
			if (watchId) return watchId

			if (pathParts.length >= 2) {
				const [prefix, id] = pathParts
				if (
					(prefix === 'shorts' || prefix === 'embed' || prefix === 'live') &&
					id
				) {
					return id
				}
			}
		}
	} catch {
		// Ignore malformed URLs and fall back to non-ID keying.
	}

	return null
}

/** Build a stable dedupe key for YouTube items. */
function youtubeDedupeKey(item: YouTubeItem): string {
	const videoId = extractYouTubeVideoId(item.url) ?? item.id.trim()
	if (videoId) return `video:${videoId}`

	// Fallback: keep path/query case intact, but normalize host case.
	try {
		const parsed = new URL(item.url.trim())
		const host = parsed.hostname.toLowerCase()
		const path = trimTrailingSlashes(parsed.pathname)
		const query = parsed.search ? parsed.search : ''
		return `${host}${path}${query}`
	} catch {
		return trimTrailingSlashes(item.url.trim())
	}
}

/** Get character n-grams from text. */
export function getNgrams(text: string, n = 3): Set<string> {
	const normalized = normalizeText(text)
	if (normalized.length < n) return new Set([normalized])
	const ngrams = new Set<string>()
	for (let i = 0; i <= normalized.length - n; i++) {
		ngrams.add(normalized.slice(i, i + n))
	}
	return ngrams
}

/** Compute Jaccard similarity between two sets. */
export function jaccardSimilarity(
	set1: Set<string>,
	set2: Set<string>,
): number {
	if (set1.size === 0 || set2.size === 0) return 0.0
	let intersection = 0
	for (const item of set1) {
		if (set2.has(item)) intersection++
	}
	const union = set1.size + set2.size - intersection
	return union > 0 ? intersection / union : 0.0
}

/** Get comparable text from an item. */
function getItemText(item: RedditItem | XItem): string {
	return 'title' in item && typeof item.title === 'string'
		? item.title
		: (item as XItem).text
}

/** Find near-duplicate pairs in items. */
function findDuplicates(
	items: (RedditItem | XItem)[],
	threshold: number,
): [number, number][] {
	const duplicates: [number, number][] = []
	const ngrams = items.map((item) => getNgrams(getItemText(item)))

	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			const similarity = jaccardSimilarity(ngrams[i]!, ngrams[j]!)
			if (similarity >= threshold) {
				duplicates.push([i, j])
			}
		}
	}

	return duplicates
}

/**
 * Remove near-duplicates, keeping highest-scored item.
 * Items should be pre-sorted by score descending.
 */
export function dedupeItems<T extends RedditItem | XItem>(
	items: T[],
	threshold = 0.7,
): T[] {
	if (items.length <= 1) return items

	const dupPairs = findDuplicates(items, threshold)
	const toRemove = new Set<number>()

	for (const [i, j] of dupPairs) {
		if (items[i]!.score >= items[j]!.score) {
			toRemove.add(j)
		} else {
			toRemove.add(i)
		}
	}

	return items.filter((_, idx) => !toRemove.has(idx))
}

/** Dedupe Reddit items. */
export function dedupeReddit(
	items: RedditItem[],
	threshold = 0.7,
): RedditItem[] {
	return dedupeItems(items, threshold)
}

/** Dedupe X items. */
export function dedupeX(items: XItem[], threshold = 0.7): XItem[] {
	return dedupeItems(items, threshold)
}

/** Dedupe YouTube items by canonical video ID (titles are unreliable). */
export function dedupeYouTube(items: YouTubeItem[]): YouTubeItem[] {
	const seenUrls = new Set<string>()
	const result: YouTubeItem[] = []

	for (const item of items) {
		const urlKey = youtubeDedupeKey(item)
		if (!seenUrls.has(urlKey)) {
			seenUrls.add(urlKey)
			result.push(item)
		}
	}

	return result
}

/** Remove duplicate WebSearch items by URL. */
export function dedupeWebsearch(items: WebSearchItem[]): WebSearchItem[] {
	const seenUrls = new Set<string>()
	const result: WebSearchItem[] = []

	for (const item of items) {
		const urlKey = trimTrailingSlashes(item.url.toLowerCase())
		if (!seenUrls.has(urlKey)) {
			seenUrls.add(urlKey)
			result.push(item)
		}
	}

	return result
}
