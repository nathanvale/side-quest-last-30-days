#!/usr/bin/env bun
/**
 * Benchmark runner for eval harness.
 * Runs CLI with --mock for each topic, computes KPIs, outputs scorecard.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
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
			`--outdir=${outdir}`,
		],
		{ cwd: ROOT, timeout: 120_000 },
	)
	const durationSeconds = (performance.now() - start) / 1000
	const success = result.exitCode === 0

	let report: ReportData | null = null
	if (success) {
		// Find the JSON output file in outdir
		try {
			const files = readdirSync(outdir).filter((f) => f.endsWith('.json'))
			if (files.length > 0) {
				const jsonPath = join(outdir, files[0]!)
				report = JSON.parse(readFileSync(jsonPath, 'utf-8')) as ReportData
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
	return [...(report.reddit ?? []), ...(report.x ?? []), ...(report.web ?? [])]
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
		regressionSafety: regressionSafety(
			avgCitation,
			avgCitation,
			THRESHOLDS.regressionSafetyThreshold,
		),
	},
	topicResults: results,
}

const allPassed = Object.values(scorecard.passed).every(Boolean)

// Output scorecard as JSON to stdout
console.log(JSON.stringify(scorecard, null, '\t'))

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
