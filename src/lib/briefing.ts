/**
 * Briefing generation from persisted watchlist run history.
 *
 * Reads the latest run history entries for a topic, parses the serialised
 * entity data from `summary_json`, computes a delta between the two most
 * recent runs, and renders a human-readable markdown briefing.
 */

import type { DeltaReport } from './delta.js'
import { computeDelta } from './delta.js'
import type { EntityResult } from './entity-extract.js'
import type { RunHistoryEntry } from './watchlist.js'

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Briefing format period. */
export type BriefingPeriod = 'daily' | 'weekly'

/** Generated briefing content. */
export interface Briefing {
	/** The topic being briefed. */
	topic: string
	/** The reporting period ('daily' or 'weekly'). */
	period: BriefingPeriod
	/** ISO timestamp when this briefing was generated. */
	generatedAt: string
	/** The most recent run history entry. */
	currentRun: RunHistoryEntry | null
	/** The second-most recent run history entry. */
	previousRun: RunHistoryEntry | null
	/** Entity delta between the two most recent runs, or null if only one run. */
	delta: DeltaReport | null
	/** Top entities from the latest run, or null if none. */
	topEntities: EntityResult | null
	/** Number of total items in the latest run. */
	itemCount: number
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Shape expected inside each run's `summary_json` field.
 * All fields are optional; we parse defensively.
 */
interface SummaryJson {
	entities?: EntityResult
	itemCount?: number
}

/**
 * Parses the `summary_json` string from a RunHistoryEntry.
 *
 * Returns null if the string is absent, empty, or not valid JSON.
 * Uses defensive parsing to handle partial / legacy data.
 *
 * @param entry - The run history entry to parse.
 */
function parseSummaryJson(entry: RunHistoryEntry): SummaryJson | null {
	const raw = entry.summaryJson
	if (!raw) return null
	try {
		const parsed = JSON.parse(raw) as unknown
		if (typeof parsed !== 'object' || parsed === null) return null
		const obj = parsed as Record<string, unknown>
		// Validate entities shape -- each field must be an array or absent.
		// Malformed payloads (e.g. { handles: null }) would crash renderBriefingMarkdown.
		if (obj.entities != null) {
			if (typeof obj.entities !== 'object' || Array.isArray(obj.entities)) {
				return { ...(obj as SummaryJson), entities: undefined }
			}
			const ent = obj.entities as Record<string, unknown>
			const keys = ['handles', 'subreddits', 'hashtags', 'terms'] as const
			for (const k of keys) {
				// Reject if the key exists but is not an array (including null).
				// renderBriefingMarkdown calls .length on each field.
				if (k in ent && !Array.isArray(ent[k])) {
					return { ...(obj as SummaryJson), entities: undefined }
				}
			}
		}
		return obj as SummaryJson
	} catch {
		return null
	}
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Generates a briefing from watchlist run history entries.
 *
 * Behaviour by number of available runs:
 * - 0 runs: returns an empty briefing with all nullable fields set to null.
 * - 1 run: sets `currentRun` but leaves `previousRun`, `delta`, and
 *          `topEntities` as null if no entity data is found.
 * - 2+ runs: computes a full delta between the two most recent runs.
 *
 * The `summary_json` column on each run is parsed as
 * `{ entities?: EntityResult, itemCount?: number }`. Malformed JSON or
 * absent fields are handled gracefully.
 *
 * @param topic   - The research topic.
 * @param runs    - Run history entries ordered most-recent first.
 * @param period  - Reporting period ('daily' or 'weekly').
 * @param generatedAt - ISO timestamp supplied by caller.
 */
export function generateBriefing(
	topic: string,
	runs: RunHistoryEntry[],
	period: BriefingPeriod,
	generatedAt: string,
): Briefing {
	if (runs.length === 0) {
		return {
			topic,
			period,
			generatedAt,
			currentRun: null,
			previousRun: null,
			delta: null,
			topEntities: null,
			itemCount: 0,
		}
	}

	const currentRun = runs[0]!
	const currentSummary = parseSummaryJson(currentRun)
	const topEntities = currentSummary?.entities ?? null
	const itemCount = currentSummary?.itemCount ?? currentRun.itemCount

	if (runs.length === 1) {
		return {
			topic,
			period,
			generatedAt,
			currentRun,
			previousRun: null,
			delta: null,
			topEntities,
			itemCount,
		}
	}

	const previousRun = runs[1]!
	const previousSummary = parseSummaryJson(previousRun)

	let delta: DeltaReport | null = null
	if (topEntities && previousSummary?.entities) {
		delta = computeDelta(topEntities, previousSummary.entities)
	}

	return {
		topic,
		period,
		generatedAt,
		currentRun,
		previousRun,
		delta,
		topEntities,
		itemCount,
	}
}

/**
 * Renders a Briefing as a human-readable markdown string.
 *
 * Sections included:
 * - Header with topic, period, and generation timestamp
 * - Summary of current and previous runs
 * - What's New (new entities)
 * - Rising (entities with increasing engagement)
 * - Falling (entities with decreasing engagement)
 * - Gone (entities that dropped off)
 * - Top Entities (from the latest run)
 *
 * @param briefing - The generated briefing to render.
 */
export function renderBriefingMarkdown(briefing: Briefing): string {
	const lines: string[] = []

	// Header
	lines.push(`# Briefing: ${briefing.topic}`)
	lines.push(
		`**Period**: ${briefing.period} | **Generated**: ${briefing.generatedAt}`,
	)
	lines.push('')

	// Summary
	lines.push('## Summary')
	if (briefing.currentRun) {
		lines.push(
			`Latest run: ${briefing.currentRun.ranAt} (${briefing.itemCount} items)`,
		)
	} else {
		lines.push('No runs recorded yet.')
	}
	lines.push(
		`Previous run: ${briefing.previousRun ? briefing.previousRun.ranAt : 'No previous run'}`,
	)
	lines.push('')

	// What's New
	lines.push("## What's New")
	if (briefing.delta && briefing.delta.newEntities.length > 0) {
		for (const e of briefing.delta.newEntities) {
			lines.push(`- ${e.value} (${e.type})`)
		}
	} else {
		lines.push('No new entities detected.')
	}
	lines.push('')

	// Rising
	lines.push('## Rising')
	if (briefing.delta && briefing.delta.risingVoices.length > 0) {
		for (const entry of briefing.delta.risingVoices) {
			const delta = `+${entry.engagementDelta.toFixed(0)}`
			lines.push(`- ${entry.entity.value} (${entry.entity.type}) ${delta}`)
		}
	} else {
		lines.push('No rising voices.')
	}
	lines.push('')

	// Falling
	lines.push('## Falling')
	if (briefing.delta && briefing.delta.fallingVoices.length > 0) {
		for (const entry of briefing.delta.fallingVoices) {
			const delta = `${entry.engagementDelta.toFixed(0)}`
			lines.push(`- ${entry.entity.value} (${entry.entity.type}) ${delta}`)
		}
	} else {
		lines.push('No falling voices.')
	}
	lines.push('')

	// Gone
	lines.push('## Gone')
	if (briefing.delta && briefing.delta.goneEntities.length > 0) {
		for (const e of briefing.delta.goneEntities) {
			lines.push(`- ${e.value} (${e.type})`)
		}
	} else {
		lines.push('No entities dropped off.')
	}
	lines.push('')

	// Top Entities
	lines.push('## Top Entities')
	if (briefing.topEntities) {
		const sections: [string, string][] = [
			['Handles', 'handles'],
			['Subreddits', 'subreddits'],
			['Hashtags', 'hashtags'],
			['Terms', 'terms'],
		]
		let hasAny = false
		for (const [label, key] of sections) {
			const entities =
				briefing.topEntities[key as keyof typeof briefing.topEntities]
			if (entities.length > 0) {
				hasAny = true
				lines.push(`**${label}**: ${entities.map((e) => e.value).join(', ')}`)
			}
		}
		if (!hasAny) {
			lines.push('No entity data available.')
		}
	} else {
		lines.push('No entity data available.')
	}

	return lines.join('\n')
}
