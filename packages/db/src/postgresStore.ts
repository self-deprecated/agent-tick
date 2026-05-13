import crypto from 'node:crypto';
import { type QueryResultRow } from 'pg';
import { PostgresStoreConnection, type PostgresStoreOptions } from './postgres.js';
import type {
  AuditEventRecord,
  CleanupExpiredSecretsResult,
  CleanupRetentionResult,
  HumanIdentityResult,
  OrganizationMembershipRecord,
  OrganizationSeatUsage,
  RetentionPolicy,
  UserProfileRecord
} from './index.js';

const DEFAULT_USER_ID = 'usr_default';
const DEFAULT_ORGANIZATION_ID = 'org_default';

interface OrganizationMembershipRow {
  organization_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  role: string;
  status: string | null;
}

interface AuditEventRow {
  event_id: number | string;
  organization_id: string;
  user_id: string;
  event_type: string;
  target_id: string;
  payload_json: string | null;
  created_at: string;
}

export class PostgresAgentTickStore extends PostgresStoreConnection {
  static open(options: PostgresStoreOptions): PostgresAgentTickStore {
    return new PostgresAgentTickStore(options);
  }

  async ensureSingleTenantDefaults(now = new Date().toISOString()): Promise<void> {
    await this.transaction(async (query) => {
      await query(
        'INSERT INTO users(id, email, email_verified, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING',
        [DEFAULT_USER_ID, '', false, 'Local admin', now, now]
      );
      await query(
        'INSERT INTO organizations(id, name, created_at, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
        [DEFAULT_ORGANIZATION_ID, 'Personal', now, now]
      );
      await query(
        'INSERT INTO organization_memberships(organization_id, user_id, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (organization_id, user_id) DO NOTHING',
        [DEFAULT_ORGANIZATION_ID, DEFAULT_USER_ID, 'owner', now, now]
      );
    });
  }

  async cleanupExpiredSecrets(now = new Date().toISOString()): Promise<CleanupExpiredSecretsResult> {
    return this.transaction(async (query) => {
      const eventTickets = await query('DELETE FROM event_tickets WHERE expires_at <= $1', [now]);
      const pairingCodes = await query('DELETE FROM pairing_codes WHERE expires_at <= $1 OR used_at IS NOT NULL', [now]);
      const approvalWaiterTokens = await query('DELETE FROM approval_waiter_tokens WHERE expires_at <= $1', [now]);
      return {
        eventTickets: eventTickets.rowCount ?? 0,
        pairingCodes: pairingCodes.rowCount ?? 0,
        approvalWaiterTokens: approvalWaiterTokens.rowCount ?? 0
      };
    });
  }

  async cleanupRetention(policy: RetentionPolicy = {}, now = new Date().toISOString()): Promise<CleanupRetentionResult> {
    return this.transaction(async (query) => {
      let approvalRequests = 0;
      let auditEvents = 0;
      let devices = 0;
      let organizationInviteTeams = 0;
      let organizationInvites = 0;

      if (policy.approvalRequestsDays !== undefined) {
        const cutoff = retentionCutoff(now, policy.approvalRequestsDays);
        const result = await query(
          "DELETE FROM approval_requests WHERE (status != 'pending' AND COALESCE(responded_at, created_at) <= $1) OR (status = 'pending' AND created_at <= $2 AND expires_at IS NOT NULL AND expires_at <= $3)",
          [cutoff, cutoff, now]
        );
        approvalRequests = result.rowCount ?? 0;
      }

      if (policy.auditEventsDays !== undefined) {
        const result = await query('DELETE FROM audit_events WHERE created_at <= $1', [retentionCutoff(now, policy.auditEventsDays)]);
        auditEvents = result.rowCount ?? 0;
      }

      if (policy.unregisteredDevicesDays !== undefined) {
        const result = await query('DELETE FROM devices WHERE unregistered_at IS NOT NULL AND unregistered_at <= $1', [retentionCutoff(now, policy.unregisteredDevicesDays)]);
        devices = result.rowCount ?? 0;
      }

      if (policy.expiredInvitesDays !== undefined) {
        const cutoff = retentionCutoff(now, policy.expiredInvitesDays);
        const eligibleInvites = `
          SELECT i.invite_id
          FROM organization_invites i
          WHERE ((i.expires_at IS NOT NULL AND i.expires_at <= $1) OR (i.revoked_at IS NOT NULL AND i.revoked_at <= $2))
            AND NOT EXISTS (SELECT 1 FROM organization_invite_acceptances a WHERE a.invite_id = i.invite_id)
        `;
        const inviteTeams = await query(`DELETE FROM organization_invite_teams WHERE invite_id IN (${eligibleInvites})`, [cutoff, cutoff]);
        const invites = await query(`DELETE FROM organization_invites WHERE invite_id IN (${eligibleInvites})`, [cutoff, cutoff]);
        organizationInviteTeams = inviteTeams.rowCount ?? 0;
        organizationInvites = invites.rowCount ?? 0;
      }

      return { approvalRequests, auditEvents, devices, organizationInviteTeams, organizationInvites };
    });
  }

