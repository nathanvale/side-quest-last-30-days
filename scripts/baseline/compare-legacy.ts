#!/usr/bin/env bun

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dedupeReddit, dedupeWebsearch, dedupeX } from '../../src/lib/dedupe.js'
import { filterByDateRange } from '../../src/lib/normalize.js'
import type { RedditItem, WebSearchItem, XItem } from '../../src/lib/schema.js'
import {
	scoreRedditItems,
	scoreWebsearchItems,
	scoreXItems,
	sortItems,
} from '../../src/lib/score.js'

type BaselineFixture = {
	meta: {
		version: string
		generated_at: string
		days: number
		from_date: string
		to_date: string
		items_per_source: number
	}
	policy: {
		score_delta: {
			absolute: number
			percent: number
			baseline_floor: number
		}
		ranking: {
			top_n_strict: number
			max_drift: number
		}
		tie_breakers: string[]
	}
	topics: BaselineTopic[]
}

type BaselineTopic = {
	id: string
	topic: string
	inputs: {
		reddit: RedditItem[]
		x: XItem[]
		youtube: unknown[]
		web: WebSearchItem[]
	}
}

type LegacyResult = {
	topic_id: string
	sources: {
		reddit: RedditItem[]
		x: XItem[]
		web: WebSearchItem[]
	}
}

const DEFAULT_OUT_PATH = 'reports/legacy-compare.json'
const DEFAULT_LEGACY_SCORE_TOLERANCE = {
	absolute: 1,
	percent: 0.01,
	baseline_floor: 1,
}

function parseArgs(args: string[]) {
	const result: Record<string, string> = {}
	for (const arg of args) {
		if (!arg.startsWith('--')) continue
		const [key, value] = arg.slice(2).split('=', 2)
		if (key && value) result[key] = value
	}
	return result
}

function withFixedDate<T>(iso: string, fn: () => T): T {
	const fixed = new Date(iso)
	const RealDate = Date
	const FixedDate = class extends RealDate {
		constructor(...args: unknown[]) {
			if (args.length === 0) {
				super(fixed.getTime())
				return
			}
			super(...(args as ConstructorParameters<typeof Date>))
		}
		static override now() {
			return fixed.getTime()
		}
	}
	// @ts-expect-error override Date for deterministic scoring
	globalThis.Date = FixedDate
	try {
		return fn()
	} finally {
		globalThis.Date = RealDate
	}
}

function loadFixture(path: string): BaselineFixture {
	return JSON.parse(readFileSync(path, 'utf-8')) as BaselineFixture
}

function scoreCurrentParity(fixture: BaselineFixture): LegacyResult[] {
	return withFixedDate(fixture.meta.to_date, () =>
		fixture.topics.map((topic) => {
			const { from_date, to_date, days } = fixture.meta
			const filteredReddit = filterByDateRange(
				topic.inputs.reddit,
				from_date,
				to_date,
			)
			const filteredX = filterByDateRange(topic.inputs.x, from_date, to_date)
			const filteredWeb = filterByDateRange(
				topic.inputs.web,
				from_date,
				to_date,
			)

			const scoredReddit = scoreRedditItems(filteredReddit, days)
			const scoredX = scoreXItems(filteredX, days)
			const scoredWeb = scoreWebsearchItems(filteredWeb, days)

			const sortedReddit = sortItems(scoredReddit) as RedditItem[]
			const sortedX = sortItems(scoredX) as XItem[]
			const sortedWeb = sortItems(scoredWeb) as WebSearchItem[]

			return {
				topic_id: topic.id,
				sources: {
					reddit: dedupeReddit(sortedReddit),
					x: dedupeX(sortedX),
					web: dedupeWebsearch(sortedWeb),
				},
			}
		}),
	)
}

