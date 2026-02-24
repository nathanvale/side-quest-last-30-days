/**
 * Tri-modal output contract for the wots CLI.
 *
 * Routes output to one of three modes:
 * 1. `--json` - JSON envelope on stdout: `{ status: 'data', data: {...} }`
 * 2. `--jsonl` - One JSON line per item + a meta line on stdout
 * 3. Default - Human-readable output (compact, md, context, path, json dict)
 */

import { CliError, errorToEnvelope } from './cli-error.js'
import { projectFields } from './field-projection.js'
import type { SearchCommand } from './parse-args.js'
import type { Report } from './schema.js'
import { reportToDict } from './schema.js'

const SCHEMA_VERSION = '1'

/** Output context resolved from parsed flags. */
export interface OutputContext {
	json: boolean
	jsonl: boolean
	quiet: boolean
	fields: string[]
}

/** JSON envelope wrapper for success responses. */
export interface DataEnvelope {
	status: 'data'
	schema_version: string
	data: Record<string, unknown>
}

/** JSON envelope wrapper for error responses. */
export interface ErrorEnvelope {
	status: 'error'
	schema_version: string
	message: string
	error: { name: string; code: string }
}

/**
 * Wrap an arbitrary data payload in a JSON data envelope.
 *
 * @param data - Data to wrap.
 * @returns A `{ status: 'data', schema_version, data }` envelope.
 */
export function wrapData(data: Record<string, unknown>): DataEnvelope {
	return { status: 'data', schema_version: SCHEMA_VERSION, data }
}

/**
 * Wrap a report dict in a JSON data envelope.
 *
 * @param report  - The report to wrap.
 * @param extras  - Additional top-level fields to merge into data.
 * @returns A `{ status: 'data', data: {...} }` envelope.
 */
export function wrapReport(
	report: Report,
	extras?: Record<string, unknown>,
): DataEnvelope {
	const data = reportToDict(report) as Record<string, unknown>
	if (extras) Object.assign(data, extras)
	return wrapData(data)
}

/**
 * Convert a report to JSONL format (one line per item + meta line).
 *
 * Each item line: `{ source: 'reddit'|'x'|'youtube', ...item }`
 * Final meta line: `{ status: 'meta', topic, days, range, generated_at }`
 *
 * @param report - The report to serialize.
 * @param fields - Optional field projection for JSONL items.
 * @returns An array of JSON strings (one per line).
 */
export function reportToJsonl(report: Report, fields: string[] = []): string[] {
	const lines: string[] = []
	const hasFields = fields.length > 0
	const pushItem = (source: string, item: Record<string, unknown>) => {
		const payload = hasFields ? projectFields(item, fields) : item
		lines.push(JSON.stringify({ source, ...payload }))
	}

	for (const item of report.reddit) {
		pushItem('reddit', item as unknown as Record<string, unknown>)
	}
	for (const item of report.x) {
		pushItem('x', item as unknown as Record<string, unknown>)
	}
	for (const item of report.youtube) {
		pushItem('youtube', item as unknown as Record<string, unknown>)
	}

	// Meta line
	lines.push(
		JSON.stringify({
			status: 'meta',
			topic: report.topic,
			days: report.days,
			range: { from: report.range_from, to: report.range_to },
			generated_at: report.generated_at,
			mode: report.mode,
			reddit_count: report.reddit.length,
			x_count: report.x.length,
			youtube_count: report.youtube.length,
			...(report.reddit_error ? { reddit_error: report.reddit_error } : {}),
			...(report.x_error ? { x_error: report.x_error } : {}),
			...(report.youtube_error ? { youtube_error: report.youtube_error } : {}),
		}),
	)

	return lines
}

/**
 * Resolve output args without mutating parsed CLI arguments.
 *
 * Mirrors agent auto-detection: when stdout is non-TTY (or non-interactive),
 * default compact output flips to JSON + quiet for agent consumption.
 *
 * @param args        - Parsed search command.
 * @param stdoutIsTTY - Whether stdout is a TTY.
 * @returns Output args with auto-detection applied.
 */
export function resolveOutputArgs(
	args: SearchCommand,
	stdoutIsTTY: boolean,
): SearchCommand {
	const outputArgs = { ...args }
	if (
		!args.json &&
		!args.jsonl &&
		args.emit === 'compact' &&
		!args.emitExplicit &&
		(args.nonInteractive || !stdoutIsTTY)
	) {
		outputArgs.json = true
		outputArgs.quiet = true
	}
	return outputArgs
}

/**
 * Resolve error output context from raw args without relying on parser success.
 *
 * Mirrors auto-detection: when stdout is non-TTY (or non-interactive) and no
 * explicit JSON/JSONL flags are present, default compact output flips to JSON.
 *
 * @param rawArgs     - Raw CLI args (excluding node/bun).
 * @param stdoutIsTTY - Whether stdout is a TTY.
 * @returns Output context for error rendering.
 */
export function resolveErrorContext(
	rawArgs: string[],
	stdoutIsTTY: boolean,
): { json: boolean; jsonl: boolean; quiet: boolean; fields: string[] } {
	const json = rawArgs.includes('--json')
	const jsonl = rawArgs.includes('--jsonl')
	if (json || jsonl) {
		return { json, jsonl, quiet: false, fields: [] }
	}

	let emit = 'compact'
	let emitExplicit = false
	let nonInteractive = false
	for (let i = 0; i < rawArgs.length; i++) {
		const arg = rawArgs[i]!
		if (arg === '--non-interactive') {
			nonInteractive = true
		} else if (arg.startsWith('--emit=')) {
			emit = arg.slice('--emit='.length)
			emitExplicit = true
		} else if (arg === '--emit') {
			const value = rawArgs[i + 1]
			if (value && !value.startsWith('-')) {
				emit = value
				emitExplicit = true
				i += 1
			}
		}
	}

	const autoJson =
		emit === 'compact' && !emitExplicit && (nonInteractive || !stdoutIsTTY)
	return { json: autoJson, jsonl: false, quiet: false, fields: [] }
}

/**
 * Write an error to stderr, formatted for the output mode.
 *
 * - JSON/JSONL mode: writes `ErrorEnvelope` JSON to stdout and stderr
 * - Human mode: writes plain-text `Error: ...` to stderr
 *
 * @param ctx - Output context (json/jsonl flags).
 * @param err - The error to write.
 */
export function writeError(ctx: OutputContext, err: unknown): void {
	if (ctx.json || ctx.jsonl) {
		if (err instanceof CliError) {
			const envelope: ErrorEnvelope = {
				...errorToEnvelope(err),
				schema_version: SCHEMA_VERSION,
			}
			const payload = `${JSON.stringify(envelope)}\n`
			process.stdout.write(payload)
			process.stderr.write(payload)
		} else {
			const envelope: ErrorEnvelope = {
				status: 'error',
				schema_version: SCHEMA_VERSION,
				message: String(err),
				error: { name: 'Error', code: 'RUNTIME_ERROR' },
			}
			const payload = `${JSON.stringify(envelope)}\n`
			process.stdout.write(payload)
			process.stderr.write(payload)
		}
	} else {
		const message = err instanceof CliError ? err.message : String(err)
		process.stderr.write(`Error: ${message}\n`)
	}
}
