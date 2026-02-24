#!/usr/bin/env bun
/**
 * wots CLI - Research a topic across Reddit, X, and web.
 *
 * Usage:
 *   wots <topic> [options]
 *
 * Options:
 *   --mock           Use fixtures instead of real API calls
 *   --emit=MODE      Output mode: compact|json|md|context|path (default: compact)
 *   --sources=MODE   Source selection: auto|reddit|x|both (default: auto)
 *   --days=N         Lookback window in days (default: 30, range: 1-365)
 *   --quick          Faster research with fewer sources
 *   --deep           Comprehensive research with more sources
 *   --fast           Pin OpenAI model to gpt-4o for speed
 *   --cheap          Pin OpenAI model to gpt-4o-mini-search-preview for cost
 *   --debug          Enable verbose debug logging
 *   --include-web    Include general web search alongside Reddit/X
 *   --strategy=MODE  Search strategy: single|two-phase (default: single)
 *   --phase2-budget=N Max supplemental queries per source (default: 5)
 *   --include-youtube Include YouTube video search (requires yt-dlp)
 *   --refresh        Bypass cache reads and force fresh search
 *   --no-cache       Disable cache reads and writes
 *   --outdir=PATH    Write output files to PATH instead of default location
 *   --query-type=TYPE Query intent: auto|prompting|recommendations|news|general
 */

import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
	BriefingCommand,
	IntentQueryType as QueryType,
	RedditItem,
	SearchCommand,
	WatchCommand,
	XItem,
	YouTubeItem,
} from './index.js'
import {
	// cache
	acquireCacheLock,
	// watchlist
	addTopic,
	// cli-error
	CliError,
	// intent
	classifyIntent,
	// trend
	computeTrendScores,
	// schema
	createReport,
	// dedupe
	dedupeReddit,
	dedupeX,
	dedupeYouTube,
	// exit-codes
	EXIT_CONFLICT,
	EXIT_INTERRUPTED,
	EXIT_RUNTIME,
	EXIT_UNAUTHORIZED,
	EXIT_USAGE,
	// reddit-enrich
	enrichRedditItem,
	// openai-reddit
	extractCoreSubject,
	// normalize
	filterByDateRange,
	// briefing
	generateBriefing,
	// config
	getAvailableSources,
	getConfig,
	// render
	getContextPath,
	// dates
	getDateRange,
	getEnrichmentCacheKey,
	getEnrichmentTTL,
	getHistory,
	getIntentPolicy,
	getMissingKeys,
	// models
	getModels,
	getSearchTTL,
	getSourceCacheKey,
	// help
	isValidHelpTopic,
	// youtube
	isYtDlpAvailable,
	listTopics,
	loadCacheWithAge,
	loadStaleCacheWithAge,
	normalizeRedditItems,
	normalizeXItems,
	normalizeYouTubeItems,
	// ui
	ProgressDisplay,
	// parse-args
	parseCliArgs,
	parseRedditResponse,
	// websearch (none currently used directly)
	// xai-x
	parseXResponse,
	parseYouTubeResults,
	// field-projection
	projectReport,
	// http
	RateLimitError,
	REDDIT_PROMPT_VERSION,
	releaseCacheLock,
	removeTopic,
	renderBriefingMarkdown,
	renderCompact,
	renderContextSnippet,
	renderFullReport,
	renderHelp,
	reportToDict,
	// output
	reportToJsonl,
	resolveErrorContext,
	resolveOutputArgs,
	saveCache,
	// score
	scoreRedditItems,
	scoreXItems,
	scoreYouTubeItems,
	searchReddit,
	searchX,
	searchYouTube,
	sortItems,
	validateSources,
	wrapData,
	wrapReport,
	writeError,
	writeOutputs,
	X_PROMPT_VERSION,
} from './index.js'

/** Load a fixture file. */
function loadFixture(name: string): Record<string, unknown> {
	const scriptDir = dirname(fileURLToPath(import.meta.url))
	const fixturePath = join(scriptDir, '..', 'fixtures', name)
	try {
		return JSON.parse(readFileSync(fixturePath, 'utf-8')) as Record<
			string,
			unknown
		>
	} catch {
		return {}
	}
}

/** Read package version from package.json. */
function getPackageVersion(): string {
	try {
		const pkgPath = new URL('../package.json', import.meta.url)
		const raw = readFileSync(pkgPath, 'utf-8')
		const pkg = JSON.parse(raw) as { version?: string }
		return pkg.version ?? 'unknown'
	} catch {
		return 'unknown'
	}
}

interface SearchTaskResult {
	items: Record<string, unknown>[]
	raw: Record<string, unknown> | null
	error: string | null
	fromCache: boolean
	cacheAgeHours: number | null
	rateLimited: boolean
	usedStaleCache: boolean
}

interface CachedSearchPayload {
	items: Record<string, unknown>[]
	raw: Record<string, unknown> | null
}

