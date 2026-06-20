/**
 * Shared helpers for the synthetic Activity write-path canary.
 *
 * The canary runs the real Activity write path (Status Update + Request creation)
 * inside a rolled-back transaction with an ephemeral canary Workspace, so it
 * proves the server can create Activity without persisting rows, notifying users,
 * or polluting user-facing Activity. It catches schema drift and write-path
 * regressions that a read-only readiness ping would miss.
 */

/** Safe public canary label stamped on any synthetic rows (never committed). */
export const CANARY_TEST_LABEL = 'Agent Tick write-path canary';

/** Postgres SQLSTATE codes and SQLite messages that indicate schema drift. */
const POSTGRES_MISSING_SCHEMA_CODES = new Set(['42703', '42P01']);
const SQLITE_MISSING_SCHEMA_PATTERN = /no such column|no such table|has no column named/i;

export type ActivityWriteCanaryCode = 'schema_mismatch' | 'write_failed';

/**
 * Classify a canary write failure into a safe public code without leaking SQL,
 * column names, or stack traces. Schema drift (missing column/table) is
 * reported as `schema_mismatch`; any other failure is `write_failed`.
 */
export function classifyCanaryWriteError(error: unknown): ActivityWriteCanaryCode {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') {
      if (POSTGRES_MISSING_SCHEMA_CODES.has(code)) return 'schema_mismatch';
      if (code === 'schema_mismatch') return 'schema_mismatch';
    }
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && SQLITE_MISSING_SCHEMA_PATTERN.test(message)) return 'schema_mismatch';
  }
  return 'write_failed';
}
