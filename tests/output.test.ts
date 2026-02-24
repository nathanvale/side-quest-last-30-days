import { describe, expect, test } from 'bun:test'
import { EXIT_USAGE } from '../src/lib/exit-codes'
import type { DataEnvelope, ErrorEnvelope } from '../src/lib/output'
import { reportToJsonl, wrapReport } from '../src/lib/output'
import { createReport } from '../src/lib/schema'

function makeReport() {
	const report = createReport(
		'test topic',
		'2026-01-25',
		'2026-02-24',
		'both',
		'gpt-4o',
		'grok-3',
		30,
	)
	report.reddit = [
		{
			id: 'r1',
			title: 'Reddit Post 1',
			url: 'https://reddit.com/r/test/1',
			subreddit: 'test',
			date: '2026-02-10',
			date_confidence: 'high',
			engagement: { score: 100, num_comments: 50 },
			top_comments: [],
			comment_insights: [],
			relevance: 0.9,
			why_relevant: 'highly relevant',
			subs: { relevance: 90, recency: 80, engagement: 70 },
			score: 85,
		},
	]
	report.x = [
		{
			id: 'x1',
			text: 'X post about testing',
			url: 'https://x.com/user/status/1',
			author_handle: 'testuser',
			date: '2026-02-15',
			date_confidence: 'high',
			engagement: { likes: 200, reposts: 50 },
			relevance: 0.85,
			why_relevant: 'relevant post',
			subs: { relevance: 85, recency: 90, engagement: 60 },
			score: 78,
		},
	]
	return report
}

// ---------------------------------------------------------------------------
// wrapReport
// ---------------------------------------------------------------------------
describe('wrapReport', () => {
	test('wraps report in data envelope', () => {
		const report = makeReport()
		const envelope = wrapReport(report)
		expect(envelope.status).toBe('data')
		expect(envelope.schema_version).toBe('1')
		expect(envelope.data.topic).toBe('test topic')
		expect(envelope.data.days).toBe(30)
		expect(Array.isArray(envelope.data.reddit)).toBe(true)
		expect(Array.isArray(envelope.data.x)).toBe(true)
	})

	test('merges extras into data', () => {
		const report = makeReport()
		const envelope = wrapReport(report, {
			web_search_instructions: { topic: 'test' },
		})
		expect(envelope.data.web_search_instructions).toEqual({
			topic: 'test',
		})
	})

	test('envelope is valid JSON round-trip', () => {
		const report = makeReport()
		const envelope = wrapReport(report)
		const json = JSON.stringify(envelope)
		const parsed = JSON.parse(json) as DataEnvelope
		expect(parsed.status).toBe('data')
		expect(parsed.schema_version).toBe('1')
		expect(parsed.data.topic).toBe('test topic')
	})
})

