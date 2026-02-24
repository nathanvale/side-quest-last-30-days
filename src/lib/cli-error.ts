/**
 * Structured CLI error with typed exit code and machine-readable error code.
 *
 * Thrown instead of calling `process.exit()` directly, so the top-level
 * catch handler can serialize structured error envelopes in JSON mode.
 */

import type { ExitCode } from './exit-codes.js'
import { EXIT_RUNTIME } from './exit-codes.js'

/** Machine-readable error codes for programmatic branching. */
export type CliErrorCode =
	| 'UNKNOWN_FLAG'
	| 'INVALID_EMIT'
	| 'INVALID_SOURCES'
	| 'INVALID_STRATEGY'
	| 'INVALID_DAYS'
	| 'INVALID_BUDGET'
	| 'INVALID_QUERY_TYPE'
	| 'INVALID_PERIOD'
	| 'INVALID_EVERY'
	| 'INVALID_LIMIT'
	| 'INVALID_OUTDIR'
	| 'MISSING_TOPIC'
	| 'MISSING_API_KEY'
	| 'CONFLICT_QUICK_DEEP'
	| 'CONFLICT_FAST_CHEAP'
	| 'CONFLICT_FLAGS'
	| 'NOT_FOUND'
	| 'UNKNOWN_SUBCOMMAND'
	| 'UNKNOWN_HELP_TOPIC'
	| 'API_ERROR'
	| 'RUNTIME_ERROR'

/** Options for constructing a CliError. */
export interface CliErrorOptions {
	exitCode?: ExitCode
	code?: CliErrorCode
}

/**
 * CLI error with a typed exit code and machine-readable code.
 *
 * Throwing this instead of calling `process.exit()` directly allows the
 * top-level handler to choose between plain-text and JSON error output.
 */
export class CliError extends Error {
	/** Numeric process exit code. */
	readonly exitCode: ExitCode

	/** Machine-readable error code for programmatic consumers. */
	readonly code: CliErrorCode

	constructor(message: string, options: CliErrorOptions = {}) {
		super(message)
		this.name = 'CliError'
		this.exitCode = options.exitCode ?? EXIT_RUNTIME
		this.code = options.code ?? 'RUNTIME_ERROR'
	}
}

/** Serialize a CliError into a JSON error envelope for stderr. */
export function errorToEnvelope(err: CliError): {
	status: 'error'
	message: string
	error: { name: string; code: CliErrorCode }
} {
	return {
		status: 'error',
		message: err.message,
		error: {
			name: err.name,
			code: err.code,
		},
	}
}
