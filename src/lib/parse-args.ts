/**
 * Typed CLI argument parser with discriminated unions.
 *
 * Returns a `ParseCliResult` (ok/error) instead of calling `process.exit()`,
 * making the parser pure and testable without subprocess spawning.
 */

import { CliError } from './cli-error.js'
import { EXIT_USAGE } from './exit-codes.js'

// ---------------------------------------------------------------------------
// Flag types
// ---------------------------------------------------------------------------

/** Flags shared across all commands. */
export interface GlobalFlags {
	debug: boolean
	json: boolean
	jsonl: boolean
	quiet: boolean
	nonInteractive: boolean
	fields: string[]
}

/** Search command (the default / primary command). */
export interface SearchCommand extends GlobalFlags {
	command: 'search'
	topic: string
	mock: boolean
	emit: string
	/** True when --emit was explicitly provided on the CLI. */
	emitExplicit: boolean
	sources: string
	quick: boolean
	deep: boolean
	fast: boolean
	cheap: boolean
	includeWeb: boolean
	includeYoutube: boolean
	refresh: boolean
	noCache: boolean
	days: number
	outdir: string
	strategy: string
	phase2Budget: number
	queryType: string
}

/** Watch subcommand variants. */
export interface WatchCommand extends GlobalFlags {
	command: 'watch'
	subcommand: string
	topic: string
	schedule?: string
	limit: number
}

/** Briefing subcommand. */
export interface BriefingCommand extends GlobalFlags {
	command: 'briefing'
	topic: string
	period: 'daily' | 'weekly'
}

/** Help command. */
export interface HelpCommand extends GlobalFlags {
	command: 'help'
	helpTopic: string
}

/** Version command. */
export interface VersionCommand extends GlobalFlags {
	command: 'version'
}

/** Union of all parsed command shapes. */
export type ParsedCommand =
	| SearchCommand
	| WatchCommand
	| BriefingCommand
	| HelpCommand
	| VersionCommand

/** Successful parse. */
export interface ParseCliOk {
	ok: true
	value: ParsedCommand
}

/** Failed parse. */
export interface ParseCliError {
	ok: false
	error: CliError
}

/** Result of parsing CLI arguments. */
export type ParseCliResult = ParseCliOk | ParseCliError

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse days flag value as a base-10 integer. */
function parseDaysValue(value: string): number {
	if (!/^\d+$/.test(value)) return Number.NaN
	return Number(value)
}

/** Default global flags. */
function defaultGlobalFlags(): GlobalFlags {
	return {
		debug: false,
		json: false,
		jsonl: false,
		quiet: false,
		nonInteractive: false,
		fields: [],
	}
}

// ---------------------------------------------------------------------------
// Sub-parsers
// ---------------------------------------------------------------------------

