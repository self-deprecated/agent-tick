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

function freshStore(): AgentTickStore {
  const next = AgentTickStore.open({ databaseURL: ':memory:' });
  next.migrate();
  next.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
  store = next;
  return next;
}

async function build(localStore = freshStore()) {
  app = await buildApp({ config: loadConfig({ AGENT_TICK_MODE: 'single' }), store: localStore });
  return app;
}

describe('Activity write-path canary diagnostic', () => {
  it('passes (200) on a healthy schema, reporting pass/fail separately from /readyz', async () => {
    const server = await build();
    const response = await server.inject({ method: 'POST', url: '/v1/diagnostics/activity-write-canary' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
    // /readyz stays a separate, lightweight probe and is not affected.
    const ready = await server.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
  });

  it('fails (503) with schema_mismatch when a required Activity column is missing', async () => {
    const drifted = freshStore();
    drifted.db.exec('ALTER TABLE requests DROP COLUMN content_mode');
    const server = await build(drifted);
    const response = await server.inject({ method: 'POST', url: '/v1/diagnostics/activity-write-canary' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ ok: false, code: 'schema_mismatch' });
  });
});
