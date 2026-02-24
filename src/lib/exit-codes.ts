/**
 * Typed exit codes for the wots CLI.
 *
 * Each code maps to a specific failure category so agents can branch
 * programmatically without parsing stderr text.
 */

/** Successful execution. */
export const EXIT_OK = 0

/** Unexpected runtime error (API failures, crashes). */
export const EXIT_RUNTIME = 1

/** Bad arguments: unknown flag, invalid value, missing required arg. */
export const EXIT_USAGE = 2

/** Query returned zero results. */
export const EXIT_NOT_FOUND = 3

/** Missing or invalid API key for a required source. */
export const EXIT_UNAUTHORIZED = 4

/** Conflicting flags (e.g. --quick + --deep). */
export const EXIT_CONFLICT = 5

/** Process interrupted via SIGINT (Ctrl-C). */
export const EXIT_INTERRUPTED = 130

/** Union of all valid exit codes. */
export type ExitCode =
	| typeof EXIT_OK
	| typeof EXIT_RUNTIME
	| typeof EXIT_USAGE
	| typeof EXIT_NOT_FOUND
	| typeof EXIT_UNAUTHORIZED
	| typeof EXIT_CONFLICT
	| typeof EXIT_INTERRUPTED
