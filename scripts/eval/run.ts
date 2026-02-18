#!/usr/bin/env bun
/**
 * Benchmark runner for eval harness.
 * Runs CLI for each topic, computes KPIs, and outputs a JSON scorecard.
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

interface BaselineData {
	kpis?: {
		avgCitationValidity?: number
	}
}

type EvalMode = 'pr' | 'full' | 'baseline-update'

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

/** Load JSON fixture from the fixtures/eval directory. */
function loadFixture<T>(name: string): T {
	const path = join(ROOT, 'fixtures', 'eval', name)
	return JSON.parse(readFileSync(path, 'utf-8')) as T
}

/** Parse eval mode from CLI args, defaulting to PR mode. */
function parseEvalMode(args: string[]): EvalMode {
	if (args.includes('--baseline-update')) return 'baseline-update'
	if (args.includes('--full')) return 'full'
	if (args.includes('--pr')) return 'pr'
	const explicit = args.find((arg) => arg.startsWith('--mode='))
	if (!explicit) return 'pr'
	const mode = explicit.slice('--mode='.length)
	if (mode === 'pr' || mode === 'full' || mode === 'baseline-update') {
		return mode
	}
	console.error(
		`Invalid --mode value: ${mode}. Expected one of: pr, full, baseline-update.`,
	)
	process.exit(1)
}

/** Run the CLI for a single topic and return parsed results. */
function runTopic(
	topic: string,
	outdir: string,
	useMock: boolean,
): {
	success: boolean
	durationSeconds: number
	report: ReportData | null
	stderr: string
} {
	const start = performance.now()
	const result = Bun.spawnSync(
		[
			'bun',
			'run',
			join(ROOT, 'src', 'cli.ts'),
			topic,
			...(useMock ? ['--mock'] : []),
			'--emit=json',
			`--outdir=${outdir}`,
		],
		{ cwd: ROOT, timeout: 120_000 },
	)
	const durationSeconds = (performance.now() - start) / 1000
	const success = result.exitCode === 0

	let report: ReportData | null = null
	if (success) {
		let parsedFromFile = false
		// Find the JSON output file in outdir
		try {
			const files = readdirSync(outdir).filter((f) => f.endsWith('.json'))
			if (files.length > 0) {
				const jsonPath = join(outdir, files[0]!)
				report = JSON.parse(readFileSync(jsonPath, 'utf-8')) as ReportData
				parsedFromFile = true
			}
		} catch {
			// Fall through to stdout parsing.
		}

		if (!parsedFromFile) {
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

	const stderr = result.stderr.toString().trim()
	return { success, durationSeconds, report, stderr }
}

/** Collect all items from a report into a flat array. */
function collectItems(
	report: ReportData,
): Array<{ url: string; score: number; date: string | null }> {
	return [...(report.reddit ?? []), ...(report.x ?? []), ...(report.web ?? [])]
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const mode = parseEvalMode(process.argv.slice(2))
const useMock = mode !== 'full'
const topics = loadFixture<Topic[]>('topics.json')
const oracle = loadFixture<OracleData>('oracle.json')
const baselinePath = join(ROOT, 'fixtures', 'eval', 'baseline.json')
const shouldUpdateBaseline = mode === 'baseline-update'
const baselineCommand = '`bun run eval:baseline:update`'

let baseline: BaselineData = {}

if (existsSync(baselinePath)) {
	baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as BaselineData
} else if (!shouldUpdateBaseline) {
	console.error(
		`Missing eval baseline fixture: ${baselinePath}. Run ${baselineCommand} to create it.`,
	)
	process.exit(1)
}
const baselineCitation = baseline.kpis?.avgCitationValidity ?? 0

const results: TopicResult[] = []
const durations: number[] = []

console.error(
	`Running eval for ${topics.length} topics... (mode=${mode}, mock=${useMock})`,
)

for (const { topic, category } of topics) {
	const outdir = join(
		'/tmp',
		`eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	)
	mkdirSync(outdir, { recursive: true })

	console.error(`  [${category}] "${topic}"...`)
	try {
		const { success, durationSeconds, report, stderr } = runTopic(
			topic,
			outdir,
			useMock,
		)
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
			...(success
				? {}
				: { error: stderr.length > 0 ? stderr : 'CLI exited non-zero' }),
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
const enforceCitationGate = mode === 'full'
const citationValidityRawPass = avgCitation >= THRESHOLDS.citationValidity
const runReliabilityPass = runReliability(runs) >= THRESHOLDS.runReliability
const performanceP95Pass =
	performanceP95(durations) <= THRESHOLDS.performanceP95
const regressionSafetyPass = regressionSafety(
	avgCitation,
	baselineCitation,
	THRESHOLDS.regressionSafetyThreshold,
)

const scorecard = {
	generatedAt: new Date().toISOString(),
	mode,
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
		citationValidity: enforceCitationGate ? citationValidityRawPass : true,
		runReliability: runReliabilityPass,
		performanceP95: performanceP95Pass,
		regressionSafety: regressionSafetyPass,
	},
	checks: {
		citationValidity: citationValidityRawPass,
		runReliability: runReliabilityPass,
		performanceP95: performanceP95Pass,
		regressionSafety: regressionSafetyPass,
	},
	gates: {
		citationValidity: enforceCitationGate ? 'required' : 'observational',
		runReliability: 'required',
		performanceP95: 'required',
		regressionSafety: 'required',
	},
	topicResults: results,
}

const allPassed = Object.values(scorecard.passed).every(Boolean)

// Output scorecard as JSON to stdout
console.log(JSON.stringify(scorecard, null, '\t'))

if (shouldUpdateBaseline) {
	writeFileSync(
		baselinePath,
		`${JSON.stringify(
			{
				generatedAt: scorecard.generatedAt,
				mode: scorecard.mode,
				topicCount: scorecard.topicCount,
				kpis: scorecard.kpis,
				thresholds: scorecard.thresholds,
				checks: scorecard.checks,
				gates: scorecard.gates,
				passed: {
					citationValidity: scorecard.checks.citationValidity,
					runReliability: scorecard.checks.runReliability,
					performanceP95: scorecard.checks.performanceP95,
					regressionSafety: scorecard.checks.regressionSafety,
				},
				note: 'Baseline generated from eval harness. In PR mode, citationValidity is observational for run gating; checks/passed values here are raw KPI truth values.',
			},
			null,
			'\t',
		)}\n`,
	)
	console.error(`\nBaseline updated: ${baselinePath}`)
	process.exit(0)
}

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
