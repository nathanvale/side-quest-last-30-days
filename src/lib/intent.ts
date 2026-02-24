/** Rule-based intent classification and query policy for wots CLI. */

/**
 * Query type classification for search intent.
 *
 * Used to adapt search behavior (weights, budgets) based on what the user
 * is looking for. Lowercase values mirror the CLI --query-type flag options.
 */
export type QueryType = 'prompting' | 'recommendations' | 'news' | 'general'

/** Weight overrides for intent-aware scoring. Must sum to 1.0. */
export interface IntentWeights {
	relevance: number
	recency: number
	engagement: number
}

/** Intent-based query policy overrides applied before search. */
export interface IntentPolicy {
	queryType: QueryType
	weights: IntentWeights
	/** Multiplier for maxResults (e.g., 1.5 means 50% more results). */
	resultMultiplier: number
	/** Dedup threshold override (lower = more permissive). null = use default. */
	dedupeThreshold: number | null
}

// ---------------------------------------------------------------------------
// Keyword pattern lists per intent
// ---------------------------------------------------------------------------

// Word-boundary aware matcher: ensures the keyword is not embedded inside
// a larger word (e.g., "news" must not match inside "newsroom").
function matchesWordBoundary(text: string, keyword: string): boolean {
	// Build regex: optional non-word char before, optional non-word char after
	const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const re = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'i')
	return re.test(text)
}

// Keywords that trigger each intent category (checked with word-boundary awareness)
const NEWS_KEYWORDS = [
	'news',
	'latest',
	"what's happening",
	'update',
	'announced',
	'released',
	'launch',
]

const RECOMMENDATIONS_KEYWORDS = [
	'best',
	'top',
	'recommended',
	'what should i use',
	'alternative',
	'vs',
]

const PROMPTING_KEYWORDS = [
	'prompt',
	'prompting',
	'best practices',
	'techniques',
	'tips for',
	'how to',
]

/**
 * Classify a topic string into a QueryType using rule-based keyword matching.
 *
 * Priority order (highest to lowest specificity):
 *   NEWS > RECOMMENDATIONS > PROMPTING > GENERAL
 *
 * Word-boundary awareness prevents partial matches (e.g., "newsroom" does not
 * trigger 'news').
 */
export function classifyIntent(topic: string): QueryType {
	const lower = topic.toLowerCase()

	const isNews = NEWS_KEYWORDS.some((kw) => matchesWordBoundary(lower, kw))
	if (isNews) return 'news'

	const isRecommendations = RECOMMENDATIONS_KEYWORDS.some((kw) =>
		matchesWordBoundary(lower, kw),
	)
	if (isRecommendations) return 'recommendations'

	const isPrompting = PROMPTING_KEYWORDS.some((kw) =>
		matchesWordBoundary(lower, kw),
	)
	if (isPrompting) return 'prompting'

	return 'general'
}

// ---------------------------------------------------------------------------
// Policy table
// ---------------------------------------------------------------------------

const POLICIES: Record<QueryType, IntentPolicy> = {
	news: {
		queryType: 'news',
		weights: { relevance: 0.35, recency: 0.4, engagement: 0.25 },
		resultMultiplier: 1.0,
		dedupeThreshold: null,
	},
	recommendations: {
		queryType: 'recommendations',
		weights: { relevance: 0.5, recency: 0.2, engagement: 0.3 },
		resultMultiplier: 1.5,
		dedupeThreshold: 0.6,
	},
	prompting: {
		queryType: 'prompting',
		weights: { relevance: 0.45, recency: 0.25, engagement: 0.3 },
		resultMultiplier: 1.0,
		dedupeThreshold: null,
	},
	general: {
		queryType: 'general',
		weights: { relevance: 0.45, recency: 0.25, engagement: 0.3 },
		resultMultiplier: 1.0,
		dedupeThreshold: null,
	},
}

/**
 * Get the query policy for a given QueryType.
 *
 * Returns budget/weight overrides that are applied before search and scoring.
 * All IntentWeights in each policy sum to 1.0.
 */
export function getIntentPolicy(queryType: QueryType): IntentPolicy {
	return POLICIES[queryType]
}
