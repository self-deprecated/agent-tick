import { AgentTickApiError } from '@self-deprecated/agent-tick-sdk';

/**
 * Format a server API error for the terminal with the safe server code and
 * request id for correlation, without exposing SQL or stack internals (the
 * server already sanitizes the message). Used so Activity send failures are
 * actionable instead of a bare "Request failed".
 */
export function formatAgentTickApiError(error: AgentTickApiError): string {
  const detail = error.message || 'Request failed';
  const tags: string[] = [];
  if (error.code) tags.push(`code: ${error.code}`);
  if (error.requestId) tags.push(`requestId: ${error.requestId}`);
  if (error.status >= 500 && error.code === 'schema_mismatch') {
    return `${detail} Run migrations or roll back the server.${tags.length ? ` (${tags.join(', ')})` : ''}`;
  }
  return tags.length ? `${detail} (${tags.join(', ')})` : detail;
}
