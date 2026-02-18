/**
 * Tests for delta detection (src/lib/delta.ts) and briefing generation
 * (src/lib/briefing.ts).
 *
 * Delta tests verify new/gone/rising/falling entity detection with
 * case-insensitive matching across all entity types.
 * Briefing tests verify generation logic and markdown rendering.
 */

import { describe, expect, test } from 'bun:test'
import { generateBriefing, renderBriefingMarkdown } from '../src/lib/briefing'
import {
	computeDelta,
	detectFallingVoices,
	detectGoneEntities,
	detectNewEntities,
	detectRisingVoices,
	flattenEntities,
} from '../src/lib/delta'
import type { EntityResult, ExtractedEntity } from '../src/lib/entity-extract'
import type { RunHistoryEntry } from '../src/lib/watchlist'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Builds an ExtractedEntity with defaults for convenience. */
function makeEntity(
	value: string,
	type: ExtractedEntity['type'],
	frequency = 1,
	engagementWeight = 100,
): ExtractedEntity {
	return { value, type, frequency, engagementWeight }
}

/** Builds an empty EntityResult. */
function emptyResult(): EntityResult {
	return { handles: [], subreddits: [], hashtags: [], terms: [] }
}

/** Builds an EntityResult with one entity in each category. */
function fullResult(): EntityResult {
	return {
		handles: [makeEntity('@alice', 'handle', 2, 500)],
		subreddits: [makeEntity('r/machinelearning', 'subreddit', 5, 2000)],
		hashtags: [makeEntity('#claude', 'hashtag', 3, 750)],
		terms: [makeEntity('transformer', 'term', 4, 0)],
	}
}

/** A minimal RunHistoryEntry with no summaryJson. */
function makeRun(id: number, ranAt: string, itemCount = 10): RunHistoryEntry {
	return {
		id,
		topic: 'AI trends',
		ranAt,
		durationMs: 1000,
		itemCount,
		status: 'success',
		errorMessage: null,
	}
}

/**
 * Makes a RunHistoryEntry with a serialised summary_json payload.
 * We cast to include the summaryJson property expected by briefing.ts.
 */
function makeRunWithSummary(
	id: number,
	ranAt: string,
	entities: EntityResult | null,
	itemCount = 10,
): RunHistoryEntry & { summaryJson: string } {
	return {
		id,
		topic: 'AI trends',
		ranAt,
		durationMs: 1000,
		itemCount,
		status: 'success',
		errorMessage: null,
		summaryJson: JSON.stringify({ entities, itemCount }),
	}
}

// ---------------------------------------------------------------------------
// flattenEntities
// ---------------------------------------------------------------------------

describe('flattenEntities', () => {
	test('returns empty array for empty result', () => {
		expect(flattenEntities(emptyResult())).toHaveLength(0)
	})

	test('combines all four arrays into one flat list', () => {
		const result = fullResult()
		const flat = flattenEntities(result)
		expect(flat).toHaveLength(4)
	})

	test('order is handles, subreddits, hashtags, terms', () => {
		const result = fullResult()
		const flat = flattenEntities(result)
		expect(flat[0]?.type).toBe('handle')
		expect(flat[1]?.type).toBe('subreddit')
		expect(flat[2]?.type).toBe('hashtag')
		expect(flat[3]?.type).toBe('term')
	})
})

// ---------------------------------------------------------------------------
// detectNewEntities
// ---------------------------------------------------------------------------

