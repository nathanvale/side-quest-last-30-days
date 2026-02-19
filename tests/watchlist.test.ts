/**
 * Tests for the SQLite persistence layer (store.ts) and watchlist CRUD
 * (watchlist.ts). Every test uses an in-memory database for full isolation.
 */

import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { closeDb, initDb } from '../src/lib/store'
import { addTopic, getHistory, listTopics, recordRun, removeTopic } from '../src/lib/watchlist'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a fresh in-memory database for an isolated test. */
function makeDb(): Database {
	return initDb(':memory:')
}

/** Minimal successful RunResult fixture. */
const SUCCESS_RUN = {
	durationMs: 1234,
	itemCount: 10,
	status: 'success' as const,
	errorMessage: null,
	summaryJson: null,
}

/** Minimal error RunResult fixture. */
const ERROR_RUN = {
	durationMs: 500,
	itemCount: 0,
	status: 'error' as const,
	errorMessage: 'API key missing',
	summaryJson: null,
}

// ---------------------------------------------------------------------------
// DB initialisation
// ---------------------------------------------------------------------------

describe('initDb(:memory:)', () => {
	test('creates tables without throwing', () => {
		const db = makeDb()
		// Querying each table should succeed (not throw).
		expect(() => db.query('SELECT * FROM schema_version').all()).not.toThrow()
		expect(() => db.query('SELECT * FROM watchlist_topics').all()).not.toThrow()
		expect(() => db.query('SELECT * FROM run_history').all()).not.toThrow()
		db.close()
	})

	test('sets schema_version to 1', () => {
		const db = makeDb()
		const row = db
			.query<{ version: number }, []>('SELECT version FROM schema_version LIMIT 1')
			.get()
		expect(row?.version).toBe(1)
		db.close()
	})

	test('calling initDb twice on :memory: returns two independent DBs', () => {
		const db1 = makeDb()
		const db2 = makeDb()
		addTopic('topic-only-in-db1', undefined, db1)
		const topics2 = listTopics(db2)
		expect(topics2).toHaveLength(0)
		db1.close()
		db2.close()
	})
})

// ---------------------------------------------------------------------------
// addTopic
// ---------------------------------------------------------------------------

describe('addTopic', () => {
	test('adds a topic and it appears in listTopics', () => {
		const db = makeDb()
		addTopic('Claude Code', undefined, db)
		const topics = listTopics(db)
		expect(topics).toHaveLength(1)
		expect(topics[0]?.topic).toBe('Claude Code')
		db.close()
	})

	test('adds topic with daily schedule', () => {
		const db = makeDb()
		addTopic('Bun 1.2', 'daily', db)
		const topics = listTopics(db)
		expect(topics[0]?.schedule).toBe('daily')
		db.close()
	})

	test('adds topic with weekly schedule', () => {
		const db = makeDb()
		addTopic('React 19', 'weekly', db)
		const topics = listTopics(db)
		expect(topics[0]?.schedule).toBe('weekly')
		db.close()
	})

	test('adding same topic twice does not throw', () => {
		const db = makeDb()
		expect(() => {
			addTopic('deno', undefined, db)
			addTopic('deno', undefined, db)
		}).not.toThrow()
		db.close()
	})

	test('adding same topic twice does not duplicate rows', () => {
		const db = makeDb()
		addTopic('deno', undefined, db)
		addTopic('deno', undefined, db)
		const topics = listTopics(db)
		expect(topics).toHaveLength(1)
		db.close()
	})

	test('adding existing topic with new schedule updates the schedule', () => {
		const db = makeDb()
		addTopic('TypeScript 5', undefined, db)
		addTopic('TypeScript 5', 'weekly', db)
		const topics = listTopics(db)
		expect(topics).toHaveLength(1)
		expect(topics[0]?.schedule).toBe('weekly')
		db.close()
	})

	test('adding topic without schedule sets schedule to null', () => {
		const db = makeDb()
		addTopic('Svelte', undefined, db)
		const topics = listTopics(db)
		expect(topics[0]?.schedule).toBeNull()
		db.close()
	})

	test('createdAt is populated as an ISO-like string', () => {
		const db = makeDb()
		addTopic('Astro', undefined, db)
		const topics = listTopics(db)
		expect(topics[0]?.createdAt).toBeTruthy()
		expect(typeof topics[0]?.createdAt).toBe('string')
		db.close()
	})

	test('lastRunAt is null after insert', () => {
		const db = makeDb()
		addTopic('Remix', undefined, db)
		const topics = listTopics(db)
		expect(topics[0]?.lastRunAt).toBeNull()
		db.close()
	})
})

// ---------------------------------------------------------------------------
// removeTopic
// ---------------------------------------------------------------------------

