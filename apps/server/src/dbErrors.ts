import type { FastifyError } from 'fastify';
import type { SchemaCompatibilityMissingColumn } from '@agent-tick/db';
import { SchemaMismatchError } from './schemaCompatibility.js';

export interface ServerErrorEnvelope {
  statusCode: number;
  code: string;
  message: string;
}

/**
 * Safe, SQL-free copy shown to clients when the schema is incompatible. Never
 * include column names, SQLSTATE codes, or stack traces here — the server log
 * keeps the detail; the client gets the code + requestId for correlation.
 */
export const SCHEMA_MISMATCH_MESSAGE =
  'The Agent Tick database schema is incompatible with this server version. Run migrations or roll back.';

/**
 * Postgres SQLSTATE codes that indicate the deployed schema is missing a column
 * or table the running code needs. These surface when Activity writes hit an
 * un-migrated database (the 42703 incident), and must be classified as a safe
 * schema_mismatch rather than a generic internal_error.
 */
const POSTGRES_MISSING_SCHEMA_CODES = new Set(['42703', '42P01']);

/** SQLite (better-sqlite3) messages that indicate the same schema drift. */
const SQLITE_MISSING_SCHEMA_PATTERN = /no such column|no such table|has no column named/i;

/**
 * Detect database write errors caused by schema drift and classify them as a
 * safe `schema_mismatch` (503). Returns `null` for anything else.
 */
export function classifyDatabaseSchemaError(error: unknown): ServerErrorEnvelope | null {
  if (error instanceof SchemaMismatchError) {
    return { statusCode: 503, code: 'schema_mismatch', message: SCHEMA_MISMATCH_MESSAGE };
  }
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    const message = (error as { message?: unknown }).message;
    if (typeof code === 'string' && POSTGRES_MISSING_SCHEMA_CODES.has(code)) {
      return { statusCode: 503, code: 'schema_mismatch', message: SCHEMA_MISMATCH_MESSAGE };
    }
    if (typeof message === 'string' && SQLITE_MISSING_SCHEMA_PATTERN.test(message)) {
      return { statusCode: 503, code: 'schema_mismatch', message: SCHEMA_MISMATCH_MESSAGE };
    }
  }
  return null;
}

/**
 * Build the public error envelope for a thrown error. Precedence:
 *  1. Explicit schema_mismatch (gate or DB missing-column write) → 503, safe copy.
 *  2. Fastify/validation/known-status errors → their status + client-safe code/message.
 *  3. Everything else → 500 internal_error with a generic message (no internals).
 */
export function serverErrorEnvelope(error: unknown): ServerErrorEnvelope {
  const schema = classifyDatabaseSchemaError(error);
  if (schema) return schema;

  const maybeFastifyError = error as Partial<FastifyError>;
  const statusCode = statusCodeForError(error);
  if (statusCode >= 500) {
    return { statusCode, code: 'internal_error', message: 'Internal server error' };
  }
  return {
    statusCode,
    code: typeof maybeFastifyError.code === 'string' ? maybeFastifyError.code : 'bad_request',
    message: error instanceof Error ? error.message : 'Request failed'
  };
}

function statusCodeForError(error: unknown): number {
  const maybeFastifyError = error as Partial<FastifyError>;
  if (typeof maybeFastifyError.statusCode === 'number') return maybeFastifyError.statusCode;
  if (typeof maybeFastifyError.validation === 'object') return 400;
  if ((error as { name?: unknown }).name === 'ZodError') return 400;
  return 500;
}

export { SchemaMismatchError } from './schemaCompatibility.js';
export type { SchemaCompatibilityMissingColumn } from '@agent-tick/db';