function parseCachedSearchPayload(
	data: Record<string, unknown> | null,
): CachedSearchPayload | null {
	if (!data) return null
	const itemsRaw = data.items
	if (!Array.isArray(itemsRaw)) return null
	const items = itemsRaw.filter(
		(item) => item && typeof item === 'object',
	) as Record<string, unknown>[]
	const rawData =
		data.raw && typeof data.raw === 'object'
			? (data.raw as Record<string, unknown>)
			: null
	return { items, raw: rawData }
}

async function searchRedditTask(
	topic: string,
	cfg: Record<string, string | null>,
	selectedModels: Record<string, string | null>,
	fromDate: string,
	toDate: string,
	days: number,
	depth: string,
	mock: boolean,
	cacheOpts: { skipRead: boolean; skipWrite: boolean },
): Promise<SearchTaskResult> {
	const cacheKey = getSourceCacheKey(
		topic,
		fromDate,
		toDate,
		days,
		'reddit',
		depth,
		selectedModels.openai ?? null,
		REDDIT_PROMPT_VERSION,
	)

	// Try cache first (unless refreshing or mock)
	if (!mock && !cacheOpts.skipRead) {
		const [cached, ageHours] = loadCacheWithAge(cacheKey, getSearchTTL())
		const payload = parseCachedSearchPayload(cached)
		if (payload) {
			return {
				items: payload.items,
				raw: payload.raw,
				error: null,
				fromCache: true,
				cacheAgeHours: ageHours,
				rateLimited: false,
				usedStaleCache: false,
			}
		}
	}

	let lockAcquired = false
	if (!mock && !cacheOpts.skipRead) {
		lockAcquired = await acquireCacheLock(cacheKey)
		if (!lockAcquired) {
			const [cachedAfterWait, ageHours] = loadCacheWithAge(
				cacheKey,
				getSearchTTL(),
			)
			const payload = parseCachedSearchPayload(cachedAfterWait)
			if (payload) {
				return {
					items: payload.items,
					raw: payload.raw,
					error: null,
					fromCache: true,
					cacheAgeHours: ageHours,
					rateLimited: false,
					usedStaleCache: false,
				}
			}
		}
	}

	let raw: Record<string, unknown> | null = null
	let error: string | null = null
	let rateLimited = false

	try {
		if (mock) {
			raw = loadFixture('openai_sample.json')
		} else {
			raw = await searchReddit(
				cfg.OPENAI_API_KEY!,
				selectedModels.openai!,
				topic,
				fromDate,
				toDate,
				depth,
			)
		}
	} catch (e) {
		raw = { error: String(e) }
		if (e instanceof RateLimitError) {
			rateLimited = true
			error = e.retryable
				? `Rate limited after ${e.retries_attempted} retries`
				: 'OpenAI quota/billing limit reached (non-retryable 429)'

			// Stale cache fallback on transient rate-limit only.
			// Keep error null when stale cache is served so results still render.
			if (e.retryable && !cacheOpts.skipRead) {
				const [stale, staleAge] = loadStaleCacheWithAge(cacheKey)
				const payload = parseCachedSearchPayload(stale)
				if (payload) {
					return {
						items: payload.items,
						raw: payload.raw,
						error: null,
						fromCache: true,
						cacheAgeHours: staleAge,
						rateLimited: true,
						usedStaleCache: true,
					}
				}
			}
		} else {
			error = `API error: ${e}`
		}
	} finally {
		if (lockAcquired) releaseCacheLock(cacheKey)
	}

	const items = parseRedditResponse(raw ?? {})

	// Quick retry with simpler query if few results
	// Skip if the first attempt was rate-limited (retry amplification guard)
	if (items.length < 5 && !mock && !error && !rateLimited) {
		const core = extractCoreSubject(topic)
		if (core.toLowerCase() !== topic.toLowerCase()) {
			try {
				const retryRaw = await searchReddit(
					cfg.OPENAI_API_KEY!,
					selectedModels.openai!,
					core,
					fromDate,
					toDate,
					depth,
				)
				const retryItems = parseRedditResponse(retryRaw)
				const existingUrls = new Set(items.map((i) => i.url))
				for (const item of retryItems) {
					if (!existingUrls.has(item.url)) items.push(item)
				}
			} catch {
				// ignore retry errors
			}
		}
	}

	// Recency rescue:
	// If all parsed dates are clearly before the requested range, run one extra
	// query biased toward the explicit date window and merge new URLs.
	const allKnownDatesAreBeforeRange =
		items.length > 0 &&
		items.every((item) => {
			const d = item.date
			return (
				typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d < fromDate
			)
		})

	if (allKnownDatesAreBeforeRange && !mock && !error && !rateLimited) {
		const core = extractCoreSubject(topic)
		const recencyTopic = `${core} ${fromDate}..${toDate} latest`
		try {
			const recencyRaw = await searchReddit(
				cfg.OPENAI_API_KEY!,
				selectedModels.openai!,
				recencyTopic,
				fromDate,
				toDate,
				depth,
			)
			const recencyItems = parseRedditResponse(recencyRaw)
			const existingUrls = new Set(items.map((i) => i.url))
			for (const item of recencyItems) {
				if (!existingUrls.has(item.url)) items.push(item)
			}
		} catch {
			// ignore recency rescue errors
		}
	}

	// Write through to cache on success (unless disabled)
	if (!mock && !cacheOpts.skipWrite && !error && items.length > 0) {
		saveCache(cacheKey, { items, raw })
	}

	return {
		items,
		raw,
		error,
		fromCache: false,
		cacheAgeHours: null,
		rateLimited,
		usedStaleCache: false,
	}
}

