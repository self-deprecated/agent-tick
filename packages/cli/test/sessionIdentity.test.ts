import { describe, expect, it } from 'vitest';
import { claudeHookSessionId, resolveAgentTickSessionId, sessionFieldsFromMcpArgs, sessionFieldsFromOptions } from '../src/sessionIdentity.js';

describe('CLI session identity helpers', () => {
  it('resolves explicit, environment, and namespaced host session ids from a dedicated module', () => {
    expect(resolveAgentTickSessionId({ explicitSessionId: ' cli_session ', env: { AGENT_TICK_SESSION_ID: 'env_session', CODEX_THREAD_ID: 'codex/thread' } })).toBe('cli_session');
    expect(resolveAgentTickSessionId({ env: { AGENT_TICK_SESSION_ID: ' env_session ', CODEX_THREAD_ID: 'codex/thread' } })).toBe('env_session');
    expect(resolveAgentTickSessionId({ env: { CODEX_THREAD_ID: ' 019e9c78/ab9c 73b0 ' } })).toBe('codex_019e9c78_ab9c_73b0');
    expect(resolveAgentTickSessionId({ env: {} })).toBeUndefined();
  });

  it('maps Claude hook and option fields into request session fields', () => {
    expect(claudeHookSessionId({ session_id: ' df39e0b0/7701 4352 ' })).toBe('claude_df39e0b0_7701_4352');
    expect(claudeHookSessionId({ tool_name: 'Bash' })).toBeUndefined();
    expect(sessionFieldsFromOptions({ session: ' run_1 ', sessionTitle: ' Release prep ' }, {})).toEqual({ sessionId: 'run_1', session: { title: 'Release prep' } });
    expect(sessionFieldsFromMcpArgs({ sessionId: ' mcp_1 ', sessionTitle: ' MCP run ' }, {})).toEqual({ sessionId: 'mcp_1', session: { title: 'MCP run' } });
  });
});
