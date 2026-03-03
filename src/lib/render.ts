/** Output rendering for wots CLI. */

import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { daysAgo } from './dates.js'
import type { Report } from './schema.js'
import { reportToDict } from './schema.js'

const OUTPUT_DIR = join(homedir(), '.local', 'share', 'wots', 'out')

/** Assess how much data is actually from the configured date range. */
function assessDataFreshness(report: Report) {
	const redditRecent = report.reddit.filter(
		(r) => r.date && r.date >= report.range_from,
	).length
	const xRecent = report.x.filter(
		(x) => x.date && x.date >= report.range_from,
	).length
	const webRecent = report.web.filter(
		(w) => w.date && w.date >= report.range_from,
	).length

	const youtubeRecent = report.youtube.filter(
		(y) => y.date && y.date >= report.range_from,
	).length

	const totalRecent = redditRecent + xRecent + webRecent + youtubeRecent
	const totalItems =
		report.reddit.length +
		report.x.length +
		report.web.length +
		report.youtube.length

	return {
		redditRecent,
		xRecent,
		webRecent,
		totalRecent,
		totalItems,
		isSparse: totalRecent < 5,
		mostlyEvergreen: totalItems > 0 && totalRecent < totalItems * 0.3,
	}
}

function recencyBadge(date: string | null): string {
	const age = daysAgo(date)
	if (age == null) return ''
	if (age <= 3) return ' [recency:0-3d]'
	if (age <= 7) return ' [recency:4-7d]'
	if (age <= 14) return ' [recency:8-14d]'
	if (age <= 30) return ' [recency:15-30d]'
	return ' [recency:31d+]'
}

function momentumBadge(momentum?: number): string {
	if (momentum == null) return ''
	const value = Math.round(momentum * 10) / 10
	return ` [mom:${value}]`
}

function trendBadge(trendScore?: number): string {
	if (trendScore == null) return ''
	return ` [trend:${trendScore}]`
}

/** Format milliseconds into a human-readable reset time (e.g. "45s", "2m30s"). */
function formatResetTime(ms: number | null): string | null {
	if (ms == null || ms <= 0) return null
	const totalSec = Math.ceil(ms / 1000)
	if (totalSec < 60) return `${totalSec}s`
	const min = Math.floor(totalSec / 60)
	const sec = totalSec % 60
	return sec > 0 ? `${min}m${sec}s` : `${min}m`
}

/** Render structured rate-limit diagnostics for a source. */
function renderRateLimitBlock(
	source: 'reddit' | 'x',
	report: Report,
): string[] | null {
	const type =
		source === 'reddit'
			? report.reddit_rate_limit_type
			: report.x_rate_limit_type
	if (!type) return null

	const errorCode =
		source === 'reddit'
			? report.reddit_rate_limit_error_code
			: report.x_rate_limit_error_code
	const resetMs =
		source === 'reddit'
			? report.reddit_rate_limit_reset_ms
			: report.x_rate_limit_reset_ms
	const retryAfterMs =
		source === 'reddit'
			? report.reddit_rate_limit_retry_after_ms
			: report.x_rate_limit_retry_after_ms
	const retriesAttempted =
		source === 'reddit'
			? report.reddit_rate_limit_retries_attempted
			: report.x_rate_limit_retries_attempted
	const usedStale =
		source === 'reddit'
			? report.reddit_used_stale_cache
			: report.x_used_stale_cache
	const cacheAgeHours =
		source === 'reddit'
			? report.reddit_cache_age_hours
			: report.x_cache_age_hours

	const lines: string[] = []
	lines.push(`**${source}_rate_limit_type:** ${type}`)
	if (errorCode) {
		const sanitizedErrorCode = errorCode
			.replace(/\p{Cc}/gu, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 100)
		lines.push(`**${source}_rate_limit_error_code:** ${sanitizedErrorCode}`)
	}
	const resetStr = formatResetTime(resetMs)
	if (resetStr) lines.push(`**${source}_rate_limit_reset:** ${resetStr}`)
	const retryAfterStr = formatResetTime(retryAfterMs)
	if (retryAfterStr)
		lines.push(`**${source}_rate_limit_retry_after:** ${retryAfterStr}`)
	if (retriesAttempted != null)
		lines.push(
			`**${source}_rate_limit_retries_attempted:** ${retriesAttempted}`,
		)
	if (usedStale) {
		const ageStr =
			cacheAgeHours != null ? `age: ${cacheAgeHours.toFixed(1)}h` : ''
		lines.push(
			`**${source}_fallback:** stale_cache${ageStr ? ` (${ageStr})` : ''}`,
		)
	}
	return lines
}