  async defaultMembershipForUser(userId: string): Promise<HumanIdentityResult> {
    const row = await this.one<{ organization_id: string; role: string }>(
      "SELECT organization_id, role FROM organization_memberships WHERE user_id = $1 AND status = 'active' ORDER BY created_at ASC LIMIT 1",
      [userId]
    );
    if (!row) return { userId, organizationId: DEFAULT_ORGANIZATION_ID, role: 'owner' };
    return { userId, organizationId: row.organization_id, role: row.role };
  }

  async userProfile(userId: string): Promise<UserProfileRecord | null> {
    const row = await this.one<{ id: string; email: string | null; name: string | null; auth_method: string | null }>(
      `
        SELECT u.id, u.email, u.name, i.auth_method
        FROM users u
        LEFT JOIN auth_identities i ON i.user_id = u.id
        WHERE u.id = $1
        ORDER BY i.last_seen_at DESC
        LIMIT 1
      `,
      [userId]
    );
    if (!row) return null;
    return { userId: row.id, email: row.email ?? undefined, name: row.name ?? undefined, signInMethod: row.auth_method ?? undefined };
  }

  async listOrganizationsForUser(userId: string): Promise<OrganizationMembershipRecord[]> {
    const rows = await this.many<OrganizationMembershipRow>(
      `
        SELECT o.id AS organization_id, o.name, o.created_at, o.updated_at, m.user_id, m.role, m.status
        FROM organization_memberships m
        JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = $1 AND m.status = 'active'
        ORDER BY o.created_at ASC
      `,
      [userId]
    );
    return rows.map(mapOrganizationMembershipRow);
  }

  async listOrganizationMembers(organizationId: string): Promise<OrganizationMembershipRecord[]> {
    const rows = await this.many<OrganizationMembershipRow>(
      `
        SELECT o.id AS organization_id, o.name, o.created_at, o.updated_at, m.user_id, m.role, m.status
        FROM organization_memberships m
        JOIN organizations o ON o.id = m.organization_id
        WHERE m.organization_id = $1 AND m.status = 'active'
        ORDER BY m.created_at ASC
      `,
      [organizationId]
    );
    return rows.map(mapOrganizationMembershipRow);
  }

  async organizationSeatUsage(organizationId: string): Promise<OrganizationSeatUsage> {
    const rows = await this.many<{ status: string; count: string }>(
      "SELECT status, COUNT(*) AS count FROM organization_memberships WHERE organization_id = $1 AND status IN ('active', 'pending_approval') GROUP BY status",
      [organizationId]
    );
    return {
      activeMembers: Number(rows.find((row) => row.status === 'active')?.count ?? 0),
      pendingMembers: Number(rows.find((row) => row.status === 'pending_approval')?.count ?? 0)
    };
  }

  async organizationMembershipForUser(userId: string, organizationId: string): Promise<HumanIdentityResult | null> {
    const row = await this.one<{ organization_id: string; role: string }>(
      "SELECT organization_id, role FROM organization_memberships WHERE user_id = $1 AND organization_id = $2 AND status = 'active'",
      [userId, organizationId]
    );
    return row ? { userId, organizationId: row.organization_id, role: row.role } : null;
  }

