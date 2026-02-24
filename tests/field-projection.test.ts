import { describe, expect, test } from 'bun:test'
import { parseFieldSpec, projectFields, projectReport } from '../src/lib/field-projection'
import type { DataEnvelope } from '../src/lib/output'

// ---------------------------------------------------------------------------
// parseFieldSpec
// ---------------------------------------------------------------------------
describe('parseFieldSpec', () => {
	test('splits comma-separated fields', () => {
		expect(parseFieldSpec('score,title,url')).toEqual(['score', 'title', 'url'])
	})

	test('trims whitespace', () => {
		expect(parseFieldSpec(' score , title , url ')).toEqual(['score', 'title', 'url'])
	})

	test('filters empty segments', () => {
		expect(parseFieldSpec('score,,title,')).toEqual(['score', 'title'])
	})

	test('handles single field', () => {
		expect(parseFieldSpec('score')).toEqual(['score'])
	})

	test('handles empty string', () => {
		expect(parseFieldSpec('')).toEqual([])
	})

	test('preserves dot-path fields', () => {
		expect(parseFieldSpec('score,engagement.likes,url')).toEqual([
			'score',
			'engagement.likes',
			'url',
		])
	})
})

// ---------------------------------------------------------------------------
// projectFields
// ---------------------------------------------------------------------------
describe('projectFields', () => {
	const item = {
		id: 'r1',
		title: 'Test Post',
		url: 'https://example.com',
		score: 85,
		engagement: { likes: 200, reposts: 50 },
		date: '2026-02-10',
	}

	test('projects specified top-level fields', () => {
		const result = projectFields(item, ['score', 'title'])
		expect(result).toEqual({ score: 85, title: 'Test Post' })
	})

	test('projects dot-path fields', () => {
		const result = projectFields(item, ['engagement.likes'])
		expect(result).toEqual({ 'engagement.likes': 200 })
	})

	test('omits missing fields', () => {
		const result = projectFields(item, ['score', 'nonexistent'])
		expect(result).toEqual({ score: 85 })
	})

	test('returns empty object for no matching fields', () => {
		const result = projectFields(item, ['foo', 'bar'])
		expect(result).toEqual({})
	})

	test('returns empty object for empty fields array', () => {
		const result = projectFields(item, [])
		expect(result).toEqual({})
	})

	test('handles deeply nested paths', () => {
		const deep = { a: { b: { c: 42 } } }
		const result = projectFields(deep, ['a.b.c'])
		expect(result).toEqual({ 'a.b.c': 42 })
	})

	test('handles null/undefined in path traversal', () => {
		const obj = { a: null }
		const result = projectFields(obj as Record<string, unknown>, ['a.b'])
		expect(result).toEqual({})
	})

	test('blocks __proto__ traversal', () => {
		const obj = { safe: 'value' }
		const result = projectFields(obj, ['__proto__'])
		expect(result).toEqual({})
	})

	test('blocks constructor traversal', () => {
		const obj = { safe: 'value' }
		const result = projectFields(obj, ['constructor'])
		expect(result).toEqual({})
	})

	test('blocks prototype traversal in dot-path', () => {
		const obj = { safe: 'value' }
		const result = projectFields(obj, ['constructor.prototype'])
		expect(result).toEqual({})
	})

	test('blocks __proto__ in nested dot-path', () => {
		const obj = { a: { b: 'value' } }
		const result = projectFields(obj, ['a.__proto__'])
		expect(result).toEqual({})
	})
})

