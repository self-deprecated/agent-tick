import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AgentTickStore } from '@agent-tick/db';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let app: FastifyInstance | undefined;
let store: AgentTickStore | undefined;

afterEach(async () => {
  await app?.close();
  store?.close();
  app = undefined;
  store = undefined;
});

function testStore(): AgentTickStore {
  const next = AgentTickStore.open({ databaseURL: ':memory:' });
  next.migrate();
  next.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
  store = next;
  return next;
}

describe('server skeleton', () => {
  it('serves health checks', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('serves public auth config for single mode', async () => {
    app = await buildApp({
      config: loadConfig({ AGENT_TICK_MODE: 'single', AGENT_TICK_PUBLIC_URL: 'https://tick.example.com' }),
      store: testStore()
    });
    const response = await app.inject({ method: 'GET', url: '/v1/auth/config' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: 'single',
      authProvider: 'local',
      publicURL: 'https://tick.example.com'
    });
  });

  it('serves public auth config for clerk mode without exposing secret key', async () => {
    app = await buildApp({
      config: loadConfig({
        AGENT_TICK_MODE: 'clerk',
        AGENT_TICK_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
        AGENT_TICK_CLERK_SECRET_KEY: 'sk_test_secret'
      }),
      store: testStore()
    });
    const response = await app.inject({ method: 'GET', url: '/v1/auth/config' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: 'clerk',
      authProvider: 'clerk',
      clerkPublishableKey: 'pk_test_123'
    });
    expect(JSON.stringify(response.json())).not.toContain('sk_test_secret');
  });

  it('requires Clerk keys in clerk mode config', () => {
    expect(() => loadConfig({ AGENT_TICK_MODE: 'clerk' })).toThrow(/CLERK_PUBLISHABLE_KEY/);
  });

  it('rejects invalid Clerk bearer tokens in clerk mode', async () => {
    app = await buildApp({
      config: loadConfig({
        AGENT_TICK_MODE: 'clerk',
        AGENT_TICK_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
        AGENT_TICK_CLERK_SECRET_KEY: 'sk_test_secret'
      }),
      store: testStore()
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer invalid.jwt.token' }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'not_authenticated' } });
  });

  it('returns structured 404 errors for API misses', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });
    const response = await app.inject({ method: 'GET', url: '/v1/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'not_found', message: 'Not found' } });
  });

  it('lists and selects local organizations for human requests', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });

    const createOrg = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Production' } });
    expect(createOrg.statusCode).toBe(200);
    const organizationId = createOrg.json().organizationId as string;

    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { 'x-agent-tick-organization-id': organizationId } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ organizationId, role: 'owner' });

    const forbidden = await app.inject({ method: 'GET', url: '/v1/me', headers: { 'x-agent-tick-organization-id': 'org_missing' } });
    expect(forbidden.statusCode).toBe(403);
  });

  it('creates an agent token and uses it to create an approval request', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });

    const tokenResponse = await app.inject({ method: 'POST', url: '/v1/agent-tokens', payload: { name: 'agent' } });
    expect(tokenResponse.statusCode).toBe(200);
    const token = tokenResponse.json().token as string;

    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/approval-requests',
      headers: { authorization: `Bearer ${token}` },
      payload: { requester: { name: 'agent' }, title: 'Deploy?' }
    });
    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toMatchObject({ title: 'Deploy?', status: 'pending' });
  });

  it('registers devices for the authenticated human user', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/devices/register',
      payload: {
        deviceName: 'iPhone',
        platform: 'ios',
        installationId: 'install-1',
        expoPushToken: 'ExponentPushToken[abc]'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().deviceId).toMatch(/^dev_/);
  });

  it('allows a human admin to respond to an approval request', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: testStore() });
    const tokenResponse = await app.inject({ method: 'POST', url: '/v1/agent-tokens', payload: { name: 'agent' } });
    const token = tokenResponse.json().token as string;
    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/approval-requests',
      headers: { authorization: `Bearer ${token}` },
      payload: { requester: { name: 'agent' }, title: 'Deploy?' }
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/approval-requests/${createResponse.json().id}/responses`,
      payload: { choiceId: 'approve' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });
  });
});
