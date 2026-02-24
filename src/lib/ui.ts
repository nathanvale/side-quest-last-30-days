/** Terminal UI utilities for wots CLI. */

const IS_TTY = process.stderr.isTTY ?? false

const PURPLE = '\x1b[95m'
const CYAN = '\x1b[96m'
const GREEN = '\x1b[92m'
const YELLOW = '\x1b[93m'
const RED = '\x1b[91m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const MINI_BANNER = `${PURPLE}${BOLD}/wots${RESET} ${DIM}· researching...${RESET}`

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const REDDIT_MESSAGES = [
	'Diving into Reddit threads...',
	'Scanning subreddits for gold...',
	'Reading what Redditors are saying...',
	'Exploring the front page of the internet...',
	'Finding the good discussions...',
]

const X_MESSAGES = [
	'Checking what X is buzzing about...',
	'Reading the timeline...',
	'Finding the hot takes...',
	'Scanning tweets and threads...',
	'Discovering trending insights...',
]

const ENRICHING_MESSAGES = [
	'Getting the juicy details...',
	'Fetching engagement metrics...',
	'Reading top comments...',
	'Extracting insights...',
]

const PROCESSING_MESSAGES = [
	'Crunching the data...',
	'Scoring and ranking...',
	'Finding patterns...',
	'Removing duplicates...',
]

const YOUTUBE_MESSAGES = [
	'Searching YouTube for videos...',
	'Finding relevant video content...',
	'Scanning YouTube uploads...',
	'Discovering video discussions...',
]

const WEB_ONLY_MESSAGES = [
	'Searching the web...',
	'Finding blogs and docs...',
	'Crawling news sites...',
]

function pick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)]!
}

class Spinner {
	private message: string
	private color: string
	private timer: ReturnType<typeof setInterval> | null = null
	private frameIdx = 0
	private shownStatic = false

	constructor(message: string, color = CYAN) {
		this.message = message
		this.color = color
	}

	start(): void {
		if (IS_TTY) {
			this.timer = setInterval(() => {
				const frame = SPINNER_FRAMES[this.frameIdx % SPINNER_FRAMES.length]
				process.stderr.write(
					`\r${this.color}${frame}${RESET} ${this.message}  `,
				)
				this.frameIdx++
			}, 80)
		} else if (!this.shownStatic) {
			process.stderr.write(`⏳ ${this.message}\n`)
			this.shownStatic = true
		}
	}

	update(message: string): void {
		this.message = message
		if (!IS_TTY && !this.shownStatic) {
			process.stderr.write(`⏳ ${message}\n`)
		}
	}

	stop(finalMessage = ''): void {
		if (this.timer) {
			clearInterval(this.timer)
			this.timer = null
		}
		if (IS_TTY) {
			process.stderr.write(`\r${' '.repeat(80)}\r`)
		}
		if (finalMessage) {
			process.stderr.write(`✓ ${finalMessage}\n`)
		}
	}
}

/** Progress display for research phases. */
export class ProgressDisplay {
	private topic: string
	private spinner: Spinner | null = null
	private startTime: number
	private quiet: boolean

	constructor(topic: string, showBanner = true, quiet = false) {
		this.topic = topic
		this.startTime = Date.now()
		this.quiet = quiet
		if (showBanner && !quiet) this.showBanner()
	}

	/** Write to stderr unless quiet mode is active. */
	private write(msg: string): void {
		if (!this.quiet) process.stderr.write(msg)
	}

	private showBanner(): void {
		if (IS_TTY) {
			this.write(`${MINI_BANNER}\n`)
			this.write(`${DIM}Topic: ${RESET}${BOLD}${this.topic}${RESET}\n\n`)
		} else {
			this.write(`/wots · researching: ${this.topic}\n`)
		}
	}

	startReddit(): void {
		if (this.quiet) return
		const msg = pick(REDDIT_MESSAGES)
		this.spinner = new Spinner(`${YELLOW}Reddit${RESET} ${msg}`, YELLOW)
		this.spinner.start()
	}

	endReddit(): void {
		this.spinner?.stop(`${YELLOW}Reddit${RESET} Completed`)
	}

	startRedditEnrich(current: number, total: number): void {
		if (this.quiet) return
		this.spinner?.stop()
		const msg = pick(ENRICHING_MESSAGES)
		this.spinner = new Spinner(
			`${YELLOW}Reddit${RESET} [${current}/${total}] ${msg}`,
			YELLOW,
		)
		this.spinner.start()
	}

	updateRedditEnrich(current: number, total: number): void {
		if (this.quiet) return
		const msg = pick(ENRICHING_MESSAGES)
		this.spinner?.update(`${YELLOW}Reddit${RESET} [${current}/${total}] ${msg}`)
	}

