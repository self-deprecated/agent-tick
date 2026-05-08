import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('server skeleton', () => {
  it('serves health checks', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }) });
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('serves public auth config for single mode', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single', AGENT_TICK_PUBLIC_URL: 'https://tick.example.com' }) });
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
      })
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

  it('returns structured 404 errors for API misses', async () => {
    app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }) });
    const response = await app.inject({ method: 'GET', url: '/v1/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'not_found', message: 'Not found' } });
  });
});
