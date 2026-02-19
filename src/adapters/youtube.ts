import { parseYtDlpJsonLines } from '../lib/youtube.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000

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
 * Uses ytsearchdate to bias recent uploads and --dateafter to enforce
 * the requested lookback window.
 */
export function buildYouTubeSearchArgs(
	topic: string,
	days: number,
	depth: string,
	now: Date = new Date(),
): string[] {
	const maxResults = depth === 'quick' ? 5 : depth === 'deep' ? 20 : 10
	const lookbackDays = clampLookbackDays(days)
	const dateAfter = new Date(now.getTime() - lookbackDays * MS_PER_DAY)
	const query = `ytsearchdate${maxResults}:${topic}`

	return [
		'yt-dlp',
		'--flat-playlist',
		'--dump-json',
		'--dateafter',
		formatYtDate(dateAfter),
		query,
	]
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
	const args = buildYouTubeSearchArgs(topic, days, depth)
	const result = Bun.spawnSync(args, { timeout: 60_000 })

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

	return parseYtDlpJsonLines(result.stdout.toString())
}
