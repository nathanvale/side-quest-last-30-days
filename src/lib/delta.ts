/**
 * Delta detection between consecutive research runs.
 *
 * Compares two EntityResult snapshots (current vs previous) and surfaces
 * what's new, what's rising, what's falling, and what has gone quiet.
 * All matching is case-insensitive and type-aware.
 */

import type { EntityResult, ExtractedEntity } from './entity-extract.js'

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** A single delta observation for an entity that exists in both runs. */
export interface DeltaEntry {
	/** The entity from the current run. */
	entity: ExtractedEntity
	/** Change in engagement weight from previous to current. */
	engagementDelta: number
	/** Change in frequency from previous to current. */
	frequencyDelta: number
}

/** Full delta report comparing two EntityResult runs. */
export interface DeltaReport {
	/** Entities present in current but absent in previous. */
	newEntities: ExtractedEntity[]
	/** Entities with increasing engagement, sorted by delta descending. */
	risingVoices: DeltaEntry[]
	/** Entities with decreasing engagement, sorted by delta ascending (most negative first). */
	fallingVoices: DeltaEntry[]
	/** Entities present in previous but absent in current. */
	goneEntities: ExtractedEntity[]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Flattens all entity arrays in an EntityResult into a single array.
 *
 * Combines handles, subreddits, hashtags, and terms into one list
 * for uniform iteration and lookup.
 *
 * @param result - The EntityResult to flatten.
 */
export function flattenEntities(result: EntityResult): ExtractedEntity[] {
	return [
		...result.handles,
		...result.subreddits,
		...result.hashtags,
		...result.terms,
	]
}

/**
 * Builds a lookup key for an entity that is used for matching across runs.
 *
 * Two entities match if their normalised value and type are identical.
 * Value is lowercased to handle case variance (e.g., "@Handle" vs "@handle").
 */
function entityKey(entity: ExtractedEntity): string {
	return `${entity.type}:${entity.value.toLowerCase()}`
}

/**
 * Builds a Map of entity key -> entity for O(1) cross-run lookup.
 *
 * @param entities - Flat list of entities to index.
 */
function buildIndex(entities: ExtractedEntity[]): Map<string, ExtractedEntity> {
	const map = new Map<string, ExtractedEntity>()
	for (const entity of entities) {
		map.set(entityKey(entity), entity)
	}
	return map
}

// ---------------------------------------------------------------------------
// Detection functions
// ---------------------------------------------------------------------------

/**
 * Detects entities that are present in the current run but absent in the
 * previous run.
 *
 * Matching is case-insensitive and type-aware: an entity in `current` is
 * considered "new" only if no entity in `previous` shares the same
 * normalised value and type.
 *
 * @param current  - EntityResult from the most recent run.
 * @param previous - EntityResult from the preceding run.
 */
export function detectNewEntities(
	current: EntityResult,
	previous: EntityResult,
): ExtractedEntity[] {
	const prevIndex = buildIndex(flattenEntities(previous))
	return flattenEntities(current).filter((e) => !prevIndex.has(entityKey(e)))
}

/**
 * Detects entities that were present in a previous run but are absent from
 * the current run.
 *
 * Matching is case-insensitive and type-aware -- the inverse of
 * `detectNewEntities`.
 *
 * @param current  - EntityResult from the most recent run.
 * @param previous - EntityResult from the preceding run.
 */
export function detectGoneEntities(
	current: EntityResult,
	previous: EntityResult,
): ExtractedEntity[] {
	const currIndex = buildIndex(flattenEntities(current))
	return flattenEntities(previous).filter((e) => !currIndex.has(entityKey(e)))
}

/**
 * Detects entities whose engagement weight has increased between runs.
 *
 * Only entities present in both runs are considered. Results are sorted by
 * engagement delta in descending order (largest gain first).
 *
 * @param current  - EntityResult from the most recent run.
 * @param previous - EntityResult from the preceding run.
 */
export function detectRisingVoices(
	current: EntityResult,
	previous: EntityResult,
): DeltaEntry[] {
	const prevIndex = buildIndex(flattenEntities(previous))
	const entries: DeltaEntry[] = []

	for (const entity of flattenEntities(current)) {
		const prev = prevIndex.get(entityKey(entity))
		if (!prev) continue
		const engagementDelta = entity.engagementWeight - prev.engagementWeight
		if (engagementDelta > 0) {
			entries.push({
				entity,
				engagementDelta,
				frequencyDelta: entity.frequency - prev.frequency,
			})
		}
	}

	return entries.sort((a, b) => b.engagementDelta - a.engagementDelta)
}

/**
 * Detects entities whose engagement weight has decreased between runs.
 *
 * Only entities present in both runs are considered. Results are sorted by
 * engagement delta in ascending order (most negative first).
 *
 * @param current  - EntityResult from the most recent run.
 * @param previous - EntityResult from the preceding run.
 */
export function detectFallingVoices(
	current: EntityResult,
	previous: EntityResult,
): DeltaEntry[] {
	const prevIndex = buildIndex(flattenEntities(previous))
	const entries: DeltaEntry[] = []

	for (const entity of flattenEntities(current)) {
		const prev = prevIndex.get(entityKey(entity))
		if (!prev) continue
		const engagementDelta = entity.engagementWeight - prev.engagementWeight
		if (engagementDelta < 0) {
			entries.push({
				entity,
				engagementDelta,
				frequencyDelta: entity.frequency - prev.frequency,
			})
		}
	}

	return entries.sort((a, b) => a.engagementDelta - b.engagementDelta)
}

/**
 * Computes a full DeltaReport comparing the current run to the previous run.
 *
 * Combines all four detection functions into a single report:
 * - `newEntities` -- appeared in current, absent in previous
 * - `risingVoices` -- present in both, engagement increased
 * - `fallingVoices` -- present in both, engagement decreased
 * - `goneEntities` -- present in previous, absent in current
 *
 * @param current  - EntityResult from the most recent run.
 * @param previous - EntityResult from the preceding run.
 */
export function computeDelta(
	current: EntityResult,
	previous: EntityResult,
): DeltaReport {
	return {
		newEntities: detectNewEntities(current, previous),
		risingVoices: detectRisingVoices(current, previous),
		fallingVoices: detectFallingVoices(current, previous),
		goneEntities: detectGoneEntities(current, previous),
	}
}