describe('detectNewEntities', () => {
	test('returns all current entities when previous is empty', () => {
		const current = fullResult()
		const previous = emptyResult()
		const newEntities = detectNewEntities(current, previous)
		expect(newEntities).toHaveLength(4)
	})

	test('returns empty array when both results are empty', () => {
		const newEntities = detectNewEntities(emptyResult(), emptyResult())
		expect(newEntities).toHaveLength(0)
	})

	test('returns empty array when current and previous are identical', () => {
		const result = fullResult()
		const newEntities = detectNewEntities(result, result)
		expect(newEntities).toHaveLength(0)
	})

	test('returns only entity not present in previous', () => {
		const current: EntityResult = {
			handles: [makeEntity('@alice', 'handle'), makeEntity('@bob', 'handle')],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const previous: EntityResult = {
			handles: [makeEntity('@alice', 'handle')],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const newEntities = detectNewEntities(current, previous)
		expect(newEntities).toHaveLength(1)
		expect(newEntities[0]?.value).toBe('@bob')
	})

	test('matching is case-insensitive: @Handle matches @handle', () => {
		const current: EntityResult = {
			handles: [makeEntity('@Handle', 'handle')],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const previous: EntityResult = {
			handles: [makeEntity('@handle', 'handle')],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		// @Handle (current) matches @handle (previous) -- not new
		const newEntities = detectNewEntities(current, previous)
		expect(newEntities).toHaveLength(0)
	})

	test('same value but different type counts as new', () => {
		const current: EntityResult = {
			handles: [],
			subreddits: [],
			hashtags: [makeEntity('claude', 'hashtag')],
			terms: [],
		}
		const previous: EntityResult = {
			handles: [],
			subreddits: [],
			hashtags: [],
			terms: [makeEntity('claude', 'term')],
		}
		// 'claude' as hashtag is new; 'claude' as term is gone
		const newEntities = detectNewEntities(current, previous)
		expect(newEntities).toHaveLength(1)
		expect(newEntities[0]?.type).toBe('hashtag')
	})

	test('detects new entities across all types', () => {
		const previous: EntityResult = {
			handles: [makeEntity('@alice', 'handle')],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const current: EntityResult = {
			handles: [makeEntity('@alice', 'handle')],
			subreddits: [makeEntity('r/ml', 'subreddit')],
			hashtags: [makeEntity('#ai', 'hashtag')],
			terms: [makeEntity('llm', 'term')],
		}
		const newEntities = detectNewEntities(current, previous)
		// subreddit, hashtag, and term are all new
		expect(newEntities).toHaveLength(3)
	})
})

// ---------------------------------------------------------------------------
// detectGoneEntities
// ---------------------------------------------------------------------------

describe('detectGoneEntities', () => {
	test('returns all previous entities when current is empty', () => {
		const previous = fullResult()
		const gone = detectGoneEntities(emptyResult(), previous)
		expect(gone).toHaveLength(4)
	})

	test('returns empty array when both results are empty', () => {
		const gone = detectGoneEntities(emptyResult(), emptyResult())
		expect(gone).toHaveLength(0)
	})

	test('returns empty array when current and previous are identical', () => {
		const result = fullResult()
		const gone = detectGoneEntities(result, result)
		expect(gone).toHaveLength(0)
	})

	test('returns only entity absent from current', () => {
		const current: EntityResult = {
			handles: [makeEntity('@alice', 'handle')],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const previous: EntityResult = {
			handles: [makeEntity('@alice', 'handle'), makeEntity('@bob', 'handle')],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const gone = detectGoneEntities(current, previous)
		expect(gone).toHaveLength(1)
		expect(gone[0]?.value).toBe('@bob')
	})

	test('case-insensitive: @Bob in previous matches @bob in current -- not gone', () => {
		const current: EntityResult = {
			handles: [makeEntity('@bob', 'handle')],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const previous: EntityResult = {
			handles: [makeEntity('@Bob', 'handle')],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const gone = detectGoneEntities(current, previous)
		expect(gone).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// detectRisingVoices
// ---------------------------------------------------------------------------

describe('detectRisingVoices', () => {
	test('returns empty array when both results are empty', () => {
		const rising = detectRisingVoices(emptyResult(), emptyResult())
		expect(rising).toHaveLength(0)
	})

	test('returns entity with higher engagement in current', () => {
		const current: EntityResult = {
			handles: [makeEntity('@alice', 'handle', 3, 800)],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const previous: EntityResult = {
			handles: [makeEntity('@alice', 'handle', 2, 500)],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const rising = detectRisingVoices(current, previous)
		expect(rising).toHaveLength(1)
		expect(rising[0]?.entity.value).toBe('@alice')
		expect(rising[0]?.engagementDelta).toBe(300)
		expect(rising[0]?.frequencyDelta).toBe(1)
	})

	test('does not include entities with equal engagement', () => {
		const entity = makeEntity('@alice', 'handle', 2, 500)
		const current: EntityResult = {
			handles: [entity],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const rising = detectRisingVoices(current, current)
		expect(rising).toHaveLength(0)
	})

	test('does not include entities with lower engagement', () => {
		const current: EntityResult = {
			handles: [makeEntity('@alice', 'handle', 2, 300)],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const previous: EntityResult = {
			handles: [makeEntity('@alice', 'handle', 3, 500)],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const rising = detectRisingVoices(current, previous)
		expect(rising).toHaveLength(0)
	})

	test('sorts by engagementDelta descending', () => {
		const current: EntityResult = {
			handles: [makeEntity('@alice', 'handle', 1, 200), makeEntity('@bob', 'handle', 1, 1000)],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const previous: EntityResult = {
			handles: [
				makeEntity('@alice', 'handle', 1, 100), // delta = +100
				makeEntity('@bob', 'handle', 1, 100), // delta = +900
			],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const rising = detectRisingVoices(current, previous)
		expect(rising).toHaveLength(2)
		// bob has the larger delta so comes first
		expect(rising[0]?.entity.value).toBe('@bob')
		expect(rising[1]?.entity.value).toBe('@alice')
	})

	test('does not include entities absent from previous', () => {
		const current: EntityResult = {
			handles: [makeEntity('@alice', 'handle', 1, 500)],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const rising = detectRisingVoices(current, emptyResult())
		expect(rising).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// detectFallingVoices
// ---------------------------------------------------------------------------

describe('detectFallingVoices', () => {
	test('returns empty array when both results are empty', () => {
		const falling = detectFallingVoices(emptyResult(), emptyResult())
		expect(falling).toHaveLength(0)
	})

	test('returns entity with lower engagement in current', () => {
		const current: EntityResult = {
			handles: [makeEntity('@alice', 'handle', 2, 200)],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const previous: EntityResult = {
			handles: [makeEntity('@alice', 'handle', 3, 500)],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const falling = detectFallingVoices(current, previous)
		expect(falling).toHaveLength(1)
		expect(falling[0]?.entity.value).toBe('@alice')
		expect(falling[0]?.engagementDelta).toBe(-300)
	})

	test('sorts by engagementDelta ascending (most negative first)', () => {
		const current: EntityResult = {
			handles: [
				makeEntity('@alice', 'handle', 1, 50), // delta = -450
				makeEntity('@bob', 'handle', 1, 400), // delta = -100
			],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const previous: EntityResult = {
			handles: [makeEntity('@alice', 'handle', 1, 500), makeEntity('@bob', 'handle', 1, 500)],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const falling = detectFallingVoices(current, previous)
		expect(falling).toHaveLength(2)
		// alice has the most negative delta so comes first
		expect(falling[0]?.entity.value).toBe('@alice')
		expect(falling[1]?.entity.value).toBe('@bob')
	})

	test('does not include entities absent from previous', () => {
		const current: EntityResult = {
			handles: [makeEntity('@alice', 'handle', 1, 50)],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const falling = detectFallingVoices(current, emptyResult())
		expect(falling).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// computeDelta
// ---------------------------------------------------------------------------

describe('computeDelta', () => {
	test('returns all-empty delta for two empty results', () => {
		const delta = computeDelta(emptyResult(), emptyResult())
		expect(delta.newEntities).toHaveLength(0)
		expect(delta.risingVoices).toHaveLength(0)
		expect(delta.fallingVoices).toHaveLength(0)
		expect(delta.goneEntities).toHaveLength(0)
	})

	test('returns correct delta for full scenario', () => {
		const previous: EntityResult = {
			handles: [makeEntity('@alice', 'handle', 2, 500)],
			subreddits: [makeEntity('r/ml', 'subreddit', 5, 2000)],
			hashtags: [],
			terms: [],
		}
		const current: EntityResult = {
			handles: [makeEntity('@alice', 'handle', 3, 800)], // rising
			subreddits: [], // gone
			hashtags: [makeEntity('#ai', 'hashtag', 1, 200)], // new
			terms: [],
		}
		const delta = computeDelta(current, previous)
		expect(delta.newEntities).toHaveLength(1)
		expect(delta.newEntities[0]?.value).toBe('#ai')
		expect(delta.risingVoices).toHaveLength(1)
		expect(delta.risingVoices[0]?.entity.value).toBe('@alice')
		expect(delta.fallingVoices).toHaveLength(0)
		expect(delta.goneEntities).toHaveLength(1)
		expect(delta.goneEntities[0]?.value).toBe('r/ml')
	})
})

// ---------------------------------------------------------------------------
// generateBriefing
// ---------------------------------------------------------------------------

describe('generateBriefing', () => {
	test('0 runs: returns empty briefing with null fields', () => {
		const briefing = generateBriefing('AI trends', [], 'daily')
		expect(briefing.topic).toBe('AI trends')
		expect(briefing.period).toBe('daily')
		expect(briefing.currentRun).toBeNull()
		expect(briefing.previousRun).toBeNull()
		expect(briefing.delta).toBeNull()
		expect(briefing.topEntities).toBeNull()
		expect(briefing.itemCount).toBe(0)
	})

	test('0 runs: generatedAt is a non-empty ISO string', () => {
		const briefing = generateBriefing('test', [], 'daily')
		expect(briefing.generatedAt).toBeTruthy()
		expect(briefing.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
	})

	test('1 run without summary: currentRun set, no delta', () => {
		const run = makeRun(1, '2026-02-18T10:00:00Z', 15)
		const briefing = generateBriefing('AI trends', [run], 'daily')
		expect(briefing.currentRun).not.toBeNull()
		expect(briefing.previousRun).toBeNull()
		expect(briefing.delta).toBeNull()
		expect(briefing.topEntities).toBeNull()
		expect(briefing.itemCount).toBe(15)
	})

	test('1 run with entities in summary: topEntities populated', () => {
		const run = makeRunWithSummary(1, '2026-02-18T10:00:00Z', fullResult(), 20)
		const briefing = generateBriefing('AI trends', [run], 'daily')
		expect(briefing.topEntities).not.toBeNull()
		expect(briefing.topEntities?.handles).toHaveLength(1)
		expect(briefing.itemCount).toBe(20)
	})

	test('2 runs with entity data: delta computed', () => {
		const curr = fullResult()
		const prev: EntityResult = {
			handles: [makeEntity('@alice', 'handle', 1, 200)],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const run1 = makeRunWithSummary(2, '2026-02-19T10:00:00Z', curr)
		const run2 = makeRunWithSummary(1, '2026-02-18T10:00:00Z', prev)
		const briefing = generateBriefing('AI trends', [run1, run2], 'daily')
		expect(briefing.delta).not.toBeNull()
		// r/machinelearning, #claude, transformer are new
		expect((briefing.delta?.newEntities.length ?? 0) >= 1).toBe(true)
	})

	test('2 runs, second has no entities: delta is null', () => {
		const curr = fullResult()
		const run1 = makeRunWithSummary(2, '2026-02-19T10:00:00Z', curr)
		const run2 = makeRun(1, '2026-02-18T10:00:00Z')
		const briefing = generateBriefing('AI trends', [run1, run2], 'daily')
		// No entity data in previous -- delta cannot be computed
		expect(briefing.delta).toBeNull()
	})

	test('invalid summary_json: gracefully handled, topEntities null', () => {
		const run: RunHistoryEntry & { summaryJson: string } = {
			...makeRun(1, '2026-02-18T10:00:00Z'),
			summaryJson: 'not-valid-json',
		}
		const briefing = generateBriefing('AI trends', [run], 'daily')
		expect(briefing.topEntities).toBeNull()
	})

	test('summary_json without entities key: topEntities null', () => {
		const run: RunHistoryEntry & { summaryJson: string } = {
			...makeRun(1, '2026-02-18T10:00:00Z'),
			summaryJson: JSON.stringify({ itemCount: 5 }),
		}
		const briefing = generateBriefing('AI trends', [run], 'daily')
		expect(briefing.topEntities).toBeNull()
		expect(briefing.itemCount).toBe(5)
	})

	test('weekly period is preserved in briefing', () => {
		const briefing = generateBriefing('Bun 1.2', [], 'weekly')
		expect(briefing.period).toBe('weekly')
	})
})

// ---------------------------------------------------------------------------
// renderBriefingMarkdown
// ---------------------------------------------------------------------------

describe('renderBriefingMarkdown', () => {
	test('renders header with topic and period', () => {
		const briefing = generateBriefing('Claude Code', [], 'daily')
		const md = renderBriefingMarkdown(briefing)
		expect(md).toContain('# Briefing: Claude Code')
		expect(md).toContain('**Period**: daily')
	})

	test('renders all expected section headings', () => {
		const briefing = generateBriefing('test', [], 'daily')
		const md = renderBriefingMarkdown(briefing)
		expect(md).toContain('## Summary')
		expect(md).toContain("## What's New")
		expect(md).toContain('## Rising')
		expect(md).toContain('## Falling')
		expect(md).toContain('## Gone')
		expect(md).toContain('## Top Entities')
	})

	test('0 runs: shows appropriate no-data messages', () => {
		const briefing = generateBriefing('test', [], 'daily')
		const md = renderBriefingMarkdown(briefing)
		expect(md).toContain('No runs recorded yet.')
		expect(md).toContain('No new entities detected.')
		expect(md).toContain('No rising voices.')
		expect(md).toContain('No falling voices.')
		expect(md).toContain('No entities dropped off.')
		expect(md).toContain('No entity data available.')
	})

	test('single run shows "No previous run"', () => {
		const run = makeRun(1, '2026-02-19T10:00:00Z')
		const briefing = generateBriefing('test', [run], 'daily')
		const md = renderBriefingMarkdown(briefing)
		expect(md).toContain('No previous run')
	})

	test('single run shows latest run timestamp and item count', () => {
		const run = makeRun(1, '2026-02-19T10:00:00Z', 42)
		const briefing = generateBriefing('test', [run], 'daily')
		const md = renderBriefingMarkdown(briefing)
		expect(md).toContain('2026-02-19T10:00:00Z')
		expect(md).toContain('42 items')
	})

	test('renders rising voices with engagement delta prefix', () => {
		const prev: EntityResult = {
			handles: [makeEntity('@alice', 'handle', 1, 100)],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const curr: EntityResult = {
			handles: [makeEntity('@alice', 'handle', 2, 600)],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const run1 = makeRunWithSummary(2, '2026-02-19T10:00:00Z', curr)
		const run2 = makeRunWithSummary(1, '2026-02-18T10:00:00Z', prev)
		const briefing = generateBriefing('test', [run1, run2], 'daily')
		const md = renderBriefingMarkdown(briefing)
		expect(md).toContain('+500')
		expect(md).toContain('@alice')
	})

	test('renders falling voices with negative engagement delta', () => {
		const prev: EntityResult = {
			handles: [makeEntity('@alice', 'handle', 3, 800)],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const curr: EntityResult = {
			handles: [makeEntity('@alice', 'handle', 1, 200)],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const run1 = makeRunWithSummary(2, '2026-02-19T10:00:00Z', curr)
		const run2 = makeRunWithSummary(1, '2026-02-18T10:00:00Z', prev)
		const briefing = generateBriefing('test', [run1, run2], 'daily')
		const md = renderBriefingMarkdown(briefing)
		expect(md).toContain('-600')
	})

	test('renders top entities from the latest run', () => {
		const run = makeRunWithSummary(1, '2026-02-19T10:00:00Z', fullResult())
		const briefing = generateBriefing('test', [run], 'daily')
		const md = renderBriefingMarkdown(briefing)
		expect(md).toContain('@alice')
		expect(md).toContain('r/machinelearning')
		expect(md).toContain('#claude')
		expect(md).toContain('transformer')
	})

	test('no new entities: shows "No new entities detected."', () => {
		const curr = fullResult()
		const run1 = makeRunWithSummary(2, '2026-02-19T10:00:00Z', curr)
		const run2 = makeRunWithSummary(1, '2026-02-18T10:00:00Z', curr)
		const briefing = generateBriefing('test', [run1, run2], 'daily')
		const md = renderBriefingMarkdown(briefing)
		expect(md).toContain('No new entities detected.')
	})

	test('renders new entities when present', () => {
		const prev = emptyResult()
		const curr: EntityResult = {
			handles: [makeEntity('@newuser', 'handle', 1, 100)],
			subreddits: [],
			hashtags: [],
			terms: [],
		}
		const run1 = makeRunWithSummary(2, '2026-02-19T10:00:00Z', curr)
		const run2 = makeRunWithSummary(1, '2026-02-18T10:00:00Z', prev)
		const briefing = generateBriefing('test', [run1, run2], 'daily')
		const md = renderBriefingMarkdown(briefing)
		expect(md).toContain('@newuser')
	})
})
