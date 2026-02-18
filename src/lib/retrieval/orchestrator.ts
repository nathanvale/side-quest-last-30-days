/**
 * Search orchestrator.
 *
 * Runs adapters in parallel (phase 1). Phase 2 (entity-driven
 * supplemental search) is a no-op until PR-004 wires it in.
 *
 * The orchestrator owns concurrency and timeout concerns.
 * All source-specific logic (cache, retry, API calls) lives
 * inside the adapter implementations.
 */

import {
	type AdapterSearchConfig,
	defaultOrchestratorConfig,
	type OrchestratorConfig,
	type PhaseResult,
	type SearchAdapter,
} from './types.js'

/**
 * Run phase 1 search across all adapters in parallel.
 *
 * Each adapter is invoked with the same search config. Failures
 * in individual adapters are captured in the PhaseResult (error
 * field) rather than rejecting the whole orchestration.
 *
 * Returns one PhaseResult per adapter, in adapter order.
 */
export async function orchestrate(
	adapters: SearchAdapter[],
	searchConfig: AdapterSearchConfig,
	orchConfig: OrchestratorConfig = defaultOrchestratorConfig(),
): Promise<PhaseResult[]> {
	if (adapters.length === 0) return []

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