async function searchXTask(
	topic: string,
	cfg: Record<string, string | null>,
	selectedModels: Record<string, string | null>,
	fromDate: string,
	toDate: string,
	days: number,
	depth: string,
	mock: boolean,
	cacheOpts: { skipRead: boolean; skipWrite: boolean },
): Promise<SearchTaskResult> {
	const cacheKey = getSourceCacheKey(
		topic,
		fromDate,
		toDate,
		days,
		'x',
		depth,
		selectedModels.xai ?? null,
		X_PROMPT_VERSION,
	)

	// Try cache first (unless refreshing or mock)
	if (!mock && !cacheOpts.skipRead) {
		const [cached, ageHours] = loadCacheWithAge(cacheKey, getSearchTTL())
		const payload = parseCachedSearchPayload(cached)
		if (payload) {
			return {
				items: payload.items,
				raw: payload.raw,
				error: null,
				fromCache: true,
				cacheAgeHours: ageHours,
				rateLimited: false,
				usedStaleCache: false,
			}
		}
	}

	let lockAcquired = false
	if (!mock && !cacheOpts.skipRead) {
		lockAcquired = await acquireCacheLock(cacheKey)
		if (!lockAcquired) {
			const [cachedAfterWait, ageHours] = loadCacheWithAge(
				cacheKey,
				getSearchTTL(),
			)
			const payload = parseCachedSearchPayload(cachedAfterWait)
			if (payload) {
				return {
					items: payload.items,
					raw: payload.raw,
					error: null,
					fromCache: true,
					cacheAgeHours: ageHours,
					rateLimited: false,
					usedStaleCache: false,
				}
			}
		}
	}

	let raw: Record<string, unknown> | null = null
	let error: string | null = null
	let rateLimited = false

	try {
		if (mock) {
			raw = loadFixture('xai_sample.json')
		} else {
			raw = await searchX(
				cfg.XAI_API_KEY!,
				selectedModels.xai!,
				topic,
				fromDate,
				toDate,
				depth,
			)
		}
	} catch (e) {
		raw = { error: String(e) }
		if (e instanceof RateLimitError) {
			rateLimited = true
			error = e.retryable
				? `Rate limited after ${e.retries_attempted} retries`
				: 'xAI quota/billing limit reached (non-retryable 429)'

			// Stale cache fallback on transient rate-limit only.
			// Keep error null when stale cache is served so results still render.
			if (e.retryable && !cacheOpts.skipRead) {
				const [stale, staleAge] = loadStaleCacheWithAge(cacheKey)
				const payload = parseCachedSearchPayload(stale)
				if (payload) {
					return {
						items: payload.items,
						raw: payload.raw,
						error: null,
						fromCache: true,
						cacheAgeHours: staleAge,
						rateLimited: true,
						usedStaleCache: true,
					}
				}
			}
		} else {
			error = `API error: ${e}`
		}
	} finally {
		if (lockAcquired) releaseCacheLock(cacheKey)
	}

	const items = parseXResponse(raw ?? {})

	// Write through to cache on success (unless disabled)
	if (!mock && !cacheOpts.skipWrite && !error && items.length > 0) {
		saveCache(cacheKey, { items, raw })
	}

	return {
		items,
		raw,
		error,
		fromCache: false,
		cacheAgeHours: null,
		rateLimited,
		usedStaleCache: false,
	}
}

// ---------------------------------------------------------------------------
// Watch subcommand handlers
// ---------------------------------------------------------------------------

/**
 * Adds a topic to the watchlist and prints confirmation.
 *
 * @param topic    - Topic string to watch.
 * @param schedule - Optional schedule: `'daily'` or `'weekly'`.
 */
function watchAdd(topic: string, schedule?: string): void {
	addTopic(topic, schedule)
	const scheduleNote = schedule ? ` (schedule: ${schedule})` : ''
	process.stdout.write(`Watching: "${topic}"${scheduleNote}\n`)
}