// ---------------------------------------------------------------------------
// projectReport
// ---------------------------------------------------------------------------
describe('projectReport', () => {
	const report: Record<string, unknown> = {
		topic: 'test',
		days: 30,
		reddit: [
			{ id: 'r1', title: 'Reddit Post', score: 85, url: 'https://reddit.com/1' },
			{ id: 'r2', title: 'Reddit Post 2', score: 70, url: 'https://reddit.com/2' },
		],
		x: [{ id: 'x1', text: 'X post', score: 78, url: 'https://x.com/1' }],
		youtube: [{ id: 'yt1', title: 'Video', score: 65, url: 'https://youtube.com/1' }],
		web: [],
	}

	test('projects fields on all source arrays', () => {
		const result = projectReport(report, ['score', 'url'])
		const reddit = result.reddit as Record<string, unknown>[]
		expect(reddit).toEqual([
			{ score: 85, url: 'https://reddit.com/1' },
			{ score: 70, url: 'https://reddit.com/2' },
		])
		const x = result.x as Record<string, unknown>[]
		expect(x).toEqual([{ score: 78, url: 'https://x.com/1' }])
		const yt = result.youtube as Record<string, unknown>[]
		expect(yt).toEqual([{ score: 65, url: 'https://youtube.com/1' }])
	})

	test('preserves non-array fields', () => {
		const result = projectReport(report, ['score'])
		expect(result.topic).toBe('test')
		expect(result.days).toBe(30)
	})

	test('returns dict unchanged when fields array is empty', () => {
		const result = projectReport(report, [])
		expect(result).toBe(report) // same reference
	})

	test('handles missing source arrays', () => {
		const minimal = { topic: 'test', days: 7 }
		const result = projectReport(minimal, ['score'])
		expect(result.topic).toBe('test')
		expect(result.reddit).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// CLI integration: --fields flag
// ---------------------------------------------------------------------------
describe('cli --fields flag', () => {
	function runCli(args: string[]) {
		const testHome = '/tmp/wots-test-home'
		return Bun.spawnSync({
			cmd: [process.execPath, 'run', 'src/cli.ts', ...args],
			cwd: process.cwd(),
			env: { ...process.env, HOME: testHome },
			stdout: 'pipe',
			stderr: 'pipe',
		})
	}

	test('--json --fields projects report fields', () => {
		const result = runCli(['test topic', '--mock', '--json', '--quiet', '--fields=score,title,url'])
		expect(result.exitCode).toBe(0)
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as DataEnvelope
		expect(output.status).toBe('data')
		// Reddit items should only have projected fields
		const reddit = output.data.reddit as Record<string, unknown>[]
		expect(reddit.length).toBeGreaterThan(0)
		const first = reddit[0]!
		expect(first.score).toBeDefined()
		expect(first.title).toBeDefined()
		expect(first.url).toBeDefined()
		// Non-projected fields should be absent
		expect(first.id).toBeUndefined()
		expect(first.subreddit).toBeUndefined()
	})

	test('--jsonl --fields projects item fields but preserves source', () => {
		const result = runCli(['test topic', '--mock', '--jsonl', '--quiet', '--fields=score,title'])
		expect(result.exitCode).toBe(0)
		const stdout = new TextDecoder().decode(result.stdout).trim()
		const lines = stdout.split('\n')
		expect(lines.length).toBeGreaterThan(1)

		// Check a non-meta line
		const first = JSON.parse(lines[0]!) as Record<string, unknown>
		expect(first.source).toBeDefined() // source always preserved
		expect(first.score).toBeDefined()
		// Non-projected fields should be absent
		expect(first.id).toBeUndefined()
		expect(first.url).toBeUndefined()

		// Meta line should be unmodified
		const meta = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>
		expect(meta.status).toBe('meta')
	})

	test('--emit=json --fields projects report fields', () => {
		const result = runCli(['test topic', '--mock', '--emit=json', '--fields=score,url'])
		expect(result.exitCode).toBe(0)
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as Record<string, unknown>
		// Raw dict (no envelope)
		expect(output.topic).toBe('test topic')
		const reddit = output.reddit as Record<string, unknown>[]
		expect(reddit.length).toBeGreaterThan(0)
		const first = reddit[0]!
		expect(first.score).toBeDefined()
		expect(first.url).toBeDefined()
		expect(first.id).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// CLI integration: agent auto-detection
// ---------------------------------------------------------------------------
describe('agent auto-detection', () => {
	function runCli(args: string[]) {
		const testHome = '/tmp/wots-test-home'
		return Bun.spawnSync({
			cmd: [process.execPath, 'run', 'src/cli.ts', ...args],
			cwd: process.cwd(),
			env: { ...process.env, HOME: testHome },
			stdout: 'pipe',
			stderr: 'pipe',
		})
	}

	test('--non-interactive forces JSON envelope output', () => {
		const result = runCli(['test topic', '--mock', '--non-interactive'])
		expect(result.exitCode).toBe(0)
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as DataEnvelope
		expect(output.status).toBe('data')
		expect(output.data.topic).toBe('test topic')
	})

	test('--non-interactive suppresses stderr progress', () => {
		const result = runCli(['test topic', '--mock', '--non-interactive'])
		expect(result.exitCode).toBe(0)
		const stderr = new TextDecoder().decode(result.stderr)
		expect(stderr).not.toContain('researching')
	})

	test('explicit --emit overrides auto-detection with --non-interactive', () => {
		const result = runCli(['test topic', '--mock', '--non-interactive', '--emit=md'])
		expect(result.exitCode).toBe(0)
		const stdout = new TextDecoder().decode(result.stdout)
		// Should be markdown, not JSON
		expect(stdout).toContain('#')
		expect(() => JSON.parse(stdout)).toThrow()
	})
})
