import { describe, expect, test } from 'bun:test'
import { compareToOracle } from '../scripts/eval/oracle'
import type { EvalItem } from '../src/lib/eval-metrics'

describe('compareToOracle', () => {
	test('matches handle and hashtag entities using normalized variants', () => {
		const items: EvalItem[] = [
			{ date: null, score: 90, url: 'https://x.com/openai/status/123' },
			{ date: null, score: 80, url: 'https://example.com/topics/o3' },
		]
		expect(compareToOracle(items, ['@OpenAI', '#o3'])).toBe(1)
	})

	test('matches multi-word entities from title/snippet fields', () => {
		const items: EvalItem[] = [
			{
				date: null,
				score: 90,
				url: 'https://example.com/articles/one',
				title: 'System prompt engineering patterns',
			},
			{
				date: null,
				score: 85,
				url: 'https://example.com/articles/two',
				snippet: 'A practical guide to chain of thought prompting',
			},
		]
		expect(compareToOracle(items, ['system prompt', 'chain of thought'])).toBe(1)
	})

	test('returns 0 when oracle has entities but items are empty', () => {
		expect(compareToOracle([], ['r/reactjs'])).toBe(0)
	})

	test('returns 1 when oracle is empty', () => {
		const items: EvalItem[] = [{ date: null, score: 90, url: 'https://example.com' }]
		expect(compareToOracle(items, [])).toBe(1)
	})
})
