#!/usr/bin/env bun

import { execSync } from 'node:child_process'

const args = process.argv.slice(2)
const baseArgIndex = args.indexOf('--base')
const baseRef =
	(baseArgIndex !== -1 ? args[baseArgIndex + 1] : undefined) ||
	process.env.BASE_REF ||
	process.env.GITHUB_BASE_REF ||
	'origin/main'

const algorithmPaths = [
	'src/lib/score.ts',
	'src/lib/dedupe.ts',
	'src/lib/normalize.ts',
	'src/lib/trend.ts',
	'src/lib/dates.ts',
	'src/lib/delta.ts',
	'src/lib/render.ts',
	'src/lib/entity-extract.ts',
	'src/lib/retrieval/',
	'src/adapters/youtube.ts',
]

const baselinePath = 'fixtures/algorithm-baseline/'

function loadDiffFiles(command: string): string[] {
	try {
		const output = execSync(command, { stdio: ['ignore', 'pipe', 'pipe'] })
			.toString()
			.trim()
		if (!output) return []
		return output
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
	} catch {
		return []
	}
}

function isAlgorithmFile(path: string): boolean {
	return algorithmPaths.some((pattern) => {
		if (pattern.endsWith('/')) return path.startsWith(pattern)
		return path === pattern
	})
}

let changedFiles = loadDiffFiles(`git diff --name-only ${baseRef}...HEAD`)
if (changedFiles.length === 0) {
	changedFiles = loadDiffFiles('git diff --name-only')
}

if (changedFiles.length === 0) process.exit(0)

const algorithmChanged = changedFiles.some(isAlgorithmFile)
const baselineChanged = changedFiles.some((path) =>
	path.startsWith(baselinePath),
)

if (algorithmChanged && !baselineChanged) {
	process.stderr.write('Algorithm baseline mismatch detected.\n')
	process.stderr.write(
		'Algorithm-affecting files changed without updating baseline fixtures.\n',
	)
	process.stderr.write('If this change is intentional, run:\n')
	process.stderr.write('  bun run update:baseline\n')
	process.stderr.write('Then review the diff in fixtures and commit.\n')
	process.exit(1)
}