/** Parse watch subcommand args. */
function parseWatch(args: string[], globals: GlobalFlags): ParseCliResult {
	const sub = args[0] ?? ''

	if (!['add', 'list', 'remove', 'history'].includes(sub)) {
		return {
			ok: false,
			error: new CliError(
				`Unknown watch subcommand: "${sub}". Valid: add, list, remove, history`,
				{ exitCode: EXIT_USAGE, code: 'UNKNOWN_SUBCOMMAND' },
			),
		}
	}

	const remaining = args.slice(1)
	let topic = ''
	let schedule: string | undefined
	let scheduleProvided = false
	let limitProvided = false
	let limit = 10

	for (let i = 0; i < remaining.length; i++) {
		const arg = remaining[i]!

		// --every (watch add only)
		if (arg.startsWith('--every=')) {
			scheduleProvided = true
			schedule = arg.slice('--every='.length)
		} else if (arg === '--every') {
			const value = remaining[i + 1]
			scheduleProvided = true
			if (!value || value.startsWith('-')) {
				schedule = ''
			} else {
				schedule = value
				i += 1
			}
		}
		// --limit (watch history only)
		else if (arg.startsWith('--limit=')) {
			limitProvided = true
			const n = Number(arg.slice('--limit='.length))
			if (!Number.isInteger(n) || n < 1) {
				return {
					ok: false,
					error: new CliError(
						'--limit must be a positive integer.\nUsage: wots watch history "topic" [--limit=10|--limit 10]',
						{ exitCode: EXIT_USAGE, code: 'INVALID_LIMIT' },
					),
				}
			}
			limit = n
		} else if (arg === '--limit') {
			limitProvided = true
			const value = remaining[i + 1]
			if (!value || value.startsWith('-')) {
				return {
					ok: false,
					error: new CliError(
						'--limit must be a positive integer.\nUsage: wots watch history "topic" [--limit=10|--limit 10]',
						{ exitCode: EXIT_USAGE, code: 'INVALID_LIMIT' },
					),
				}
			}
			const n = Number(value)
			if (!Number.isInteger(n) || n < 1) {
				return {
					ok: false,
					error: new CliError(
						'--limit must be a positive integer.\nUsage: wots watch history "topic" [--limit=10|--limit 10]',
						{ exitCode: EXIT_USAGE, code: 'INVALID_LIMIT' },
					),
				}
			}
			limit = n
			i += 1
		} else if (arg.startsWith('--')) {
			return {
				ok: false,
				error: new CliError(`Unknown watch ${sub} flag: "${arg}"`, {
					exitCode: EXIT_USAGE,
					code: 'UNKNOWN_FLAG',
				}),
			}
		} else if (!arg.startsWith('-')) {
			topic = topic ? `${topic} ${arg}` : arg
		} else {
			return {
				ok: false,
				error: new CliError(`Unknown watch ${sub} flag: "${arg}"`, {
					exitCode: EXIT_USAGE,
					code: 'UNKNOWN_FLAG',
				}),
			}
		}
	}

	// Topic required for add, remove, history
	if (sub !== 'list' && !topic) {
		return {
			ok: false,
			error: new CliError(
				`watch ${sub} requires a topic.\nUsage: wots watch ${sub} "topic"`,
				{ exitCode: EXIT_USAGE, code: 'MISSING_TOPIC' },
			),
		}
	}

	// Validate schedule for add
	if (sub === 'add' && scheduleProvided) {
		const validSchedules = ['daily', 'weekly']
		if (!validSchedules.includes(schedule ?? '')) {
			return {
				ok: false,
				error: new CliError(
					`Invalid --every value: "${schedule}". Valid: daily, weekly`,
					{ exitCode: EXIT_USAGE, code: 'INVALID_EVERY' },
				),
			}
		}
	}
	if (scheduleProvided && sub !== 'add') {
		return {
			ok: false,
			error: new CliError(
				`--every is only valid for watch add.\nUsage: wots watch add "topic" [--every=daily|weekly]`,
				{ exitCode: EXIT_USAGE, code: 'INVALID_EVERY' },
			),
		}
	}
	if (limitProvided && sub !== 'history') {
		return {
			ok: false,
			error: new CliError(
				`--limit is only valid for watch history.\nUsage: wots watch history "topic" [--limit=10|--limit 10]`,
				{ exitCode: EXIT_USAGE, code: 'INVALID_LIMIT' },
			),
		}
	}

	return {
		ok: true,
		value: {
			...globals,
			command: 'watch',
			subcommand: sub,
			topic,
			schedule,
			limit,
		},
	}
}

