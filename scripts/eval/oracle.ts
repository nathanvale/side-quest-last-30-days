/** Oracle comparison logic for eval harness. */

import type { EvalItem } from '../../src/lib/eval-metrics.js'

/** Build normalized match variants for oracle entities. */
function toEntityVariants(entity: string): string[] {
	const normalized = entity
		.toLowerCase()
		.trim()
		.replace(/^[@#]+/, '')
		.replace(/\s+/g, ' ')
	if (!normalized) return []
	return [
		normalized,
		normalized.replace(/\s+/g, '-'),
		normalized.replace(/\s+/g, '_'),
		encodeURIComponent(normalized),
	]
}

/**
 * Compare search results against oracle entities.
 * Returns fraction of oracle entities found in a normalized corpus of
 * url/title/snippet/content text, including @/# and multi-word variants.
 */
export function compareToOracle(
	items: EvalItem[],
	oracleEntities: string[],
): number {
	if (oracleEntities.length === 0) return 1
	if (items.length === 0) return 0
	const corpus = items
		.flatMap((item) => [
			item.url,
			item.title ?? '',
			item.snippet ?? '',
			item.content ?? '',
		])
		.map((text) => text.toLowerCase())
		.join(' ')
	const found = oracleEntities.filter((entity) =>
		toEntityVariants(entity).some((variant) => corpus.includes(variant)),
	)
	return found.length / oracleEntities.length
}