describe('removeTopic', () => {
	test('removes an existing topic and returns true', () => {
		const db = makeDb()
		addTopic('Vue 4', undefined, db)
		const removed = removeTopic('Vue 4', db)
		expect(removed).toBe(true)
		db.close()
	})

	test('removed topic no longer appears in listTopics', () => {
		const db = makeDb()
		addTopic('Solid.js', undefined, db)
		removeTopic('Solid.js', db)
		const topics = listTopics(db)
		expect(topics).toHaveLength(0)
		db.close()
	})

	test('removing nonexistent topic returns false', () => {
		const db = makeDb()
		const removed = removeTopic('does-not-exist', db)
		expect(removed).toBe(false)
		db.close()
	})

	test('removing nonexistent topic does not throw', () => {
		const db = makeDb()
		expect(() => removeTopic('ghost-topic', db)).not.toThrow()
		db.close()
	})
})

// ---------------------------------------------------------------------------
// listTopics
// ---------------------------------------------------------------------------

describe('listTopics', () => {
	test('returns empty array when no topics exist', () => {
		const db = makeDb()
		const topics = listTopics(db)
		expect(topics).toHaveLength(0)
		db.close()
	})

	test('returns all topics when multiple exist', () => {
		const db = makeDb()
		addTopic('topic-a', undefined, db)
		addTopic('topic-b', undefined, db)
		addTopic('topic-c', undefined, db)
		const topics = listTopics(db)
		expect(topics).toHaveLength(3)
		db.close()
	})

	test('returns topics ordered by createdAt ascending', () => {
		const db = makeDb()
		addTopic('alpha', undefined, db)
		addTopic('beta', undefined, db)
		const topics = listTopics(db)
		// Insertion order corresponds to ascending createdAt.
		expect(topics[0]?.topic).toBe('alpha')
		expect(topics[1]?.topic).toBe('beta')
		db.close()
	})

	test('returned objects have the correct shape', () => {
		const db = makeDb()
		addTopic('shape-test', 'daily', db)
		const [topic] = listTopics(db)
		expect(topic).toHaveProperty('id')
		expect(topic).toHaveProperty('topic')
		expect(topic).toHaveProperty('schedule')
		expect(topic).toHaveProperty('createdAt')
		expect(topic).toHaveProperty('lastRunAt')
		db.close()
	})
})

// ---------------------------------------------------------------------------
// recordRun + getHistory
// ---------------------------------------------------------------------------

describe('recordRun', () => {
	test('records a successful run', () => {
		const db = makeDb()
		addTopic('AI news', undefined, db)
		recordRun('AI news', SUCCESS_RUN, db)
		const history = getHistory('AI news', 10, db)
		expect(history).toHaveLength(1)
		expect(history[0]?.status).toBe('success')
		db.close()
	})

	test('recorded run has correct fields', () => {
		const db = makeDb()
		addTopic('Rust 2024', undefined, db)
		recordRun('Rust 2024', SUCCESS_RUN, db)
		const [entry] = getHistory('Rust 2024', 1, db)
		expect(entry?.durationMs).toBe(1234)
		expect(entry?.itemCount).toBe(10)
		expect(entry?.errorMessage).toBeNull()
		db.close()
	})

	test('records an error run with status=error and message', () => {
		const db = makeDb()
		addTopic('error-topic', undefined, db)
		recordRun('error-topic', ERROR_RUN, db)
		const [entry] = getHistory('error-topic', 1, db)
		expect(entry?.status).toBe('error')
		expect(entry?.errorMessage).toBe('API key missing')
		db.close()
	})

	test('updates lastRunAt on the watchlist topic', () => {
		const db = makeDb()
		addTopic('tracked-topic', undefined, db)
		recordRun('tracked-topic', SUCCESS_RUN, db)
		const [topic] = listTopics(db)
		expect(topic?.lastRunAt).not.toBeNull()
		db.close()
	})

	test('does not throw when topic is not in watchlist_topics', () => {
		const db = makeDb()
		// Record a run for a topic that was never added to watchlist.
		expect(() => recordRun('un-watched-topic', SUCCESS_RUN, db)).not.toThrow()
		db.close()
	})

	test('multiple runs for same topic are all stored', () => {
		const db = makeDb()
		addTopic('multi-run', undefined, db)
		recordRun('multi-run', SUCCESS_RUN, db)
		recordRun('multi-run', SUCCESS_RUN, db)
		recordRun('multi-run', ERROR_RUN, db)
		const history = getHistory('multi-run', 10, db)
		expect(history).toHaveLength(3)
		db.close()
	})
})

// ---------------------------------------------------------------------------
// getHistory
// ---------------------------------------------------------------------------

