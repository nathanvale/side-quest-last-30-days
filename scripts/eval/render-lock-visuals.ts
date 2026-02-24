#!/usr/bin/env bun
/**
 * Render visual markdown report from matrix + assessment artifacts.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Assessment = {
	generated_at: string
	artifacts: { out_json: string; out_csv: string; partial: string }
	gates: Record<string, boolean>
	metrics: {
		current_reddit: SummaryRow
		legacy_reddit: SummaryRow
		current_x: SummaryRow
		legacy_x: SummaryRow
		catastrophic_zero_rate: {
			current_reddit: number
			legacy_reddit: number
		}
	}
	pass: boolean
	topics_completed: number
	topics_total: number
	topics_selected?: number
}

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

type Matrix = {
	meta: {
		generated_at: string
		topics: string[]
	}
	summary: SummaryRow[]
	records: Array<{
		topic: string
		source: 'reddit' | 'x'
		impl: 'current' | 'legacy'
		count: number
	}>
}

function parseArgs(argv: string[]): {
	matrix: string | null
	assessment: string | null
	out: string
} {
	let matrix: string | null = null
	let assessment: string | null = null
	let out = 'reports/lock-metrics-visuals.md'

	for (const arg of argv) {
		if (arg.startsWith('--matrix=')) matrix = arg.slice('--matrix='.length)
		else if (arg.startsWith('--assessment=')) {
			assessment = arg.slice('--assessment='.length)
		} else if (arg.startsWith('--out=')) out = arg.slice('--out='.length)
	}
	return { matrix, assessment, out }
}

function latestReportFile(
	suffix: string,
	opts?: { exclude?: string[]; require?: string[] },
): string {
	const dir = resolve('reports')
	const files = readdirSync(dir)
		.filter((name) => name.startsWith('live-compare.matrix-'))
		.filter((name) => name.endsWith(suffix))
		.filter((name) => !name.includes('.topic-'))
		.filter((name) =>
			(opts?.exclude ?? []).every((needle) => !name.includes(needle)),
		)
		.filter((name) =>
			(opts?.require ?? []).every((needle) => name.includes(needle)),
		)
		.sort()
	if (files.length === 0) {
		throw new Error(`No report files found for suffix: ${suffix}`)
	}
	return resolve(dir, files[files.length - 1]!)
}

function shortTopic(topic: string): string {
	return topic.length > 18 ? `${topic.slice(0, 17)}…` : topic
}

function loadRecentAssessments(limit: number): Assessment[] {
	const dir = resolve('reports')
	const files = readdirSync(dir)
		.filter((name) => name.startsWith('live-compare.matrix-'))
		.filter((name) => name.endsWith('.assessment.json'))
		.sort()
	const recent = files.slice(-limit)
	return recent.map(
		(name) =>
			JSON.parse(readFileSync(resolve(dir, name), 'utf-8')) as Assessment,
	)
}

function runLabel(ts: string): string {
	const d = new Date(ts)
	if (Number.isNaN(d.getTime())) return ts
	const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
	const dd = String(d.getUTCDate()).padStart(2, '0')
	const hh = String(d.getUTCHours()).padStart(2, '0')
	const mi = String(d.getUTCMinutes()).padStart(2, '0')
	return `${mm}-${dd} ${hh}:${mi}Z`
}

const args = parseArgs(process.argv.slice(2))
const matrixPath = resolve(
	args.matrix ??
		latestReportFile('.json', {
			exclude: ['.assessment.json', '.partial.json'],
		}),
)
const assessmentPath = resolve(
	args.assessment ??
		latestReportFile('.assessment.json', { require: ['.assessment.json'] }),
)
const outPath = resolve(args.out)

const matrix = JSON.parse(readFileSync(matrixPath, 'utf-8')) as Matrix
const assessment = JSON.parse(
	readFileSync(assessmentPath, 'utf-8'),
) as Assessment

const topics = [...new Set(matrix.records.map((r) => r.topic))]
const topicCounts = topics.map((topic) => {
	const cr = matrix.records
		.filter(
			(r) => r.topic === topic && r.source === 'reddit' && r.impl === 'current',
		)
		.reduce((sum, r) => sum + r.count, 0)
	const lr = matrix.records
		.filter(
			(r) => r.topic === topic && r.source === 'reddit' && r.impl === 'legacy',
		)
		.reduce((sum, r) => sum + r.count, 0)
	return { topic, current: cr, legacy: lr }
})

const gates = assessment.gates
const cr = assessment.metrics.current_reddit
const lr = assessment.metrics.legacy_reddit
const cx = assessment.metrics.current_x
const lx = assessment.metrics.legacy_x

const maxTopicCount = Math.max(
	1,
	...topicCounts.map((t) => Math.max(t.current, t.legacy)),
)
const trend = loadRecentAssessments(7)
const trendLabels = trend.map((a) => `"${runLabel(a.generated_at)}"`).join(', ')
const trendPass = trend.map((a) => (a.pass ? 1 : 0)).join(',')
const trendCurrentRedditMedian = trend
	.map((a) => a.metrics.current_reddit?.median_count ?? 0)
	.join(',')
const trendLegacyRedditMedian = trend
	.map((a) => a.metrics.legacy_reddit?.median_count ?? 0)
	.join(',')
const trendCurrentXMedian = trend
	.map((a) => a.metrics.current_x?.median_count ?? 0)
	.join(',')
const trendLegacyXMedian = trend
	.map((a) => a.metrics.legacy_x?.median_count ?? 0)
	.join(',')

const content = `# Lock Metrics Visuals

Data:
- Matrix: \`${matrixPath}\`
- Assessment: \`${assessmentPath}\`

## Gate Status

- ${gates.reddit_median_non_regression ? '✅' : '❌'} \`reddit_median_non_regression\`
- ${gates.reddit_catastrophic_zero_rate_le_20pct ? '✅' : '❌'} \`reddit_catastrophic_zero_rate_le_20pct\`
- ${gates.reddit_filter_collapse_rate_le_40pct ? '✅' : '❌'} \`reddit_filter_collapse_rate_le_40pct\`
- ${gates.x_median_comparable_ge_80pct ? '✅' : '❌'} \`x_median_comparable_ge_80pct\`

## Gate Chart

\`\`\`mermaid
xychart-beta
    title "Gate Results (1=pass, 0=fail)"
    x-axis [reddit_median, reddit_zero_rate, reddit_filter, x_comparable]
    y-axis "pass" 0 --> 1
    bar [${gates.reddit_median_non_regression ? 1 : 0},${gates.reddit_catastrophic_zero_rate_le_20pct ? 1 : 0},${gates.reddit_filter_collapse_rate_le_40pct ? 1 : 0},${gates.x_median_comparable_ge_80pct ? 1 : 0}]
\`\`\`

## Core Metrics (Current vs Legacy)

| Metric | Current Reddit | Legacy Reddit | Current X | Legacy X |
|---|---:|---:|---:|---:|
| Success rate | ${cr.success_rate} | ${lr.success_rate} | ${cx.success_rate} | ${lx.success_rate} |
| Median count | ${cr.median_count} | ${lr.median_count} | ${cx.median_count} | ${lx.median_count} |
| Filter zero rate | ${cr.filter_zero_rate} | ${lr.filter_zero_rate} | ${cx.filter_zero_rate} | ${lx.filter_zero_rate} |
| Catastrophic zero rate (reddit) | ${assessment.metrics.catastrophic_zero_rate.current_reddit} | ${assessment.metrics.catastrophic_zero_rate.legacy_reddit} | - | - |

## Reliability Chart

\`\`\`mermaid
xychart-beta
    title "Success Rate by Source"
    x-axis [current_reddit, legacy_reddit, current_x, legacy_x]
    y-axis "rate" 0 --> 1
    bar [${cr.success_rate},${lr.success_rate},${cx.success_rate},${lx.success_rate}]
\`\`\`

## Trend (Last ${trend.length} Runs)

\`\`\`mermaid
xychart-beta
    title "Lock Pass Trend (1=pass, 0=fail)"
    x-axis [${trendLabels}]
    y-axis "pass" 0 --> 1
    line [${trendPass}]
\`\`\`

\`\`\`mermaid
xychart-beta
    title "Reddit Median Count Trend"
    x-axis [${trendLabels}]
    y-axis "median_count" 0 --> ${Math.max(1, ...trend.map((a) => a.metrics.current_reddit?.median_count ?? 0), ...trend.map((a) => a.metrics.legacy_reddit?.median_count ?? 0))}
    line [${trendCurrentRedditMedian}]
    line [${trendLegacyRedditMedian}]
\`\`\`

\`\`\`mermaid
xychart-beta
    title "X Median Count Trend"
    x-axis [${trendLabels}]
    y-axis "median_count" 0 --> ${Math.max(1, ...trend.map((a) => a.metrics.current_x?.median_count ?? 0), ...trend.map((a) => a.metrics.legacy_x?.median_count ?? 0))}
    line [${trendCurrentXMedian}]
    line [${trendLegacyXMedian}]
\`\`\`

| Run (UTC) | Pass | Current Reddit Median | Legacy Reddit Median | Current X Median | Legacy X Median |
|---|---:|---:|---:|---:|---:|
${trend
	.map(
		(a) =>
			`| ${runLabel(a.generated_at)} | ${a.pass ? '1' : '0'} | ${a.metrics.current_reddit?.median_count ?? 0} | ${a.metrics.legacy_reddit?.median_count ?? 0} | ${a.metrics.current_x?.median_count ?? 0} | ${a.metrics.legacy_x?.median_count ?? 0} |`,
	)
	.join('\n')}

## Topic Counts (Reddit)

| Topic | Current | Legacy |
|---|---:|---:|
${topicCounts.map((t) => `| ${t.topic} | ${t.current} | ${t.legacy} |`).join('\n')}

## Topic Chart (Reddit Counts)

\`\`\`mermaid
xychart-beta
    title "Reddit Count by Topic"
    x-axis [${topicCounts.map((t) => `"${shortTopic(t.topic)}"`).join(', ')}]
    y-axis "count" 0 --> ${maxTopicCount}
    bar [${topicCounts.map((t) => t.current).join(',')}]
    bar [${topicCounts.map((t) => t.legacy).join(',')}]
\`\`\`
`

writeFileSync(outPath, content)
process.stdout.write(`${outPath}\n`)
