#!/usr/bin/env bun
/**
 * Reliability matrix runner for baseline lock decisions.
 *
 * Executes 10 topics x 3 repeats in chunked mode (per-topic eval:live runs),
 * merges records, and computes lock gates.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

type TopicFixture = { topic: string; category: string }
type SummaryRow = {
	impl: 'current' | 'legacy'
	source: 'reddit' | 'x'
	runs_total: number
	success_rate: number
	parsed_rate: number
	median_count: number
	sufficient_data_rate: number
	quota_error_rate: number
	filter_zero_rate: number
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
type RecordRow = {
	topic: string
	source: 'reddit' | 'x'
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

const now = new Date()
const stamp = now.toISOString().replace(/[:.]/g, '-')

const argMap = new Map<string, string>()
for (const arg of process.argv.slice(2)) {
	if (!arg.startsWith('--')) continue
	const [k, v] = arg.slice(2).split('=', 2)
	if (!k || v == null) continue
	argMap.set(k, v)
}
const repeatsArg = Number(argMap.get('repeats') ?? '3')
const topicLimitArg = Number(argMap.get('topicLimit') ?? '10')
const timeoutMsArg = Number(argMap.get('timeoutMs') ?? '60000')
const repeats = Number.isInteger(repeatsArg) && repeatsArg > 0 ? repeatsArg : 3
const topicLimit =
	Number.isInteger(topicLimitArg) && topicLimitArg > 0 ? topicLimitArg : 10
const timeoutMs =
	Number.isInteger(timeoutMsArg) && timeoutMsArg > 0 ? timeoutMsArg : 60000

const topicsPath = resolve('fixtures/eval/topics.json')
const reportsDir = resolve('reports')
const outPath = resolve(join(reportsDir, `live-compare.matrix-${stamp}.json`))
const csvPath = resolve(join(reportsDir, `live-compare.matrix-${stamp}.csv`))
const assessmentPath = resolve(
	join(reportsDir, `live-compare.matrix-${stamp}.assessment.json`),
)
const partialPath = resolve(
	join(reportsDir, `live-compare.matrix-${stamp}.partial.json`),
)

const topicsAll = JSON.parse(
	readFileSync(topicsPath, 'utf-8'),
) as TopicFixture[]
const topics = topicsAll.slice(0, topicLimit)
mkdirSync(reportsDir, { recursive: true })

const allRecords: RecordRow[] = []
const topicOutputs: string[] = []
const topicFailures: Array<{ topic: string; error: string }> = []

for (let i = 0; i < topics.length; i++) {
	const topic = topics[i]!.topic
	process.stderr.write(`[matrix] topic ${i + 1}/${topics.length}: ${topic}\n`)
	const topicSlug = `topic-${String(i + 1).padStart(2, '0')}`
	const topicOut = resolve(
		join(reportsDir, `live-compare.matrix-${stamp}.${topicSlug}.json`),
	)
	const topicCsv = resolve(
		join(reportsDir, `live-compare.matrix-${stamp}.${topicSlug}.csv`),
	)
	topicOutputs.push(topicOut)

	const cmd = [
		'bun',
		'run',
		resolve('scripts/eval/live-compare.ts'),
		`--repeats=${repeats}`,
		'--sources=reddit,x',
		`--topics=${topic}`,
		'--days=30',
		'--minCount=5',
		'--refresh',
		`--timeoutMs=${timeoutMs}`,
		`--out=${topicOut}`,
		`--csv=${topicCsv}`,
	]

	const run = Bun.spawnSync(cmd, {
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: 900_000,
	})

	if (run.exitCode !== 0) {
		process.stderr.write(
			`[matrix] fail topic ${i + 1}/${topics.length}: ${topic}\n`,
		)
		topicFailures.push({
			topic,
			error: run.stderr.toString().slice(0, 1200),
		})
		continue
	}
	process.stderr.write(
		`[matrix] done topic ${i + 1}/${topics.length}: ${topic}\n`,
	)

	const payload = JSON.parse(readFileSync(topicOut, 'utf-8')) as {
		records: RecordRow[]
	}
	allRecords.push(...payload.records)

	writeFileSync(
		partialPath,
		`${JSON.stringify(
			{
				generated_at: new Date().toISOString(),
				topics_total: topicsAll.length,
				topics_selected: topics.length,
				topics_completed: i + 1,
				topic_failures: topicFailures,
				records_total: allRecords.length,
				topic_outputs: topicOutputs,
			},
			null,
			2,
		)}\n`,
	)
}

function median(values: number[]): number {
	if (values.length === 0) return 0
	const sorted = [...values].sort((a, b) => a - b)
	const m = Math.floor(sorted.length / 2)
	return sorted.length % 2 === 0
		? (sorted[m - 1]! + sorted[m]!) / 2
		: sorted[m]!
}

function aggregate(records: RecordRow[]): SummaryRow[] {
	const groups = new Map<string, RecordRow[]>()
	for (const r of records) {
		const key = `${r.impl}|${r.source}`
		const arr = groups.get(key) ?? []
		arr.push(r)
		groups.set(key, arr)
	}

	const rows: SummaryRow[] = []
	for (const [key, values] of groups) {
		const [impl, source] = key.split('|') as [
			'current' | 'legacy',
			'reddit' | 'x',
		]
		const total = values.length
		const success = values.filter((r) => r.success).length
		const parsed = values.filter((r) => r.parsed).length
		const sufficient = values.filter((r) => r.count >= 5).length
		const quota = values.filter((r) => r.quota_error).length
		const filterZero = values.filter(
			(r) =>
				r.stages &&
				r.stages.parse_count > 0 &&
				r.stages.date_filtered_count === 0,
		).length
		rows.push({
			impl,
			source,
			runs_total: total,
			success_rate: total > 0 ? success / total : 0,
			parsed_rate: total > 0 ? parsed / total : 0,
			median_count: median(values.map((r) => r.count)),
			sufficient_data_rate: total > 0 ? sufficient / total : 0,
			quota_error_rate: total > 0 ? quota / total : 0,
			filter_zero_rate: total > 0 ? filterZero / total : 0,
		})
	}
	return rows.sort((a, b) =>
		`${a.source}-${a.impl}`.localeCompare(`${b.source}-${b.impl}`),
	)
}

function getSummary(
	summary: SummaryRow[],
	impl: 'current' | 'legacy',
	source: 'reddit' | 'x',
): SummaryRow | null {
	return summary.find((r) => r.impl === impl && r.source === source) ?? null
}

function catastrophicZeroRate(
	records: RecordRow[],
	impl: 'current' | 'legacy',
	source: 'reddit' | 'x',
): number {
	const rows = records.filter((r) => r.impl === impl && r.source === source)
	if (rows.length === 0) return 0
	return rows.filter((r) => r.count === 0).length / rows.length
}

const summary = aggregate(allRecords)
const cReddit = getSummary(summary, 'current', 'reddit')
const lReddit = getSummary(summary, 'legacy', 'reddit')
const cX = getSummary(summary, 'current', 'x')
const lX = getSummary(summary, 'legacy', 'x')

const gates = {
	reddit_median_non_regression:
		(cReddit?.median_count ?? 0) >= (lReddit?.median_count ?? 0),
	reddit_catastrophic_zero_rate_le_20pct:
		catastrophicZeroRate(allRecords, 'current', 'reddit') <= 0.2,
	reddit_filter_collapse_rate_le_40pct: (cReddit?.filter_zero_rate ?? 1) <= 0.4,
	x_median_comparable_ge_80pct:
		(cX?.median_count ?? 0) >= (lX?.median_count ?? 0) * 0.8,
}

const matrix = {
	meta: {
		generated_at: now.toISOString(),
		topics_path: topicsPath,
		topics_total: topicsAll.length,
		topics_selected: topics.length,
		topics_completed: topics.length - topicFailures.length,
		repeats,
		sources: ['reddit', 'x'],
		topic_outputs: topicOutputs,
		topic_failures: topicFailures,
	},
	summary,
	records: allRecords,
}

const assessment = {
	generated_at: now.toISOString(),
	artifacts: { out_json: outPath, out_csv: csvPath, partial: partialPath },
	gates,
	metrics: {
		current_reddit: cReddit,
		legacy_reddit: lReddit,
		current_x: cX,
		legacy_x: lX,
		catastrophic_zero_rate: {
			current_reddit: catastrophicZeroRate(allRecords, 'current', 'reddit'),
			legacy_reddit: catastrophicZeroRate(allRecords, 'legacy', 'reddit'),
		},
	},
	pass: Object.values(gates).every(Boolean),
	topics_completed: topics.length - topicFailures.length,
	topics_total: topicsAll.length,
	topics_selected: topics.length,
}

function toCsv(records: RecordRow[]): string {
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

writeFileSync(outPath, `${JSON.stringify(matrix, null, 2)}\n`)
writeFileSync(csvPath, toCsv(allRecords))
writeFileSync(assessmentPath, `${JSON.stringify(assessment, null, 2)}\n`)

process.stdout.write(`${JSON.stringify(assessment, null, 2)}\n`)
