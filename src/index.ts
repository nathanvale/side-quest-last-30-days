/**
 * @side-quest/word-on-the-street
 *
 * Research any topic across Reddit, X, and web.
 * Engagement-ranked results with scoring and deduplication.
 */

export { isYtDlpAvailable, searchYouTube } from './adapters/youtube.js'
// Briefing
export type { Briefing, BriefingPeriod } from './lib/briefing.js'
export { generateBriefing, renderBriefingMarkdown } from './lib/briefing.js'
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
// CLI Error
export type { CliErrorCode, CliErrorOptions } from './lib/cli-error.js'
export { CliError, errorToEnvelope } from './lib/cli-error.js'
// Config
export {
	getAvailableSources,
	getConfig,
	getMissingKeys,
	validateSources,
} from './lib/config.js'
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
// Delta detection
export type { DeltaEntry, DeltaReport } from './lib/delta.js'
export {
	computeDelta,
	detectFallingVoices,
	detectGoneEntities,
	detectNewEntities,
	detectRisingVoices,
	flattenEntities,
} from './lib/delta.js'
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
// Exit Codes
export type { ExitCode } from './lib/exit-codes.js'
export {
	EXIT_CONFLICT,
	EXIT_INTERRUPTED,
	EXIT_NOT_FOUND,
	EXIT_OK,
	EXIT_RUNTIME,
	EXIT_UNAUTHORIZED,
	EXIT_USAGE,
} from './lib/exit-codes.js'
// Field Projection
export {
	parseFieldSpec,
	projectFields,
	projectReport,
} from './lib/field-projection.js'
// Help
export type { HelpTopic } from './lib/help.js'
export { HELP_TOPICS, isValidHelpTopic, renderHelp } from './lib/help.js'
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
export { getModels, invalidateCachedModel } from './lib/models.js'
// Normalization
export {
	filterByDateRange,
	normalizeRedditItems,
	normalizeXItems,
	normalizeYouTubeItems,
} from './lib/normalize.js'
// OpenAI Reddit
export {
	extractCoreSubject,
	isModelAccessError,
	parseRedditResponse,
	REDDIT_PROMPT_VERSION,
	searchReddit,
	supportsWebSearchFilters,
} from './lib/openai-reddit.js'
// Output
export type {
	DataEnvelope,
	ErrorEnvelope,
	OutputContext,
} from './lib/output.js'
export {
	reportToJsonl,
	resolveErrorContext,
	resolveOutputArgs,
	wrapData,
	wrapReport,
	writeError,
} from './lib/output.js'
// Parse args
export type {
	BriefingCommand,
	GlobalFlags,
	HelpCommand,
	ParseCliError,
	ParseCliOk,
	ParseCliResult,
	ParsedCommand,
	SearchCommand,
	VersionCommand,
	WatchCommand,
} from './lib/parse-args.js'
export { parseCliArgs } from './lib/parse-args.js'
// Reddit enrichment
export { enrichRedditItem } from './lib/reddit-enrich.js'
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
	reportToDict,
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
// UI
export { ProgressDisplay } from './lib/ui.js'
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
export { parseXResponse, searchX, X_PROMPT_VERSION } from './lib/xai-x.js'
// YouTube
export { parseYouTubeResults, youtubeEngagementScore } from './lib/youtube.js'