/** Render compact output for Claude to synthesize. */
export function renderCompact(
	report: Report,
	limit = 15,
	missingKeys = 'none',
): string {
	const lines: string[] = []

	lines.push(`## Research Results: ${report.topic}`)
	lines.push('')

	const freshness = assessDataFreshness(report)
	if (freshness.isSparse) {
		lines.push(
			`**⚠️ LIMITED RECENT DATA** - Few discussions from the last ${report.days} days.`,
		)
		lines.push(
			`Only ${freshness.totalRecent} item(s) confirmed from ${report.range_from} to ${report.range_to}.`,
		)
		lines.push(
			'Results below may include older/evergreen content. Be transparent with the user about this.',
		)
		lines.push('')
	}

	if (report.mode === 'web-only') {
		lines.push('**🌐 WEB SEARCH MODE** - Claude will search blogs, docs & news')
		lines.push('')
		lines.push('---')
		lines.push(
			'**⚡ Want better results?** Add API keys to unlock Reddit & X data:',
		)
		lines.push(
			'- `OPENAI_API_KEY` → Reddit threads with real upvotes & comments',
		)
		lines.push('- `XAI_API_KEY` → X posts with real likes & reposts')
		lines.push('- Edit `~/.config/wots/.env` to add keys')
		lines.push('---')
		lines.push('')
	}

	if (report.from_cache) {
		const ageStr = report.cache_age_hours
			? `${report.cache_age_hours.toFixed(1)}h old`
			: 'cached'
		lines.push(
			`**⚡ CACHED RESULTS** (${ageStr}) - use \`--refresh\` for fresh data`,
		)
		lines.push('')
	}

	lines.push(`**Date Range:** ${report.range_from} to ${report.range_to}`)
	lines.push(`**Mode:** ${report.mode}`)
	if (report.openai_model_used)
		lines.push(`**OpenAI Model:** ${report.openai_model_used}`)
	if (report.xai_model_used)
		lines.push(`**xAI Model:** ${report.xai_model_used}`)
	lines.push('')

	if (report.mode === 'reddit-only' && missingKeys === 'x') {
		lines.push(
			'*💡 Tip: Add XAI_API_KEY for X/Twitter data and better triangulation.*',
		)
		lines.push('')
	} else if (report.mode === 'x-only' && missingKeys === 'reddit') {
		lines.push(
			'*💡 Tip: Add OPENAI_API_KEY for Reddit data and better triangulation.*',
		)
		lines.push('')
	}

	// Reddit items
	if (report.reddit_error) {
		const rlBlock = renderRateLimitBlock('reddit', report)
		if (rlBlock) {
			lines.push('### Reddit Threads', '', ...rlBlock, '')
		} else {
			lines.push(
				'### Reddit Threads',
				'',
				`**ERROR:** ${report.reddit_error}`,
				'',
			)
		}
	} else if (
		['both', 'reddit-only'].includes(report.mode) &&
		report.reddit.length === 0
	) {
		lines.push(
			'### Reddit Threads',
			'',
			'*No relevant Reddit threads found for this topic.*',
			'',
		)
	} else if (report.reddit.length > 0) {
		lines.push('### Reddit Threads', '')
		for (const item of report.reddit.slice(0, limit)) {
			const engParts: string[] = []
			if (item.engagement) {
				if (item.engagement.score != null)
					engParts.push(`${item.engagement.score}pts`)
				if (item.engagement.num_comments != null)
					engParts.push(`${item.engagement.num_comments}cmt`)
			}
			const engStr = engParts.length > 0 ? ` [${engParts.join(', ')}]` : ''
			const dateStr = item.date ? ` (${item.date})` : ' (date unknown)'
			const confStr =
				item.date_confidence !== 'high' ? ` [date:${item.date_confidence}]` : ''
			const recencyStr = recencyBadge(item.date)
			const momentumStr = momentumBadge(item.momentum)
			const trendStr = trendBadge(item.trend_score)

			lines.push(
				`**${item.id}** (score:${item.score}) r/${item.subreddit}${dateStr}${confStr}${engStr}${recencyStr}${momentumStr}${trendStr}`,
			)
			lines.push(`  ${item.title}`)
			lines.push(`  ${item.url}`)
			lines.push(`  *${item.why_relevant}*`)

			if (item.comment_insights.length > 0) {
				lines.push('  Insights:')
				for (const insight of item.comment_insights.slice(0, 3)) {
					lines.push(`    - ${insight}`)
				}
			}
			lines.push('')
		}
	}

	// X items
	if (report.x_error) {
		const rlBlock = renderRateLimitBlock('x', report)
		if (rlBlock) {
			lines.push('### X Posts', '', ...rlBlock, '')
		} else {
			lines.push('### X Posts', '', `**ERROR:** ${report.x_error}`, '')
		}
	} else if (
		['both', 'x-only', 'all', 'x-web'].includes(report.mode) &&
		report.x.length === 0
	) {
		lines.push(
			'### X Posts',
			'',
			'*No relevant X posts found for this topic.*',
			'',
		)
	} else if (report.x.length > 0) {
		lines.push('### X Posts', '')
		for (const item of report.x.slice(0, limit)) {
			const engParts: string[] = []
			if (item.engagement) {
				if (item.engagement.likes != null)
					engParts.push(`${item.engagement.likes}likes`)
				if (item.engagement.reposts != null)
					engParts.push(`${item.engagement.reposts}rt`)
			}
			const engStr = engParts.length > 0 ? ` [${engParts.join(', ')}]` : ''
			const dateStr = item.date ? ` (${item.date})` : ' (date unknown)'
			const confStr =
				item.date_confidence !== 'high' ? ` [date:${item.date_confidence}]` : ''
			const recencyStr = recencyBadge(item.date)
			const momentumStr = momentumBadge(item.momentum)
			const trendStr = trendBadge(item.trend_score)

			lines.push(
				`**${item.id}** (score:${item.score}) @${item.author_handle}${dateStr}${confStr}${engStr}${recencyStr}${momentumStr}${trendStr}`,
			)
			lines.push(`  ${item.text.slice(0, 200)}...`)
			lines.push(`  ${item.url}`)
			lines.push(`  *${item.why_relevant}*`)
			lines.push('')
		}
	}

	// Web items
	if (report.web_error) {
		lines.push('### Web Results', '', `**ERROR:** ${report.web_error}`, '')
	} else if (report.web.length > 0) {
		lines.push('### Web Results', '')
		for (const item of report.web.slice(0, limit)) {
			const dateStr = item.date ? ` (${item.date})` : ' (date unknown)'
			const confStr =
				item.date_confidence !== 'high' ? ` [date:${item.date_confidence}]` : ''
			const recencyStr = recencyBadge(item.date)
			const momentumStr = momentumBadge(item.momentum)
			const trendStr = trendBadge(item.trend_score)

			lines.push(
				`**${item.id}** [WEB] (score:${item.score}) ${item.source_domain}${dateStr}${confStr}${recencyStr}${momentumStr}${trendStr}`,
			)
			lines.push(`  ${item.title}`)
			lines.push(`  ${item.url}`)
			lines.push(`  ${item.snippet.slice(0, 150)}...`)
			lines.push(`  *${item.why_relevant}*`)
			lines.push('')
		}
	}

	// YouTube items
	if (report.youtube_error) {
		lines.push(
			'### YouTube Videos',
			'',
			`**ERROR:** ${report.youtube_error}`,
			'',
		)
	} else if (report.youtube.length > 0) {
		lines.push('### YouTube Videos', '')
		for (const item of report.youtube.slice(0, limit)) {
			const dateStr = item.date ? ` (${item.date})` : ' (date unknown)'
			const confStr =
				item.date_confidence !== 'high' ? ` [date:${item.date_confidence}]` : ''
			const engStr = ` [${item.views.toLocaleString()}views, ${item.likes.toLocaleString()}likes]`
			const recencyStr = recencyBadge(item.date)
			const momentumStr = momentumBadge(item.momentum)
			const trendStr = trendBadge(item.trend_score)

			lines.push(
				`**${item.id}** [YT] (score:${item.score}) ${item.channel}${dateStr}${confStr}${engStr}${recencyStr}${momentumStr}${trendStr}`,
			)
			lines.push(`  ${item.title}`)
			lines.push(`  ${item.url}`)
			lines.push(`  *${item.why_relevant}*`)
			lines.push('')
		}
	}

	const gaps: string[] = []
	if (report.reddit_error) gaps.push('Reddit error')
	if (report.x_error) gaps.push('X error')
	if (report.youtube_error) gaps.push('YouTube error')
	if (report.mode === 'web-only') gaps.push('Web-only mode')
	if (freshness.isSparse) gaps.push('Low recent volume')
	if (freshness.mostlyEvergreen) gaps.push('Mostly evergreen')

	if (gaps.length > 0) {
		lines.push('### Signal Gaps', '')
		lines.push(`**Gaps:** ${gaps.join(', ')}`)
		lines.push('')
	}

	return lines.join('\n')
}

