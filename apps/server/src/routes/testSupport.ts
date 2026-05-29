import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';

const TestUserSchema = z.object({
  subject: z.string().min(1).default('user'),
  email: z.string().email().optional(),
  name: z.string().optional()
});

const BackdateStateSchema = z.object({
  iso: z.string().datetime(),
  requestIds: z.array(z.string().min(1)).default([]),
  statusIds: z.array(z.string().min(1)).default([]),
  deviceIds: z.array(z.string().min(1)).default([])
});

export interface TestSupportRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerTestSupportRoutes(app: FastifyInstance, { config, store }: TestSupportRoutesOptions): Promise<void> {
  if (!config.testAuth) return;

  app.post('/__test/users', async (request) => {
    const input = TestUserSchema.parse(request.body ?? {});
    const identity = await store.loginOrCreateClerkIdentity({
      issuer: 'agent-tick-test',
      subject: input.subject,
      email: input.email ?? `${input.subject}@example.test`,
      emailVerified: true,
      name: input.name ?? input.subject
    });
    return { ...identity, token: `test_${input.subject}` };
  });

  app.get('/__test/state', async () => {
    const db = sqliteDatabaseForTestSupport(store);
    return {
      users: db.prepare('SELECT id, email, name, created_at FROM users ORDER BY created_at, id').all(),
      workspaces: db.prepare('SELECT workspace_id, type, name, created_at FROM workspaces ORDER BY created_at, workspace_id').all(),
      workspaceMembers: db.prepare('SELECT workspace_id, user_id, role, member_kind, status, created_at FROM workspace_members ORDER BY created_at, workspace_id, user_id').all(),
      agentTokens: db.prepare('SELECT agent_token_id, workspace_id, creator_user_id, routing_rule_id, bound_recipient_user_id, label, last_activity_at, last_check_in_at, revoked_at, created_at FROM agent_tokens ORDER BY created_at, agent_token_id').all(),
      approvalDevices: db.prepare('SELECT device_id, user_id, name, platform, unregistered_at, created_at FROM approval_devices ORDER BY created_at, device_id').all(),
      requests: db.prepare('SELECT id, workspace_id, agent_token_id, routing_rule_id, title, status, created_at, deadline FROM requests ORDER BY created_at, id').all(),
      requestRecipients: db.prepare('SELECT request_id, user_id, has_active_device, responded_at FROM request_recipients ORDER BY created_at, request_id, user_id').all(),
      requestWaiters: db.prepare('SELECT waiter_id, request_id, workspace_id, agent_token_id, state, stop_reason, error_code, error_message, lease_expires_at, credential_expires_at FROM request_waiters ORDER BY created_at, waiter_id').all(),
      routingRules: db.prepare('SELECT routing_rule_id, workspace_id, name, required_response_mode, required_response_count FROM routing_rules ORDER BY created_at, routing_rule_id').all(),
      routingRuleRecipients: db.prepare('SELECT routing_rule_id, user_id FROM routing_rule_recipients ORDER BY created_at, routing_rule_id, user_id').all(),
      statusUpdates: db.prepare('SELECT status_id, workspace_id, agent_token_id, routing_rule_id, message, state, created_at FROM status_updates ORDER BY created_at, status_id').all(),
      responses: db.prepare('SELECT response_id, request_id, user_id, choice_id, final, created_at FROM responses ORDER BY created_at, response_id').all()
    };
  });

  app.post('/__test/backdate-state', async (request) => {
    const input = BackdateStateSchema.parse(request.body ?? {});
    const db = sqliteDatabaseForTestSupport(store);
    for (const id of input.requestIds) db.prepare('UPDATE requests SET created_at = ? WHERE id = ?').run(input.iso, id);
    for (const id of input.statusIds) db.prepare('UPDATE status_updates SET created_at = ? WHERE status_id = ?').run(input.iso, id);
    for (const id of input.deviceIds) db.prepare('UPDATE approval_devices SET unregistered_at = ?, updated_at = ? WHERE device_id = ?').run(input.iso, input.iso, id);
    return { ok: true };
  });

  app.post('/__test/retention-cleanup', async () => {
    return {
      secrets: await store.cleanupExpiredSecrets(),
      retention: await store.cleanupRetention({
        ...(config.requestRetentionDays !== undefined ? { requestsDays: config.requestRetentionDays } : {}),
        ...(config.statusUpdateRetentionDays !== undefined ? { statusUpdatesDays: config.statusUpdateRetentionDays } : {}),
        ...(config.auditRetentionDays !== undefined ? { auditEventsDays: config.auditRetentionDays } : {}),
        ...(config.unregisteredDeviceRetentionDays !== undefined ? { unregisteredDevicesDays: config.unregisteredDeviceRetentionDays } : {})
      })
    };
  });
}

type TestSqliteDatabase = { prepare(sql: string): { all(...params: unknown[]): unknown[]; run(...params: unknown[]): { changes: number } } };

function sqliteDatabaseForTestSupport(store: AgentTickStore): TestSqliteDatabase {
  const db = (store as { db?: TestSqliteDatabase }).db;
  if (!db) throw new Error('Test state endpoint requires a SQLite test store');
  return db;
}
