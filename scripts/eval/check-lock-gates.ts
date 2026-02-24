#!/usr/bin/env bun
/**
 * Fail fast when lock gates are not satisfied.
 * Defaults to the latest matrix assessment artifact in reports/.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Assessment = {
	generated_at: string
	gates: Record<string, boolean>
	pass: boolean
	topics_completed?: number
	topics_selected?: number
}

function parseArgs(argv: string[]): { assessmentPath: string | null } {
	let assessmentPath: string | null = null
	for (const arg of argv) {
		if (arg.startsWith('--assessment=')) {
			assessmentPath = arg.slice('--assessment='.length)
		}
	}
	return { assessmentPath }
}

function latestAssessmentPath(): string {
	const dir = resolve('reports')
	const files = readdirSync(dir)
		.filter((name) => name.startsWith('live-compare.matrix-'))
		.filter((name) => name.endsWith('.assessment.json'))
		.sort()
	if (files.length === 0) {
		throw new Error('No assessment files found under reports/')
	}
	return resolve(dir, files[files.length - 1]!)
}

const args = parseArgs(process.argv.slice(2))
const assessmentPath = resolve(args.assessmentPath ?? latestAssessmentPath())
const assessment = JSON.parse(
	readFileSync(assessmentPath, 'utf-8'),
) as Assessment

const failedGates = Object.entries(assessment.gates)
	.filter(([, ok]) => !ok)
	.map(([name]) => name)

const output = {
	assessment_path: assessmentPath,
	generated_at: assessment.generated_at,
	pass: assessment.pass && failedGates.length === 0,
	topics_completed: assessment.topics_completed ?? null,
	topics_selected: assessment.topics_selected ?? null,
	failed_gates: failedGates,
}

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)

if (!output.pass) {
	process.stderr.write(`Lock gates failed: ${failedGates.join(', ')}\n`)
	process.exit(1)
}
