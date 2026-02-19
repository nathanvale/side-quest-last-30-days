import { describe, expect, test } from 'bun:test'
import type { ExtractedEntity } from '../src/lib/entity-extract.js'
import {
	extractEntities,
	extractHandles,
	extractHashtags,
	extractRepeatedTerms,
	extractSubreddits,
	filterStopwords,
	rankEntities,
} from '../src/lib/entity-extract.js'
import { defaultRedditItem, defaultWebSearchItem, defaultXItem } from '../src/lib/schema.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function xItem(
	overrides: Partial<Parameters<typeof defaultXItem>[0]> & {
		text: string
		author_handle: string
	},
) {
	return defaultXItem({
		id: overrides.id ?? `x-${Math.random().toString(36).slice(2, 8)}`,
		url: overrides.url ?? 'https://x.com/test/1',
		...overrides,
	})
}

function redditItem(
	overrides: Partial<Parameters<typeof defaultRedditItem>[0]> & {
		title: string
		subreddit: string
	},
) {
	return defaultRedditItem({
		id: overrides.id ?? `reddit-${Math.random().toString(36).slice(2, 8)}`,
		url: overrides.url ?? 'https://reddit.com/r/test/1',
		...overrides,
	})
}

function webItem(
	overrides: Partial<Parameters<typeof defaultWebSearchItem>[0]> & {
		title: string
		snippet: string
	},
) {
	return defaultWebSearchItem({
		id: overrides.id ?? `web-${Math.random().toString(36).slice(2, 8)}`,
		url: overrides.url ?? 'https://example.com/1',
		source_domain: overrides.source_domain ?? 'example.com',
		...overrides,
	})
}

// ---------------------------------------------------------------------------
// extractHandles
// ---------------------------------------------------------------------------

describe('extractHandles', () => {
	test('extracts @handles from text field', () => {
		const items = [
			xItem({
				text: 'Great take by @anthropic on AI safety',
				author_handle: '@testuser',
			}),
		]
		const result = extractHandles(items)
		const values = result.map((e) => e.value)
		expect(values).toContain('@anthropic')
		expect(values).toContain('@testuser')
	})

	test('extracts author_handle field', () => {
		const items = [xItem({ text: 'No handles here', author_handle: '@elonmusk' })]
		const result = extractHandles(items)
		expect(result.map((e) => e.value)).toContain('@elonmusk')
	})

	test('case-insensitive dedup (@Foo and @foo = 1 entity)', () => {
		const items = [
			xItem({ text: 'Hello @Foo', author_handle: '@bar' }),
			xItem({ text: 'Hey @foo', author_handle: '@baz' }),
		]
		const result = extractHandles(items)
		const fooEntities = result.filter((e) => e.value === '@foo')
		expect(fooEntities).toHaveLength(1)
		expect(fooEntities[0].frequency).toBe(2)
	})

	test('accumulates engagement across items', () => {
		const items = [
			xItem({
				text: 'cc @anthropic',
				author_handle: '@a',
				engagement: { likes: 100 },
			}),
			xItem({
				text: '@anthropic is great',
				author_handle: '@b',
				engagement: { likes: 50 },
			}),
		]
		const result = extractHandles(items)
		const anthropic = result.find((e) => e.value === '@anthropic')
		expect(anthropic).toBeDefined()
		expect(anthropic!.engagementWeight).toBe(150)
		expect(anthropic!.frequency).toBe(2)
	})

	test('empty items array returns empty', () => {
		expect(extractHandles([])).toEqual([])
	})

	test('text with no handles returns only author_handle', () => {
		const items = [
			xItem({
				text: 'Just a plain tweet',
				author_handle: '@someone',
			}),
		]
		const result = extractHandles(items)
		expect(result).toHaveLength(1)
		expect(result[0].value).toBe('@someone')
	})

	test('mixed text with URLs and noisy content', () => {
		const items = [
			xItem({
				text: 'Check https://t.co/abc @realuser wrote this! 🚀',
				author_handle: '@poster',
			}),
		]
		const result = extractHandles(items)
		const values = result.map((e) => e.value)
		expect(values).toContain('@realuser')
		expect(values).toContain('@poster')
	})
})

