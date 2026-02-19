/**
 * SQLite persistence layer for watchlist topics and run history.
 *
 * Uses Bun's built-in `bun:sqlite` -- no external dependency required.
 * The default DB lives at `~/.local/share/last-30-days/research.db`.
 * Pass `:memory:` to `initDb` for isolated test instances.
 */

import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Singleton instance -- lazy-initialised on first call to `getDb()`. */
let _db: Database | null = null

/**
 * Returns the default path for the SQLite database file.
 * Resolves `~` via `os.homedir()`.
 */
export function getDbPath(): string {
	return join(homedir(), '.local', 'share', 'last-30-days', 'research.db')
}

/**
 * SQL DDL for all tables.
 * Keeps schema creation in one place so `initDb` stays readable.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS watchlist_topics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  topic      TEXT    NOT NULL UNIQUE,
  schedule   TEXT    DEFAULT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  last_run_at TEXT   DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS run_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  topic         TEXT    NOT NULL,
  ran_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  duration_ms   INTEGER DEFAULT NULL,
  item_count    INTEGER DEFAULT 0,
  status        TEXT    NOT NULL DEFAULT 'success',
  error_message TEXT    DEFAULT NULL,
  summary_json  TEXT    DEFAULT NULL
);
`

/**
 * Initialises the database at `dbPath` (or `:memory:` for tests).
 *
 * - Creates the parent directory if it does not exist.
 * - Runs the full schema migration on every call (idempotent via
 *   `CREATE TABLE IF NOT EXISTS`).
 * - Seeds `schema_version` to `1` if the table is empty.
 *
 * @param dbPath - Filesystem path or `:memory:`. Defaults to `getDbPath()`.
 * @returns An open `Database` instance ready for use.
 */
export function initDb(dbPath?: string): Database {
	const resolvedPath = dbPath ?? getDbPath()

	// For file-backed databases, ensure the parent directory exists.
	if (resolvedPath !== ':memory:') {
		mkdirSync(dirname(resolvedPath), { recursive: true })
	}

	const db = new Database(resolvedPath)

	// WAL mode for better concurrent read performance on file-backed DBs.
	if (resolvedPath !== ':memory:') {
		db.exec('PRAGMA journal_mode=WAL;')
	}

	// Create tables (idempotent).
	db.exec(SCHEMA_SQL)

	// Seed schema_version if not already set.
	const row = db
		.query<{ version: number }, []>(
			'SELECT version FROM schema_version LIMIT 1',
		)
		.get()
	if (!row) {
		db.run('INSERT INTO schema_version (version) VALUES (1)')
	}

	return db
}

/**
 * Returns the singleton `Database` instance, initialising it on first call.
 *
 * @param dbPath - Optional path override (useful for one-off test helpers).
 *   Note: once the singleton is initialised, subsequent calls ignore this
 *   parameter -- use `closeDb()` + `getDb(newPath)` to re-target.
 */
export function getDb(dbPath?: string): Database {
	if (!_db) {
		_db = initDb(dbPath)
	}
	return _db
}

/**
 * Closes the singleton database connection and clears the reference.
 * Subsequent calls to `getDb()` will re-initialise a fresh connection.
 * Primarily useful in tests to isolate state between cases.
 */
export function closeDb(): void {
	if (_db) {
		_db.close()
		_db = null
	}
}