// ---------------------------------------------------------------------------
// reportToJsonl
// ---------------------------------------------------------------------------
describe('reportToJsonl', () => {
	test('produces one line per item plus meta', () => {
		const report = makeReport()
		const lines = reportToJsonl(report)
		// 1 reddit + 1 x + 1 meta = 3 lines
		expect(lines.length).toBe(3)
	})

	test('each item line has source field', () => {
		const report = makeReport()
		const lines = reportToJsonl(report)
		const reddit = JSON.parse(lines[0]!) as { source: string }
		expect(reddit.source).toBe('reddit')
		const x = JSON.parse(lines[1]!) as { source: string }
		expect(x.source).toBe('x')
	})

	test('meta line has status and counts', () => {
		const report = makeReport()
		const lines = reportToJsonl(report)
		const meta = JSON.parse(lines[lines.length - 1]!) as {
			status: string
			reddit_count: number
			x_count: number
		}
		expect(meta.status).toBe('meta')
		expect(meta.reddit_count).toBe(1)
		expect(meta.x_count).toBe(1)
	})

	test('each line is valid JSON', () => {
		const report = makeReport()
		const lines = reportToJsonl(report)
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow()
		}
	})

	test('empty report produces only meta line', () => {
		const report = createReport('empty', '2026-01-25', '2026-02-24', 'both', null, null)
		const lines = reportToJsonl(report)
		expect(lines.length).toBe(1)
		const meta = JSON.parse(lines[0]!) as { status: string }
		expect(meta.status).toBe('meta')
	})

	test('includes youtube items when present', () => {
		const report = makeReport()
		report.youtube = [
			{
				id: 'yt1',
				title: 'YouTube Video',
				url: 'https://youtube.com/watch?v=1',
				channel: 'TestChannel',
				date: '2026-02-12',
				date_confidence: 'high',
				views: 1000,
				likes: 100,
				comments: 20,
				transcript_snippet: 'test snippet',
				engagement: null,
				relevance: 0.7,
				why_relevant: 'relevant video',
				subs: { relevance: 70, recency: 80, engagement: 50 },
				score: 65,
			},
		]
		const lines = reportToJsonl(report)
		// 1 reddit + 1 x + 1 youtube + 1 meta = 4
		expect(lines.length).toBe(4)
		const yt = JSON.parse(lines[2]!) as { source: string }
		expect(yt.source).toBe('youtube')
	})

	test('projects fields while preserving source', () => {
		const report = makeReport()
		const lines = reportToJsonl(report, ['title'])
		const reddit = JSON.parse(lines[0]!) as Record<string, unknown>
		expect(reddit.source).toBe('reddit')
		expect(reddit.title).toBe('Reddit Post 1')
		expect(reddit.id).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// CLI integration: --json flag
// ---------------------------------------------------------------------------
describe('cli --json flag', () => {
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

	test('--json produces data envelope', () => {
		const result = runCli(['test topic', '--mock', '--json'])
		expect(result.exitCode).toBe(0)
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as DataEnvelope
		expect(output.status).toBe('data')
		expect(output.data.topic).toBe('test topic')
		expect(output.data.days).toBe(30)
	})

	test('--jsonl produces valid JSONL', () => {
		const result = runCli(['test topic', '--mock', '--jsonl'])
		expect(result.exitCode).toBe(0)
		const stdout = new TextDecoder().decode(result.stdout).trim()
		const lines = stdout.split('\n')
		expect(lines.length).toBeGreaterThan(0)
		// Last line should be meta
		const meta = JSON.parse(lines[lines.length - 1]!) as {
			status: string
		}
		expect(meta.status).toBe('meta')
		// Each line should parse as JSON
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow()
		}
	})

	test('--quiet suppresses stderr progress', () => {
		const result = runCli(['test topic', '--mock', '--json', '--quiet'])
		expect(result.exitCode).toBe(0)
		const stderr = new TextDecoder().decode(result.stderr)
		// Quiet mode should not contain the banner or progress messages
		expect(stderr).not.toContain('/wots')
		expect(stderr).not.toContain('researching')
	})

	test('--emit=json still produces raw dict (backward compat)', () => {
		const result = runCli(['test topic', '--mock', '--emit=json'])
		expect(result.exitCode).toBe(0)
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as Record<string, unknown>
		// Raw dict does NOT have status wrapper
		expect(output.status).toBeUndefined()
		expect(output.topic).toBe('test topic')
	})
})

// ---------------------------------------------------------------------------
// Phase 4: Structured errors on stderr
// ---------------------------------------------------------------------------
describe('structured errors', () => {
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

	function runCliWithEnv(args: string[], env: Record<string, string>) {
		const testHome = '/tmp/wots-test-home'
		return Bun.spawnSync({
			cmd: [process.execPath, 'run', 'src/cli.ts', ...args],
			cwd: process.cwd(),
			env: { ...process.env, HOME: testHome, ...env },
			stdout: 'pipe',
			stderr: 'pipe',
		})
	}

	test('--json + error produces ErrorEnvelope on stderr', () => {
		const result = runCli(['--json', '--emit=invalid'])
		expect(result.exitCode).toBe(EXIT_USAGE)
		const stderr = new TextDecoder().decode(result.stderr).trim()
		const envelope = JSON.parse(stderr) as ErrorEnvelope
		expect(envelope.status).toBe('error')
		expect(envelope.error.code).toBe('INVALID_EMIT')
		expect(envelope.error.name).toBe('CliError')
	})

	test('--jsonl + error produces ErrorEnvelope on stderr', () => {
		const result = runCli(['--jsonl', '--emit=invalid'])
		expect(result.exitCode).toBe(EXIT_USAGE)
		const stderr = new TextDecoder().decode(result.stderr).trim()
		const envelope = JSON.parse(stderr) as ErrorEnvelope
		expect(envelope.status).toBe('error')
	})

	test('plain-text error without --json', () => {
		const result = runCli(['--emit=invalid'])
		expect(result.exitCode).toBe(EXIT_USAGE)
		const stderr = new TextDecoder().decode(result.stderr)
		expect(stderr).toContain('Error:')
		expect(stderr).toContain('Invalid --emit')
		// Should NOT be JSON
		expect(stderr).not.toContain('"status"')
	})

	test('auto-detected non-tty emits JSON error', () => {
		const result = runCli([])
		expect(result.exitCode).toBe(EXIT_USAGE)
		const stderr = new TextDecoder().decode(result.stderr).trim()
		const envelope = JSON.parse(stderr) as ErrorEnvelope
		expect(envelope.status).toBe('error')
		expect(envelope.error.code).toBe('MISSING_TOPIC')
	})

	test('missing API keys returns EXIT_UNAUTHORIZED', () => {
		const result = runCliWithEnv(['test topic', '--sources=reddit', '--json'], {
			OPENAI_API_KEY: '',
			XAI_API_KEY: 'test',
		})
		expect(result.exitCode).toBe(4)
		const stderr = new TextDecoder().decode(result.stderr).trim()
		const envelope = JSON.parse(stderr) as ErrorEnvelope
		expect(envelope.status).toBe('error')
		expect(envelope.error.code).toBe('MISSING_API_KEY')
	})
})