/** Render reusable context snippet. */
export function renderContextSnippet(report: Report): string {
	const lines: string[] = []
	lines.push(`# Context: ${report.topic} (Last ${report.days} Days)`)
	lines.push('')
	lines.push(
		`*Generated: ${report.generated_at.slice(0, 10)} | Sources: ${report.mode}*`,
	)
	lines.push('')
	lines.push('## Key Sources')
	lines.push('')

	const allItems: [number, string, string, string][] = []
	for (const item of report.reddit.slice(0, 5)) {
		allItems.push([item.score, 'Reddit', item.title, item.url])
	}
	for (const item of report.x.slice(0, 5)) {
		allItems.push([item.score, 'X', `${item.text.slice(0, 50)}...`, item.url])
	}
	for (const item of report.web.slice(0, 5)) {
		allItems.push([
			item.score,
			'Web',
			`${item.title.slice(0, 50)}...`,
			item.url,
		])
	}
	for (const item of report.youtube.slice(0, 5)) {
		allItems.push([
			item.score,
			'YouTube',
			`${item.title.slice(0, 50)}...`,
			item.url,
		])
	}

	allItems.sort((a, b) => b[0] - a[0])
	for (const [, source, text] of allItems.slice(0, 7)) {
		lines.push(`- [${source}] ${text}`)
	}

	lines.push('')
	lines.push('## Summary')
	lines.push('')
	lines.push(
		'*See full report for best practices, prompt pack, and detailed sources.*',
	)
	lines.push('')

	return lines.join('\n')
}

