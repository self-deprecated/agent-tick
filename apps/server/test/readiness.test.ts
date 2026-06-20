import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AgentTickStore } from '@agent-tick/db';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { assertSchemaCompatible, SchemaMismatchError } from '../src/schemaCompatibility.js';

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

describe('schema compatibility readiness gate', () => {
  it('reports ready with database ok when the schema is current', async () => {
    const server = await build();
    const response = await server.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ready', dependencies: { database: 'ok' } });
  });

  it('returns 503 with schema_mismatch rather than database ok when a required Activity column is missing', async () => {
    const drifted = freshStore();
    // Simulate the production incident: table present, evolved write-path column absent.
    drifted.db.exec('ALTER TABLE requests DROP COLUMN content_mode');

    const server = await build(drifted);
    const response = await server.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('not_ready');
    expect(body.dependencies.database).toBe('schema_mismatch');
  });

  it('startup gate throws a safe schema_mismatch error on drift and passes when current', async () => {
    const healthy = freshStore();
    await expect(assertSchemaCompatible(healthy)).resolves.toBeUndefined();

    const drifted = freshStore();
    drifted.db.exec('ALTER TABLE status_updates DROP COLUMN context_usage_json');
    const result = assertSchemaCompatible(drifted);
    await expect(result).rejects.toBeInstanceOf(SchemaMismatchError);
    await expect(result).rejects.toMatchObject({ code: 'schema_mismatch', statusCode: 503 });
  });
});
