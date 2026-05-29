import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_WORKSPACE_ID, openAgentTickStore } from '@agent-tick/db';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { postgresDatabaseURLForSchema, postgresTestDatabaseURL, withPostgresSchemaHarness } from '../../../packages/db/test/postgresHarness.js';

const describePostgres = postgresTestDatabaseURL ? describe : describe.skip;
const postgresSuiteName = postgresTestDatabaseURL
  ? 'Postgres server smoke'
  : 'Postgres server smoke (set AGENT_TICK_TEST_POSTGRES_URL to run)';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describePostgres(postgresSuiteName, () => {
  it('serves readiness and core routes against a real Postgres store', async () => {
    await withPostgresSchemaHarness(async ({ databaseURL, schemaName }) => {
      const schemaDatabaseURL = postgresDatabaseURLForSchema(databaseURL, schemaName);
      const config = loadConfig({
        AGENT_TICK_MODE: 'single',
        AGENT_TICK_DATABASE_URL: schemaDatabaseURL,
        AGENT_TICK_RETENTION_CLEANUP_ENABLED: 'false'
      });
      const store = openAgentTickStore({ databaseURL: config.databaseURL });
      await store.migrate('2026-05-08T00:00:00.000Z');
      await store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
      app = await buildApp({ config, store });

      const ready = await app.inject({ method: 'GET', url: '/readyz' });
      expect(ready.statusCode).toBe(200);
      expect(ready.json()).toMatchObject({ status: 'ready', dependencies: { database: 'ok' } });

      const tokenResponse = await app.inject({ method: 'POST', url: '/v1/agent-tokens', payload: { label: 'Postgres smoke' } });
      expect(tokenResponse.statusCode).toBe(200);
      const token = tokenResponse.json() as { agentTokenId: string; token: string };
      expect(token.token).toMatch(/^agent_/);

      const createRequest = await app.inject({
        method: 'POST',
        url: '/v1/requests',
        headers: { authorization: `Bearer ${token.token}` },
        payload: { requester: { name: 'Postgres smoke' }, requestType: 'sanction', title: 'Continue?' }
      });
      expect(createRequest.statusCode).toBe(200);
      const requestPayload = createRequest.json() as { request: { id: string }; waiter: { token: string } };
      expect(requestPayload.waiter.token).toMatch(/^wait_/);

      const response = await app.inject({ method: 'POST', url: `/v1/requests/${requestPayload.request.id}/responses`, payload: { choiceId: 'approve' } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });

      const wait = await app.inject({ method: 'GET', url: `/v1/requests/${requestPayload.request.id}/wait?timeoutMs=1`, headers: { authorization: `Bearer ${requestPayload.waiter.token}` } });
      expect(wait.statusCode).toBe(200);
      expect(wait.json()).toMatchObject({ request: { status: 'responded' }, terminal: true });

      const status = await app.inject({
        method: 'POST',
        url: '/v1/status-updates',
        headers: { authorization: `Bearer ${token.token}` },
        payload: { message: 'Postgres smoke status', state: 'working' }
      });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({ workspaceId: DEFAULT_WORKSPACE_ID, message: 'Postgres smoke status' });

      const activity = await app.inject({ method: 'GET', url: '/v1/activity' });
      expect(activity.statusCode).toBe(200);
      expect(JSON.stringify(activity.json())).toContain('Postgres smoke status');

      await store.writeAuditEvent(DEFAULT_WORKSPACE_ID, 'usr_default', 'postgres.smoke', 'smoke', {}, '2026-05-08T00:10:00.000Z');
      const audit = await app.inject({ method: 'GET', url: '/v1/audit-events' });
      expect(audit.statusCode).toBe(200);
      expect(audit.json()).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'postgres.smoke' })]));

      expect(await store.cleanupRetention({ statusUpdatesDays: 0, auditEventsDays: 0 }, '2026-05-09T00:00:00.000Z')).toMatchObject({ statusUpdates: expect.any(Number), auditEvents: expect.any(Number) });
      await store.close();
    });
  });
});