describe('getHistory', () => {
	test('returns empty array for unknown topic', () => {
		const db = makeDb()
		const history = getHistory('no-such-topic', 10, db)
		expect(history).toHaveLength(0)
		db.close()
	})

	test('orders results most recent first', () => {
		const db = makeDb()
		addTopic('ordering-test', undefined, db)
		recordRun('ordering-test', { ...SUCCESS_RUN, itemCount: 1 }, db)
		recordRun('ordering-test', { ...SUCCESS_RUN, itemCount: 2 }, db)
		recordRun('ordering-test', { ...SUCCESS_RUN, itemCount: 3 }, db)
		const history = getHistory('ordering-test', 10, db)
		// Most recent = last inserted; because SQLite datetime('now') has
		// second-level precision we cannot rely on time ordering alone.
		// Instead we verify descending id order.
		const ids = history.map((h) => h.id)
		expect(ids[0]).toBeGreaterThan(ids[1]!)
		expect(ids[1]).toBeGreaterThan(ids[2]!)
		db.close()
	})

	test('respects the limit parameter', () => {
		const db = makeDb()
		addTopic('limit-test', undefined, db)
		for (let i = 0; i < 10; i++) {
			recordRun('limit-test', SUCCESS_RUN, db)
		}
		const history = getHistory('limit-test', 3, db)
		expect(history).toHaveLength(3)
		db.close()
	})

	test('default limit of 20 is applied', () => {
		const db = makeDb()
		addTopic('default-limit', undefined, db)
		for (let i = 0; i < 25; i++) {
			recordRun('default-limit', SUCCESS_RUN, db)
		}
		const history = getHistory('default-limit', undefined, db)
		expect(history).toHaveLength(20)
		db.close()
	})

	test('returned entries have the correct shape', () => {
		const db = makeDb()
		addTopic('shape-history', undefined, db)
		recordRun('shape-history', SUCCESS_RUN, db)
		const [entry] = getHistory('shape-history', 1, db)
		expect(entry).toHaveProperty('id')
		expect(entry).toHaveProperty('topic')
		expect(entry).toHaveProperty('ranAt')
		expect(entry).toHaveProperty('durationMs')
		expect(entry).toHaveProperty('itemCount')
		expect(entry).toHaveProperty('status')
		expect(entry).toHaveProperty('errorMessage')
		db.close()
	})
})

// ---------------------------------------------------------------------------
// closeDb (singleton lifecycle)
// ---------------------------------------------------------------------------

describe('closeDb', () => {
	afterEach(() => {
		// Ensure the singleton is always closed between tests in this suite.
		closeDb()
	})

	test('closeDb does not throw when no singleton is open', () => {
		closeDb() // Call twice -- second call should be a no-op.
		expect(() => closeDb()).not.toThrow()
	})

	test('after closeDb, getDb can be re-initialised', async () => {
		// Import getDb dynamically so we test the real singleton path.
		const { getDb } = await import('../src/lib/store')
		const db1 = getDb(':memory:')
		expect(db1).toBeTruthy()
		closeDb()
		const db2 = getDb(':memory:')
		expect(db2).toBeTruthy()
		// They should be separate instances (after close + reinit).
		closeDb()
	})
})

// ---------------------------------------------------------------------------
// Integration: full workflow
// ---------------------------------------------------------------------------

describe('integration: add, run, list, remove', () => {
	test('full CRUD lifecycle', () => {
		const db = makeDb()

		// Add two topics.
		addTopic('Go generics', 'weekly', db)
		addTopic('Zig 0.14', undefined, db)

		// Record a run for the first topic.
		recordRun('Go generics', SUCCESS_RUN, db)

		// Both topics appear in list.
		const topics = listTopics(db)
		expect(topics).toHaveLength(2)

		// First topic has lastRunAt set.
		const goTopic = topics.find((t) => t.topic === 'Go generics')
		expect(goTopic?.lastRunAt).not.toBeNull()
		expect(goTopic?.schedule).toBe('weekly')

		// History for Go generics has one entry.
		const history = getHistory('Go generics', 5, db)
		expect(history).toHaveLength(1)

		// Remove Go generics.
		const removed = removeTopic('Go generics', db)
		expect(removed).toBe(true)

		// Only Zig remains.
		const remaining = listTopics(db)
		expect(remaining).toHaveLength(1)
		expect(remaining[0]?.topic).toBe('Zig 0.14')

		db.close()
	})
})

// ---------------------------------------------------------------------------
// Singleton isolation guard
// ---------------------------------------------------------------------------

describe('singleton isolation', () => {
	beforeEach(() => closeDb())
	afterEach(() => closeDb())

	test('tests using explicit db do not contaminate the singleton', () => {
		const db = makeDb()
		addTopic('explicit-db-topic', undefined, db)
		db.close()

		// The global singleton (if lazily initialised) should be empty.
		const { getDb } = require('../src/lib/store') as typeof import('../src/lib/store')
		const singleton = getDb(':memory:')
		const topics = listTopics(singleton)
		expect(topics).toHaveLength(0)
	})
})