/** Render full markdown report. */
export function renderFullReport(report: Report): string {
	const lines: string[] = []

	lines.push(`# ${report.topic} - Last ${report.days} Days Research Report`)
	lines.push('')
	lines.push(`**Generated:** ${report.generated_at}`)
	lines.push(`**Date Range:** ${report.range_from} to ${report.range_to}`)
	lines.push(`**Mode:** ${report.mode}`)
	lines.push('')

	lines.push('## Models Used')
	lines.push('')
	if (report.openai_model_used)
		lines.push(`- **OpenAI:** ${report.openai_model_used}`)
	if (report.xai_model_used) lines.push(`- **xAI:** ${report.xai_model_used}`)
	lines.push('')

	if (report.reddit.length > 0) {
		lines.push('## Reddit Threads')
		lines.push('')
		for (const item of report.reddit) {
			lines.push(`### ${item.id}: ${item.title}`)
			lines.push('')
			lines.push(`- **Subreddit:** r/${item.subreddit}`)
			lines.push(`- **URL:** ${item.url}`)
			lines.push(
				`- **Date:** ${item.date ?? 'Unknown'} (confidence: ${item.date_confidence})`,
			)
			lines.push(`- **Score:** ${item.score}/100`)
			lines.push(`- **Relevance:** ${item.why_relevant}`)

			if (item.engagement) {
				lines.push(
					`- **Engagement:** ${item.engagement.score ?? '?'} points, ${item.engagement.num_comments ?? '?'} comments`,
				)
			}

			if (item.comment_insights.length > 0) {
				lines.push('')
				lines.push('**Key Insights from Comments:**')
				for (const insight of item.comment_insights) {
					lines.push(`- ${insight}`)
				}
			}
			lines.push('')
		}
	}

	if (report.x.length > 0) {
		lines.push('## X Posts')
		lines.push('')
		for (const item of report.x) {
			lines.push(`### ${item.id}: @${item.author_handle}`)
			lines.push('')
			lines.push(`- **URL:** ${item.url}`)
			lines.push(
				`- **Date:** ${item.date ?? 'Unknown'} (confidence: ${item.date_confidence})`,
			)
			lines.push(`- **Score:** ${item.score}/100`)
			lines.push(`- **Relevance:** ${item.why_relevant}`)

			if (item.engagement) {
				lines.push(
					`- **Engagement:** ${item.engagement.likes ?? '?'} likes, ${item.engagement.reposts ?? '?'} reposts`,
				)
			}
			lines.push('')
			lines.push(`> ${item.text}`)
			lines.push('')
		}
	}

	if (report.web.length > 0) {
		lines.push('## Web Results')
		lines.push('')
		for (const item of report.web) {
			lines.push(`### ${item.id}: ${item.title}`)
			lines.push('')
			lines.push(`- **Source:** ${item.source_domain}`)
			lines.push(`- **URL:** ${item.url}`)
			lines.push(
				`- **Date:** ${item.date ?? 'Unknown'} (confidence: ${item.date_confidence})`,
			)
			lines.push(`- **Score:** ${item.score}/100`)
			lines.push(`- **Relevance:** ${item.why_relevant}`)
			lines.push('')
			lines.push(`> ${item.snippet}`)
			lines.push('')
		}
	}

	if (report.youtube.length > 0) {
		lines.push('## YouTube Videos')
		lines.push('')
		for (const item of report.youtube) {
			lines.push(`### ${item.id}: ${item.title}`)
			lines.push('')
			lines.push(`- **Channel:** ${item.channel}`)
			lines.push(`- **URL:** ${item.url}`)
			lines.push(
				`- **Date:** ${item.date ?? 'Unknown'} (confidence: ${item.date_confidence})`,
			)
			lines.push(`- **Score:** ${item.score}/100`)
			lines.push(`- **Relevance:** ${item.why_relevant}`)
			lines.push(
				`- **Engagement:** ${item.views.toLocaleString()} views, ${item.likes.toLocaleString()} likes, ${item.comments.toLocaleString()} comments`,
			)
			lines.push('')
		}
	}

	lines.push('## Best Practices')
	lines.push('')
	lines.push('*To be synthesized by Claude*')
	lines.push('')
	lines.push('## Prompt Pack')
	lines.push('')
	lines.push('*To be synthesized by Claude*')
	lines.push('')

	return lines.join('\n')
}

