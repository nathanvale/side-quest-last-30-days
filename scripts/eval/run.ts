#!/usr/bin/env bun
/**
 * Benchmark runner for eval harness.
 * Runs CLI with --mock for each topic, computes KPIs, outputs scorecard.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Mode parsing: --mode=pr|full|baseline-update (default: full for backward compat)
// ---------------------------------------------------------------------------
type EvalMode = 'pr' | 'full' | 'baseline-update'

function parseMode(): EvalMode {
	const modeArg = process.argv.find((a) => a.startsWith('--mode='))
	if (!modeArg) return 'full'
	const value = modeArg.slice('--mode='.length)
	const valid: EvalMode[] = ['pr', 'full', 'baseline-update']
	if (!valid.includes(value as EvalMode)) {
		console.error(
			`Error: Invalid --mode value: "${value}". Valid: ${valid.join(', ')}`,
		)
		process.exit(1)
	}
	return value as EvalMode
}

const MODE = parseMode()

import {
	citationValidity,
	performanceP95,
	regressionSafety,
	runReliability,
	trendRecallAtK,
} from '../../src/lib/eval-metrics.js'
import { compareToOracle } from './oracle.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

interface Topic {
	topic: string
	category: string
}

interface OracleData {
	[topic: string]: { entities: string[] }
}

interface ReportData {
	reddit?: Array<{
		url: string
		score: number
		date: string | null
	}>
	x?: Array<{
		url: string
		score: number
		date: string | null
	}>
	web?: Array<{
		url: string
		score: number
		date: string | null
	}>
	youtube?: Array<{
		url: string
		score: number
		date: string | null
	}>
}

interface TopicResult {
	topic: string
	category: string
	success: boolean
	durationSeconds: number
	citationValidity: number
	trendRecallAt10: number
	oracleRecall: number
	itemCount: number
	error?: string
}

/**
 * Eval fixtures are anchored to January/February 2026.
 * Use a wider lookback so mocked runs stay populated over time.
 */
const EVAL_DAYS = 60

/** Load JSON fixture from the fixtures/eval directory. */
function loadFixture<T>(name: string): T {
	const path = join(ROOT, 'fixtures', 'eval', name)
	return JSON.parse(readFileSync(path, 'utf-8')) as T
}

/** Run the CLI for a single topic and return parsed results. */
function runTopic(
	topic: string,
	outdir: string,
): { success: boolean; durationSeconds: number; report: ReportData | null } {
	const start = performance.now()
	const result = Bun.spawnSync(
		[
			'bun',
			'run',
			join(ROOT, 'src', 'cli.ts'),
			topic,
			'--mock',
			'--emit=json',
			`--days=${EVAL_DAYS}`,
			`--outdir=${outdir}`,
		],
		{ cwd: ROOT, timeout: 120_000 },
	)
	const durationSeconds = (performance.now() - start) / 1000
	const success = result.exitCode === 0

	let report: ReportData | null = null
	if (success) {
		// Prefer deterministic report artifact over raw payload files.
		try {
			const reportPath = join(outdir, 'report.json')
			if (existsSync(reportPath)) {
				report = JSON.parse(readFileSync(reportPath, 'utf-8')) as ReportData
			} else {
				// Fallback for unexpected layouts: choose report*.json only.
				const files = readdirSync(outdir).filter((f) =>
					/^report.*\.json$/i.test(f),
				)
				files.sort()
				if (files.length > 0) {
					if (files.length > 1) {
						console.error(
							`  Warning: multiple report files found, using ${files[0]}`,
						)
					}
					const jsonPath = join(outdir, files[0]!)
					report = JSON.parse(readFileSync(jsonPath, 'utf-8')) as ReportData
				}
			}
		} catch {
			// If we can't read the output, try parsing stdout
			try {
				const stdout = result.stdout.toString().trim()
				if (stdout.startsWith('{')) {
					report = JSON.parse(stdout) as ReportData
				}
			} catch {
				// No parseable output
			}
		}
	}

	return { success, durationSeconds, report }
}