/** Lists all watched topics in a formatted table. */
function watchList(): void {
	const topics = listTopics()
	if (topics.length === 0) {
		process.stdout.write('No topics on your watchlist.\n')
		return
	}
	process.stdout.write(
		`${'ID'.padEnd(4)} ${'Topic'.padEnd(40)} ${'Schedule'.padEnd(8)} Last run\n`,
	)
	process.stdout.write(
		`${'-'.repeat(4)} ${'-'.repeat(40)} ${'-'.repeat(8)} ${'-'.repeat(19)}\n`,
	)
	for (const t of topics) {
		const id = String(t.id).padEnd(4)
		const topic = t.topic.slice(0, 40).padEnd(40)
		const schedule = (t.schedule ?? '-').padEnd(8)
		const lastRun = t.lastRunAt ?? 'never'
		process.stdout.write(`${id} ${topic} ${schedule} ${lastRun}\n`)
	}
}

/**
 * Removes a topic from the watchlist and prints confirmation.
 *
 * @param topic - Topic string to remove.
 */
function watchRemove(topic: string): void {
	const removed = removeTopic(topic)
	if (removed) {
		process.stdout.write(`Removed: "${topic}"\n`)
	} else {
		process.stdout.write(`Not found: "${topic}"\n`)
	}
}

/**
 * Prints run history for a topic.
 *
 * @param topic - Topic to query.
 * @param limit - Maximum number of entries to display.
 */
function watchHistory(topic: string, limit: number): void {
	const entries = getHistory(topic, limit)
	if (entries.length === 0) {
		process.stdout.write(`No run history for "${topic}".\n`)
		return
	}
	process.stdout.write(
		`Run history for "${topic}" (${entries.length} entries):\n\n`,
	)
	for (const e of entries) {
		const status = e.status === 'success' ? 'ok' : 'ERR'
		const duration = e.durationMs != null ? `${e.durationMs}ms` : '-'
		const items = String(e.itemCount).padStart(3)
		const error = e.errorMessage ? ` -- ${e.errorMessage}` : ''
		process.stdout.write(
			`  [${status}] ${e.ranAt}  ${items} items  ${duration}${error}\n`,
		)
	}
}

/**
 * Write a JSON envelope for watch/briefing subcommands.
 *
 * @param data   - Payload to wrap.
 * @param pretty - Pretty-print JSON when true.
 */
function writeEnvelope(data: Record<string, unknown>, pretty: boolean): void {
	const envelope = wrapData(data)
	process.stdout.write(`${JSON.stringify(envelope, null, pretty ? 2 : 0)}\n`)
}

/**
 * Handles the `briefing` subcommand.
 *
 * Fetches run history for the topic from the watchlist store, generates a
 * briefing with optional delta detection, and prints it as markdown to stdout.
 *
 * @param cmd - Parsed briefing command.
 */
function handleBriefingCommand(cmd: BriefingCommand): void {
	// Fetch enough history for the period: daily=2 runs, weekly=8 runs.
	const limit = cmd.period === 'weekly' ? 8 : 2
	const runs = getHistory(cmd.topic, limit)
	// Keep core briefing logic time-free by creating timestamp at the CLI boundary.
	const generatedAt = new Date().toISOString()
	const briefing = generateBriefing(cmd.topic, runs, cmd.period, generatedAt)
	if (cmd.json || cmd.jsonl) {
		writeEnvelope({ briefing }, cmd.json && !cmd.jsonl)
		return
	}
	process.stdout.write(renderBriefingMarkdown(briefing))
	process.stdout.write('\n')
}

/**
 * Routes `watch` subcommands using the pre-parsed WatchCommand.
 *
 * @param cmd - Parsed watch command with subcommand, topic, and options.
 */
