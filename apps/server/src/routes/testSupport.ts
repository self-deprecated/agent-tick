import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';

const TestUserSchema = z.object({
  subject: z.string().min(1).default('user'),
  email: z.string().email().optional(),
  name: z.string().optional()
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
      users: db.prepare('SELECT id, email, name FROM users ORDER BY created_at, id').all(),
      workspaces: db.prepare('SELECT workspace_id, type, name FROM workspaces ORDER BY created_at, workspace_id').all(),
      workspaceMembers: db.prepare('SELECT workspace_id, user_id, role, status FROM workspace_members ORDER BY created_at, workspace_id, user_id').all(),
      agentTokens: db.prepare('SELECT agent_token_id, workspace_id, creator_user_id, routing_rule_id, label, last_activity_at, last_check_in_at, revoked_at FROM agent_tokens ORDER BY created_at, agent_token_id').all(),
      approvalDevices: db.prepare('SELECT device_id, user_id, name, platform, unregistered_at FROM approval_devices ORDER BY created_at, device_id').all(),
      requests: db.prepare('SELECT id, workspace_id, agent_token_id, routing_rule_id, title, status FROM requests ORDER BY created_at, id').all(),
      requestRecipients: db.prepare('SELECT request_id, user_id, has_active_device, responded_at FROM request_recipients ORDER BY created_at, request_id, user_id').all(),
      routingRules: db.prepare('SELECT routing_rule_id, workspace_id, name, required_response_mode, required_response_count FROM routing_rules ORDER BY created_at, routing_rule_id').all(),
      routingRuleRecipients: db.prepare('SELECT routing_rule_id, user_id FROM routing_rule_recipients ORDER BY created_at, routing_rule_id, user_id').all(),
      statusUpdates: db.prepare('SELECT status_id, workspace_id, agent_token_id, routing_rule_id, message, state FROM status_updates ORDER BY created_at, status_id').all(),
      responses: db.prepare('SELECT response_id, request_id, user_id, choice_id, final FROM responses ORDER BY created_at, response_id').all()
    };
  });
}

type TestSqliteDatabase = { prepare(sql: string): { all(): unknown[] } };

function sqliteDatabaseForTestSupport(store: AgentTickStore): TestSqliteDatabase {
  const db = (store as { db?: TestSqliteDatabase }).db;
  if (!db) throw new Error('Test state endpoint requires a SQLite test store');
  return db;
}
