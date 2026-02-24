import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRedditResponse } from '../src/lib/openai-reddit'
import { scoreRedditItems } from '../src/lib/score'

function loadFixture(name: string): Record<string, unknown> {
	const path = join(process.cwd(), 'fixtures', name)
	return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
}

describe('openai reddit edge fixtures', () => {
	test('parseRedditResponse handles malformed fields safely', () => {
		const raw = loadFixture('openai_edge_cases.json')
		const items = parseRedditResponse(raw)

		expect(items.length).toBe(5)

		const byTitle = new Map(items.map((item) => [String(item.title), item]))

		const missingSub = byTitle.get('Missing Subreddit')!
		expect(missingSub.subreddit).toBe('')
		expect(missingSub.date).toBeNull()
		expect(missingSub.relevance).toBe(0.5)

		const nanRel = byTitle.get('NaN Relevance')!
		expect(nanRel.relevance).toBe(0.5)

		const valid = byTitle.get('Edge Case Valid')!
		expect(valid.relevance).toBe(0.9)

		for (const item of items) {
			const rel = Number(item.relevance)
			expect(Number.isFinite(rel)).toBe(true)
			expect(rel).toBeGreaterThanOrEqual(0)
			expect(rel).toBeLessThanOrEqual(1)
		}

		const scored = scoreRedditItems(items as any)
		for (const item of scored) {
			expect(Number.isFinite(item.score)).toBe(true)
		}
	})

	test('parseRedditResponse returns empty list when no JSON present', () => {
		const raw = loadFixture('openai_edge_cases_no_json.json')
		const items = parseRedditResponse(raw)
		expect(items.length).toBe(0)
	})
})