function runLegacy(
	fixture: BaselineFixture,
	legacyPath: string,
): LegacyResult[] {
	const script = `
import json, os, sys
from datetime import datetime, timezone

legacy_path = os.environ.get("LEGACY_REPO")
if not legacy_path:
    sys.stderr.write("LEGACY_REPO not set\\n")
    sys.exit(1)

sys.path.insert(0, os.path.join(legacy_path, "scripts"))

from lib import schema, score, normalize, websearch, dedupe, dates

fixed_iso = os.environ.get("FIXED_DATE")
fixed_dt = datetime.fromisoformat(fixed_iso.replace("Z", "+00:00"))

class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        if tz:
            return fixed_dt.astimezone(tz)
        return fixed_dt

dates.datetime = FixedDateTime

payload = json.load(sys.stdin)
results = []

for topic in payload["topics"]:
    inputs = topic["inputs"]

    reddit_items = []
    for item in inputs.get("reddit", []):
        eng = item.get("engagement") or None
        engagement = None
        if isinstance(eng, dict):
            engagement = schema.Engagement(
                score=eng.get("score"),
                num_comments=eng.get("num_comments"),
                upvote_ratio=eng.get("upvote_ratio"),
            )
        top_comments = []
        for c in item.get("top_comments", []) or []:
            top_comments.append(schema.Comment(
                score=c.get("score", 0),
                date=c.get("date"),
                author=c.get("author", ""),
                excerpt=c.get("excerpt", ""),
                url=c.get("url", ""),
            ))
        reddit_items.append(schema.RedditItem(
            id=item.get("id", ""),
            title=item.get("title", ""),
            url=item.get("url", ""),
            subreddit=item.get("subreddit", ""),
            date=item.get("date"),
            date_confidence=item.get("date_confidence", "low"),
            engagement=engagement,
            top_comments=top_comments,
            comment_insights=item.get("comment_insights", []) or [],
            relevance=item.get("relevance", 0.5),
            why_relevant=item.get("why_relevant", ""),
        ))

    x_items = []
    for item in inputs.get("x", []):
        eng = item.get("engagement") or None
        engagement = None
        if isinstance(eng, dict):
            engagement = schema.Engagement(
                likes=eng.get("likes"),
                reposts=eng.get("reposts"),
                replies=eng.get("replies"),
                quotes=eng.get("quotes"),
            )
        x_items.append(schema.XItem(
            id=item.get("id", ""),
            text=item.get("text", ""),
            url=item.get("url", ""),
            author_handle=item.get("author_handle", ""),
            date=item.get("date"),
            date_confidence=item.get("date_confidence", "low"),
            engagement=engagement,
            relevance=item.get("relevance", 0.5),
            why_relevant=item.get("why_relevant", ""),
        ))

    web_items = []
    for item in inputs.get("web", []):
        web_items.append(schema.WebSearchItem(
            id=item.get("id", ""),
            title=item.get("title", ""),
            url=item.get("url", ""),
            source_domain=item.get("source_domain", ""),
            snippet=item.get("snippet", ""),
            date=item.get("date"),
            date_confidence=item.get("date_confidence", "low"),
            relevance=item.get("relevance", 0.5),
            why_relevant=item.get("why_relevant", ""),
        ))

    from_date = payload.get("from_date", "")
    to_date = payload.get("to_date", "")

    filtered_reddit = normalize.filter_by_date_range(reddit_items, from_date, to_date)
    filtered_x = normalize.filter_by_date_range(x_items, from_date, to_date)
    filtered_web = normalize.filter_by_date_range(web_items, from_date, to_date)

    scored_reddit = score.score_reddit_items(filtered_reddit)
    scored_x = score.score_x_items(filtered_x)
    scored_web = score.score_websearch_items(filtered_web)

    sorted_reddit = score.sort_items(scored_reddit)
    sorted_x = score.sort_items(scored_x)
    sorted_web = score.sort_items(scored_web)

    deduped_reddit = dedupe.dedupe_reddit(sorted_reddit)
    deduped_x = dedupe.dedupe_x(sorted_x)
    deduped_web = websearch.dedupe_websearch(sorted_web)

    results.append({
        "topic_id": topic.get("id"),
        "sources": {
            "reddit": [r.to_dict() for r in deduped_reddit],
            "x": [x.to_dict() for x in deduped_x],
            "web": [w.to_dict() for w in deduped_web],
        },
    })

json.dump(results, sys.stdout)
`

	const payload = {
		from_date: fixture.meta.from_date,
		to_date: fixture.meta.to_date,
		topics: fixture.topics.map((topic) => ({
			id: topic.id,
			inputs: {
				reddit: topic.inputs.reddit,
				x: topic.inputs.x,
				web: topic.inputs.web,
			},
		})),
	}

	const result = spawnSync('python3', ['-c', script], {
		input: JSON.stringify(payload),
		encoding: 'utf-8',
		env: {
			...process.env,
			LEGACY_REPO: legacyPath,
			FIXED_DATE: fixture.meta.to_date,
		},
	})

	if (result.status !== 0) {
		const stderr = result.stderr || 'legacy comparison failed'
		throw new Error(stderr.toString())
	}

	return JSON.parse(result.stdout) as LegacyResult[]
}

