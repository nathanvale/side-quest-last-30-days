/**
 * Query budget and weight policies per depth level.
 *
 * Controls how many results to request, how many phase 2
 * supplemental queries are allowed, and per-adapter timeouts.
 * Intent-based overrides will be layered on in PR-008.
 */

/** Query budget configuration. */
export interface QueryBudget {
	/** Max items to request per source. */
	maxResults: number
	/** Max supplemental queries per source in phase 2. */
	phase2Budget: number
	/** Per-adapter timeout in milliseconds. */
	timeoutMs: number
}

const BUDGETS: Record<string, QueryBudget> = {
	quick: { maxResults: 10, phase2Budget: 2, timeoutMs: 30_000 },
	default: { maxResults: 20, phase2Budget: 5, timeoutMs: 60_000 },
	deep: { maxResults: 50, phase2Budget: 10, timeoutMs: 120_000 },
}

/**
 * Get query budget for a depth level.
 *
 * Falls back to 'default' for unknown depth values.
 */
export function getQueryBudget(depth: string): QueryBudget {
	return BUDGETS[depth] ?? BUDGETS.default!
}
