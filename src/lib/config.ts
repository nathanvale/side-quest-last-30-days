/** Environment and API key management for wots CLI. */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CONFIG_DIR = join(homedir(), '.config', 'wots')
const CONFIG_FILE = join(CONFIG_DIR, '.env')

/** Load environment variables from a file. */
function loadEnvFile(path: string): Record<string, string> {
	const env: Record<string, string> = {}
	if (!existsSync(path)) return env

	const content = readFileSync(path, 'utf-8')
	for (const rawLine of content.split('\n')) {
		const line = rawLine.trim()
		if (!line || line.startsWith('#')) continue
		const eqIdx = line.indexOf('=')
		if (eqIdx === -1) continue

		const key = line.slice(0, eqIdx).trim()
		let value = line.slice(eqIdx + 1).trim()

		// Remove quotes if present
		if (
			value.length >= 2 &&
			((value[0] === '"' && value[value.length - 1] === '"') ||
				(value[0] === "'" && value[value.length - 1] === "'"))
		) {
			value = value.slice(1, -1)
		}

		if (key && value) env[key] = value
	}
	return env
}

/** Load configuration from ~/.config/wots/.env and environment. */
export function getConfig(): Record<string, string | null> {
	const fileEnv = loadEnvFile(CONFIG_FILE)
	const normalize = (value?: string | null): string | null => {
		if (value == null) return null
		const trimmed = value.trim()
		return trimmed.length > 0 ? trimmed : null
	}

	return {
		OPENAI_API_KEY: normalize(
			process.env.OPENAI_API_KEY ?? fileEnv.OPENAI_API_KEY,
		),
		XAI_API_KEY: normalize(process.env.XAI_API_KEY ?? fileEnv.XAI_API_KEY),
		OPENAI_MODEL_POLICY:
			normalize(process.env.OPENAI_MODEL_POLICY) ??
			normalize(fileEnv.OPENAI_MODEL_POLICY) ??
			'pinned',
		OPENAI_MODEL_PIN:
			normalize(process.env.OPENAI_MODEL_PIN) ??
			normalize(fileEnv.OPENAI_MODEL_PIN) ??
			'gpt-4o-search-preview',
		XAI_MODEL_POLICY:
			normalize(process.env.XAI_MODEL_POLICY) ??
			normalize(fileEnv.XAI_MODEL_POLICY) ??
			'latest',
		XAI_MODEL_PIN:
			normalize(process.env.XAI_MODEL_PIN) ??
			normalize(fileEnv.XAI_MODEL_PIN) ??
			null,
	}
}

/** Check if configuration file exists. */
export function configExists(): boolean {
	return existsSync(CONFIG_FILE)
}

/**
 * Determine which sources are available based on API keys.
 * @returns 'both', 'reddit', 'x', or 'web' (fallback when no keys)
 */
export function getAvailableSources(
	config: Record<string, string | null>,
): string {
	const hasOpenai = Boolean(config.OPENAI_API_KEY)
	const hasXai = Boolean(config.XAI_API_KEY)

	if (hasOpenai && hasXai) return 'both'
	if (hasOpenai) return 'reddit'
	if (hasXai) return 'x'
	return 'web'
}

/**
 * Determine which API keys are missing.
 * @returns 'both', 'reddit', 'x', or 'none'
 */
export function getMissingKeys(config: Record<string, string | null>): string {
	const hasOpenai = Boolean(config.OPENAI_API_KEY)
	const hasXai = Boolean(config.XAI_API_KEY)

	if (hasOpenai && hasXai) return 'none'
	if (hasOpenai) return 'x'
	if (hasXai) return 'reddit'
	return 'both'
}

/**
 * Validate requested sources against available keys.
 * @returns [effectiveSources, errorMessage]
 */
export function validateSources(
	requested: string,
	available: string,
	includeWeb = false,
): [string, string | null] {
	if (available === 'web') {
		if (requested === 'auto' || requested === 'web') return ['web', null]
		return [
			'web',
			'No API keys configured. Using WebSearch fallback. Add keys to ~/.config/wots/.env for Reddit/X.',
		]
	}

	if (requested === 'auto') {
		if (includeWeb) {
			if (available === 'both') return ['all', null]
			if (available === 'reddit') return ['reddit-web', null]
			if (available === 'x') return ['x-web', null]
		}
		return [available, null]
	}

	if (requested === 'web') return ['web', null]

	if (requested === 'both') {
		if (available !== 'both') {
			const missing = available === 'reddit' ? 'xAI' : 'OpenAI'
			return [
				'none',
				`Requested both sources but ${missing} key is missing. Use --sources=auto to use available keys.`,
			]
		}
		return [includeWeb ? 'all' : 'both', null]
	}

	if (requested === 'reddit') {
		if (available === 'x')
			return ['none', 'Requested Reddit but only xAI key is available.']
		return [includeWeb ? 'reddit-web' : 'reddit', null]
	}

	if (requested === 'x') {
		if (available === 'reddit')
			return ['none', 'Requested X but only OpenAI key is available.']
		return [includeWeb ? 'x-web' : 'x', null]
	}

	return [requested, null]
}
