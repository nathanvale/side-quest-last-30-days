#!/usr/bin/env bun
/**
 * Stage-by-stage Reddit drop-off debugger for current vs legacy.
 *
 * Runs one topic through both implementations and reports:
 * parse -> enrich -> normalize -> date-filter -> score -> dedupe -> final.
 */

import { mkdirSync, readFileSync } from 'node:fs'
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

type StageCounts = {
	parse_count: number
	enrich_count: number
	normalize_count: number
	date_filtered_count: number
	scored_count: number
	deduped_count: number
	final_report_count: number
	date_stats: { nulls: number; within: number; before: number; after: number }
}

type CliArgs = {
	topic: string
	days: number
	legacyPath: string
	outPath: string
}

function parseArgs(argv: string[]): CliArgs {
	const map = new Map<string, string>()
	for (const arg of argv) {
		if (!arg.startsWith('--')) continue
		const [k, v] = arg.slice(2).split('=', 2)
		if (!k || v == null) continue
		map.set(k, v)
	}

	return {
		topic: map.get('topic') ?? 'React Server Components vulnerability',
		days: Number(map.get('days') ?? '30'),
		legacyPath: resolve(
			map.get('legacy') ?? '/Users/nathanvale/code/last30days',
		),
		outPath: resolve(map.get('out') ?? 'reports/reddit-drop/stage-debug.json'),
	}
}

function buildCurrentStageCounts(outdir: string): StageCounts {
	const raw = JSON.parse(
		readFileSync(join(outdir, 'raw_openai.json'), 'utf-8'),
	) as Record<string, unknown>
	const enriched = JSON.parse(
		readFileSync(join(outdir, 'raw_reddit_threads_enriched.json'), 'utf-8'),
	) as Record<string, unknown>[]
	const report = JSON.parse(
		readFileSync(join(outdir, 'report.json'), 'utf-8'),
	) as {
		range: { from: string; to: string }
		days: number
		reddit: unknown[]
	}

	const parsed = parseRedditResponse(raw)
	const normalized = normalizeRedditItems(
		enriched,
		report.range.from,
		report.range.to,
	)
	const filtered = filterByDateRange(
		normalized,
		report.range.from,
		report.range.to,
	)
	const scored = scoreRedditItems(filtered, report.days)
	const sorted = sortItems(scored) as RedditItem[]
	const deduped = dedupeReddit(sorted)
	const dateStats = { nulls: 0, within: 0, before: 0, after: 0 }

	for (const item of normalized) {
		if (!item.date) dateStats.nulls += 1
		else if (item.date < report.range.from) dateStats.before += 1
		else if (item.date > report.range.to) dateStats.after += 1
		else dateStats.within += 1
	}

	return {
		parse_count: parsed.length,
		enrich_count: enriched.length,
		normalize_count: normalized.length,
		date_filtered_count: filtered.length,
		scored_count: scored.length,
		deduped_count: deduped.length,
		final_report_count: Array.isArray(report.reddit) ? report.reddit.length : 0,
		date_stats: dateStats,
	}
}

function buildLegacyStageCounts(): StageCounts {
	const script = `
import json, sys
from pathlib import Path
sys.path.insert(0, '/Users/nathanvale/code/last30days/scripts')
from lib import openai_reddit, normalize, score, dedupe
base = Path('${homedir()}/.local/share/last30days/out')
raw = json.loads((base / 'raw_openai.json').read_text())
enriched = json.loads((base / 'raw_reddit_threads_enriched.json').read_text())
report = json.loads((base / 'report.json').read_text())
from_d = report['range']['from']
to_d = report['range']['to']
parsed = openai_reddit.parse_reddit_response(raw)
normalized = normalize.normalize_reddit_items(enriched, from_d, to_d)
filtered = normalize.filter_by_date_range(normalized, from_d, to_d)
scored = score.score_reddit_items(filtered)
deduped = dedupe.dedupe_reddit(score.sort_items(scored))
stats = {'nulls': 0, 'within': 0, 'before': 0, 'after': 0}
for it in normalized:
  d = it.date
  if not d: stats['nulls'] += 1
  elif d < from_d: stats['before'] += 1
  elif d > to_d: stats['after'] += 1
  else: stats['within'] += 1
print(json.dumps({
  'parse_count': len(parsed),
  'enrich_count': len(enriched),
  'normalize_count': len(normalized),
  'date_filtered_count': len(filtered),
  'scored_count': len(scored),
  'deduped_count': len(deduped),
  'final_report_count': len(report.get('reddit', [])),
  'date_stats': stats
}))
`

	const result = Bun.spawnSync(['/usr/bin/python3', '-c', script], {
		stdout: 'pipe',
		stderr: 'pipe',
	})

	if (result.exitCode !== 0) {
		throw new Error(`Legacy stage count failed: ${result.stderr.toString()}`)
	}

	return JSON.parse(result.stdout.toString()) as StageCounts
}

function extractFoundThreads(stderr: string): number | null {
	const match = stderr.match(/Found\s+(\d+)\s+threads/i)
	if (!match) return null
	const n = Number(match[1])
	return Number.isInteger(n) ? n : null
}

function runAndTrace(args: CliArgs): Record<string, unknown> {
	const currentOut = resolve('reports/reddit-drop/current-live')
	mkdirSync(currentOut, { recursive: true })

	const current = Bun.spawnSync(
		[
			'bun',
			'run',
			resolve('src/cli.ts'),
			args.topic,
			'--emit=json',
			'--sources=reddit',
			`--days=${args.days}`,
			'--refresh',
			`--outdir=${currentOut}`,
		],
		{ stdout: 'pipe', stderr: 'pipe', timeout: 180_000 },
	)

	if (current.exitCode !== 0) {
		throw new Error(`Current run failed: ${current.stderr.toString()}`)
	}

	const legacy = Bun.spawnSync(
		[
			'/usr/bin/python3',
			join(args.legacyPath, 'scripts', 'last30days.py'),
			args.topic,
			'--emit=json',
			'--sources=reddit',
		],
		{ stdout: 'pipe', stderr: 'pipe', timeout: 180_000 },
	)

	if (legacy.exitCode !== 0) {
		throw new Error(`Legacy run failed: ${legacy.stderr.toString()}`)
	}

	return {
		topic: args.topic,
		days: args.days,
		current: {
			exit_code: current.exitCode,
			stderr: current.stderr.toString(),
			stages: (() => {
				const stages = buildCurrentStageCounts(currentOut)
				const found = extractFoundThreads(current.stderr.toString())
				if (found != null) stages.parse_count = found
				return stages
			})(),
		},
		legacy: {
			exit_code: legacy.exitCode,
			stderr: legacy.stderr.toString(),
			stages: (() => {
				const stages = buildLegacyStageCounts()
				const found = extractFoundThreads(legacy.stderr.toString())
				if (found != null) stages.parse_count = found
				return stages
			})(),
		},
	}
}

const args = parseArgs(process.argv.slice(2))
const result = runAndTrace(args)
mkdirSync(resolve('reports/reddit-drop'), { recursive: true })
Bun.write(args.outPath, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
