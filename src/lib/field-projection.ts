/**
 * Field projection for JSON output.
 *
 * Reduces output to only the fields specified by `--fields=x,y,z`.
 * Supports dot-path traversal (e.g. `engagement.likes`).
 */

/**
 * Parse a comma-separated field spec into an array of field paths.
 *
 * @param spec - Comma-separated field names, e.g. `'score,title,url'`.
 * @returns Array of trimmed, non-empty field paths.
 */
export function parseFieldSpec(spec: string): string[] {
	return spec
		.split(',')
		.map((f) => f.trim())
		.filter(Boolean)
}

/**
 * Get a value from an object by dot-path.
 *
 * @param obj  - The object to traverse.
 * @param path - Dot-separated path, e.g. `'engagement.likes'`.
 * @returns The value at the path, or `undefined` if not found.
 */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
	const parts = path.split('.')
	let current: unknown = obj
	for (const part of parts) {
		if (
			part === '__proto__' ||
			part === 'prototype' ||
			part === 'constructor'
		) {
			return undefined
		}
		if (current == null || typeof current !== 'object') return undefined
		const record = current as Record<string, unknown>
		if (!Object.hasOwn(record, part)) return undefined
		current = record[part]
	}
	return current
}

/**
 * Project specific fields from an item.
 *
 * @param item   - The item to project fields from.
 * @param fields - Array of field paths to include.
 * @returns A new object containing only the specified fields.
 */
export function projectFields(
	item: Record<string, unknown>,
	fields: string[],
): Record<string, unknown> {
	const result: Record<string, unknown> = {}
	for (const field of fields) {
		const value = getByPath(item, field)
		if (value !== undefined) {
			result[field] = value
		}
	}
	return result
}

/**
 * Apply field projection to all items in a report dict.
 *
 * Projects fields on `reddit[]`, `x[]`, `youtube[]`, and `web[]` arrays.
 * Non-array fields (topic, days, range, etc.) are preserved as-is.
 *
 * @param dict   - Report dict from `reportToDict()`.
 * @param fields - Array of field paths to project.
 * @returns A new dict with projected item arrays.
 */
export function projectReport(
	dict: Record<string, unknown>,
	fields: string[],
): Record<string, unknown> {
	if (fields.length === 0) return dict

	const result = { ...dict }
	const arrayKeys = ['reddit', 'x', 'youtube', 'web']

	for (const key of arrayKeys) {
		const arr = result[key]
		if (Array.isArray(arr)) {
			result[key] = arr.map((item: unknown) =>
				projectFields(item as Record<string, unknown>, fields),
			)
		}
	}

	return result
}
