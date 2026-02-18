/**
 * @side-quest/last-30-days
 *
 * Research any topic from the last 30 days across Reddit, X, and web.
 * Engagement-ranked results with scoring and deduplication.
 */

// Cache
export {
	acquireCacheLock,
	clearCachedModel,
	getCacheKey,
	getEnrichmentCacheKey,
	getEnrichmentTTL,
	getPhase2CacheKey,
	getSearchTTL,
	getSourceCacheKey,
	getStaleSearchTTL,
	loadCache,
	loadCacheWithAge,
	loadStaleCacheWithAge,
	releaseCacheLock,
	SEARCH_CACHE_SCHEMA_VERSION,
	saveCache,
} from './lib/cache.js'
// Config
export { getAvailableSources, getConfig, getMissingKeys } from './lib/config.js'
// Date utilities
export {
	daysAgo,
	getDateConfidence,
	getDateRange,
	parseDate,
	recencyScore,
	timestampToDate,
} from './lib/dates.js'
// Deduplication
export {
	dedupeItems,
	dedupeReddit,
	dedupeWebsearch,
	dedupeX,
	dedupeYouTube,
	getNgrams,
	jaccardSimilarity,
	normalizeText,
} from './lib/dedupe.js'
// Entity extraction
export type { EntityResult, ExtractedEntity } from './lib/entity-extract.js'
export {
	extractEntities,
	extractHandles,
	extractHashtags,
	extractRepeatedTerms,
	extractSubreddits,
	filterStopwords,
	rankEntities,
} from './lib/entity-extract.js'
export type { EvalCluster, EvalItem } from './lib/eval-metrics.js'
// Eval metrics
export {
	citationValidity,
	crossSourceConfirmation,
	freshnessAtK,
	medianRunCost,
	momentumPrecisionAtK,
	performanceP95,
	regressionSafety,
	runReliability,
	trendRecallAtK,
	watchlistDeltaUtility,
} from './lib/eval-metrics.js'
// HTTP / retry
export {
	backoffDelay,
	HTTPError,
	isRetryableRateLimit,
	parseRateLimitResetMs,
	parseRetryAfterMs,
	RateLimitError,
} from './lib/http.js'
// Intent classification
export type {
	IntentPolicy,
	IntentWeights,
	QueryType as IntentQueryType,
} from './lib/intent.js'
export { classifyIntent, getIntentPolicy } from './lib/intent.js'
// Models
export { invalidateCachedModel } from './lib/models.js'
// Normalization
export {
	filterByDateRange,
	normalizeRedditItems,
	normalizeXItems,
	normalizeYouTubeItems,
} from './lib/normalize.js'
// OpenAI Reddit
export {
	isModelAccessError,
	parseRedditResponse,
	supportsWebSearchFilters,
} from './lib/openai-reddit.js'
// Rendering
export {
	getContextPath,
	renderCompact,
	renderContextSnippet,
	renderFullReport,
	writeOutputs,
} from './lib/render.js'
export { orchestrate } from './lib/retrieval/orchestrator.js'
export type { QueryBudget } from './lib/retrieval/query-policy.js'
export {
	applyIntentPolicy,
	getQueryBudget,
} from './lib/retrieval/query-policy.js'
// Retrieval contracts
export type {
	AdapterSearchConfig,
	MergePolicy,
	OrchestratorConfig,
	PhaseResult,
	SearchAdapter,
	SearchItem,
	SourceType,
} from './lib/retrieval/types.js'
export {
	defaultMergePolicy,
	defaultOrchestratorConfig,
} from './lib/retrieval/types.js'
// Schema types
export type {
	Comment,
	Engagement,
	RedditItem,
	Report,
	SubScores,
	WebSearchItem,
	XItem,
	YouTubeItem,
} from './lib/schema.js'
// Schema factories
export {
	createReport,
	defaultYouTubeItem,
} from './lib/schema.js'
// Scoring
export {
	scoreRedditItems,
	scoreWebsearchItems,
	scoreXItems,
	scoreYouTubeItems,
	sortItems,
} from './lib/score.js'
// Store
export { closeDb, getDb, getDbPath, initDb } from './lib/store.js'
// Telemetry contract types
export type {
	ConfidenceFactorsV1,
	ConfidenceLabel,
	ConfidenceReasonCode,
	ConfidenceV1,
	CostByProviderV1,
	CostSummaryV1,
	CountBySourceV1,
	DataQualityGrade,
	DataQualityRatiosV1,
	DataQualityV1,
	DateRangeV1,
	LatencySummaryV1,
	Phase2SkipReason,
	Phase2SummaryV1,
	QueryType,
	RetrievalDepth,
	RetrievalStrategy,
	RunCompletedDataV1,
	RunCompletedEnvelopeV1,
	SourceSkipDetailV1,
	SourceSkipReasonCode,
	TelemetryEnvelopeV1,
	TelemetrySource,
	TopTrendV1,
	TrendCategory,
} from './lib/telemetry-contract.js'
// Trend scoring
export type { TrendScore } from './lib/trend.js'
export {
	computeTrendScores,
	momentumScore,
	sourceDiversityBonus,
	trendScore,
} from './lib/trend.js'
// Watchlist
export type {
	RunHistoryEntry,
	RunResult,
	WatchlistTopic,
} from './lib/watchlist.js'
export {
	addTopic,
	getHistory,
	listTopics,
	recordRun,
	removeTopic,
} from './lib/watchlist.js'
// WebSearch
export {
	extractDateFromSnippet,
	extractDateFromUrl,
	extractDateSignals,
	extractDomain,
	isExcludedDomain,
	normalizeWebsearchItems,
	parseWebsearchResults,
} from './lib/websearch.js'
// xAI X
export { parseXResponse } from './lib/xai-x.js'
// YouTube
export {
	isYtDlpAvailable,
	parseYouTubeResults,
	youtubeEngagementScore,
} from './lib/youtube.js'
