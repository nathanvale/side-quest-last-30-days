/**
 * YouTube source adapter via yt-dlp.
 *
 * Searches YouTube for recent videos about a topic, extracts
 * metadata and transcript snippets. Requires yt-dlp installed
 * as a system dependency -- gracefully degrades when not found.
 */

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

/** Search YouTube for videos matching a topic. */
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

	if (result.exitCode !== 0) return []

	// yt-dlp outputs one JSON object per line
	const lines = result.stdout.toString().trim().split('\n')
	return lines
		.filter((line) => line.trim())
		.map((line) => {
			try {
				return JSON.parse(line) as Record<string, unknown>
			} catch {
				return null
			}
		})
		.filter((item): item is Record<string, unknown> => item !== null)
}

/**
 * Get transcript snippet for a video.
 *
 * Transcript extraction via yt-dlp auto-subs is complex and will
 * be enhanced in a future PR. Returns empty string for now.
 */
export async function getTranscript(_videoId: string): Promise<string> {
	return ''
}

/** YouTube engagement formula. */
export function youtubeEngagementScore(
	views: number,
	likes: number,
	comments: number,
): number {
	return (
		0.65 * Math.log1p(views) +
		0.3 * Math.log1p(likes) +
		0.05 * Math.log1p(comments)
	)
}

/** Format yt-dlp date string (YYYYMMDD) to ISO date (YYYY-MM-DD). */
function formatYtDate(yyyymmdd: string): string | null {
	if (yyyymmdd.length !== 8) return null
	const y = yyyymmdd.slice(0, 4)
	const m = yyyymmdd.slice(4, 6)
	const d = yyyymmdd.slice(6, 8)
	return `${y}-${m}-${d}`
}

/** Parse raw yt-dlp search results into normalized objects. */
export function parseYouTubeResults(
	results: Record<string, unknown>[],
): Record<string, unknown>[] {
	return results.map((r) => ({
		id: String(r.id ?? ''),
		title: String(r.title ?? ''),
		url: `https://www.youtube.com/watch?v=${String(r.id ?? '')}`,
		channel: String(r.uploader ?? r.channel ?? ''),
		date: r.upload_date ? formatYtDate(String(r.upload_date)) : null,
		views: Number(r.view_count ?? 0),
		likes: Number(r.like_count ?? 0),
		comments: Number(r.comment_count ?? 0),
		transcript_snippet: '',
		relevance: 0.7,
		why_relevant: `YouTube video about ${String(r.title ?? 'topic')}`,
	}))
}