function scoreTolerance(
	baselineScore: number,
	actualScore: number,
	policy: BaselineFixture['policy']['score_delta'],
): number {
	const baseline = Math.max(baselineScore, policy.baseline_floor)
	const allowed = Math.max(policy.absolute, policy.percent * baseline)
	return Math.abs(actualScore - baselineScore) - allowed
}

function compareSource<T extends { id: string; score: number }>(
	source: string,
	legacy: T[],
	current: T[],
	policy: BaselineFixture['policy'],
) {
	const legacyIds = legacy.map((item) => item.id)
	const currentIds = current.map((item) => item.id)
	const legacyById = new Map(legacy.map((item) => [item.id, item]))
	const currentById = new Map(current.map((item) => [item.id, item]))

	const missingInLegacy = currentIds.filter((id) => !legacyById.has(id))
	const missingInCurrent = legacyIds.filter((id) => !currentById.has(id))

	const scoreDeltas = legacyIds
		.map((id) => {
			const legacyItem = legacyById.get(id)
			const currentItem = currentById.get(id)
			if (!legacyItem || !currentItem) return null
			const delta = currentItem.score - legacyItem.score
			const overTolerance =
				scoreTolerance(
					legacyItem.score,
					currentItem.score,
					policy.score_delta,
				) > 0
			return {
				id,
				legacy: legacyItem.score,
				current: currentItem.score,
				delta,
				over_tolerance: overTolerance,
			}
		})
		.filter((entry) => entry !== null) as {
		id: string
		legacy: number
		current: number
		delta: number
		over_tolerance: boolean
	}[]

	const topN = policy.ranking.top_n_strict
	const legacyTop = legacyIds.slice(0, topN)
	const currentTop = currentIds.slice(0, topN)
	const topChanged = legacyTop.join('|') !== currentTop.join('|')

	const driftViolations: { id: string; drift: number }[] = []
	for (let i = topN; i < legacyIds.length; i++) {
		const id = legacyIds[i]!
		const currentIndex = currentIds.indexOf(id)
		if (currentIndex === -1) continue
		const legacyItem = legacyById.get(id)
		const currentItem = currentById.get(id)
		if (!legacyItem || !currentItem) continue
		const scoreDeltaOver =
			scoreTolerance(legacyItem.score, currentItem.score, policy.score_delta) >
			0
		if (scoreDeltaOver) continue
		const drift = Math.abs(currentIndex - i)
		if (drift > policy.ranking.max_drift) {
			driftViolations.push({ id, drift })
		}
	}

	return {
		source,
		legacy_count: legacyIds.length,
		current_count: currentIds.length,
		missing_in_legacy: missingInLegacy,
		missing_in_current: missingInCurrent,
		top_n_strict: topN,
		legacy_top_ids: legacyTop,
		current_top_ids: currentTop,
		top_order_changed: topChanged,
		score_deltas: scoreDeltas,
		score_deltas_over_tolerance: scoreDeltas.filter(
			(entry) => entry.over_tolerance,
		),
		drift_violations: driftViolations,
	}
}

