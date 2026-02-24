import { describe, expect, test } from 'bun:test'
import { resolveErrorContext, resolveOutputArgs } from '../src/lib/output'
import type { SearchCommand } from '../src/lib/parse-args'

function buildSearchCommand(overrides: Partial<SearchCommand> = {}): SearchCommand {
	return {
		command: 'search',
		topic: 'test',
		mock: false,
		emit: 'compact',
		emitExplicit: false,
		sources: 'auto',
		quick: false,
		deep: false,
		includeWeb: false,
		includeYoutube: false,
		refresh: false,
		noCache: false,
		days: 30,
		outdir: '',
		strategy: 'single',
		phase2Budget: 5,
		queryType: 'auto',
		debug: false,
		json: false,
		jsonl: false,
		quiet: false,
		nonInteractive: false,
		fields: [],
		...overrides,
	}
}

describe('cli output auto-detection', () => {
	test('does not auto-json when emit=compact is explicit', () => {
		const args = buildSearchCommand({ emitExplicit: true })
		const output = resolveOutputArgs(args, false)
		expect(output.json).toBe(false)
		expect(output.quiet).toBe(false)
	})

	test('auto-json when emit=compact is implicit and non-tty', () => {
		const args = buildSearchCommand({ emitExplicit: false })
		const output = resolveOutputArgs(args, false)
		expect(output.json).toBe(true)
		expect(output.quiet).toBe(true)
	})
})

describe('error context auto-detection', () => {
	test('does not auto-json when emit=compact is explicit', () => {
		const ctx = resolveErrorContext(['topic', '--emit=compact'], false)
		expect(ctx.json).toBe(false)
		expect(ctx.jsonl).toBe(false)
		expect(ctx.quiet).toBe(false)
	})

	test('does not auto-json when emit=compact is space-separated', () => {
		const ctx = resolveErrorContext(['topic', '--emit', 'compact'], false)
		expect(ctx.json).toBe(false)
		expect(ctx.jsonl).toBe(false)
		expect(ctx.quiet).toBe(false)
	})

	test('auto-json when emit=compact is implicit and non-tty', () => {
		const ctx = resolveErrorContext(['topic'], false)
		expect(ctx.json).toBe(true)
		expect(ctx.jsonl).toBe(false)
		expect(ctx.quiet).toBe(false)
	})
})
