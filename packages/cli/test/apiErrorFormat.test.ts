import { describe, expect, it } from 'vitest';
import { AgentTickApiError } from '@self-deprecated/agent-tick-sdk';
import { formatAgentTickApiError } from '../src/apiErrorFormat.js';

describe('CLI Activity send error formatting', () => {
  it('surfaces the server code and requestId for a schema_mismatch without leaking SQL', () => {
    const error = new AgentTickApiError(
      'The Agent Tick database schema is incompatible with this server version. Run migrations or roll back.',
      503,
      { error: { code: 'schema_mismatch', message: '...' } },
      'schema_mismatch',
      'req_abc123'
    );
    const formatted = formatAgentTickApiError(error);
    expect(formatted).toContain('schema_mismatch');
    expect(formatted).toContain('req_abc123');
    expect(formatted).toContain('Run migrations or roll back');
  });

  it('includes code and requestId for generic API errors', () => {
    const error = new AgentTickApiError('Workspace membership required', 403, {}, 'forbidden', 'req_xyz');
    expect(formatAgentTickApiError(error)).toBe('Workspace membership required (code: forbidden, requestId: req_xyz)');
  });

  it('falls back gracefully when code and requestId are absent', () => {
    const error = new AgentTickApiError('Something went wrong', 500, {});
    expect(formatAgentTickApiError(error)).toBe('Something went wrong');
  });
});
