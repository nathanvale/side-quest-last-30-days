/**
 * Search orchestrator.
 *
 * Runs adapters in parallel (phase 1). When strategy is 'two-phase',
 * extracts entities from phase 1 results and runs supplemental
 * searches (phase 2) on adapters that support it.
 *
 * The orchestrator owns concurrency and timeout concerns.
 * All source-specific logic (cache, retry, API calls) lives
 * inside the adapter implementations.
 */

import type { EntityResult } from '../entity-extract.js'
import { extractEntities } from '../entity-extract.js'
import {
	type AdapterSearchConfig,
	defaultOrchestratorConfig,
	type OrchestratorConfig,
	type PhaseResult,
	type SearchAdapter,
} from './types.js'

/**
 * Run search across all adapters, with optional phase 2 supplemental.
 *
 * Phase 1 runs all adapters in parallel. If strategy is 'two-phase',
 * entities are extracted from phase 1 results and supplemental
 * queries are dispatched to adapters that implement searchSupplemental.
 *
 * Returns one PhaseResult per adapter per phase, phase 1 first.
 */
export async function orchestrate(
	adapters: SearchAdapter[],
	searchConfig: AdapterSearchConfig,
	orchConfig: OrchestratorConfig = defaultOrchestratorConfig(),
): Promise<PhaseResult[]> {
	if (adapters.length === 0) return []

	// Phase 1: run all adapters in parallel
	const phase1Results = await runPhase1(adapters, searchConfig, orchConfig)

	// Single strategy -- return phase 1 only
	if (orchConfig.strategy === 'single') return phase1Results

	// Phase 2: extract entities from phase 1, run supplemental
	const allPhase1Items = phase1Results
		.filter((r) => !r.error)
		.flatMap((r) => r.items)

	const entities = extractEntities(allPhase1Items)

	const phase2Results = await runPhase2(
		adapters,
		searchConfig,
		entities,
		orchConfig,
	)

	return [...phase1Results, ...phase2Results]
}

/**
 * Run phase 1 search across all adapters in parallel.
 *
 * Each adapter is invoked with the same search config. Failures
 * in individual adapters are captured in the PhaseResult (error
 * field) rather than rejecting the whole orchestration.
 *
 * Returns one PhaseResult per adapter, in adapter order.
 */
async function runPhase1(
	adapters: SearchAdapter[],
	searchConfig: AdapterSearchConfig,
	orchConfig: OrchestratorConfig,
): Promise<PhaseResult[]> {
	const results = await Promise.allSettled(
		adapters.map((adapter) =>
			withTimeout(adapter.search(searchConfig), orchConfig.timeoutMs, adapter),
		),
	)

	return results.map((result, idx) => {
		if (result.status === 'fulfilled') {
			return result.value
		}

		// Adapter threw or timed out -- return error PhaseResult
		const adapter = adapters[idx]!
		return {
			items: [],
			source: adapter.sourceType,
			phase: 1 as const,
			error: String(result.reason),
			fromCache: false,
			cacheAgeHours: null,
			durationMs: 0,
		}
	})
}

/**
 * Run phase 2 supplemental searches using extracted entities.
 *
 * For each adapter that implements searchSupplemental, creates
 * supplemental queries based on extracted entities:
 * - Reddit adapters: top subreddits (up to phase2Budget)
 * - X adapters: top handles (up to phase2Budget)
 * - Other adapters: top terms (up to phase2Budget)
 *
 * All supplemental queries run in parallel. Failures are captured
 * per-query and do not affect other results.
 */
async function runPhase2(
	adapters: SearchAdapter[],
	searchConfig: AdapterSearchConfig,
	entities: EntityResult,
	orchConfig: OrchestratorConfig,
): Promise<PhaseResult[]> {
	const tasks: Array<{
		adapter: SearchAdapter
		entity: string
		entityType: 'handle' | 'subreddit' | 'hashtag' | 'term'
	}> = []

	for (const adapter of adapters) {
		if (!adapter.searchSupplemental) continue

		const candidates = getEntitiesForAdapter(adapter, entities)
		const budgeted = candidates.slice(0, orchConfig.phase2Budget)

		for (const candidate of budgeted) {
			tasks.push({
				adapter,
				entity: candidate.value,
				entityType: candidate.type,
			})
		}
	}

	if (tasks.length === 0) return []

	const results = await Promise.allSettled(
		tasks.map((task) =>
			withTimeout(
				task.adapter.searchSupplemental!(
					searchConfig,
					task.entity,
					task.entityType,
				),
				orchConfig.timeoutMs,
				task.adapter,
			),
		),
	)

	return results.map((result, idx) => {
		if (result.status === 'fulfilled') {
			return result.value
		}

		const task = tasks[idx]!
		return {
			items: [],
			source: task.adapter.sourceType,
			phase: 2 as const,
			error: String(result.reason),
			fromCache: false,
			cacheAgeHours: null,
			durationMs: 0,
		}
	})
}

/**
 * Select entities relevant to an adapter based on its source type.
 *
 * Reddit adapters get subreddits, X adapters get handles,
 * and other adapters get the top terms.
 */
function getEntitiesForAdapter(
	adapter: SearchAdapter,
	entities: EntityResult,
): Array<{ value: string; type: 'handle' | 'subreddit' | 'hashtag' | 'term' }> {
	switch (adapter.sourceType) {
		case 'reddit':
			return entities.subreddits
		case 'x':
			return entities.handles
		default:
			return entities.terms
	}
}

/**
 * Wrap a promise with a timeout.
 * Rejects with a descriptive error if the adapter exceeds timeoutMs.
 */
function withTimeout(
	promise: Promise<PhaseResult>,
	timeoutMs: number,
	adapter: SearchAdapter,
): Promise<PhaseResult> {
	if (timeoutMs <= 0) return promise

	return new Promise<PhaseResult>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(
				new Error(
					`${adapter.sourceType} adapter timed out after ${timeoutMs}ms`,
				),
			)
		}, timeoutMs)

		promise
			.then((result) => {
				clearTimeout(timer)
				resolve(result)
			})
			.catch((err) => {
				clearTimeout(timer)
				reject(err)
			})
	})
}
