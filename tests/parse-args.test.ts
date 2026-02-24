import { describe, expect, test } from 'bun:test'

import { EXIT_USAGE } from '../src/lib/exit-codes'
import type {
	BriefingCommand,
	HelpCommand,
	SearchCommand,
	WatchCommand,
} from '../src/lib/parse-args'
import { parseCliArgs } from '../src/lib/parse-args'

// ---------------------------------------------------------------------------
// Search command (default)
// ---------------------------------------------------------------------------
describe('parseCliArgs: search', () => {
	test('parses a basic topic', () => {
		const result = parseCliArgs(['Claude Code'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.command).toBe('search')
		const cmd = result.value as SearchCommand
		expect(cmd.topic).toBe('Claude Code')
		expect(cmd.emit).toBe('compact')
		expect(cmd.emitExplicit).toBe(false)
		expect(cmd.days).toBe(30)
		expect(cmd.mock).toBe(false)
	})

	test('parses multi-word topic', () => {
		const result = parseCliArgs(['React', 'Server', 'Components'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as SearchCommand
		expect(cmd.topic).toBe('React Server Components')
	})

	test('parses --mock --emit=json --days=7', () => {
		const result = parseCliArgs(['test', '--mock', '--emit=json', '--days=7'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as SearchCommand
		expect(cmd.mock).toBe(true)
		expect(cmd.emit).toBe('json')
		expect(cmd.days).toBe(7)
	})

	test('parses --emit json (space-separated)', () => {
		const result = parseCliArgs(['test', '--emit', 'json'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as SearchCommand
		expect(cmd.emit).toBe('json')
		expect(cmd.emitExplicit).toBe(true)
	})

	test('parses --emit=compact as explicit', () => {
		const result = parseCliArgs(['test', '--emit=compact'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as SearchCommand
		expect(cmd.emit).toBe('compact')
		expect(cmd.emitExplicit).toBe(true)
	})

	test('parses --sources=reddit', () => {
		const result = parseCliArgs(['test', '--sources=reddit'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as SearchCommand
		expect(cmd.sources).toBe('reddit')
	})

	test('parses --quick and --deep flags', () => {
		const quick = parseCliArgs(['test', '--quick'])
		expect(quick.ok).toBe(true)
		if (quick.ok) expect((quick.value as SearchCommand).quick).toBe(true)

		const deep = parseCliArgs(['test', '--deep'])
		expect(deep.ok).toBe(true)
		if (deep.ok) expect((deep.value as SearchCommand).deep).toBe(true)
	})

	test('parses --fast and --cheap flags', () => {
		const fast = parseCliArgs(['test', '--fast'])
		expect(fast.ok).toBe(true)
		if (fast.ok) expect((fast.value as SearchCommand).fast).toBe(true)

		const cheap = parseCliArgs(['test', '--cheap'])
		expect(cheap.ok).toBe(true)
		if (cheap.ok) expect((cheap.value as SearchCommand).cheap).toBe(true)
	})

	test('parses --include-web and --include-youtube', () => {
		const result = parseCliArgs(['test', '--include-web', '--include-youtube'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as SearchCommand
		expect(cmd.includeWeb).toBe(true)
		expect(cmd.includeYoutube).toBe(true)
	})

	test('parses --refresh and --no-cache', () => {
		const result = parseCliArgs(['test', '--refresh', '--no-cache'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as SearchCommand
		expect(cmd.refresh).toBe(true)
		expect(cmd.noCache).toBe(true)
	})

	test('parses --outdir with = form', () => {
		const result = parseCliArgs(['test', '--outdir=/tmp/out'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as SearchCommand
		expect(cmd.outdir).toBe('/tmp/out')
	})

	test('parses --strategy=two-phase', () => {
		const result = parseCliArgs(['test', '--strategy=two-phase'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as SearchCommand
		expect(cmd.strategy).toBe('two-phase')
	})

	test('parses --phase2-budget=3', () => {
		const result = parseCliArgs(['test', '--phase2-budget=3'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as SearchCommand
		expect(cmd.phase2Budget).toBe(3)
	})

	test('parses --query-type=news', () => {
		const result = parseCliArgs(['test', '--query-type=news'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as SearchCommand
		expect(cmd.queryType).toBe('news')
	})

	test('rejects unknown flag', () => {
		const result = parseCliArgs(['test', '--unknown-flag'])
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.exitCode).toBe(EXIT_USAGE)
		expect(result.error.code).toBe('UNKNOWN_FLAG')
	})

	test('rejects invalid --emit', () => {
		const result = parseCliArgs(['test', '--emit=invalid'])
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.code).toBe('INVALID_EMIT')
	})

	test('rejects invalid --sources', () => {
		const result = parseCliArgs(['test', '--sources=invalid'])
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.code).toBe('INVALID_SOURCES')
	})

	test('rejects invalid --strategy', () => {
		const result = parseCliArgs(['test', '--strategy=invalid'])
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.code).toBe('INVALID_STRATEGY')
	})

	test('rejects --phase2-budget=0', () => {
		const result = parseCliArgs(['test', '--phase2-budget=0'])
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.code).toBe('INVALID_BUDGET')
	})

	test('rejects invalid --query-type', () => {
		const result = parseCliArgs(['test', '--query-type=invalid'])
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.code).toBe('INVALID_QUERY_TYPE')
	})
})

// ---------------------------------------------------------------------------
// Global flags
// ---------------------------------------------------------------------------
describe('parseCliArgs: global flags', () => {
	test('parses --json', () => {
		const result = parseCliArgs(['test', '--json'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.json).toBe(true)
	})

	test('parses --jsonl', () => {
		const result = parseCliArgs(['test', '--jsonl'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.jsonl).toBe(true)
	})

	test('parses --quiet', () => {
		const result = parseCliArgs(['test', '--quiet'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.quiet).toBe(true)
	})

	test('parses --non-interactive', () => {
		const result = parseCliArgs(['test', '--non-interactive'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.nonInteractive).toBe(true)
	})

	test('parses --fields=score,title,url', () => {
		const result = parseCliArgs(['test', '--fields=score,title,url'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.fields).toEqual(['score', 'title', 'url'])
	})

	test('parses --fields with space-separated value', () => {
		const result = parseCliArgs(['test', '--fields', 'score,title'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.fields).toEqual(['score', 'title'])
	})

	test('rejects --json + --jsonl', () => {
		const result = parseCliArgs(['test', '--json', '--jsonl'])
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.code).toBe('CONFLICT_FLAGS')
	})

	test('global flags are stripped before subcommand parsing', () => {
		const result = parseCliArgs(['--json', 'test', '--mock'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.command).toBe('search')
		expect(result.value.json).toBe(true)
		expect((result.value as SearchCommand).mock).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// Help command
// ---------------------------------------------------------------------------
describe('parseCliArgs: help', () => {
	test('help command with default topic', () => {
		const result = parseCliArgs(['help'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.command).toBe('help')
		expect((result.value as HelpCommand).helpTopic).toBe('overview')
	})

	test('help with specific topic', () => {
		const result = parseCliArgs(['help', 'contract'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect((result.value as HelpCommand).helpTopic).toBe('contract')
	})

	test('--help flag', () => {
		const result = parseCliArgs(['--help'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.command).toBe('help')
	})

	test('-h flag', () => {
		const result = parseCliArgs(['-h'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.command).toBe('help')
	})

	test('--help inside search args returns help', () => {
		const result = parseCliArgs(['test', '--help'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.command).toBe('help')
	})
})

// ---------------------------------------------------------------------------
// Watch command
// ---------------------------------------------------------------------------
describe('parseCliArgs: watch', () => {
	test('watch add with topic', () => {
		const result = parseCliArgs(['watch', 'add', 'Claude Code'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as WatchCommand
		expect(cmd.command).toBe('watch')
		expect(cmd.subcommand).toBe('add')
		expect(cmd.topic).toBe('Claude Code')
	})

	test('watch add with --every=daily', () => {
		const result = parseCliArgs(['watch', 'add', 'Bun', '--every=daily'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as WatchCommand
		expect(cmd.schedule).toBe('daily')
	})

	test('watch list', () => {
		const result = parseCliArgs(['watch', 'list'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as WatchCommand
		expect(cmd.subcommand).toBe('list')
	})

	test('watch remove with topic', () => {
		const result = parseCliArgs(['watch', 'remove', 'Claude Code'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as WatchCommand
		expect(cmd.subcommand).toBe('remove')
		expect(cmd.topic).toBe('Claude Code')
	})

	test('watch history with --limit=5', () => {
		const result = parseCliArgs(['watch', 'history', 'Bun', '--limit=5'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as WatchCommand
		expect(cmd.subcommand).toBe('history')
		expect(cmd.limit).toBe(5)
	})

	test('watch add rejects missing topic', () => {
		const result = parseCliArgs(['watch', 'add'])
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.code).toBe('MISSING_TOPIC')
	})

	test('watch rejects unknown subcommand', () => {
		const result = parseCliArgs(['watch', 'nope'])
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.code).toBe('UNKNOWN_SUBCOMMAND')
	})

	test('watch add rejects invalid --every', () => {
		const result = parseCliArgs(['watch', 'add', 'test', '--every=hourly'])
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.code).toBe('INVALID_EVERY')
	})

	test('watch history rejects invalid --limit', () => {
		const result = parseCliArgs(['watch', 'history', 'test', '--limit=abc'])
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.code).toBe('INVALID_LIMIT')
	})
})

// ---------------------------------------------------------------------------
// Briefing command
// ---------------------------------------------------------------------------
describe('parseCliArgs: briefing', () => {
	test('briefing with topic', () => {
		const result = parseCliArgs(['briefing', 'Claude Code'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as BriefingCommand
		expect(cmd.command).toBe('briefing')
		expect(cmd.topic).toBe('Claude Code')
		expect(cmd.period).toBe('daily')
	})

	test('briefing with --period=weekly', () => {
		const result = parseCliArgs(['briefing', 'Bun', '--period=weekly'])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const cmd = result.value as BriefingCommand
		expect(cmd.period).toBe('weekly')
	})

	test('briefing rejects missing topic', () => {
		const result = parseCliArgs(['briefing'])
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.code).toBe('MISSING_TOPIC')
	})

	test('briefing rejects invalid --period', () => {
		const result = parseCliArgs(['briefing', 'test', '--period=monthly'])
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.code).toBe('INVALID_PERIOD')
	})

	test('briefing rejects unknown flag', () => {
		const result = parseCliArgs(['briefing', 'test', '--unknown'])
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.code).toBe('UNKNOWN_FLAG')
	})
})
