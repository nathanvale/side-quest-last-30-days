/**
 * Watchlist CRUD operations backed by the SQLite store.
 *
 * Every function accepts an optional `db` parameter so callers can pass an
 * in-memory database for test isolation without touching the global singleton.
 */

import type { Database } from 'bun:sqlite'
import { getDb } from './store.js'

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** A single row from the `watchlist_topics` table. */
export interface WatchlistTopic {
	id: number
	topic: string
	schedule: string | null
	createdAt: string
	lastRunAt: string | null
}

/** A single row from the `run_history` table. */
export interface RunHistoryEntry {
	id: number
	topic: string
	ranAt: string
	durationMs: number | null
	itemCount: number
	status: 'success' | 'error'
	errorMessage: string | null
}

/** Input shape for `recordRun`. */
export interface RunResult {
	durationMs: number
	itemCount: number
	status: 'success' | 'error'
	errorMessage: string | null
	summaryJson: string | null
}

// ---------------------------------------------------------------------------
// Raw row shapes returned directly from SQLite queries
// ---------------------------------------------------------------------------

interface WatchlistTopicRow {
	id: number
	topic: string
	schedule: string | null
	created_at: string
	last_run_at: string | null
}

interface RunHistoryRow {
	id: number
	topic: string
	ran_at: string
	duration_ms: number | null
	item_count: number
	status: string
	error_message: string | null
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

/**
 * Adds a topic to the watchlist.
 *
 * Idempotent: inserting an existing topic is a no-op. If `schedule` is
 * provided on a duplicate insert, the schedule is updated.
 *
 * @param topic    - The research topic to watch.
 * @param schedule - Optional recurrence: `'daily'`, `'weekly'`, or `undefined`.
 * @param db       - Database instance; defaults to the global singleton.
 */
export function addTopic(
	topic: string,
	schedule?: string,
	db?: Database,
): void {
	const conn = db ?? getDb()

	// Attempt insert first.
	conn.run(
		`INSERT OR IGNORE INTO watchlist_topics (topic, schedule) VALUES (?, ?)`,
		[topic, schedule ?? null],
	)

	// If a schedule was provided, update it (handles the "topic already existed"
	// case so the caller's intent is always honoured).
	if (schedule !== undefined) {
		conn.run(`UPDATE watchlist_topics SET schedule = ? WHERE topic = ?`, [
			schedule,
			topic,
		])
	}
}

/**
 * Removes a topic from the watchlist.
 *
 * @param topic - The topic to remove.
 * @param db    - Database instance; defaults to the global singleton.
 * @returns `true` if a row was deleted, `false` if the topic did not exist.
 */
export function removeTopic(topic: string, db?: Database): boolean {
	const conn = db ?? getDb()
	const result = conn.run(`DELETE FROM watchlist_topics WHERE topic = ?`, [
		topic,
	])
	return result.changes > 0
}

/**
 * Returns all watched topics ordered by `created_at` ascending.
 *
 * @param db - Database instance; defaults to the global singleton.
 */
export function listTopics(db?: Database): WatchlistTopic[] {
	const conn = db ?? getDb()
	const rows = conn
		.query<WatchlistTopicRow, []>(
			`SELECT id, topic, schedule, created_at, last_run_at
       FROM watchlist_topics
       ORDER BY created_at ASC`,
		)
		.all()

	return rows.map((r) => ({
		id: r.id,
		topic: r.topic,
		schedule: r.schedule,
		createdAt: r.created_at,
		lastRunAt: r.last_run_at,
	}))
}

/**
 * Returns run history for a topic, most recent first.
 *
 * @param topic - The topic to query.
 * @param limit - Maximum number of entries to return (default: 20).
 * @param db    - Database instance; defaults to the global singleton.
 */
export function getHistory(
	topic: string,
	limit = 20,
	db?: Database,
): RunHistoryEntry[] {
	const conn = db ?? getDb()
	const rows = conn
		.query<RunHistoryRow, [string, number]>(
			`SELECT id, topic, ran_at, duration_ms, item_count, status, error_message
       FROM run_history
       WHERE topic = ?
       ORDER BY ran_at DESC, id DESC
       LIMIT ?`,
		)
		.all(topic, limit)

	return rows.map((r) => ({
		id: r.id,
		topic: r.topic,
		ranAt: r.ran_at,
		durationMs: r.duration_ms,
		itemCount: r.item_count,
		status: r.status as 'success' | 'error',
		errorMessage: r.error_message,
	}))
}

/**
 * Records the outcome of a research run in `run_history` and updates the
 * `last_run_at` column on the corresponding `watchlist_topics` row (if it
 * exists).
 *
 * @param topic  - The topic that was researched.
 * @param result - Run outcome including duration, item count, and status.
 * @param db     - Database instance; defaults to the global singleton.
 */
export function recordRun(
	topic: string,
	result: RunResult,
	db?: Database,
): void {
	const conn = db ?? getDb()

	conn.run(
		`INSERT INTO run_history
       (topic, duration_ms, item_count, status, error_message, summary_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
		[
			topic,
			result.durationMs,
			result.itemCount,
			result.status,
			result.errorMessage,
			result.summaryJson,
		],
	)

	// Update last_run_at on the watchlist topic if it is being watched.
	conn.run(
		`UPDATE watchlist_topics SET last_run_at = datetime('now') WHERE topic = ?`,
		[topic],
	)
}
