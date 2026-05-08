import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import {
  ApprovalRequestSchema,
  CreateApprovalRequestSchema,
  RespondApprovalRequestSchema,
  type ApprovalRequest,
  type Choice,
  type CreateApprovalRequest,
  type RespondApprovalRequest
} from '@agent-tick/shared';

export const DEFAULT_USER_ID = 'usr_default';
export const DEFAULT_ORGANIZATION_ID = 'org_default';

export interface OpenStoreOptions {
  databaseURL?: string;
}

export interface AgentTokenRecord {
  agentId: string;
  name: string;
  scopes: string[];
  organizationId: string;
  ownerUserId: string | undefined;
  lastRequestAt: string | undefined;
  createdAt: string;
  revokedAt: string | undefined;
}

export interface AgentCredential extends AgentTokenRecord {
  token: string;
}

export interface AgentTokenAuth {
  source: 'agent';
  agentId: string;
  name: string;
  scopes: string[];
  organizationId: string;
  ownerUserId: string | undefined;
}

export interface CreateAgentTokenInput {
  name: string;
  scopes?: string[];
  organizationId?: string;
  ownerUserId?: string;
}

export interface CreateApprovalInput extends CreateApprovalRequest {
  organizationId?: string;
  agentId?: string;
  userId?: string;
}

export interface ClerkIdentityProfile {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export interface HumanIdentityResult {
  userId: string;
  organizationId: string;
  role: string;
}

export interface DeviceRegistrationInput {
  userId: string;
  organizationId: string;
  deviceName: string;
  platform?: string;
  installationId?: string;
  expoPushToken?: string;
}

export interface DeviceRecord {
  deviceId: string;
  userId: string;
  organizationId: string;
  name: string;
  platform: string | undefined;
  installationId: string | undefined;
  expoPushToken: string | undefined;
  createdAt: string;
  updatedAt: string;
  unregisteredAt: string | undefined;
}

export class AgentTickStore {
  readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  static open(options: OpenStoreOptions = {}): AgentTickStore {
    return new AgentTickStore(new Database(databasePathFromURL(options.databaseURL ?? 'file:./agent-tick.db')));
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    this.db.exec(MIGRATION_0001);
    const appliedAt = new Date().toISOString();
    this.db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)').run('0001_core', appliedAt);
  }

  ensureSingleTenantDefaults(now = new Date().toISOString()): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare('INSERT OR IGNORE INTO users(id, email, email_verified, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(DEFAULT_USER_ID, '', 0, 'Local admin', now, now);
      this.db
        .prepare('INSERT OR IGNORE INTO organizations(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(DEFAULT_ORGANIZATION_ID, 'Personal', now, now);
      this.db
        .prepare(
          'INSERT OR IGNORE INTO organization_memberships(organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(DEFAULT_ORGANIZATION_ID, DEFAULT_USER_ID, 'owner', now, now);
    });
    tx();
  }