/** Collect all items from a report into a flat array. */
function collectItems(
	report: ReportData,
): Array<{ url: string; score: number; date: string | null }> {
	return [
		...(report.reddit ?? []),
		...(report.x ?? []),
		...(report.web ?? []),
		...(report.youtube ?? []),
	]
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const topics = loadFixture<Topic[]>('topics.json')
const oracle = loadFixture<OracleData>('oracle.json')

const results: TopicResult[] = []
const durations: number[] = []

console.error(`Running eval for ${topics.length} topics...`)

for (const { topic, category } of topics) {
	const outdir = join(
		'/tmp',
		`eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	)
	mkdirSync(outdir, { recursive: true })

	try {
		console.error(`  [${category}] "${topic}"...`)
		const { success, durationSeconds, report } = runTopic(topic, outdir)
		durations.push(durationSeconds)

		const items = report ? collectItems(report) : []
		const oracleEntities = oracle[topic]?.entities ?? []

		results.push({
			topic,
			category,
			success,
			durationSeconds,
			citationValidity: citationValidity(items),
			trendRecallAt10: trendRecallAtK(items, oracleEntities, 10),
			oracleRecall: compareToOracle(items, oracleEntities),
			itemCount: items.length,
			...(success ? {} : { error: 'CLI exited non-zero' }),
		})
	} finally {
		rmSync(outdir, { recursive: true, force: true })
	}
}

// Compute aggregate KPIs
const runs = results.map((r) => ({ success: r.success }))
const allCitations = results.map((r) => r.citationValidity)
const avgCitation =
	allCitations.length > 0
		? allCitations.reduce((a, b) => a + b, 0) / allCitations.length
		: 0

// Thresholds
const THRESHOLDS = {
	citationValidity: 0.5,
	runReliability: 0.8,
	performanceP95: 120,
	regressionSafetyThreshold: 0.02,
}

const BASELINE_PATH = join(ROOT, 'fixtures', 'eval', 'baseline.json')

type EvalKpis = {
	runReliability: number
	performanceP95Seconds: number
	avgCitationValidity: number
	avgTrendRecallAt10: number
	avgOracleRecall: number
}

/** Load baseline KPI snapshot if available. */
function loadBaselineKpis(): EvalKpis | null {
	try {
		const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as {
			kpis: EvalKpis
		}
		return raw.kpis
	} catch {
		return null
	}
}

const baselineKpis = loadBaselineKpis()

const scorecard = {
	generatedAt: new Date().toISOString(),
	topicCount: topics.length,
	kpis: {
		runReliability: runReliability(runs),
		performanceP95Seconds: performanceP95(durations),
		avgCitationValidity: avgCitation,
		avgTrendRecallAt10:
			results.length > 0
				? results.reduce((a, r) => a + r.trendRecallAt10, 0) / results.length
				: 0,
		avgOracleRecall:
			results.length > 0
				? results.reduce((a, r) => a + r.oracleRecall, 0) / results.length
				: 0,
	},
	thresholds: THRESHOLDS,
	passed: {
		citationValidity: avgCitation >= THRESHOLDS.citationValidity,
		runReliability: runReliability(runs) >= THRESHOLDS.runReliability,
		performanceP95: performanceP95(durations) <= THRESHOLDS.performanceP95,
		// Absolute-threshold mode may run without a saved baseline.
		regressionSafety:
			baselineKpis == null
				? true
				: regressionSafety(
						avgCitation,
						baselineKpis.avgCitationValidity,
						THRESHOLDS.regressionSafetyThreshold,
					),
	},
	topicResults: results,
}

const allPassed = Object.values(scorecard.passed).every(Boolean)

// Output scorecard as JSON to stdout
console.log(JSON.stringify(scorecard, null, '\t'))

// ---------------------------------------------------------------------------
// Mode-specific exit behavior
// ---------------------------------------------------------------------------
if (MODE === 'baseline-update') {
	writeFileSync(BASELINE_PATH, `${JSON.stringify(scorecard, null, '\t')}\n`)
	console.error(`\nBaseline updated: ${BASELINE_PATH}`)
	process.exit(0)
}

if (MODE === 'pr') {
	// Compare each KPI against baseline -- fail only on regression
	const baseline = baselineKpis
	if (baseline == null) {
		console.error('\nNo baseline found -- skipping regression check, passing.')
		process.exit(0)
	}

	const threshold = THRESHOLDS.regressionSafetyThreshold
	const regressions: string[] = []

	// Higher-is-better KPIs: fail if current < baseline - threshold
	for (const key of [
		'runReliability',
		'avgCitationValidity',
		'avgTrendRecallAt10',
		'avgOracleRecall',
	] as const) {
		const current = scorecard.kpis[key]
		const base = baseline[key]
		if (!regressionSafety(current, base, threshold)) {
			regressions.push(
				`${key}: ${base.toFixed(3)} -> ${current.toFixed(3)} (drop > ${threshold})`,
			)
		}
	}

	// Lower-is-better KPI: fail if current > baseline + tolerance
	{
		const current = scorecard.kpis.performanceP95Seconds
		const base = baseline.performanceP95Seconds
		// Allow 10% tolerance on p95 timing
		const timingTolerance = Math.max(base * 0.1, 1)
		if (current > base + timingTolerance) {
			regressions.push(
				`performanceP95Seconds: ${base.toFixed(2)}s -> ${current.toFixed(2)}s (exceeds tolerance)`,
			)
		}
	}

	if (regressions.length > 0) {
		console.error('\nEval PR check FAILED -- regressions detected:')
		for (const r of regressions) console.error(`  - ${r}`)
		process.exit(1)
	}

	console.error('\nEval PR check PASSED -- no regressions from baseline.')
	process.exit(0)
}

// MODE === 'full' -- original absolute-threshold behavior
if (!allPassed) {
	console.error('\nEval FAILED -- some thresholds not met.')
	const failures = Object.entries(scorecard.passed)
		.filter(([, v]) => !v)
		.map(([k]) => k)
	console.error(`  Failed: ${failures.join(', ')}`)
	process.exit(1)
} else {
	console.error('\nEval PASSED -- all thresholds met.')
}
