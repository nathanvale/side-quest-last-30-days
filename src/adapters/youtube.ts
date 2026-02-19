import { parseYtDlpJsonLines } from '../lib/youtube.js'

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
	_days: number,
	depth: string,
): Promise<Record<string, unknown>[]> {
	const maxResults = depth === 'quick' ? 5 : depth === 'deep' ? 20 : 10
	const query = `ytsearch${maxResults}:${topic}`

	const result = Bun.spawnSync(
		['yt-dlp', '--flat-playlist', '--dump-json', query],
		{ timeout: 60_000 },
	)

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