function handleWatchCommand(cmd: WatchCommand): void {
	const wantsJson = cmd.json || cmd.jsonl
	if (cmd.subcommand === 'add') {
		if (wantsJson) {
			addTopic(cmd.topic, cmd.schedule)
			writeEnvelope(
				{
					action: 'watch.add',
					topic: cmd.topic,
					schedule: cmd.schedule ?? null,
				},
				cmd.json && !cmd.jsonl,
			)
			return
		}
		watchAdd(cmd.topic, cmd.schedule)
	} else if (cmd.subcommand === 'list') {
		if (wantsJson) {
			const topics = listTopics()
			writeEnvelope({ action: 'watch.list', topics }, cmd.json && !cmd.jsonl)
			return
		}
		watchList()
	} else if (cmd.subcommand === 'remove') {
		if (wantsJson) {
			const removed = removeTopic(cmd.topic)
			writeEnvelope(
				{ action: 'watch.remove', topic: cmd.topic, removed },
				cmd.json && !cmd.jsonl,
			)
			return
		}
		watchRemove(cmd.topic)
	} else if (cmd.subcommand === 'history') {
		if (wantsJson) {
			const entries = getHistory(cmd.topic, cmd.limit)
			writeEnvelope(
				{ action: 'watch.history', topic: cmd.topic, entries },
				cmd.json && !cmd.jsonl,
			)
			return
		}
		watchHistory(cmd.topic, cmd.limit)
	}
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

async function main() {
	const rawArgs = process.argv.slice(2)
	const parsed = parseCliArgs(rawArgs)

	// Parser returned an error -- throw it so the catch handler routes it.
	if (!parsed.ok) throw parsed.error

	const cmd = parsed.value

	// Route subcommands
	if (cmd.command === 'help') {
		if (!isValidHelpTopic(cmd.helpTopic)) {
			throw new CliError(
				`Unknown help topic: "${cmd.helpTopic}". Valid: overview, sources, output, contract`,
				{ exitCode: EXIT_USAGE, code: 'UNKNOWN_HELP_TOPIC' },
			)
		}
		console.log(renderHelp(cmd.helpTopic))
		return
	}
	if (cmd.command === 'version') {
		process.stdout.write(`${getPackageVersion()}\n`)
		return
	}

	if (cmd.command === 'watch') {
		handleWatchCommand(cmd)
		return
	}

	if (cmd.command === 'briefing') {
		handleBriefingCommand(cmd)
		return
	}

	// Search command
	const args = cmd as SearchCommand
	const outputArgs = resolveOutputArgs(args, process.stdout.isTTY)
	const fieldsProvided = args.fields.length > 0
	const fieldsAllowed =
		outputArgs.json || outputArgs.jsonl || args.emit === 'json'
	if (fieldsProvided && !fieldsAllowed) {
		throw new CliError(
			'--fields can only be used with --json, --jsonl, or --emit=json.',
			{ exitCode: EXIT_CONFLICT, code: 'CONFLICT_FLAGS' },
		)
	}

	if (args.debug) {
		process.env.WOTS_DEBUG = '1'
		process.stderr.write(
			`[debug] strategy=${args.strategy} phase2Budget=${args.phase2Budget}\n`,
		)
	}

	// Two-phase strategy warning -- adapter wrappers not yet available
	if (args.strategy === 'two-phase') {
		process.stderr.write(
			'Warning: Two-phase strategy not yet implemented, falling back to single-phase.\n',
		)
	}

	// Validate --days
	if (!Number.isInteger(args.days) || args.days < 1 || args.days > 365) {
		throw new CliError('--days must be an integer between 1 and 365.', {
			exitCode: EXIT_USAGE,
			code: 'INVALID_DAYS',
		})
	}

	// Determine depth
	if (args.quick && args.deep) {
		throw new CliError('Cannot use both --quick and --deep.', {
			exitCode: EXIT_CONFLICT,
			code: 'CONFLICT_QUICK_DEEP',
		})
	}
	if (args.fast && args.cheap) {
		throw new CliError('Cannot use both --fast and --cheap.', {
			exitCode: EXIT_CONFLICT,
			code: 'CONFLICT_FAST_CHEAP',
		})
	}
	const depth = args.quick ? 'quick' : args.deep ? 'deep' : 'default'

	if (!args.topic) {
		throw new CliError(
			'Please provide a topic to research.\nUsage: wots <topic> [options]\nRun wots --help for full usage.',
			{ exitCode: EXIT_USAGE, code: 'MISSING_TOPIC' },
		)
	}

	if (args.outdir) {
		const resolved = resolve(args.outdir)
		if (!isAbsolute(args.outdir)) {
			const cwd = process.cwd()
			const withinCwd = resolved === cwd || resolved.startsWith(`${cwd}${sep}`)
			if (!withinCwd) {
				throw new CliError(
					'--outdir must stay within the current working directory when using a relative path. Use an absolute path to write elsewhere.',
					{ exitCode: EXIT_USAGE, code: 'INVALID_OUTDIR' },
				)
			}
		}
	}

	// Resolve intent classification
	const resolvedQueryType: QueryType =
		args.queryType === 'auto'
			? classifyIntent(args.topic)
			: (args.queryType as QueryType)
	const intentPolicy = getIntentPolicy(resolvedQueryType)

	// Load config
	const cfg = getConfig()
	if (args.fast) {
		cfg.OPENAI_MODEL_POLICY = 'pinned'
		cfg.OPENAI_MODEL_PIN = 'gpt-4o'
	} else if (args.cheap) {
		cfg.OPENAI_MODEL_POLICY = 'pinned'
		cfg.OPENAI_MODEL_PIN = 'gpt-4o-mini-search-preview'
	}
	if (args.debug) {
		process.stderr.write(
			`[debug] query-type=${resolvedQueryType} (input: ${args.queryType})\n`,
		)
		process.stderr.write(
			`[debug] openai-model-policy=${cfg.OPENAI_MODEL_POLICY} openai-model-pin=${cfg.OPENAI_MODEL_PIN ?? 'none'}\n`,
		)
	}
	const available = getAvailableSources(cfg)

	// Determine sources
	let sources: string
	if (args.mock) {
		// In mock mode, simulate having both keys available
		const [effectiveSources, error] = validateSources(
			args.sources,
			'both',
			args.includeWeb,
		)
		sources = effectiveSources
		if (error && !error.includes('WebSearch fallback')) {
			throw new CliError(error, {
				exitCode: EXIT_UNAUTHORIZED,
				code: 'MISSING_API_KEY',
			})
		}
	} else {
		const [effectiveSources, error] = validateSources(
			args.sources,
			available,
			args.includeWeb,
		)
		sources = effectiveSources
		if (error) {
			if (error.includes('WebSearch fallback')) {
				process.stderr.write(`Note: ${error}\n`)
			} else {
				throw new CliError(error, {
					exitCode: EXIT_UNAUTHORIZED,
					code: 'MISSING_API_KEY',
				})
			}
		}
	}

	// Get date range
	const [fromDate, toDate] = getDateRange(args.days)
	const missingKeys = getMissingKeys(cfg)

	// Initialize progress
	const progress = new ProgressDisplay(args.topic, true, outputArgs.quiet)

	if (missingKeys !== 'none') progress.showPromo(missingKeys)

	// Select models
	let selectedModels: Record<string, string | null>
	if (args.mock) {
		const mockOpenai =
			(loadFixture('models_openai_sample.json').data as Record<
				string,
				unknown
			>[]) ?? []
		const mockXai =
			(loadFixture('models_xai_sample.json').data as Record<
				string,
				unknown
			>[]) ?? []
		selectedModels = await getModels(
			{ OPENAI_API_KEY: 'mock', XAI_API_KEY: 'mock', ...cfg },
			mockOpenai,
			mockXai,
		)
	} else {
		selectedModels = await getModels(cfg)
	}

	// Determine mode string
	const modeMap: Record<string, string> = {
		all: 'all',
		both: 'both',
		reddit: 'reddit-only',
		'reddit-web': 'reddit-web',
		x: 'x-only',
		'x-web': 'x-web',
		web: 'web-only',
	}
	const mode = modeMap[sources] ?? sources

	// Check if WebSearch is needed
	const webNeeded = ['all', 'web', 'reddit-web', 'x-web'].includes(sources)

	// Web-only mode
	if (sources === 'web') {
		progress.startWebOnly()
		progress.endWebOnly()
	}

	const runReddit = ['both', 'reddit', 'all', 'reddit-web'].includes(sources)
	const runX = ['both', 'x', 'all', 'x-web'].includes(sources)

	// Cache configuration
	const skipCacheRead = args.refresh || args.noCache
	const skipCacheWrite = args.noCache
	const cacheOpts = { skipRead: skipCacheRead, skipWrite: skipCacheWrite }

	// Run searches in parallel
	let redditItems: Record<string, unknown>[] = []
	let xItems: Record<string, unknown>[] = []
	let rawOpenai: Record<string, unknown> | null = null
	let rawXai: Record<string, unknown> | null = null
	let redditError: string | null = null
	let xError: string | null = null
	let anyFromCache = false
	let maxCacheAge: number | null = null
	let redditRateLimited = false
	let xRateLimited = false
	let redditUsedStaleCache = false
	let xUsedStaleCache = false

	const promises: Promise<void>[] = []

	if (runReddit) {
		progress.startReddit()
		promises.push(
			searchRedditTask(
				args.topic,
				cfg,
				selectedModels,
				fromDate,
				toDate,
				args.days,
				depth,
				args.mock,
				cacheOpts,
			).then((result) => {
				redditItems = result.items
				rawOpenai = result.raw
				redditError = result.error
				if (result.fromCache) {
					anyFromCache = true
					if (
						result.cacheAgeHours != null &&
						(maxCacheAge == null || result.cacheAgeHours > maxCacheAge)
					) {
						maxCacheAge = result.cacheAgeHours
					}
				}
				if (result.rateLimited) redditRateLimited = true
				if (result.usedStaleCache) redditUsedStaleCache = true
				if (result.fromCache && !result.rateLimited) {
					progress.endReddit()
				} else {
					if (redditError) progress.showError(`Reddit error: ${redditError}`)
					progress.endReddit()
				}
			}),
		)
	}

	if (runX) {
		progress.startX()
		promises.push(
			searchXTask(
				args.topic,
				cfg,
				selectedModels,
				fromDate,
				toDate,
				args.days,
				depth,
				args.mock,
				cacheOpts,
			).then((result) => {
				xItems = result.items
				rawXai = result.raw
				xError = result.error
				if (result.fromCache) {
					anyFromCache = true
					if (
						result.cacheAgeHours != null &&
						(maxCacheAge == null || result.cacheAgeHours > maxCacheAge)
					) {
						maxCacheAge = result.cacheAgeHours
					}
				}
				if (result.rateLimited) xRateLimited = true
				if (result.usedStaleCache) xUsedStaleCache = true
				if (result.fromCache && !result.rateLimited) {
					progress.endX()
				} else {
					if (xError) progress.showError(`X error: ${xError}`)
					progress.endX()
				}
			}),
		)
	}

	await Promise.allSettled(promises)

	const anyRateLimited = redditRateLimited || xRateLimited
	const anyUsedStaleCache = redditUsedStaleCache || xUsedStaleCache

	if (anyFromCache && !anyRateLimited) {
		progress.showCached(maxCacheAge)
	}
	if (anyRateLimited) {
		const rateLimitedSources: string[] = []
		if (redditRateLimited) rateLimitedSources.push('Reddit')
		if (xRateLimited) rateLimitedSources.push('X')
		const sourceName = rateLimitedSources.join('/')
		progress.showRateLimited(sourceName, anyUsedStaleCache, maxCacheAge)
	}

	// Enrich Reddit items
	const rawRedditEnriched: Record<string, unknown>[] = []
	if (redditItems.length > 0) {
		progress.startRedditEnrich(1, redditItems.length)
		for (let i = 0; i < redditItems.length; i++) {
			if (i > 0) progress.updateRedditEnrich(i + 1, redditItems.length)
			const item = redditItems[i]!
			const itemUrl = String(item.url ?? '')
			const enrichKey = itemUrl ? getEnrichmentCacheKey(itemUrl) : ''

			if (!args.mock && enrichKey && !skipCacheRead) {
				const [cachedEnriched] = loadCacheWithAge(enrichKey, getEnrichmentTTL())
				const cachedItem =
					cachedEnriched &&
					typeof cachedEnriched.item === 'object' &&
					cachedEnriched.item
						? (cachedEnriched.item as Record<string, unknown>)
						: null
				if (cachedItem) {
					redditItems[i] = cachedItem
					rawRedditEnriched.push(cachedItem)
					continue
				}
			}

			try {
				if (args.mock) {
					const mockThread = loadFixture('reddit_thread_sample.json')
					redditItems[i] = await enrichRedditItem(redditItems[i]!, mockThread)
				} else {
					redditItems[i] = await enrichRedditItem(redditItems[i]!)
					if (enrichKey && !skipCacheWrite) {
						saveCache(enrichKey, {
							item: redditItems[i]!,
							cached_at: new Date().toISOString(),
						})
					}
				}
			} catch (e) {
				progress.showError(`Enrich failed: ${e}`)
			}
			rawRedditEnriched.push(redditItems[i]!)
		}
		progress.endRedditEnrich()
	}

	// YouTube search (opt-in via --include-youtube)
	let youtubeRawItems: Record<string, unknown>[] = []
	let youtubeError: string | null = null

	if (args.includeYoutube) {
		if (args.mock) {
			// Load fixture data in mock mode
			progress.startYouTube()
			try {
				const fixturePath = join(
					dirname(fileURLToPath(import.meta.url)),
					'..',
					'fixtures',
					'youtube_sample.json',
				)
				const fixtureData = JSON.parse(
					readFileSync(fixturePath, 'utf-8'),
				) as Record<string, unknown>[]
				youtubeRawItems = parseYouTubeResults(fixtureData)
			} catch (e) {
				youtubeError = `YouTube fixture error: ${e}`
			}
			progress.endYouTube()
		} else if (isYtDlpAvailable()) {
			progress.startYouTube()
			try {
				const rawResults = await searchYouTube(args.topic, args.days, depth)
				youtubeRawItems = parseYouTubeResults(rawResults)
			} catch (e) {
				youtubeError = `YouTube search error: ${e}`
			}
			progress.endYouTube()
		} else {
			progress.showError('yt-dlp not installed, skipping YouTube')
			youtubeError = 'yt-dlp not installed'
		}
	}

	// Processing phase
	progress.startProcessing()

	const normalizedReddit = normalizeRedditItems(redditItems, fromDate, toDate)
	const normalizedX = normalizeXItems(xItems, fromDate, toDate)
	const normalizedYouTube = normalizeYouTubeItems(
		youtubeRawItems,
		fromDate,
		toDate,
	)

	let filteredReddit = filterByDateRange(normalizedReddit, fromDate, toDate)
	const filteredX = filterByDateRange(normalizedX, fromDate, toDate)
	const filteredYouTube = filterByDateRange(normalizedYouTube, fromDate, toDate)

	// Reliability fallback:
	// If strict date filtering removes all Reddit items, retain one best-effort
	// item so live runs don't collapse to zero. Prefer null-date items first
	// (unknown freshness), otherwise keep the newest known-date item.
	if (filteredReddit.length === 0 && normalizedReddit.length > 0) {
		const nullDateItems = normalizedReddit.filter((item) => item.date == null)
		if (nullDateItems.length > 0) {
			filteredReddit = [nullDateItems[0]!]
		} else {
			const byDateDesc = [...normalizedReddit].sort((a, b) =>
				String(b.date ?? '').localeCompare(String(a.date ?? '')),
			)
			filteredReddit = [byDateDesc[0]!]
		}
	}

	const trendScores = computeTrendScores([
		...filteredReddit,
		...filteredX,
		...filteredYouTube,
	])
	const scoreOpts = { intentWeights: intentPolicy.weights }
	const scoredReddit = scoreRedditItems(
		filteredReddit,
		args.days,
		trendScores,
		scoreOpts,
	)
	const scoredX = scoreXItems(filteredX, args.days, trendScores, scoreOpts)
	const scoredYouTube = scoreYouTubeItems(
		filteredYouTube,
		args.days,
		trendScores,
		scoreOpts,
	)

	const sortedReddit = sortItems(scoredReddit) as RedditItem[]
	const sortedX = sortItems(scoredX) as XItem[]
	const sortedYouTube = sortItems(scoredYouTube) as YouTubeItem[]

	const dedupedReddit = dedupeReddit(sortedReddit)
	const dedupedX = dedupeX(sortedX)
	const dedupedYouTube = dedupeYouTube(sortedYouTube)

	progress.endProcessing()

	// Create report
	const report = createReport(
		args.topic,
		fromDate,
		toDate,
		mode,
		selectedModels.openai,
		selectedModels.xai,
		args.days,
	)
	report.reddit = dedupedReddit
	report.x = dedupedX
	report.youtube = dedupedYouTube
	report.reddit_error = redditError
	report.x_error = xError
	report.youtube_error = youtubeError
	report.from_cache = anyFromCache
	report.cache_age_hours = maxCacheAge
	report.context_snippet_md = renderContextSnippet(report)

	// Write outputs
	try {
		writeOutputs(
			report,
			rawOpenai,
			rawXai,
			rawRedditEnriched,
			args.outdir || undefined,
		)
	} catch (e) {
		if (args.debug) {
			process.stderr.write(`Warning: Could not write output files: ${e}\n`)
		}
	}

	// Show completion
	if (sources === 'web') {
		progress.showWebOnlyComplete()
	} else {
		progress.showComplete(
			dedupedReddit.length,
			dedupedX.length,
			dedupedYouTube.length,
		)
	}

	// Build web search extras for envelope modes
	const webExtras = webNeeded
		? {
				web_search_instructions: {
					topic: args.topic,
					date_range: { from: fromDate, to: toDate },
					days: args.days,
					instructions:
						'Use WebSearch tool to find 8-15 relevant web pages. Exclude reddit.com, x.com, twitter.com.',
				},
			}
		: undefined

	// Field projection helper -- applies --fields at the output boundary
	const hasFields = args.fields.length > 0
	const applyProjection = (dict: Record<string, unknown>) =>
		hasFields ? projectReport(dict, args.fields) : dict

	// Output result: --json and --jsonl take precedence over --emit
	if (outputArgs.json) {
		const envelope = wrapReport(report, webExtras)
		envelope.data = applyProjection(envelope.data)
		console.log(JSON.stringify(envelope, null, 2))
	} else if (outputArgs.jsonl) {
		const lines = reportToJsonl(report, args.fields)
		for (const line of lines) {
			process.stdout.write(`${line}\n`)
		}
	} else if (args.emit === 'compact') {
		console.log(renderCompact(report, 15, missingKeys))
	} else if (args.emit === 'json') {
		let dict = reportToDict(report) as Record<string, unknown>
		if (webExtras) Object.assign(dict, webExtras)
		dict = applyProjection(dict)
		console.log(JSON.stringify(dict, null, 2))
	} else if (args.emit === 'md') {
		console.log(renderFullReport(report))
	} else if (args.emit === 'context') {
		console.log(report.context_snippet_md)
	} else if (args.emit === 'path') {
		console.log(getContextPath(args.outdir || undefined))
	}

	// Web mode handoff: print structured instructions for Claude's WebSearch tool.
	// Skip for JSON modes (already embedded in envelope/dict).
	if (
		webNeeded &&
		!outputArgs.json &&
		!outputArgs.jsonl &&
		args.emit !== 'json'
	) {
		console.log(`\n${'='.repeat(60)}`)
		console.log('### WEBSEARCH REQUIRED ###')
		console.log('='.repeat(60))
		console.log(`Topic: ${args.topic}`)
		console.log(`Date range: ${fromDate} to ${toDate}`)
		console.log('')
		console.log(
			'Claude: Use your WebSearch tool to find 8-15 relevant web pages.',
		)
		console.log(
			'EXCLUDE: reddit.com, x.com, twitter.com (already covered above)',
		)
		console.log(
			`INCLUDE: blogs, docs, news, tutorials from the last ${args.days} days`,
		)
		console.log('')
		console.log(
			'After searching, synthesize WebSearch results WITH the Reddit/X',
		)
		console.log(
			'results above. WebSearch items should rank LOWER than comparable',
		)
		console.log('Reddit/X items (they lack engagement metrics).')
		console.log('='.repeat(60))
	}
}

// Graceful SIGINT handler (Ctrl-C)
if (import.meta.main) {
	process.on('SIGINT', () => process.exit(EXIT_INTERRUPTED))

	main()
		.then(() => process.exit(0))
		.catch((e) => {
			const rawArgs = process.argv.slice(2)
			const ctx = resolveErrorContext(rawArgs, process.stdout.isTTY)
			writeError(ctx, e)

			if (e instanceof CliError) {
				process.exit(e.exitCode)
			}
			process.exit(EXIT_RUNTIME)
		})
}
