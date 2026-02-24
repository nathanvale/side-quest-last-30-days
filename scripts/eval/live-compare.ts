#!/usr/bin/env bun
/**
 * Live comparison harness for current vs legacy implementations.
 *
 * Runs repeated live (or mock) CLI executions across topics for Reddit/X,
 * captures reliability + coverage metrics, and writes graph-ready artifacts.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { dedupeReddit } from '../../src/lib/dedupe.js'
import {
	filterByDateRange,
	normalizeRedditItems,
} from '../../src/lib/normalize.js'
import { parseRedditResponse } from '../../src/lib/openai-reddit.js'
import type { RedditItem } from '../../src/lib/schema.js'
import { scoreRedditItems, sortItems } from '../../src/lib/score.js'

type SourceMode = 'reddit' | 'x'

type TopicSpec = {
	topic: string
}

type CliArgs = {
	legacyPath: string
	outPath: string
	csvPath: string
	topics: TopicSpec[]
	sources: SourceMode[]
	repeats: number
	days: number
	minCount: number
	refresh: boolean
	mock: boolean
	timeoutMs: number
}

type RunRecord = {
	topic: string
	source: SourceMode
	repeat: number
	impl: 'current' | 'legacy'
	exit_code: number
	parsed: boolean
	success: boolean
	count: number
	error: string | null
	quota_error: boolean
	stages: StageCounts | null
	stage_error: string | null
}

type StageCounts = {
	parse_count: number
	enrich_count: number
	normalize_count: number
	date_filtered_count: number
	scored_count: number
	deduped_count: number
	final_report_count: number
}

type Aggregate = {
	impl: 'current' | 'legacy'
	source: SourceMode
	runs_total: number
	success_rate: number
	parsed_rate: number
	median_count: number
	sufficient_data_rate: number
	quota_error_rate: number
	filter_zero_rate: number
}

const DEFAULT_TOPICS: TopicSpec[] = [
	{ topic: 'Bun 1.3 features' },
	{ topic: 'Node.js 24/25 release changes' },
	{ topic: 'React Server Components security fixes' },
]

function parseArgs(argv: string[]): CliArgs {
	const map = new Map<string, string>()
	for (const arg of argv) {
		if (!arg.startsWith('--')) continue
		const [k, v] = arg.slice(2).split('=', 2)
		if (!k || v == null) continue
		map.set(k, v)
	}

	const repeats = Number(map.get('repeats') ?? '2')
	const days = Number(map.get('days') ?? '30')
	const minCount = Number(map.get('minCount') ?? '5')
	const refresh = argv.includes('--refresh')
	const mock = argv.includes('--mock')
	const timeoutMs = Number(map.get('timeoutMs') ?? '120000')

	const sources = (map.get('sources') ?? 'reddit,x')
		.split(',')
		.map((s) => s.trim())
		.filter((s): s is SourceMode => s === 'reddit' || s === 'x')

	const topicsArg = map.get('topics')
	const topics = topicsArg
		? topicsArg
				.split('|')
				.map((t) => t.trim())
				.filter((t) => t.length > 0)
				.map((topic) => ({ topic }))
		: DEFAULT_TOPICS

	return {
		legacyPath: resolve(
			map.get('legacy') ?? '/Users/nathanvale/code/last30days',
		),
		outPath: resolve(map.get('out') ?? 'reports/live-compare.json'),
		csvPath: resolve(map.get('csv') ?? 'reports/live-compare-runs.csv'),
		topics,
		sources: sources.length > 0 ? sources : ['reddit', 'x'],
		repeats: Number.isInteger(repeats) && repeats > 0 ? repeats : 2,
		days: Number.isInteger(days) && days > 0 ? days : 30,
		minCount: Number.isInteger(minCount) && minCount > 0 ? minCount : 5,
		refresh,
		mock,
		timeoutMs:
			Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120_000,
	}
}

function extractFirstJsonObject(text: string): string | null {
	const start = text.indexOf('{')
	if (start === -1) return null
	let depth = 0
	let inString = false
	let escaped = false
	for (let i = start; i < text.length; i++) {
		const ch = text[i]!
		if (inString) {
			if (escaped) {
				escaped = false
				continue
			}
			if (ch === '\\') {
				escaped = true
				continue
			}
			if (ch === '"') inString = false
			continue
		}
		if (ch === '"') {
			inString = true
			continue
		}
		if (ch === '{') depth++
		if (ch === '}') {
			depth--
			if (depth === 0) {
				return text.slice(start, i + 1)
			}
		}
	}
	return null
}

function parseReport(stdout: string): Record<string, unknown> | null {
	const payload = extractFirstJsonObject(stdout)
	if (!payload) return null
	try {
		return JSON.parse(payload) as Record<string, unknown>
	} catch {
		return null
	}
}

function median(values: number[]): number {
	if (values.length === 0) return 0
	const sorted = [...values].sort((a, b) => a - b)
	const m = Math.floor(sorted.length / 2)
	return sorted.length % 2 === 0
		? (sorted[m - 1]! + sorted[m]!) / 2
		: sorted[m]!
}

function runOne(
	args: CliArgs,
	topic: string,
	source: SourceMode,
	repeat: number,
	impl: 'current' | 'legacy',
): RunRecord {
	const cmd =
		impl === 'current'
			? [
					'bun',
					'run',
					join(process.cwd(), 'src', 'cli.ts'),
					topic,
					'--emit=json',
					`--sources=${source}`,
					`--days=${args.days}`,
					...(args.refresh ? ['--refresh'] : []),
					...(args.mock ? ['--mock'] : []),
				]
			: [
					'python3',
					join(args.legacyPath, 'scripts', 'last30days.py'),
					topic,
					'--emit=json',
					`--sources=${source}`,
					...(args.mock ? ['--mock'] : []),
				]

	const result = Bun.spawnSync(cmd, {
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: args.timeoutMs,
	})
	const stdout = result.stdout.toString()
	const parsed = parseReport(stdout)
	const report = parsed ?? {}

	const count = Array.isArray(report[source]) ? report[source].length : 0
	const errorKey = source === 'reddit' ? 'reddit_error' : 'x_error'
	const errorRaw = report[errorKey]
	const error =
		typeof errorRaw === 'string' && errorRaw.length > 0 ? errorRaw : null
	const quotaError = Boolean(
		error &&
			/(quota|billing|non-retryable 429|insufficient_quota|hard_limit)/i.test(
				error,
			),
	)

	let stages: StageCounts | null = null
	let stageError: string | null = null
	if (source === 'reddit') {
		try {
			stages = computeRedditStageCounts(impl, report, result.stderr.toString())
		} catch (e) {
			stageError = e instanceof Error ? e.message : String(e)
		}
	}

	return {
		topic,
		source,
		repeat,
		impl,
		exit_code: result.exitCode,
		parsed: parsed !== null,
		success: result.exitCode === 0 && parsed !== null,
		count,
		error,
		quota_error: quotaError,
		stages,
		stage_error: stageError,
	}
}

function aggregate(records: RunRecord[], minCount: number): Aggregate[] {
	const groups = new Map<string, RunRecord[]>()
	for (const r of records) {
		const key = `${r.impl}|${r.source}`
		const arr = groups.get(key) ?? []
		arr.push(r)
		groups.set(key, arr)
	}

	const result: Aggregate[] = []
	for (const [key, rows] of groups) {
		const [impl, source] = key.split('|') as ['current' | 'legacy', SourceMode]
		const total = rows.length
		const success = rows.filter((r) => r.success).length
		const parsed = rows.filter((r) => r.parsed).length
		const counts = rows.map((r) => r.count)
		const sufficient = rows.filter((r) => r.count >= minCount).length
		const quota = rows.filter((r) => r.quota_error).length
		const filterZeroRows = rows.filter((r) => {
			if (!r.stages) return false
			return r.stages.parse_count > 0 && r.stages.date_filtered_count === 0
		}).length
		result.push({
			impl,
			source,
			runs_total: total,
			success_rate: total > 0 ? success / total : 0,
			parsed_rate: total > 0 ? parsed / total : 0,
			median_count: median(counts),
			sufficient_data_rate: total > 0 ? sufficient / total : 0,
			quota_error_rate: total > 0 ? quota / total : 0,
			filter_zero_rate: total > 0 ? filterZeroRows / total : 0,
		})
	}
	return result.sort((a, b) =>
		`${a.source}-${a.impl}`.localeCompare(`${b.source}-${b.impl}`),
	)
}

function toCsv(records: RunRecord[]): string {
	const head =
		'topic,source,repeat,impl,exit_code,parsed,success,count,error,quota_error,parse_count,enrich_count,normalize_count,date_filtered_count,scored_count,deduped_count,final_report_count,stage_error'
	const rows = records.map((r) =>
		[
			r.topic,
			r.source,
			r.repeat,
			r.impl,
			r.exit_code,
			r.parsed,
			r.success,
			r.count,
			`"${(r.error ?? '').replace(/"/g, '""')}"`,
			r.quota_error,
			r.stages?.parse_count ?? '',
			r.stages?.enrich_count ?? '',
			r.stages?.normalize_count ?? '',
			r.stages?.date_filtered_count ?? '',
			r.stages?.scored_count ?? '',
			r.stages?.deduped_count ?? '',
			r.stages?.final_report_count ?? '',
			`"${(r.stage_error ?? '').replace(/"/g, '""')}"`,
		].join(','),
	)
	return [head, ...rows].join('\n') + '\n'
}

function extractFoundThreads(stderr: string): number | null {
	const match = stderr.match(/Found\s+(\d+)\s+threads/i)
	if (!match) return null
	const n = Number(match[1])
	return Number.isInteger(n) ? n : null
}

function computeCurrentRedditStageCounts(
	report: Record<string, unknown>,
	foundThreads: number | null,
): StageCounts {
	const base = join(homedir(), '.local', 'share', 'last-30-days', 'out')
	const raw = JSON.parse(
		readFileSync(join(base, 'raw_openai.json'), 'utf-8'),
	) as Record<string, unknown>
	const enriched = JSON.parse(
		readFileSync(join(base, 'raw_reddit_threads_enriched.json'), 'utf-8'),
	) as Record<string, unknown>[]

	const range = report.range as Record<string, unknown> | undefined
	const from = String(range?.from ?? '')
	const to = String(range?.to ?? '')
	const days = Number(report.days ?? 30)

	const parsedItems = parseRedditResponse(raw)
	const normalized = normalizeRedditItems(enriched, from, to)
	const filtered = filterByDateRange(normalized, from, to)
	const scored = scoreRedditItems(filtered, days)
	const deduped = dedupeReddit(sortItems(scored) as RedditItem[])
	const finalCount = Array.isArray(report.reddit)
		? (report.reddit as unknown[]).length
		: deduped.length

	return {
		parse_count: foundThreads ?? parsedItems.length,
		enrich_count: enriched.length,
		normalize_count: normalized.length,
		date_filtered_count: filtered.length,
		scored_count: scored.length,
		deduped_count: deduped.length,
		final_report_count: finalCount,
	}
}

function computeLegacyRedditStageCounts(
	report: Record<string, unknown>,
	foundThreads: number | null,
): StageCounts {
	const base = join(homedir(), '.local', 'share', 'last30days', 'out')
	const enriched = JSON.parse(
		readFileSync(join(base, 'raw_reddit_threads_enriched.json'), 'utf-8'),
	) as Record<string, unknown>[]
	const range = report.range as Record<string, unknown> | undefined
	const from = String(range?.from ?? '')
	const to = String(range?.to ?? '')
	const finalCount = Array.isArray(report.reddit)
		? (report.reddit as unknown[]).length
		: 0

	let nullOrOut = 0
	for (const item of enriched) {
		const d = item.date
		if (typeof d !== 'string' || d.length === 0 || d < from || d > to) {
			nullOrOut += 1
		}
	}
	const inRange = enriched.length - nullOrOut

	return {
		parse_count: foundThreads ?? enriched.length,
		enrich_count: enriched.length,
		normalize_count: enriched.length,
		date_filtered_count: inRange,
		scored_count: inRange,
		deduped_count: finalCount,
		final_report_count: finalCount,
	}
}

function computeRedditStageCounts(
	impl: 'current' | 'legacy',
	report: Record<string, unknown>,
	stderr: string,
): StageCounts {
	const foundThreads = extractFoundThreads(stderr)
	return impl === 'current'
		? computeCurrentRedditStageCounts(report, foundThreads)
		: computeLegacyRedditStageCounts(report, foundThreads)
}

const args = parseArgs(process.argv.slice(2))
const records: RunRecord[] = []

for (const { topic } of args.topics) {
	for (const source of args.sources) {
		for (let i = 1; i <= args.repeats; i++) {
			records.push(runOne(args, topic, source, i, 'current'))
			records.push(runOne(args, topic, source, i, 'legacy'))
		}
	}
}

const summary = aggregate(records, args.minCount)

const out = {
	meta: {
		generated_at: new Date().toISOString(),
		legacy_path: args.legacyPath,
		repeats: args.repeats,
		days: args.days,
		min_count: args.minCount,
		timeout_ms: args.timeoutMs,
		refresh: args.refresh,
		mock: args.mock,
		sources: args.sources,
		topics: args.topics.map((t) => t.topic),
	},
	summary,
	records,
}

mkdirSync(resolve(join(args.outPath, '..')), { recursive: true })
mkdirSync(resolve(join(args.csvPath, '..')), { recursive: true })
writeFileSync(args.outPath, `${JSON.stringify(out, null, 2)}\n`)
writeFileSync(args.csvPath, toCsv(records))

process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