function buildReport(
	fixture: BaselineFixture,
	legacy: LegacyResult[],
	current: LegacyResult[],
	outPath: string,
	legacyPath: string,
	legacyScoreTolerance: BaselineFixture['policy']['score_delta'],
) {
	const topics = fixture.topics.map((topic) => {
		const legacyTopic = legacy.find((entry) => entry.topic_id === topic.id)
		const currentTopic = current.find((entry) => entry.topic_id === topic.id)
		if (!legacyTopic || !currentTopic) {
			return {
				id: topic.id,
				topic: topic.topic,
				missing: true,
			}
		}

		return {
			id: topic.id,
			topic: topic.topic,
			sources: {
				reddit: compareSource(
					'reddit',
					legacyTopic.sources.reddit,
					currentTopic.sources.reddit,
					{
						...fixture.policy,
						score_delta: legacyScoreTolerance,
					},
				),
				x: compareSource('x', legacyTopic.sources.x, currentTopic.sources.x, {
					...fixture.policy,
					score_delta: legacyScoreTolerance,
				}),
				web: compareSource(
					'web',
					legacyTopic.sources.web,
					currentTopic.sources.web,
					{
						...fixture.policy,
						score_delta: legacyScoreTolerance,
					},
				),
			},
		}
	})

	const summary = {
		topics: topics.length,
		sources: ['reddit', 'x', 'web'],
		intent: 'legacy-parity (trend disabled, youtube excluded)',
	}

	const report = {
		meta: {
			generated_at: new Date().toISOString(),
			legacy_repo: legacyPath,
			fixture_version: fixture.meta.version,
			fixture_generated_at: fixture.meta.generated_at,
			from_date: fixture.meta.from_date,
			to_date: fixture.meta.to_date,
			days: fixture.meta.days,
			policy: fixture.policy,
			legacy_score_tolerance: legacyScoreTolerance,
			out_path: outPath,
		},
		summary,
		topics,
	}

	const outDir = dirname(outPath)
	mkdirSync(outDir, { recursive: true })
	writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)

	process.stdout.write(`Legacy comparison written to ${outPath}\n`)
}

const args = parseArgs(process.argv.slice(2))
const legacyPathRaw =
	args.legacy ??
	process.env.LEGACY_REPO ??
	join(homedir(), 'code', 'last30days')
const legacyPath = resolve(legacyPathRaw)
const outPath = resolve(args.out ?? DEFAULT_OUT_PATH)
const scriptDir = dirname(fileURLToPath(import.meta.url))
const fixturePath = resolve(
	args.fixture ??
		join(scriptDir, '..', '..', 'fixtures', 'algorithm-baseline', 'v1.json'),
)

if (!legacyPathRaw || !existsSync(legacyPath)) {
	process.stderr.write(
		`Error: legacy repo path not found: ${legacyPath}\n` +
			'Provide --legacy=<path> or LEGACY_REPO.\n',
	)
	process.exit(1)
}

const fixture = loadFixture(fixturePath)
const legacy = runLegacy(fixture, legacyPath)
const current = scoreCurrentParity(fixture)

const legacyScoreTolerance = {
	absolute:
		args.legacyToleranceAbs != null
			? Number(args.legacyToleranceAbs)
			: DEFAULT_LEGACY_SCORE_TOLERANCE.absolute,
	percent:
		args.legacyTolerancePct != null
			? Number(args.legacyTolerancePct)
			: DEFAULT_LEGACY_SCORE_TOLERANCE.percent,
	baseline_floor:
		args.legacyToleranceFloor != null
			? Number(args.legacyToleranceFloor)
			: DEFAULT_LEGACY_SCORE_TOLERANCE.baseline_floor,
}

buildReport(fixture, legacy, current, outPath, legacyPath, legacyScoreTolerance)