/** Write all output files. */
export function writeOutputs(
	report: Report,
	rawOpenai?: Record<string, unknown> | null,
	rawXai?: Record<string, unknown> | null,
	rawRedditEnriched?: Record<string, unknown>[] | null,
	outdir?: string,
): void {
	const dir = outdir || OUTPUT_DIR
	mkdirSync(dir, { recursive: true })

	// Clean stale raw files from previous runs
	const rawFiles = [
		'raw_openai.json',
		'raw_xai.json',
		'raw_reddit_threads_enriched.json',
	]
	for (const file of rawFiles) {
		try {
			unlinkSync(join(dir, file))
		} catch {
			// ignore if not exists
		}
	}

	// Write report files (always)
	writeFileSync(
		join(dir, 'report.json'),
		JSON.stringify(reportToDict(report), null, 2),
	)
	writeFileSync(join(dir, 'report.md'), renderFullReport(report))
	writeFileSync(join(dir, 'wots.context.md'), renderContextSnippet(report))

	if (rawOpenai) {
		writeFileSync(
			join(dir, 'raw_openai.json'),
			JSON.stringify(rawOpenai, null, 2),
		)
	}
	if (rawXai) {
		writeFileSync(join(dir, 'raw_xai.json'), JSON.stringify(rawXai, null, 2))
	}
	if (rawRedditEnriched) {
		writeFileSync(
			join(dir, 'raw_reddit_threads_enriched.json'),
			JSON.stringify(rawRedditEnriched, null, 2),
		)
	}
}

/** Get path to context file. */
export function getContextPath(outdir?: string): string {
	return join(outdir || OUTPUT_DIR, 'wots.context.md')
}