// ---------------------------------------------------------------------------
// extractSubreddits
// ---------------------------------------------------------------------------

describe('extractSubreddits', () => {
	test('extracts from subreddit field', () => {
		const items = [redditItem({ title: 'Hello world', subreddit: 'MachineLearning' })]
		const result = extractSubreddits(items)
		expect(result.map((e) => e.value)).toContain('r/machinelearning')
	})

	test('extracts r/ mentions from title', () => {
		const items = [
			redditItem({
				title: 'Also posted in r/LocalLLaMA',
				subreddit: 'machinelearning',
			}),
		]
		const result = extractSubreddits(items)
		const values = result.map((e) => e.value)
		expect(values).toContain('r/machinelearning')
		expect(values).toContain('r/localllama')
	})

	test('case-insensitive dedup', () => {
		const items = [
			redditItem({ title: 'Post 1', subreddit: 'Python' }),
			redditItem({ title: 'Post 2', subreddit: 'python' }),
		]
		const result = extractSubreddits(items)
		const pythonEntities = result.filter((e) => e.value === 'r/python')
		expect(pythonEntities).toHaveLength(1)
		expect(pythonEntities[0].frequency).toBe(2)
	})

	test('empty items returns empty', () => {
		expect(extractSubreddits([])).toEqual([])
	})

	test('ignores empty subreddit values', () => {
		const items = [
			redditItem({ title: 'Missing subreddit', subreddit: '' }),
			redditItem({ title: 'Whitespace subreddit', subreddit: '   ' }),
			redditItem({ title: 'Valid subreddit', subreddit: 'python' }),
		]
		const result = extractSubreddits(items)
		const values = result.map((e) => e.value)
		expect(values).toContain('r/python')
		expect(values).not.toContain('r/')
	})
})

// ---------------------------------------------------------------------------
// extractHashtags
// ---------------------------------------------------------------------------

describe('extractHashtags', () => {
	test('extracts #hashtags from mixed item types', () => {
		const items = [
			xItem({
				text: 'Big news #AI #LLMs',
				author_handle: '@user',
			}),
			redditItem({
				title: 'Trending #AI today',
				subreddit: 'tech',
			}),
			webItem({
				title: 'Article',
				snippet: 'The #AI revolution continues',
			}),
		]
		const result = extractHashtags(items)
		const ai = result.find((e) => e.value === '#ai')
		expect(ai).toBeDefined()
		expect(ai!.frequency).toBe(3)
		expect(result.find((e) => e.value === '#llms')).toBeDefined()
	})

	test('minimum 2 chars, maximum 30', () => {
		const items = [
			xItem({
				text: '#a #ab #validtag',
				author_handle: '@u',
			}),
		]
		const result = extractHashtags(items)
		const values = result.map((e) => e.value)
		expect(values).not.toContain('#a')
		expect(values).toContain('#ab')
		expect(values).toContain('#validtag')
	})

	test('case-insensitive dedup', () => {
		const items = [
			xItem({ text: '#AI', author_handle: '@a' }),
			xItem({ text: '#ai', author_handle: '@b' }),
		]
		const result = extractHashtags(items)
		expect(result.filter((e) => e.value === '#ai')).toHaveLength(1)
	})

	test('empty items returns empty', () => {
		expect(extractHashtags([])).toEqual([])
	})
})

// ---------------------------------------------------------------------------
// extractRepeatedTerms
// ---------------------------------------------------------------------------