  loginOrCreateClerkIdentity(profile: ClerkIdentityProfile, now = new Date().toISOString()): HumanIdentityResult {
    if (!profile.emailVerified || !profile.email.trim()) {
      throw httpError(403, 'forbidden', 'A verified primary email is required');
    }
    const email = profile.email.trim().toLowerCase();
    const existing = this.db
      .prepare('SELECT user_id FROM auth_identities WHERE provider = ? AND issuer = ? AND subject = ?')
      .get('clerk', profile.issuer, profile.subject) as { user_id: string } | undefined;

    if (existing) {
      this.db
        .prepare('UPDATE auth_identities SET email = ?, email_verified = ?, name = ?, last_seen_at = ?, updated_at = ? WHERE provider = ? AND issuer = ? AND subject = ?')
        .run(email, profile.emailVerified ? 1 : 0, profile.name, now, now, 'clerk', profile.issuer, profile.subject);
      this.db.prepare('UPDATE users SET email = ?, email_verified = ?, name = ?, updated_at = ? WHERE id = ?')
        .run(email, profile.emailVerified ? 1 : 0, profile.name, now, existing.user_id);
      const membership = this.defaultMembershipForUser(existing.user_id);
      return { userId: existing.user_id, organizationId: membership.organizationId, role: membership.role };
    }

    const collision = this.db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
    if (collision) {
      throw httpError(409, 'identity_link_required', 'A local user with this email already exists; explicit identity linking is required');
    }

    const userId = newID('usr');
    const organizationId = newID('org');
    const tx = this.db.transaction(() => {
      this.db.prepare('INSERT INTO users(id, email, email_verified, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(userId, email, profile.emailVerified ? 1 : 0, profile.name, now, now);
      this.db.prepare('INSERT INTO auth_identities(provider, issuer, subject, user_id, email, email_verified, name, first_seen_at, last_seen_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('clerk', profile.issuer, profile.subject, userId, email, profile.emailVerified ? 1 : 0, profile.name, now, now, now);
      this.db.prepare('INSERT INTO organizations(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(organizationId, `${profile.name || email}'s Organization`, now, now);
      this.db.prepare('INSERT INTO organization_memberships(organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(organizationId, userId, 'owner', now, now);
    });
    tx();
    return { userId, organizationId, role: 'owner' };
  }

  defaultMembershipForUser(userId: string): HumanIdentityResult {
    const row = this.db
      .prepare(`SELECT organization_id, role FROM organization_memberships WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`)
      .get(userId) as { organization_id: string; role: string } | undefined;
    if (!row) return { userId, organizationId: DEFAULT_ORGANIZATION_ID, role: 'owner' };
    return { userId, organizationId: row.organization_id, role: row.role };
  }

  createAgentToken(input: CreateAgentTokenInput, now = new Date().toISOString()): AgentCredential {
    const agentId = newID('agt');
    const token = `agent_${randomToken()}`;
    const scopes = input.scopes?.length ? input.scopes : ['approval:create'];
    const organizationId = input.organizationId ?? DEFAULT_ORGANIZATION_ID;
    this.db
      .prepare(
        `INSERT INTO agent_tokens(
          agent_id, organization_id, owner_user_id, name, token_hash, scopes_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(agentId, organizationId, input.ownerUserId ?? null, input.name.trim(), hashToken(token), JSON.stringify(scopes), now);
    return {
      agentId,
      name: input.name.trim(),
      token,
      scopes,
      organizationId,
      ownerUserId: input.ownerUserId,
      lastRequestAt: undefined,
      createdAt: now,
      revokedAt: undefined
    };
  }

  listAgentTokens(organizationId = DEFAULT_ORGANIZATION_ID): AgentTokenRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_tokens WHERE organization_id = ? ORDER BY created_at DESC')
      .all(organizationId) as AgentTokenRow[];
    return rows.map(mapAgentTokenRow);
  }

  verifyAgentToken(token: string, now = new Date().toISOString()): AgentTokenAuth | null {
    if (!token.startsWith('agent_')) return null;
    const hash = hashToken(token);
    const row = this.db
      .prepare('SELECT * FROM agent_tokens WHERE token_hash = ? AND revoked_at IS NULL')
      .get(hash) as AgentTokenRow | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE agent_tokens SET last_request_at = ? WHERE agent_id = ?').run(now, row.agent_id);
    return {
      source: 'agent',
      agentId: row.agent_id,
      name: row.name,
      scopes: parseJSON<string[]>(row.scopes_json, []),
      organizationId: row.organization_id,
      ownerUserId: row.owner_user_id ?? undefined
    };
  }

  createApprovalRequest(input: CreateApprovalInput, now = new Date().toISOString()): ApprovalRequest {
    const parsed = CreateApprovalRequestSchema.parse(input);
    const id = newID('req');
    const organizationId = input.organizationId ?? DEFAULT_ORGANIZATION_ID;
    const requesterAgentId = parsed.requester.agentId ?? input.agentId ?? 'agent_unknown';
    const choices = parsed.choices?.length ? parsed.choices : defaultChoices();
    this.db
      .prepare(
        `INSERT INTO approval_requests(
          id, organization_id, user_id, requester_name, requester_agent_id, requester_host,
          requester_working_directory, requester_project_name, requester_project_id, request_type,
          title, body, command, choices_json, default_choice, allow_freeform_reply, expires_at,
          risk, metadata_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        organizationId,
        input.userId ?? null,
        parsed.requester.name,
        requesterAgentId,
        parsed.requester.host ?? null,
        parsed.requester.workingDirectory ?? null,
        parsed.requester.projectName ?? null,
        parsed.requester.projectId ?? null,
        parsed.requestType,
        parsed.title,
        parsed.body ?? null,
        parsed.command ?? null,
        JSON.stringify(choices),
        parsed.defaultChoice ?? null,
        parsed.allowFreeformReply ? 1 : 0,
        parsed.expiresAt ?? null,
        parsed.risk ?? null,
        JSON.stringify(parsed.metadata ?? {}),
        'pending',
        now
      );
    this.writeAuditEvent(organizationId, input.userId ?? requesterAgentId, 'approval.created', id, { title: parsed.title }, now);
    return this.getApprovalRequest(id) ?? missingApproval(id);
  }

  listApprovalRequests(organizationId = DEFAULT_ORGANIZATION_ID): ApprovalRequest[] {
    const rows = this.db
      .prepare('SELECT * FROM approval_requests WHERE organization_id = ? ORDER BY created_at DESC')
      .all(organizationId) as ApprovalRow[];
    return rows.map(mapApprovalRow);
  }

  getApprovalRequest(id: string): ApprovalRequest | null {
    const row = this.db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id) as ApprovalRow | undefined;
    return row ? mapApprovalRow(row) : null;
  }

  respondToApprovalRequest(id: string, response: RespondApprovalRequest, responderUserId = DEFAULT_USER_ID, now = new Date().toISOString()): ApprovalRequest | null {
    const parsed = RespondApprovalRequestSchema.parse(response);
    const current = this.getApprovalRequest(id);
    if (!current) return null;
    if (current.status !== 'pending') return current;
    if (parsed.choiceId && !current.choices.some((choice) => choice.id === parsed.choiceId)) {
      throw new Error(`unknown choiceId: ${parsed.choiceId}`);
    }
    this.db
      .prepare('UPDATE approval_requests SET status = ?, response_json = ?, responded_at = ? WHERE id = ? AND status = ?')
      .run('responded', JSON.stringify(parsed), now, id, 'pending');
    this.writeAuditEvent(DEFAULT_ORGANIZATION_ID, responderUserId, 'approval.responded', id, parsed, now);
    return this.getApprovalRequest(id);
  }

  registerDevice(input: DeviceRegistrationInput, now = new Date().toISOString()): DeviceRecord {
    const existing = input.installationId
      ? (this.db
          .prepare('SELECT * FROM devices WHERE user_id = ? AND installation_id = ? AND unregistered_at IS NULL')
          .get(input.userId, input.installationId) as DeviceRow | undefined)
      : undefined;
    const deviceId = existing?.device_id ?? newID('dev');
    const expoPushToken = input.expoPushToken?.trim() || null;

    const tx = this.db.transaction(() => {
      if (expoPushToken) {
        this.db.prepare('UPDATE devices SET expo_push_token = NULL, updated_at = ? WHERE expo_push_token = ?').run(now, expoPushToken);
      }
      if (existing) {
        this.db
          .prepare('UPDATE devices SET name = ?, platform = ?, expo_push_token = ?, updated_at = ? WHERE device_id = ?')
          .run(input.deviceName.trim(), input.platform ?? null, expoPushToken, now, deviceId);
      } else {
        this.db
          .prepare('INSERT INTO devices(device_id, user_id, organization_id, name, platform, installation_id, expo_push_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(deviceId, input.userId, input.organizationId, input.deviceName.trim(), input.platform ?? null, input.installationId ?? null, expoPushToken, now, now);
      }
    });
    tx();
    return this.getDeviceForUser(deviceId, input.userId) ?? missingDevice(deviceId);
  }

  listDevicesForUser(userId: string): DeviceRecord[] {
    const rows = this.db.prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as DeviceRow[];
    return rows.map(mapDeviceRow);
  }

  getDeviceForUser(deviceId: string, userId: string): DeviceRecord | null {
    const row = this.db.prepare('SELECT * FROM devices WHERE device_id = ? AND user_id = ?').get(deviceId, userId) as DeviceRow | undefined;
    return row ? mapDeviceRow(row) : null;
  }

  updateDevicePushToken(deviceId: string, userId: string, expoPushToken: string, now = new Date().toISOString()): DeviceRecord | null {
    const token = expoPushToken.trim();
    const tx = this.db.transaction(() => {
      if (token) this.db.prepare('UPDATE devices SET expo_push_token = NULL, updated_at = ? WHERE expo_push_token = ?').run(now, token);
      this.db.prepare('UPDATE devices SET expo_push_token = ?, updated_at = ? WHERE device_id = ? AND user_id = ?').run(token || null, now, deviceId, userId);
    });
    tx();
    return this.getDeviceForUser(deviceId, userId);
  }

  unregisterDevice(deviceId: string, userId: string, now = new Date().toISOString()): DeviceRecord | null {
    this.db.prepare('UPDATE devices SET unregistered_at = ?, expo_push_token = NULL, updated_at = ? WHERE device_id = ? AND user_id = ?').run(now, now, deviceId, userId);
    return this.getDeviceForUser(deviceId, userId);
  }

  writeAuditEvent(organizationId: string, userId: string, eventType: string, targetId: string, payload: unknown, now = new Date().toISOString()): void {
    this.db
      .prepare('INSERT INTO audit_events(organization_id, user_id, event_type, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(organizationId, userId, eventType, targetId, JSON.stringify(payload ?? {}), now);
  }
}

export function databasePathFromURL(databaseURL: string): string {
  if (databaseURL === ':memory:') return databaseURL;
  if (databaseURL.startsWith('file:')) return new URL(databaseURL).pathname || databaseURL.slice('file:'.length);
  return databaseURL;
}

function mapAgentTokenRow(row: AgentTokenRow): AgentTokenRecord {
  return {
    agentId: row.agent_id,
    name: row.name,
    scopes: parseJSON<string[]>(row.scopes_json, []),
    organizationId: row.organization_id,
    ownerUserId: row.owner_user_id ?? undefined,
    lastRequestAt: row.last_request_at ?? undefined,
    createdAt: row.created_at,
    revokedAt: row.revoked_at ?? undefined
  };
}

function mapDeviceRow(row: DeviceRow): DeviceRecord {
  return {
    deviceId: row.device_id,
    userId: row.user_id,
    organizationId: row.organization_id,
    name: row.name,
    platform: row.platform ?? undefined,
    installationId: row.installation_id ?? undefined,
    expoPushToken: row.expo_push_token ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    unregisteredAt: row.unregistered_at ?? undefined
  };
}

function mapApprovalRow(row: ApprovalRow): ApprovalRequest {
  return ApprovalRequestSchema.parse({
    id: row.id,
    userId: row.user_id ?? undefined,
    requester: {
      name: row.requester_name,
      agentId: row.requester_agent_id,
      host: row.requester_host ?? undefined,
      workingDirectory: row.requester_working_directory ?? undefined,
      projectName: row.requester_project_name ?? undefined,
      projectId: row.requester_project_id ?? undefined
    },
    requestType: row.request_type,
    title: row.title,
    body: row.body ?? undefined,
    command: row.command ?? undefined,
    choices: parseJSON<Choice[]>(row.choices_json, defaultChoices()),
    defaultChoice: row.default_choice ?? undefined,
    allowFreeformReply: row.allow_freeform_reply === 1,
    expiresAt: row.expires_at ?? undefined,
    risk: row.risk ?? undefined,
    metadata: parseJSON<Record<string, string>>(row.metadata_json, {}),
    status: row.status,
    createdAt: row.created_at,
    respondedAt: row.responded_at ?? undefined,
    response: row.response_json ? parseJSON(row.response_json, undefined) : undefined
  });
}

function defaultChoices(): Choice[] {
  return [
    { id: 'approve', label: 'Approve', kind: 'approve' },
    { id: 'reject', label: 'Reject', kind: 'reject' }
  ];
}

function newID(prefix: string): string {
  return `${prefix}_${randomToken(16)}`;
}

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function httpError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function missingApproval(id: string): never {
  throw new Error(`approval request ${id} was not created`);
}

function missingDevice(id: string): never {
  throw new Error(`device ${id} was not created`);
}

interface AgentTokenRow {
  agent_id: string;
  organization_id: string;
  owner_user_id: string | null;
  name: string;
  token_hash: string;
  scopes_json: string;
  last_request_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface DeviceRow {
  device_id: string;
  user_id: string;
  organization_id: string;
  name: string;
  platform: string | null;
  installation_id: string | null;
  expo_push_token: string | null;
  created_at: string;
  updated_at: string;
  unregistered_at: string | null;
}

interface ApprovalRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  requester_name: string;
  requester_agent_id: string;
  requester_host: string | null;
  requester_working_directory: string | null;
  requester_project_name: string | null;
  requester_project_id: string | null;
  request_type: string;
  title: string;
  body: string | null;
  command: string | null;
  choices_json: string;
  default_choice: string | null;
  allow_freeform_reply: number;
  expires_at: string | null;
  risk: string | null;
  metadata_json: string;
  status: string;
  created_at: string;
  responded_at: string | null;
  response_json: string | null;
}

const MIGRATION_0001 = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  email_verified INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users(email) WHERE email <> '';

CREATE TABLE IF NOT EXISTS auth_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  issuer TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  email TEXT NOT NULL DEFAULT '',
  email_verified INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, issuer, subject)
);

CREATE INDEX IF NOT EXISTS auth_identities_user_idx ON auth_identities(user_id);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS agent_tokens (
  agent_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  owner_user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  last_request_at TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS agent_tokens_org_idx ON agent_tokens(organization_id);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT REFERENCES users(id),
  requester_name TEXT NOT NULL,
  requester_agent_id TEXT NOT NULL,
  requester_host TEXT,
  requester_working_directory TEXT,
  requester_project_name TEXT,
  requester_project_id TEXT,
  request_type TEXT NOT NULL DEFAULT 'approval',
  title TEXT NOT NULL,
  body TEXT,
  command TEXT,
  choices_json TEXT NOT NULL,
  default_choice TEXT,
  allow_freeform_reply INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  risk TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  responded_at TEXT,
  response_json TEXT
);

CREATE INDEX IF NOT EXISTS approval_requests_org_status_idx ON approval_requests(organization_id, status, created_at);

CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  platform TEXT,
  installation_id TEXT,
  expo_push_token TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  unregistered_at TEXT
);

CREATE INDEX IF NOT EXISTS devices_user_idx ON devices(user_id, unregistered_at);
CREATE UNIQUE INDEX IF NOT EXISTS devices_user_installation_idx ON devices(user_id, installation_id) WHERE installation_id IS NOT NULL AND unregistered_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
`;