	endRedditEnrich(): void {
		this.spinner?.stop(`${YELLOW}Reddit${RESET} Enriched with engagement data`)
	}

	startX(): void {
		if (this.quiet) return
		const msg = pick(X_MESSAGES)
		this.spinner = new Spinner(`${CYAN}X${RESET} ${msg}`, CYAN)
		this.spinner.start()
	}

	endX(): void {
		this.spinner?.stop(`${CYAN}X${RESET} Completed`)
	}

	/** Start YouTube search phase. */
	startYouTube(): void {
		if (this.quiet) return
		const msg = pick(YOUTUBE_MESSAGES)
		this.spinner = new Spinner(`${RED}YouTube${RESET} ${msg}`, RED)
		this.spinner.start()
	}

	/** End YouTube search phase. */
	endYouTube(): void {
		this.spinner?.stop(`${RED}YouTube${RESET} Completed`)
	}

	startProcessing(): void {
		if (this.quiet) return
		const msg = pick(PROCESSING_MESSAGES)
		this.spinner = new Spinner(`${PURPLE}Processing${RESET} ${msg}`, PURPLE)
		this.spinner.start()
	}

	endProcessing(): void {
		this.spinner?.stop()
	}

	showComplete(
		redditCount: number,
		xCount: number,
		youtubeCount: number,
	): void {
		const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1)
		if (IS_TTY) {
			this.write(
				`\n${GREEN}${BOLD}✓ Research complete${RESET} ${DIM}(${elapsed}s)${RESET}\n`,
			)
			this.write(
				`  ${YELLOW}Reddit:${RESET} ${redditCount} threads  ${CYAN}X:${RESET} ${xCount} posts  ${RED}YouTube:${RESET} ${youtubeCount} videos\n\n`,
			)
		} else {
			this.write(
				`✓ Research complete (${elapsed}s) - Reddit: ${redditCount} threads, X: ${xCount} posts, YouTube: ${youtubeCount} videos\n`,
			)
		}
	}

	showCached(ageHours: number | null = null): void {
		const ageStr = ageHours != null ? ` (${ageHours.toFixed(1)}h old)` : ''
		this.write(
			`${GREEN}⚡${RESET} ${DIM}Using cached results${ageStr} - use --refresh for fresh data${RESET}\n`,
		)
	}

	/** Show rate-limit degraded state with optional stale-cache info. */
	showRateLimited(
		source: string,
		usedCache: boolean,
		cacheAgeHours: number | null = null,
	): void {
		if (usedCache) {
			const ageStr =
				cacheAgeHours != null ? ` (${cacheAgeHours.toFixed(1)}h old)` : ''
			this.write(
				`${YELLOW}⚠ ${source} rate-limited - using cached data${ageStr}. Try again shortly or use --refresh later.${RESET}\n`,
			)
		} else {
			this.write(
				`${YELLOW}⚠ ${source} rate-limited - no cached results available. Try again in a few minutes.${RESET}\n`,
			)
		}
	}

	showError(message: string): void {
		this.write(`${RED}✗ Error:${RESET} ${message}\n`)
	}

	startWebOnly(): void {
		if (this.quiet) return
		const msg = pick(WEB_ONLY_MESSAGES)
		this.spinner = new Spinner(`${GREEN}Web${RESET} ${msg}`, GREEN)
		this.spinner.start()
	}

	endWebOnly(): void {
		this.spinner?.stop(`${GREEN}Web${RESET} Claude will search the web`)
	}

	showWebOnlyComplete(): void {
		const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1)
		if (IS_TTY) {
			this.write(
				`\n${GREEN}${BOLD}✓ Ready for web search${RESET} ${DIM}(${elapsed}s)${RESET}\n`,
			)
			this.write(
				`  ${GREEN}Web:${RESET} Claude will search blogs, docs & news\n\n`,
			)
		} else {
			this.write(`✓ Ready for web search (${elapsed}s)\n`)
		}
	}

	showPromo(missing: string): void {
		if (missing === 'both') {
			this.write(
				`\n${YELLOW}⚡ Add API keys to ~/.config/wots/.env for Reddit & X data${RESET}\n`,
			)
		} else if (missing === 'reddit') {
			this.write(
				`${DIM}💡 Add OPENAI_API_KEY for Reddit data with real engagement metrics${RESET}\n`,
			)
		} else if (missing === 'x') {
			this.write(
				`${DIM}💡 Add XAI_API_KEY for X/Twitter data with real likes & reposts${RESET}\n`,
			)
		}
	}
}