describe('extractRepeatedTerms', () => {
	test('finds terms appearing in >= minCount items', () => {
		const items = [
			xItem({ text: 'claude is amazing', author_handle: '@a' }),
			xItem({ text: 'claude model release', author_handle: '@b' }),
			xItem({ text: 'claude beats gpt', author_handle: '@c' }),
		]
		const result = extractRepeatedTerms(items)
		const values = result.map((e) => e.value)
		expect(values).toContain('claude')
	})

	test('respects custom minCount', () => {
		const items = [
			xItem({ text: 'claude rocks', author_handle: '@a' }),
			xItem({ text: 'claude rules', author_handle: '@b' }),
		]
		// Default minCount=3 should not include "claude"
		expect(extractRepeatedTerms(items).map((e) => e.value)).not.toContain('claude')
		// minCount=2 should include it
		expect(extractRepeatedTerms(items, 2).map((e) => e.value)).toContain('claude')
	})

	test('filters stopwords', () => {
		const items = [
			xItem({ text: 'the big model', author_handle: '@a' }),
			xItem({ text: 'the big release', author_handle: '@b' }),
			xItem({ text: 'the big update', author_handle: '@c' }),
		]
		const result = extractRepeatedTerms(items)
		const values = result.map((e) => e.value)
		expect(values).not.toContain('the')
		expect(values).toContain('big')
	})

	test('empty items returns empty', () => {
		expect(extractRepeatedTerms([])).toEqual([])
	})

	test('single item with minCount=1', () => {
		const items = [xItem({ text: 'unique term here', author_handle: '@a' })]
		const result = extractRepeatedTerms(items, 1)
		const values = result.map((e) => e.value)
		expect(values).toContain('unique')
		expect(values).toContain('term')
		// "here" is a stopword
		expect(values).not.toContain('here')
	})
})

// ---------------------------------------------------------------------------
// rankEntities
// ---------------------------------------------------------------------------

describe('rankEntities', () => {
	test('higher frequency + engagement ranks higher', () => {
		const entities: ExtractedEntity[] = [
			{
				value: '@low',
				type: 'handle',
				frequency: 1,
				engagementWeight: 0,
			},
			{
				value: '@high',
				type: 'handle',
				frequency: 10,
				engagementWeight: 1000,
			},
			{
				value: '@mid',
				type: 'handle',
				frequency: 5,
				engagementWeight: 100,
			},
		]
		const ranked = rankEntities(entities)
		expect(ranked[0].value).toBe('@high')
		expect(ranked[ranked.length - 1].value).toBe('@low')
	})

	test('stable sort for ties', () => {
		const entities: ExtractedEntity[] = [
			{
				value: '@first',
				type: 'handle',
				frequency: 1,
				engagementWeight: 0,
			},
			{
				value: '@second',
				type: 'handle',
				frequency: 1,
				engagementWeight: 0,
			},
		]
		const ranked = rankEntities(entities)
		expect(ranked[0].value).toBe('@first')
		expect(ranked[1].value).toBe('@second')
	})

	test('empty array returns empty', () => {
		expect(rankEntities([])).toEqual([])
	})

	test('clamps negative engagement to keep ranking stable', () => {
		const entities: ExtractedEntity[] = [
			{
				value: '@low',
				type: 'handle',
				frequency: 1,
				engagementWeight: -5,
			},
			{
				value: '@high',
				type: 'handle',
				frequency: 3,
				engagementWeight: 0,
			},
		]
		const ranked = rankEntities(entities)
		expect(ranked[0].value).toBe('@high')
		expect(ranked[1].value).toBe('@low')
	})
})

// ---------------------------------------------------------------------------
// filterStopwords
// ---------------------------------------------------------------------------