/** Parse briefing subcommand args. */
function parseBriefing(args: string[], globals: GlobalFlags): ParseCliResult {
	let topic = ''
	let period: 'daily' | 'weekly' = 'daily'

	for (const arg of args) {
		if (arg.startsWith('--period=')) {
			const val = arg.slice('--period='.length)
			if (val === 'daily' || val === 'weekly') {
				period = val
			} else {
				return {
					ok: false,
					error: new CliError(
						`Invalid --period value: "${val}". Valid: daily, weekly`,
						{ exitCode: EXIT_USAGE, code: 'INVALID_PERIOD' },
					),
				}
			}
		} else if (!arg.startsWith('-')) {
			topic = topic ? `${topic} ${arg}` : arg
		} else {
			return {
				ok: false,
				error: new CliError(
					`Unknown briefing flag: "${arg}"\nUsage: wots briefing "topic" [--period=daily|weekly]`,
					{ exitCode: EXIT_USAGE, code: 'UNKNOWN_FLAG' },
				),
			}
		}
	}

	if (!topic) {
		return {
			ok: false,
			error: new CliError(
				'briefing requires a topic.\nUsage: wots briefing "topic" [--period=daily|weekly]',
				{ exitCode: EXIT_USAGE, code: 'MISSING_TOPIC' },
			),
		}
	}

	return {
		ok: true,
		value: { ...globals, command: 'briefing', topic, period },
	}
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse CLI arguments into a typed discriminated union.
 *
 * Never calls `process.exit()` -- returns `ParseCliError` on bad input
 * so callers can decide how to render the error.
 */
export function parseCliArgs(rawArgs: string[]): ParseCliResult {
	const globals = defaultGlobalFlags()

	// Pre-scan for global flags that apply to all commands
	const filteredArgs: string[] = []
	for (let i = 0; i < rawArgs.length; i++) {
		const arg = rawArgs[i]!
		if (arg === '--json') {
			globals.json = true
		} else if (arg === '--jsonl') {
			globals.jsonl = true
		} else if (arg === '--quiet') {
			globals.quiet = true
		} else if (arg === '--debug') {
			globals.debug = true
		} else if (arg === '--non-interactive') {
			globals.nonInteractive = true
		} else if (arg.startsWith('--fields=')) {
			globals.fields = arg
				.slice('--fields='.length)
				.split(',')
				.map((f) => f.trim())
				.filter(Boolean)
		} else if (arg === '--fields') {
			const value = rawArgs[i + 1]
			if (value && !value.startsWith('-')) {
				globals.fields = value
					.split(',')
					.map((f) => f.trim())
					.filter(Boolean)
				i += 1
			}
		} else {
			filteredArgs.push(arg)
		}
	}

	// Mutual exclusion: --json and --jsonl
	if (globals.json && globals.jsonl) {
		return {
			ok: false,
			error: new CliError('Cannot use both --json and --jsonl.', {
				exitCode: EXIT_USAGE,
				code: 'CONFLICT_FLAGS',
			}),
		}
	}

	// Route subcommands
	const first = filteredArgs[0]

	// Help command
	if (first === 'help' || first === '--help' || first === '-h') {
		const helpTopic =
			first === 'help' ? (filteredArgs[1] ?? 'overview') : 'overview'
		return {
			ok: true,
			value: { ...globals, command: 'help', helpTopic },
		}
	}

	// Version command
	if (first === '--version' || first === '-v') {
		return {
			ok: true,
			value: { ...globals, command: 'version' },
		}
	}

	// Watch subcommand
	if (first === 'watch') {
		return parseWatch(filteredArgs.slice(1), globals)
	}

	// Briefing subcommand
	if (first === 'briefing') {
		return parseBriefing(filteredArgs.slice(1), globals)
	}

	// Search command (default)
	return parseSearch(filteredArgs, globals)
}

/** Parse the default search command args. */
function parseSearch(args: string[], globals: GlobalFlags): ParseCliResult {
	let topic = ''
	let mock = false
	let emit = 'compact'
	let emitExplicit = false
	let sources = 'auto'
	let quick = false
	let deep = false
	let fast = false
	let cheap = false
	let includeWeb = false
	let includeYoutube = false
	let refresh = false
	let noCache = false
	let days = 30
	let outdir = ''
	let strategy = 'single'
	let phase2Budget = 5
	let queryType = 'auto'

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!
		if (arg === '--help' || arg === '-h') {
			return {
				ok: true,
				value: { ...globals, command: 'help', helpTopic: 'overview' },
			}
		}
		if (arg === '--mock') {
			mock = true
		} else if (arg.startsWith('--emit=')) {
			emit = arg.slice('--emit='.length)
			emitExplicit = true
		} else if (arg === '--emit') {
			const value = args[i + 1]
			if (value && !value.startsWith('-')) {
				emit = value
				emitExplicit = true
				i += 1
			}
		} else if (arg.startsWith('--sources=')) {
			sources = arg.slice('--sources='.length)
		} else if (arg === '--sources') {
			const value = args[i + 1]
			if (value && !value.startsWith('-')) {
				sources = value
				i += 1
			}
		} else if (arg.startsWith('--days=')) {
			days = parseDaysValue(arg.slice('--days='.length))
		} else if (arg === '--days') {
			const value = args[i + 1]
			if (!value || value.startsWith('-')) {
				days = Number.NaN
			} else {
				days = parseDaysValue(value)
				i += 1
			}
		} else if (arg === '--quick') {
			quick = true
		} else if (arg === '--deep') {
			deep = true
		} else if (arg === '--fast') {
			fast = true
		} else if (arg === '--cheap') {
			cheap = true
		} else if (arg === '--include-web') {
			includeWeb = true
		} else if (arg === '--include-youtube') {
			includeYoutube = true
		} else if (arg === '--refresh') {
			refresh = true
		} else if (arg === '--no-cache') {
			noCache = true
		} else if (arg.startsWith('--outdir=')) {
			outdir = arg.slice('--outdir='.length)
		} else if (arg === '--outdir') {
			const value = args[i + 1]
			if (value && !value.startsWith('-')) {
				outdir = value
				i += 1
			}
		} else if (arg.startsWith('--strategy=')) {
			strategy = arg.slice('--strategy='.length)
		} else if (arg === '--strategy') {
			const value = args[i + 1]
			if (value && !value.startsWith('-')) {
				strategy = value
				i += 1
			}
		} else if (arg.startsWith('--phase2-budget=')) {
			phase2Budget = Number(arg.slice('--phase2-budget='.length))
		} else if (arg === '--phase2-budget') {
			const value = args[i + 1]
			if (!value || value.startsWith('-')) {
				phase2Budget = Number.NaN
			} else {
				phase2Budget = Number(value)
				i += 1
			}
		} else if (arg.startsWith('--query-type=')) {
			queryType = arg.slice('--query-type='.length)
		} else if (arg === '--query-type') {
			const value = args[i + 1]
			if (value && !value.startsWith('-')) {
				queryType = value
				i += 1
			}
		} else if (arg.startsWith('--')) {
			return {
				ok: false,
				error: new CliError(`Unknown flag: ${arg}`, {
					exitCode: EXIT_USAGE,
					code: 'UNKNOWN_FLAG',
				}),
			}
		} else if (!arg.startsWith('-')) {
			topic = topic ? `${topic} ${arg}` : arg
		} else {
			return {
				ok: false,
				error: new CliError(`Unknown flag: ${arg}`, {
					exitCode: EXIT_USAGE,
					code: 'UNKNOWN_FLAG',
				}),
			}
		}
	}

	// Validation
	const validEmits = ['compact', 'json', 'md', 'context', 'path']
	if (!validEmits.includes(emit)) {
		return {
			ok: false,
			error: new CliError(
				`Invalid --emit value: "${emit}". Valid: ${validEmits.join(', ')}`,
				{ exitCode: EXIT_USAGE, code: 'INVALID_EMIT' },
			),
		}
	}

	const validSources = ['auto', 'reddit', 'x', 'both', 'web']
	if (!validSources.includes(sources)) {
		return {
			ok: false,
			error: new CliError(
				`Invalid --sources value: "${sources}". Valid: ${validSources.join(', ')}`,
				{ exitCode: EXIT_USAGE, code: 'INVALID_SOURCES' },
			),
		}
	}

	const validStrategies = ['single', 'two-phase']
	if (!validStrategies.includes(strategy)) {
		return {
			ok: false,
			error: new CliError(
				`Invalid --strategy value: "${strategy}". Valid: ${validStrategies.join(', ')}`,
				{ exitCode: EXIT_USAGE, code: 'INVALID_STRATEGY' },
			),
		}
	}

	if (
		!Number.isInteger(phase2Budget) ||
		phase2Budget < 1 ||
		phase2Budget > 50
	) {
		return {
			ok: false,
			error: new CliError(
				'--phase2-budget must be an integer between 1 and 50.',
				{ exitCode: EXIT_USAGE, code: 'INVALID_BUDGET' },
			),
		}
	}

	const validQueryTypes = [
		'auto',
		'prompting',
		'recommendations',
		'news',
		'general',
	]
	if (!validQueryTypes.includes(queryType)) {
		return {
			ok: false,
			error: new CliError(
				`Invalid --query-type value: "${queryType}". Valid: ${validQueryTypes.join(', ')}`,
				{ exitCode: EXIT_USAGE, code: 'INVALID_QUERY_TYPE' },
			),
		}
	}

	return {
		ok: true,
		value: {
			...globals,
			command: 'search',
			topic,
			mock,
			emit,
			emitExplicit,
			sources,
			quick,
			deep,
			fast,
			cheap,
			includeWeb,
			includeYoutube,
			refresh,
			noCache,
			days,
			outdir,
			strategy,
			phase2Budget,
			queryType,
		},
	}
}