  async organizationMembershipForUserAnyStatus(userId: string, organizationId: string): Promise<OrganizationMembershipRecord | null> {
    const row = await this.one<OrganizationMembershipRow>(
      `
        SELECT o.id AS organization_id, o.name, o.created_at, o.updated_at, m.user_id, m.role, m.status
        FROM organization_memberships m
        JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = $1 AND m.organization_id = $2
      `,
      [userId, organizationId]
    );
    return row ? mapOrganizationMembershipRow(row) : null;
  }

  async createOrganizationForUser(userId: string, name: string, now = new Date().toISOString()): Promise<OrganizationMembershipRecord> {
    const organizationId = newID('org');
    const cleanName = name.trim();
    await this.transaction(async (query) => {
      await query('INSERT INTO organizations(id, name, created_at, updated_at) VALUES ($1, $2, $3, $4)', [organizationId, cleanName, now, now]);
      await query('INSERT INTO organization_memberships(organization_id, user_id, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)', [organizationId, userId, 'owner', now, now]);
      await query('INSERT INTO audit_events(organization_id, user_id, event_type, target_id, payload_json, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [organizationId, userId, 'organization.created', organizationId, JSON.stringify({ name: cleanName }), now]);
    });
    const membership = await this.organizationMembershipForUser(userId, organizationId);
    if (!membership) throw new Error(`organization ${organizationId} was not created`);
    return { organizationId, name: cleanName, userId, role: membership.role, status: 'active', createdAt: now, updatedAt: now };
  }

  async listAuditEvents(organizationId: string, limit = 100): Promise<AuditEventRecord[]> {
    const rows = await this.many<AuditEventRow>(
      'SELECT * FROM audit_events WHERE organization_id = $1 ORDER BY event_id DESC LIMIT $2',
      [organizationId, limit]
    );
    return rows.map(mapAuditEventRow);
  }

  async listAuditEventsAfter(organizationId: string, afterEventId = 0, limit = 100): Promise<AuditEventRecord[]> {
    const rows = await this.many<AuditEventRow>(
      'SELECT * FROM audit_events WHERE organization_id = $1 AND event_id > $2 ORDER BY event_id ASC LIMIT $3',
      [organizationId, afterEventId, limit]
    );
    return rows.map(mapAuditEventRow);
  }

  async writeAuditEvent(organizationId: string, userId: string, eventType: string, targetId: string, payload: unknown, now = new Date().toISOString()): Promise<void> {
    await this.pool.query(
      'INSERT INTO audit_events(organization_id, user_id, event_type, target_id, payload_json, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [organizationId, userId, eventType, targetId, JSON.stringify(payload ?? {}), now]
    );
  }

  private async one<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
    const result = await this.pool.query<T>(sql, params);
    return result.rows[0] ?? null;
  }

  private async many<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  private async transaction<T>(fn: (query: <R extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount: number | null }>) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const query = async <R extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) => client.query<R>(sql, params);
    try {
      await client.query('BEGIN');
      const result = await fn(query);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapOrganizationMembershipRow(row: OrganizationMembershipRow): OrganizationMembershipRecord {
  return {
    organizationId: row.organization_id,
    name: row.name,
    userId: row.user_id,
    role: row.role,
    status: row.status ?? 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAuditEventRow(row: AuditEventRow): AuditEventRecord {
  return {
    eventId: Number(row.event_id),
    organizationId: row.organization_id,
    userId: row.user_id,
    eventType: row.event_type,
    targetId: row.target_id,
    payload: parseJSON(row.payload_json, {}),
    createdAt: row.created_at
  };
}

function retentionCutoff(now: string, days: number): string {
  if (!Number.isInteger(days) || days < 0) throw new Error('retention days must be a non-negative integer');
  const timestamp = Date.parse(now);
  if (Number.isNaN(timestamp)) throw new Error('retention cleanup requires a valid ISO timestamp');
  return new Date(timestamp - days * 24 * 60 * 60 * 1000).toISOString();
}

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function newID(prefix: string): string {
  return `${prefix}_${randomToken(16)}`;
}

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}
