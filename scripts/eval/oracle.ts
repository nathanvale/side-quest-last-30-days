/** Oracle comparison logic for eval harness. */

import type { EvalItem } from '../../src/lib/eval-metrics.js'

/**
 * Compare search results against oracle entities.
 * Returns fraction of oracle entities found (case-insensitive substring match)
 * in the concatenated URLs of the result items.
 */
export function compareToOracle(
	items: EvalItem[],
	oracleEntities: string[],
): number {
	if (oracleEntities.length === 0) return 1
	if (items.length === 0) return 0
	const corpus = items.map((i) => i.url.toLowerCase()).join(' ')
	const found = oracleEntities.filter((entity) =>
		corpus.includes(entity.toLowerCase()),
	)
	return found.length / oracleEntities.length
}
