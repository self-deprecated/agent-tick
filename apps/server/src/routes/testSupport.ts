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
      organizations: db.prepare('SELECT id, name FROM organizations ORDER BY created_at, id').all(),
      memberships: db.prepare('SELECT organization_id, user_id, role, status FROM organization_memberships ORDER BY created_at, organization_id, user_id').all(),
      agentTokens: db.prepare('SELECT agent_id, organization_id, owner_user_id, name, last_request_at, revoked_at FROM agent_tokens ORDER BY created_at, agent_id').all(),
      devices: db.prepare('SELECT device_id, user_id, name, platform, unregistered_at FROM devices ORDER BY created_at, device_id').all(),
      approvals: db.prepare('SELECT id, organization_id, requester_name, requester_agent_id, title, status FROM approval_requests ORDER BY created_at, id').all(),
      approvalRecipients: db.prepare('SELECT request_id, user_id, organization_id, source, status FROM approval_recipients ORDER BY created_at, request_id, user_id').all(),
      policies: db.prepare('SELECT policy_id, organization_id, name, team_id, project_id, required_approvals, enabled, archived_at FROM policies ORDER BY created_at, policy_id').all(),
      teams: db.prepare('SELECT team_id, organization_id, name, slug, archived_at FROM teams ORDER BY created_at, team_id').all(),
      teamMemberships: db.prepare('SELECT team_id, organization_id, user_id, role FROM team_memberships ORDER BY created_at, team_id, user_id').all(),
      invites: db.prepare('SELECT invite_id, organization_id, label, role, approval_required, used_count, revoked_at FROM organization_invites ORDER BY created_at, invite_id').all(),
      membershipRequests: db.prepare('SELECT request_id, invite_id, organization_id, user_id, requested_role, status FROM organization_invite_acceptances ORDER BY accepted_at, request_id').all()
    };
  });
}

type TestSqliteDatabase = { prepare(sql: string): { all(): unknown[] } };

function sqliteDatabaseForTestSupport(store: AgentTickStore): TestSqliteDatabase {
  const db = (store as { db?: TestSqliteDatabase }).db;
  if (!db) throw new Error('Test state endpoint requires a SQLite test store');
  return db;
}
