import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { PostgresAgentTickStore } from '../src/index.js';
import { DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID } from './storeHarness.js';
import { postgresDatabaseURLForSchema, postgresTestDatabaseURL, withPostgresSchemaHarness } from './postgresHarness.js';

const describePostgres = postgresTestDatabaseURL ? describe : describe.skip;
const postgresSuiteName = postgresTestDatabaseURL
  ? 'Postgres concurrency contract'
  : 'Postgres concurrency contract (set AGENT_TICK_TEST_POSTGRES_URL to run)';

class TransactionProbeStore extends PostgresAgentTickStore {
  async holdTransaction(seconds: number): Promise<void> {
    await this.transaction(async () => {
      await this.pool.query('SELECT pg_sleep($1)', [seconds]);
    });
  }
}

describePostgres(postgresSuiteName, () => {
  it('keeps same-store non-transactional queries outside active transaction clients', async () => {
    await withPostgresSchemaHarness(async ({ databaseURL, schemaName }) => {
      const store = new TransactionProbeStore({ databaseURL: postgresDatabaseURLForSchema(databaseURL, schemaName) });
      try {
        await store.migrate();
        const held = store.holdTransaction(0.4);
        await sleep(50);
        const started = Date.now();
        await store.ping();
        expect(Date.now() - started).toBeLessThan(250);
        await held;
      } finally {
        await store.close();
      }
    });
  });

  it('handles simultaneous Request responses and waiter terminal races from multiple store instances', async () => {
    await withPostgresSchemaHarness(async ({ store, openStore }) => {
      const otherStore = openStore();
      const thirdStore = openStore();
      await store.migrate();
      await store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
      const shared = await store.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Concurrent requests', '2026-05-08T00:01:00.000Z');
      const bob = await store.addWorkspaceMemberByEmail(shared.workspaceId, 'bob.concurrent@example.com', 'member', '2026-05-08T00:02:00.000Z');
      const rule = await store.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Two approvers', recipientUserIds: [DEFAULT_USER_ID, bob.userId], requiredResponseMode: 'exact', requiredResponseCount: 2 }, '2026-05-08T00:03:00.000Z');
      const credential = await store.createAgentToken({ workspaceId: shared.workspaceId, label: 'Deploy', routingRuleId: rule.routingRuleId }, '2026-05-08T00:04:00.000Z');
      const request = await store.createRequest({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, requester: { name: 'Deploy' }, requestType: 'sanction', title: 'Deploy concurrently?' }, '2026-05-08T00:05:00.000Z');
      const waiter = await store.createRequestWaiterToken(request.id, shared.workspaceId, credential.agentTokenId, undefined, '2026-05-08T00:05:10.000Z');

      const responses = await Promise.all([
        store.respondToRequestForWorkspace(request.id, shared.workspaceId, { choiceId: 'approve' }, DEFAULT_USER_ID, '2026-05-08T00:06:00.000Z'),
        otherStore.respondToRequestForWorkspace(request.id, shared.workspaceId, { choiceId: 'approve' }, bob.userId, '2026-05-08T00:06:00.001Z')
      ]);
      expect(responses.some((record) => record?.status === 'responded')).toBe(true);
      expect(await store.getRequestForWorkspace(request.id, shared.workspaceId)).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });

      const waiterResults = await Promise.all([
        store.renewRequestWaiter(waiter.waiterId, '2026-05-08T00:09:00.000Z', '2026-05-08T00:07:00.000Z'),
        otherStore.stopRequestWaiter(waiter.waiterId, 'agent_exit', '2026-05-08T00:07:00.001Z'),
        thirdStore.markRequestWaiterError(waiter.waiterId, 'transport_error', 'lost connection', '2026-05-08T00:07:00.002Z')
      ]);
      expect(waiterResults.every(Boolean)).toBe(true);
      const final = await store.getRequestForWorkspace(request.id, shared.workspaceId, undefined, '2026-05-08T00:07:30.000Z');
      expect(['stopped', 'errored']).toContain(final?.agentWaiter?.state);
    });
  });

  it('keeps Clerk identity retries receipt claims audit ordering and cleanup safe across store instances', async () => {
    await withPostgresSchemaHarness(async ({ store, openStore }) => {
      const otherStore = openStore();
      const thirdStore = openStore();
      await store.migrate();
      await Promise.all([
        store.ensureSingleTenantDefaults('2026-05-08T01:00:00.000Z'),
        otherStore.ensureSingleTenantDefaults('2026-05-08T01:00:00.001Z')
      ]);

      const profile = { issuer: 'https://clerk.example', subject: 'concurrent_user', email: 'concurrent@example.com', emailVerified: true, name: 'Concurrent' };
      const identities = await Promise.all([
        store.loginOrCreateClerkIdentity(profile, '2026-05-08T01:01:00.000Z'),
        otherStore.loginOrCreateClerkIdentity(profile, '2026-05-08T01:01:00.001Z')
      ]);
      expect(new Set(identities.map((identity) => identity.userId)).size).toBe(1);

      const receiptClaims = await Promise.all([
        store.claimBillingReceiptOwner({ provider: 'revenuecat', environment: 'sandbox', platform: 'ios', productKey: 'hosted_personal_monthly', entitlementKey: 'hosted_personal', receiptKey: 'receipt_concurrent', ownerUserId: identities[0]!.userId }, '2026-05-08T01:02:00.000Z'),
        otherStore.claimBillingReceiptOwner({ provider: 'revenuecat', environment: 'sandbox', platform: 'ios', productKey: 'hosted_personal_monthly', entitlementKey: 'hosted_personal', receiptKey: 'receipt_concurrent', ownerUserId: DEFAULT_USER_ID }, '2026-05-08T01:02:00.001Z')
      ]);
      expect(receiptClaims.filter((claim) => claim.created)).toHaveLength(1);
      expect(new Set(receiptClaims.map((claim) => claim.owner.ownerUserId)).size).toBe(1);

      await Promise.all([
        store.writeAuditEvent(DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID, 'concurrency.audit.1', 'target-1', {}, '2026-05-08T01:03:00.000Z'),
        otherStore.writeAuditEvent(DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID, 'concurrency.audit.2', 'target-2', {}, '2026-05-08T01:03:00.001Z'),
        thirdStore.writeAuditEvent(DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID, 'concurrency.audit.3', 'target-3', {}, '2026-05-08T01:03:00.002Z')
      ]);
      const audit = await store.listAuditEventsAfter(DEFAULT_WORKSPACE_ID, 0, 50);
      expect(audit.map((event) => event.eventId)).toEqual([...audit.map((event) => event.eventId)].sort((a, b) => a - b));

      await store.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, message: 'old', state: 'working' }, '2026-04-01T00:00:00.000Z');
      const cleanupResults = await Promise.all([
        store.cleanupRetention({ statusUpdatesDays: 1, auditEventsDays: 1 }, '2026-05-08T01:04:00.000Z'),
        otherStore.cleanupRetention({ statusUpdatesDays: 1, auditEventsDays: 1 }, '2026-05-08T01:04:00.000Z')
      ]);
      expect(cleanupResults.reduce((sum, result) => sum + result.statusUpdates, 0)).toBeGreaterThanOrEqual(1);
    });
  });
});
