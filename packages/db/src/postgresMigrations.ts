export interface PostgresMigration {
  id: string;
  sql: string;
}

/**
 * Ordered Postgres migrations for existing deployments.
 *
 * When changing POSTGRES_SCHEMA in a way CREATE TABLE IF NOT EXISTS cannot apply
 * to existing databases, append a new migration here with a lexically increasing
 * id. Keep migrations idempotent where practical so operator recovery remains
 * safe after partial/manual repairs.
 */
export const POSTGRES_MIGRATIONS: PostgresMigration[] = [
  {
    id: '20260616_0001_workspace_private_requests',
    sql: `
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS responses_entitled_until TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS private_requests_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE routing_rules ADD COLUMN IF NOT EXISTS private_requests_required BOOLEAN NOT NULL DEFAULT false;
`
  },
  {
    id: '20260616_0002_private_activity_payloads',
    sql: `
ALTER TABLE requests ADD COLUMN IF NOT EXISTS content_mode TEXT NOT NULL DEFAULT 'plain';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS encrypted_payload_json TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS private_recipient_version TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS private_unavailable_recipients_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE status_updates ADD COLUMN IF NOT EXISTS content_mode TEXT NOT NULL DEFAULT 'plain';
ALTER TABLE status_updates ADD COLUMN IF NOT EXISTS encrypted_payload_json TEXT;
ALTER TABLE status_updates ADD COLUMN IF NOT EXISTS private_recipient_version TEXT;
ALTER TABLE status_updates ADD COLUMN IF NOT EXISTS context_usage_json TEXT NOT NULL DEFAULT '{}';
`
  },
  {
    id: '20260616_0003_tool_activity',
    sql: `
CREATE TABLE IF NOT EXISTS tool_activities (
  tool_activity_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  agent_token_id TEXT REFERENCES agent_tokens(agent_token_id) ON DELETE SET NULL,
  routing_rule_id TEXT REFERENCES routing_rules(routing_rule_id) ON DELETE SET NULL,
  thread_id TEXT,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  tool_call_id TEXT,
  tool_name TEXT NOT NULL,
  state TEXT NOT NULL,
  outcome TEXT,
  summary TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  content_mode TEXT NOT NULL DEFAULT 'plain',
  encrypted_payload_json TEXT,
  private_recipient_version TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tool_activities_workspace_idx ON tool_activities(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tool_activities_session_idx ON tool_activities(workspace_id, session_id, created_at ASC);

CREATE TABLE IF NOT EXISTS tool_activity_recipients (
  tool_activity_id TEXT NOT NULL REFERENCES tool_activities(tool_activity_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(tool_activity_id, user_id)
);
CREATE INDEX IF NOT EXISTS tool_activity_recipients_user_idx ON tool_activity_recipients(user_id, tool_activity_id);
`
  },
  {
    id: '20260616_0004_tool_activity_thread_id',
    sql: `
ALTER TABLE tool_activities ADD COLUMN IF NOT EXISTS thread_id TEXT;
`
  }
];