describe('filterStopwords', () => {
	test('removes known stopword terms', () => {
		const entities: ExtractedEntity[] = [
			{
				value: 'the',
				type: 'term',
				frequency: 5,
				engagementWeight: 0,
			},
			{
				value: 'claude',
				type: 'term',
				frequency: 3,
				engagementWeight: 0,
			},
			{
				value: 'with',
				type: 'term',
				frequency: 4,
				engagementWeight: 0,
			},
		]
		const filtered = filterStopwords(entities)
		expect(filtered.map((e) => e.value)).toEqual(['claude'])
	})

	test('removes known bot handles', () => {
		const entities: ExtractedEntity[] = [
			{
				value: '@bot',
				type: 'handle',
				frequency: 2,
				engagementWeight: 0,
			},
			{
				value: '@automod',
				type: 'handle',
				frequency: 1,
				engagementWeight: 0,
			},
			{
				value: '@realuser',
				type: 'handle',
				frequency: 3,
				engagementWeight: 100,
			},
		]
		const filtered = filterStopwords(entities)
		expect(filtered.map((e) => e.value)).toEqual(['@realuser'])
	})

	test('preserves non-stopword entities', () => {
		const entities: ExtractedEntity[] = [
			{
				value: '#ai',
				type: 'hashtag',
				frequency: 5,
				engagementWeight: 100,
			},
			{
				value: 'r/python',
				type: 'subreddit',
				frequency: 3,
				engagementWeight: 50,
			},
		]
		const filtered = filterStopwords(entities)
		expect(filtered).toHaveLength(2)
	})

	test('empty array returns empty', () => {
		expect(filterStopwords([])).toEqual([])
	})
})

// ---------------------------------------------------------------------------
// extractEntities (integration)
// ---------------------------------------------------------------------------

describe('extractEntities', () => {
	test('mixed Reddit + X items produce handles, subreddits, hashtags', () => {
		const items = [
			xItem({
				text: '@anthropic just released #claude3',
				author_handle: '@anthropic',
				engagement: { likes: 500 },
			}),
			xItem({
				text: '@anthropic leading #claude3 #ai',
				author_handle: '@user2',
				engagement: { likes: 200 },
			}),
			xItem({
				text: 'More #ai news from @openai',
				author_handle: '@user3',
				engagement: { likes: 100 },
			}),
			redditItem({
				title: 'Discussion on #claude3 models',
				subreddit: 'MachineLearning',
				engagement: { score: 300 },
			}),
			redditItem({
				title: 'New findings in r/LocalLLaMA',
				subreddit: 'machinelearning',
				engagement: { score: 150 },
			}),
		]

		const result = extractEntities(items)

		// Handles from X only
		expect(result.handles.length).toBeGreaterThan(0)
		expect(result.handles.map((e) => e.value)).toContain('@anthropic')

		// Subreddits from Reddit only
		expect(result.subreddits.length).toBeGreaterThan(0)
		expect(result.subreddits.map((e) => e.value)).toContain('r/machinelearning')

		// Hashtags from all sources
		expect(result.hashtags.length).toBeGreaterThan(0)
		expect(result.hashtags.map((e) => e.value)).toContain('#claude3')
	})

	test('results are ranked', () => {
		const items = [
			xItem({
				text: '@popular rocks',
				author_handle: '@popular',
				engagement: { likes: 1000 },
			}),
			xItem({
				text: '@popular again',
				author_handle: '@popular',
				engagement: { likes: 500 },
			}),
			xItem({
				text: 'hello world',
				author_handle: '@obscure',
				engagement: { likes: 1 },
			}),
		]

		const result = extractEntities(items)
		// @popular should rank above @obscure
		const popularIdx = result.handles.findIndex((e) => e.value === '@popular')
		const obscureIdx = result.handles.findIndex((e) => e.value === '@obscure')
		expect(popularIdx).toBeLessThan(obscureIdx)
	})

	test('handles come from X items only', () => {
		const items = [
			redditItem({
				title: 'Post mentioning @someone',
				subreddit: 'test',
			}),
		]
		const result = extractEntities(items)
		// Even though Reddit title mentions @someone, handles only from X
		expect(result.handles).toEqual([])
	})

	test('subreddits come from Reddit items only', () => {
		const items = [
			xItem({
				text: 'Check r/machinelearning',
				author_handle: '@user',
			}),
		]
		const result = extractEntities(items)
		expect(result.subreddits).toEqual([])
	})
})
