/**
 * Retrieval contract types.
 *
 * Defines the adapter pattern that all search sources must implement.
 * The orchestrator depends only on these interfaces -- never on
 * source-specific internals like cache, rate-limit, or API details.
 */

import type { RedditItem, WebSearchItem, XItem } from '../schema.js'

/** Union of all searchable item types. */
export type SearchItem = RedditItem | XItem | WebSearchItem

/** Source type identifier. */
export type SourceType = 'reddit' | 'x' | 'web' | 'youtube'

/**
 * Common interface for source adapters.
 *
 * Each adapter wraps a single source (Reddit, X, YouTube, etc.)
 * and translates its raw output into a `PhaseResult`. All side
 * effects (cache, retry, rate-limit) live inside the adapter
 * implementation, not the orchestrator.
 */
export interface SearchAdapter {
	/** Source type identifier. */
	readonly sourceType: SourceType
	/** Execute a search and return results. */
	search(config: AdapterSearchConfig): Promise<PhaseResult>
	/**
	 * Optional: run a supplemental phase 2 query for a specific entity.
	 *
	 * Adapters that support phase 2 implement this method to search
	 * for a specific handle, subreddit, hashtag, or term extracted
	 * from phase 1 results. The orchestrator only calls this on
	 * adapters that define it.
	 */
	searchSupplemental?(
		config: AdapterSearchConfig,
		entity: string,
		entityType: 'handle' | 'subreddit' | 'hashtag' | 'term',
	): Promise<PhaseResult>
}

/** Configuration passed to adapter search. */
export interface AdapterSearchConfig {
	topic: string
	fromDate: string
	toDate: string
	days: number
	depth: 'quick' | 'default' | 'deep'
	mock: boolean
	cacheOpts: { skipRead: boolean; skipWrite: boolean }
}

/** Result from a single search phase. */
export interface PhaseResult {
	items: SearchItem[]
	source: SourceType
	phase: 1 | 2
	error: string | null
	fromCache: boolean
	cacheAgeHours: number | null
	durationMs: number
}

/** Orchestrator configuration. */
export interface OrchestratorConfig {
	/** Search strategy -- single (phase 1 only) or two-phase. */
	strategy: 'single' | 'two-phase'
	/** Max supplemental queries per source in phase 2. */
	phase2Budget: number
	/** Per-adapter timeout in milliseconds. */
	timeoutMs: number
}

/** How to merge results from multiple phases. */
export interface MergePolicy {
	/** Jaccard similarity threshold for dedup. */
	dedupeThreshold: number
	/** Maximum total items after merge. */
	maxItems: number
	/** Whether to prefer phase 1 items on dedup conflict. */
	preferPhase1: boolean
}

/** Default orchestrator config -- single-phase, backward-compatible. */
export function defaultOrchestratorConfig(): OrchestratorConfig {
	return {
		strategy: 'single',
		phase2Budget: 5,
		timeoutMs: 60_000,
	}
}

/** Default merge policy -- matches existing dedup behavior. */
export function defaultMergePolicy(): MergePolicy {
	return {
		dedupeThreshold: 0.7,
		maxItems: 100,
		preferPhase1: true,
	}
}
