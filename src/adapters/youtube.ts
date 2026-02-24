import { parseYtDlpJsonLines } from '../lib/youtube.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const YT_TIMEOUT_MS_BY_DEPTH: Record<string, number> = {
	quick: 15_000,
	normal: 30_000,
	deep: 60_000,
}

const YT_RESULTS_BY_DEPTH: Record<string, number> = {
	quick: 5,
	normal: 10,
	deep: 20,
}

/** Clamp lookback days to a safe positive integer window. */
function clampLookbackDays(days: number): number {
	if (!Number.isFinite(days)) return 30
	const normalized = Math.floor(days)
	if (normalized < 1) return 1
	if (normalized > 365) return 365
	return normalized
}

/** Format a UTC date as YYYYMMDD for yt-dlp date filters. */
function formatYtDate(date: Date): string {
	const year = date.getUTCFullYear()
	const month = String(date.getUTCMonth() + 1).padStart(2, '0')
	const day = String(date.getUTCDate()).padStart(2, '0')
	return `${year}${month}${day}`
}

/**
 * Build yt-dlp args for time-windowed YouTube search.
 *
 * Uses ytsearch with --dateafter to enforce the requested lookback window.
 * (ytsearchdate is broken in yt-dlp 2026.02.21+, so we use ytsearch instead.)
 */
export function buildYouTubeSearchArgs(
	topic: string,
	days: number,
	depth: string,
	now: Date = new Date(),
): string[] {
	const maxResults = YT_RESULTS_BY_DEPTH[depth] ?? YT_RESULTS_BY_DEPTH.normal
	const lookbackDays = clampLookbackDays(days)
	const dateAfter = new Date(now.getTime() - lookbackDays * MS_PER_DAY)
	const query = `ytsearch${maxResults}:${topic}`

	return [
		'yt-dlp',
		'--flat-playlist',
		'--dump-json',
		'--dateafter',
		formatYtDate(dateAfter),
		query,
	]
}

/** Build yt-dlp args for fetching full metadata for a list of video IDs. */
function buildYouTubeMetadataArgs(ids: string[]): string[] {
	const urls = ids.map((id) => `https://www.youtube.com/watch?v=${id}`)
	return ['yt-dlp', '--dump-json', '--no-playlist', ...urls]
}

function getDepthTimeoutMs(depth: string): number {
	return YT_TIMEOUT_MS_BY_DEPTH[depth] ?? 30_000
}

function getDepthMaxResults(depth: string): number {
	return YT_RESULTS_BY_DEPTH[depth] ?? 10
}

/** Check if yt-dlp is available in PATH. */
export function isYtDlpAvailable(): boolean {
	try {
		const result = Bun.spawnSync(['yt-dlp', '--version'], {
			timeout: 5000,
		})
		return result.exitCode === 0
	} catch {
		return false
	}
}

/** Search YouTube for videos matching a topic using yt-dlp. */
export async function searchYouTube(
	topic: string,
	days: number,
	depth: string,
): Promise<Record<string, unknown>[]> {
	const start = Date.now()
	const args = buildYouTubeSearchArgs(topic, days, depth)
	const timeoutMs = getDepthTimeoutMs(depth)
	const result = Bun.spawnSync(args, { timeout: timeoutMs })

	if (result.exitCode !== 0) {
		const stderr = result.stderr.toString().trim()
		const stdout = result.stdout.toString().trim()
		const details = [
			`exit=${result.exitCode}`,
			stderr ? `stderr=${stderr}` : '',
			stdout ? `stdout=${stdout}` : '',
		]
			.filter(Boolean)
			.join(' ')
		throw new Error(`yt-dlp search failed (${details})`)
	}

	const flatResults = parseYtDlpJsonLines(result.stdout.toString())
	const maxResults = getDepthMaxResults(depth)
	const ids = flatResults
		.map((item) => String(item.id ?? ''))
		.filter(Boolean)
		.slice(0, maxResults)

	// If we have no IDs or no remaining time budget, return flat results.
	const elapsed = Date.now() - start
	const remaining = timeoutMs - elapsed
	if (ids.length === 0 || remaining < 2000) {
		return flatResults
	}

	const metadataArgs = buildYouTubeMetadataArgs(ids)
	const metadataResult = Bun.spawnSync(metadataArgs, { timeout: remaining })
	if (metadataResult.exitCode !== 0) {
		return flatResults
	}

	const fullResults = parseYtDlpJsonLines(metadataResult.stdout.toString())
	if (fullResults.length === 0) {
		return flatResults
	}

	const fullById = new Map(
		fullResults.map((item) => [String(item.id ?? ''), item]),
	)
	const merged = flatResults.map((item) => {
		const id = String(item.id ?? '')
		const full = fullById.get(id)
		return full ? { ...item, ...full } : item
	})
	return merged
}
