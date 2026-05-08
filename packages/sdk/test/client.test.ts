import { describe, expect, it } from 'vitest';
import { AgentTickApiError, AgentTickClient } from '../src/index.js';

describe('AgentTickClient', () => {
  it('attaches bearer and organization headers', async () => {
    const seen: { headers?: Headers; url?: string } = {};
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com/base/',
      tokenProvider: async () => 'token-123',
      organizationIdProvider: () => 'org_123',
      fetch: async (input, init) => {
        seen.url = String(input);
        seen.headers = new Headers(init?.headers);
        return jsonResponse({ status: 'ok' });
      }
    });

    await client.health();

    expect(seen.url).toBe('https://tick.example.com/healthz');
    expect(seen.headers?.get('Authorization')).toBe('Bearer token-123');
    expect(seen.headers?.get('X-Agent-Tick-Organization-ID')).toBe('org_123');
  });

  it('parses structured API errors', async () => {
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async () =>
        jsonResponse(
          { error: { code: 'not_authenticated', message: 'Authentication required', requestId: 'req-1' } },
          { status: 401 }
        )
    });

    await expect(client.getMe()).rejects.toMatchObject<Partial<AgentTickApiError>>({
      name: 'AgentTickApiError',
      status: 401,
      code: 'not_authenticated',
      requestId: 'req-1'
    });
  });

  it('validates response schemas', async () => {
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async () => jsonResponse({ status: 'wrong' })
    });

    await expect(client.health()).rejects.toThrow();
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
}
