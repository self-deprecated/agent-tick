import { describe, expect, it } from 'vitest';
import { classifyDatabaseSchemaError, SCHEMA_MISMATCH_MESSAGE, serverErrorEnvelope } from '../src/dbErrors.js';
import { SchemaMismatchError } from '../src/schemaCompatibility.js';

describe('server database write-error classification', () => {
  it('classifies an explicit schema mismatch gate error as schema_mismatch 503', () => {
    const error = new SchemaMismatchError([{ table: 'requests', column: 'content_mode' }]);
    expect(serverErrorEnvelope(error)).toEqual({ statusCode: 503, code: 'schema_mismatch', message: SCHEMA_MISMATCH_MESSAGE });
  });

  it('classifies a Postgres missing-column (42703) write error as schema_mismatch 503 without leaking SQL', () => {
    const error = Object.assign(new Error('column "content_mode" of relation "requests" does not exist'), { code: '42703' });
    const envelope = serverErrorEnvelope(error);
    expect(envelope).toEqual({ statusCode: 503, code: 'schema_mismatch', message: SCHEMA_MISMATCH_MESSAGE });
    expect(envelope.message).not.toContain('content_mode');
    expect(envelope.message).not.toContain('42703');
  });

  it('classifies a SQLite no-such-column write error as schema_mismatch 503', () => {
    const error = new Error('no such column: content_mode');
    expect(serverErrorEnvelope(error)).toEqual({ statusCode: 503, code: 'schema_mismatch', message: SCHEMA_MISMATCH_MESSAGE });
  });

  it('keeps generic internal errors as internal_error 500 with no internals', () => {
    const error = new Error('connect ECONNREFUSED something internal');
    expect(serverErrorEnvelope(error)).toEqual({ statusCode: 500, code: 'internal_error', message: 'Internal server error' });
  });

  it('classifies a missing table (42P01) as schema_mismatch', () => {
    const error = Object.assign(new Error('relation "requests" does not exist'), { code: '42P01' });
    expect(classifyDatabaseSchemaError(error)?.code).toBe('schema_mismatch');
  });

  it('does not classify ambiguous-column SQL bugs (42702) as schema drift', () => {
    const error = Object.assign(new Error('column reference "id" is ambiguous'), { code: '42702' });
    expect(classifyDatabaseSchemaError(error)).toBeNull();
    expect(serverErrorEnvelope(error)).toEqual({ statusCode: 500, code: 'internal_error', message: 'Internal server error' });
  });

  it('passes through client-safe 4xx errors with their code and message', () => {
    const error = Object.assign(new Error('Workspace membership required'), { statusCode: 403, code: 'forbidden' });
    expect(serverErrorEnvelope(error)).toEqual({ statusCode: 403, code: 'forbidden', message: 'Workspace membership required' });
  });
});
