import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import {
  ApprovalRequestSchema,
  CreateApprovalRequestSchema,
  RespondApprovalRequestSchema,
  type ApprovalPolicyProgress,
  type ApprovalRequest,
  type ApprovalVoteRecord,
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
  projectId: string | undefined;
  teamId: string | undefined;
  defaultApprovalPolicy: string | undefined;
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
  projectId: string | undefined;
  teamId: string | undefined;
  defaultApprovalPolicy: string | undefined;
}

export interface CreateAgentTokenInput {
  name: string;
  scopes?: string[];
  organizationId?: string;
  ownerUserId?: string;
  projectId?: string;
  teamId?: string;
  defaultApprovalPolicy?: string;
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

export interface OrganizationRecord {
  organizationId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMembershipRecord extends OrganizationRecord {
  userId: string;
  role: string;
  status: string;
}

export interface OrganizationInviteRecord {
  inviteId: string;
  organizationId: string;
  label: string | undefined;
  role: string;
  approvalRequired: boolean;
  teamIds: string[];
  email: string | undefined;
  domain: string | undefined;
  expiresAt: string | undefined;
  maxUses: number | undefined;
  usedCount: number;
  emailLastStatus: string | undefined;
  emailLastSentAt: string | undefined;
  emailLastError: string | undefined;
  revokedAt: string | undefined;
  createdAt: string;
  token?: string;
  url?: string;
}

export interface CreateOrganizationInviteInput {
  organizationId: string;
  userId: string;
  label?: string;
  role?: string;
  approvalRequired?: boolean;
  teamIds?: string[];
  email?: string;
  domain?: string;
  expiresAt?: string;
  maxUses?: number;
  publicURL?: string;
}

export interface InvitePreviewRecord {
  organizationName: string;
  role: string;
  approvalRequired: boolean;
  expiresAt: string | undefined;
}

export interface AcceptInviteResult {
  status: 'joined' | 'already_member' | 'pending_approval';
  membership: OrganizationMembershipRecord;
}

export interface MembershipActivationLimits {
  maxActiveMembers?: number;
}

export interface OrganizationSeatUsage {
  activeMembers: number;
  pendingMembers: number;
}

export interface OrganizationMembershipRequestRecord {
  requestId: string;
  inviteId: string;
  organizationId: string;
  organizationName: string | undefined;
  userId: string;
  userEmail: string | undefined;
  userName: string | undefined;
  inviteLabel: string | undefined;
  inviteRevokedAt: string | undefined;
  requestedRole: string;
  requestedTeamIds: string[];
  status: string;
  acceptedAt: string;
  decidedByUserId: string | undefined;
  decidedAt: string | undefined;
}

export interface ProjectRecord {
  projectId: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | undefined;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | undefined;
}

export interface CreateProjectInput {
  organizationId: string;
  userId: string;
  name: string;
  slug?: string;
  description?: string;
}

export interface TeamRecord {
  teamId: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | undefined;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | undefined;
}

export interface TeamMembershipRecord extends TeamRecord {
  userId: string;
  role: string;
}

export interface CreateTeamInput {
  organizationId: string;
  userId: string;
  name: string;
  slug?: string;
  description?: string;
}

export interface UpsertTeamMemberInput {
  organizationId: string;
  actorUserId: string;
  teamId: string;
  userId: string;
  role?: string;
}

export interface RemoveTeamMemberInput {
  organizationId: string;
  actorUserId: string;
  teamId: string;
  userId: string;
}

export interface PolicyRecord {
  policyId: string;
  organizationId: string;
  name: string;
  description: string | undefined;
  projectId: string | undefined;
  teamId: string | undefined;
  requiredApprovals: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | undefined;
}

export interface CreatePolicyInput {
  organizationId: string;
  userId: string;
  name: string;
  description?: string;
  projectId?: string;
  teamId?: string;
  requiredApprovals?: number;
  enabled?: boolean;
}

export interface UpdatePolicyInput {
  organizationId: string;
  userId: string;
  policyId: string;
  name?: string;
  description?: string;
  projectId?: string | null;
  teamId?: string | null;
  requiredApprovals?: number;
  enabled?: boolean;
  archived?: boolean;
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

export interface EventTicketInput {
  source: string;
  organizationId: string;
  userId?: string;
  agentId?: string;
  ttlSeconds?: number;
}

export interface EventTicketRecord {
  ticket: string;
  expiresAt: string;
}

export interface EventTicketAuth {
  source: string;
  organizationId: string;
  userId: string | undefined;
  agentId: string | undefined;
  expiresAt: string;
}

export interface ApprovalWaiterTokenRecord {
  token: string;
  expiresAt: string;
}

export interface ApprovalWaiterAuth {
  requestId: string;
  organizationId: string;
  agentId: string;
  expiresAt: string;
}

export interface PairingTokenRecord {
  token: string;
  expiresAt: string;
}

export interface DeviceCredential {
  deviceId: string;
  token: string;
}

export interface DeviceTokenAuth {
  source: 'device';
  deviceId: string;
  userId: string;
  organizationId: string;
}

export interface AvailabilityRecord {
  userId: string;
  organizationId: string;
  state: string;
  lastSeenAt: string | undefined;
  updatedAt: string;
}

export interface AuditEventRecord {
  eventId: number;
  organizationId: string;
  userId: string;
  eventType: string;
  targetId: string;
  payload: unknown;
  createdAt: string;
}

export interface CleanupExpiredSecretsResult {
  eventTickets: number;
  pairingCodes: number;
  approvalWaiterTokens: number;
}

export interface RetentionPolicy {
  approvalRequestsDays?: number;
  auditEventsDays?: number;
  unregisteredDevicesDays?: number;
  expiredInvitesDays?: number;
}

export interface CleanupRetentionResult {
  approvalRequests: number;
  auditEvents: number;
  devices: number;
  organizationInviteTeams: number;
  organizationInvites: number;
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
    ensureColumn(this.db, 'organization_memberships', 'status', "ALTER TABLE organization_memberships ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
    ensureColumn(this.db, 'organization_memberships', 'approved_by_user_id', 'ALTER TABLE organization_memberships ADD COLUMN approved_by_user_id TEXT');
    ensureColumn(this.db, 'organization_memberships', 'approved_at', 'ALTER TABLE organization_memberships ADD COLUMN approved_at TEXT');
    ensureColumn(this.db, 'organization_memberships', 'rejected_by_user_id', 'ALTER TABLE organization_memberships ADD COLUMN rejected_by_user_id TEXT');
    ensureColumn(this.db, 'organization_memberships', 'rejected_at', 'ALTER TABLE organization_memberships ADD COLUMN rejected_at TEXT');
    ensureColumn(this.db, 'organization_memberships', 'invite_id', 'ALTER TABLE organization_memberships ADD COLUMN invite_id TEXT');
    ensureColumn(this.db, 'organization_invites', 'approval_required', 'ALTER TABLE organization_invites ADD COLUMN approval_required INTEGER NOT NULL DEFAULT 1');
    ensureColumn(this.db, 'organization_invites', 'domain', 'ALTER TABLE organization_invites ADD COLUMN domain TEXT');
    ensureColumn(this.db, 'organization_invites', 'email_last_status', 'ALTER TABLE organization_invites ADD COLUMN email_last_status TEXT');
    ensureColumn(this.db, 'organization_invites', 'email_last_sent_at', 'ALTER TABLE organization_invites ADD COLUMN email_last_sent_at TEXT');
    ensureColumn(this.db, 'organization_invites', 'email_last_error', 'ALTER TABLE organization_invites ADD COLUMN email_last_error TEXT');
    ensureColumn(this.db, 'organization_invite_acceptances', 'requested_team_ids_json', "ALTER TABLE organization_invite_acceptances ADD COLUMN requested_team_ids_json TEXT NOT NULL DEFAULT '[]'");
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

  cleanupExpiredSecrets(now = new Date().toISOString()): CleanupExpiredSecretsResult {
    const tx = this.db.transaction(() => {
      const eventTickets = this.db.prepare('DELETE FROM event_tickets WHERE expires_at <= ?').run(now).changes;
      const pairingCodes = this.db.prepare('DELETE FROM pairing_codes WHERE expires_at <= ? OR used_at IS NOT NULL').run(now).changes;
      const approvalWaiterTokens = this.db.prepare('DELETE FROM approval_waiter_tokens WHERE expires_at <= ?').run(now).changes;
      return { eventTickets, pairingCodes, approvalWaiterTokens };
    });
    return tx();
  }

  cleanupRetention(policy: RetentionPolicy = {}, now = new Date().toISOString()): CleanupRetentionResult {
    const tx = this.db.transaction(() => {
      let approvalRequests = 0;
      let auditEvents = 0;
      let devices = 0;
      let organizationInviteTeams = 0;
      let organizationInvites = 0;

      if (policy.approvalRequestsDays !== undefined) {
        const cutoff = retentionCutoff(now, policy.approvalRequestsDays);
        approvalRequests = this.db
          .prepare(
            "DELETE FROM approval_requests WHERE (status != 'pending' AND COALESCE(responded_at, created_at) <= ?) OR (status = 'pending' AND created_at <= ? AND expires_at IS NOT NULL AND expires_at <= ?)"
          )
          .run(cutoff, cutoff, now).changes;
      }

      if (policy.auditEventsDays !== undefined) {
        auditEvents = this.db.prepare('DELETE FROM audit_events WHERE created_at <= ?').run(retentionCutoff(now, policy.auditEventsDays)).changes;
      }

      if (policy.unregisteredDevicesDays !== undefined) {
        devices = this.db
          .prepare('DELETE FROM devices WHERE unregistered_at IS NOT NULL AND unregistered_at <= ?')
          .run(retentionCutoff(now, policy.unregisteredDevicesDays)).changes;
      }

      if (policy.expiredInvitesDays !== undefined) {
        const cutoff = retentionCutoff(now, policy.expiredInvitesDays);
        const eligibleInvites = `
          SELECT i.invite_id
          FROM organization_invites i
          WHERE ((i.expires_at IS NOT NULL AND i.expires_at <= ?) OR (i.revoked_at IS NOT NULL AND i.revoked_at <= ?))
            AND NOT EXISTS (SELECT 1 FROM organization_invite_acceptances a WHERE a.invite_id = i.invite_id)
        `;
        organizationInviteTeams = this.db.prepare(`DELETE FROM organization_invite_teams WHERE invite_id IN (${eligibleInvites})`).run(cutoff, cutoff).changes;
        organizationInvites = this.db.prepare(`DELETE FROM organization_invites WHERE invite_id IN (${eligibleInvites})`).run(cutoff, cutoff).changes;
      }

      return { approvalRequests, auditEvents, devices, organizationInviteTeams, organizationInvites };
    });
    return tx();
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
      .prepare(`SELECT organization_id, role FROM organization_memberships WHERE user_id = ? AND status = 'active' ORDER BY created_at ASC LIMIT 1`)
      .get(userId) as { organization_id: string; role: string } | undefined;
    if (!row) return { userId, organizationId: DEFAULT_ORGANIZATION_ID, role: 'owner' };
    return { userId, organizationId: row.organization_id, role: row.role };
  }

  listOrganizationsForUser(userId: string): OrganizationMembershipRecord[] {
    const rows = this.db
      .prepare(`
        SELECT o.id AS organization_id, o.name, o.created_at, o.updated_at, m.user_id, m.role, m.status
        FROM organization_memberships m
        JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = ? AND m.status = 'active'
        ORDER BY o.created_at ASC
      `)
      .all(userId) as OrganizationMembershipRow[];
    return rows.map(mapOrganizationMembershipRow);
  }

  listOrganizationMembers(organizationId: string): OrganizationMembershipRecord[] {
    const rows = this.db
      .prepare(`
        SELECT o.id AS organization_id, o.name, o.created_at, o.updated_at, m.user_id, m.role, m.status
        FROM organization_memberships m
        JOIN organizations o ON o.id = m.organization_id
        WHERE m.organization_id = ? AND m.status = 'active'
        ORDER BY m.created_at ASC
      `)
      .all(organizationId) as OrganizationMembershipRow[];
    return rows.map(mapOrganizationMembershipRow);
  }

  organizationSeatUsage(organizationId: string): OrganizationSeatUsage {
    const rows = this.db
      .prepare("SELECT status, COUNT(*) AS count FROM organization_memberships WHERE organization_id = ? AND status IN ('active', 'pending_approval') GROUP BY status")
      .all(organizationId) as Array<{ status: string; count: number }>;
    return {
      activeMembers: rows.find((row) => row.status === 'active')?.count ?? 0,
      pendingMembers: rows.find((row) => row.status === 'pending_approval')?.count ?? 0
    };
  }

  private assertSeatAvailableForActivation(organizationId: string, maxActiveMembers: number | undefined): void {
    if (maxActiveMembers === undefined) return;
    const limit = Math.trunc(maxActiveMembers);
    if (limit < 1) return;
    const activeMembers = this.organizationSeatUsage(organizationId).activeMembers;
    if (activeMembers >= limit) throw httpError(409, 'conflict', 'Organization active member seat limit reached');
  }

  organizationMembershipForUser(userId: string, organizationId: string): HumanIdentityResult | null {
    const row = this.db
      .prepare("SELECT organization_id, role FROM organization_memberships WHERE user_id = ? AND organization_id = ? AND status = 'active'")
      .get(userId, organizationId) as { organization_id: string; role: string } | undefined;
    return row ? { userId, organizationId: row.organization_id, role: row.role } : null;
  }

  organizationMembershipForUserAnyStatus(userId: string, organizationId: string): OrganizationMembershipRecord | null {
    const row = this.db
      .prepare(`
        SELECT o.id AS organization_id, o.name, o.created_at, o.updated_at, m.user_id, m.role, m.status
        FROM organization_memberships m
        JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = ? AND m.organization_id = ?
      `)
      .get(userId, organizationId) as OrganizationMembershipRow | undefined;
    return row ? mapOrganizationMembershipRow(row) : null;
  }

  createOrganizationForUser(userId: string, name: string, now = new Date().toISOString()): OrganizationMembershipRecord {
    const organizationId = newID('org');
    const cleanName = name.trim();
    const tx = this.db.transaction(() => {
      this.db.prepare('INSERT INTO organizations(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(organizationId, cleanName, now, now);
      this.db.prepare('INSERT INTO organization_memberships(organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(organizationId, userId, 'owner', now, now);
      this.db.prepare('INSERT INTO audit_events(organization_id, user_id, event_type, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(organizationId, userId, 'organization.created', organizationId, JSON.stringify({ name: cleanName }), now);
    });
    tx();
    const membership = this.organizationMembershipForUser(userId, organizationId) ?? missingOrganization(organizationId);
    return {
      organizationId: membership.organizationId,
      userId,
      role: membership.role,
      status: 'active',
      name: cleanName,
      createdAt: now,
      updatedAt: now
    };
  }

  listOrganizationInvites(organizationId: string): OrganizationInviteRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM organization_invites WHERE organization_id = ? ORDER BY created_at DESC')
      .all(organizationId) as OrganizationInviteRow[];
    return rows.map((row) => mapOrganizationInviteRow(row, this.listInviteTeamIds(row.invite_id)));
  }

  createOrganizationInvite(input: CreateOrganizationInviteInput, now = new Date().toISOString()): OrganizationInviteRecord {
    const inviteId = newID('inv');
    const token = `invite_${randomToken()}`;
    const role = input.role?.trim() || 'member';
    const maxUses = Math.min(Math.max(Math.trunc(input.maxUses ?? 1), 1), 100);
    const approvalRequired = input.approvalRequired ?? true;
    const email = input.email?.trim().toLowerCase() || undefined;
    const domain = normalizeInviteDomain(input.domain);
    if (email && domain) throw httpError(400, 'bad_request', 'Invite can be restricted by either exact email or domain, not both');
    const teamIds = uniqueStrings(input.teamIds ?? []);
    for (const teamId of teamIds) {
      if (!this.teamBelongsToOrganization(teamId, input.organizationId)) throw httpError(400, 'bad_request', 'Team is not in the selected organization');
    }
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO organization_invites(invite_id, organization_id, created_by_user_id, label, role, approval_required, token_hash, email, domain, expires_at, max_uses, used_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          inviteId,
          input.organizationId,
          input.userId,
          input.label?.trim() || null,
          role,
          approvalRequired ? 1 : 0,
          hashToken(token),
          email ?? null,
          domain ?? null,
          input.expiresAt ?? null,
          maxUses,
          0,
          now
        );
      for (const teamId of teamIds) this.db.prepare('INSERT INTO organization_invite_teams(invite_id, team_id) VALUES (?, ?)').run(inviteId, teamId);
    })();
    this.writeAuditEvent(input.organizationId, input.userId, 'organization_invite.created', inviteId, { role, approvalRequired, teamIds, email, domain }, now);
    const invite = this.getOrganizationInvite(inviteId) ?? missingInvite(inviteId);
    return {
      ...invite,
      token,
      ...(input.publicURL ? { url: `${input.publicURL.replace(/\/+$/, '')}/invite/${encodeURIComponent(token)}` } : {})
    };
  }

  getOrganizationInvite(inviteId: string): OrganizationInviteRecord | null {
    const row = this.db.prepare('SELECT * FROM organization_invites WHERE invite_id = ?').get(inviteId) as OrganizationInviteRow | undefined;
    return row ? mapOrganizationInviteRow(row, this.listInviteTeamIds(inviteId)) : null;
  }

  organizationName(organizationId: string): string | undefined {
    const row = this.db.prepare('SELECT name FROM organizations WHERE id = ?').get(organizationId) as { name: string } | undefined;
    return row?.name;
  }

  rotateOrganizationInviteToken(inviteId: string, organizationId: string, userId: string, now = new Date().toISOString(), publicURL?: string): OrganizationInviteRecord | null {
    const invite = this.getOrganizationInvite(inviteId);
    if (!invite || invite.organizationId !== organizationId || invite.revokedAt) return null;
    if (invite.expiresAt && invite.expiresAt <= now) return null;
    if (invite.maxUses !== undefined && invite.usedCount >= invite.maxUses) return null;
    const token = `invite_${randomToken()}`;
    const changed = this.db.prepare('UPDATE organization_invites SET token_hash = ? WHERE invite_id = ? AND organization_id = ? AND revoked_at IS NULL').run(hashToken(token), inviteId, organizationId).changes;
    if (changed !== 1) return null;
    this.writeAuditEvent(organizationId, userId, 'organization_invite.token_rotated', inviteId, {}, now);
    const rotated = this.getOrganizationInvite(inviteId) ?? missingInvite(inviteId);
    return {
      ...rotated,
      token,
      ...(publicURL ? { url: `${publicURL.replace(/\/+$/, '')}/invite/${encodeURIComponent(token)}` } : {})
    };
  }

  recordOrganizationInviteEmailDelivery(inviteId: string, organizationId: string, userId: string, status: string, errorMessage: string | undefined, now = new Date().toISOString()): OrganizationInviteRecord | null {
    const changed = this.db
      .prepare('UPDATE organization_invites SET email_last_status = ?, email_last_sent_at = ?, email_last_error = ? WHERE invite_id = ? AND organization_id = ?')
      .run(status, status === 'sent' ? now : null, errorMessage ?? null, inviteId, organizationId).changes;
    if (changed !== 1) return null;
    this.writeAuditEvent(organizationId, userId, 'organization_invite.email_delivery', inviteId, { status, error: errorMessage }, now);
    return this.getOrganizationInvite(inviteId);
  }

  revokeOrganizationInvite(inviteId: string, organizationId: string, userId: string, now = new Date().toISOString()): OrganizationInviteRecord | null {
    const row = this.db
      .prepare('SELECT * FROM organization_invites WHERE invite_id = ? AND organization_id = ?')
      .get(inviteId, organizationId) as OrganizationInviteRow | undefined;
    if (!row) return null;
    if (!row.revoked_at) {
      this.db.prepare('UPDATE organization_invites SET revoked_at = ? WHERE invite_id = ? AND organization_id = ?').run(now, inviteId, organizationId);
      row.revoked_at = now;
      this.writeAuditEvent(organizationId, userId, 'organization_invite.revoked', inviteId, {}, now);
    }
    return mapOrganizationInviteRow(row, this.listInviteTeamIds(inviteId));
  }

  private listInviteTeamIds(inviteId: string): string[] {
    const rows = this.db.prepare('SELECT team_id FROM organization_invite_teams WHERE invite_id = ? ORDER BY team_id ASC').all(inviteId) as { team_id: string }[];
    return rows.map((row) => row.team_id);
  }

  previewInvite(token: string, now = new Date().toISOString()): InvitePreviewRecord | null {
    const row = this.findUsableInvite(token, now);
    if (!row) return null;
    return {
      organizationName: row.organization_name,
      role: row.role,
      approvalRequired: Boolean(row.approval_required),
      expiresAt: row.expires_at ?? undefined
    };
  }

  acceptInvite(token: string, userId: string, now = new Date().toISOString(), limits: MembershipActivationLimits = {}): AcceptInviteResult | null {
    const invite = this.findUsableInvite(token, now);
    if (!invite) return null;
    const user = this.db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined;
    const userEmail = user?.email?.trim().toLowerCase();
    const inviteEmail = invite.email?.trim().toLowerCase();
    if (inviteEmail && userEmail !== inviteEmail) {
      throw httpError(403, 'forbidden', 'This invite is restricted to a different email address');
    }
    const inviteDomain = invite.domain?.trim().toLowerCase();
    if (inviteDomain && domainFromEmail(userEmail) !== inviteDomain) {
      throw httpError(403, 'forbidden', 'This invite is restricted to a different email domain');
    }

    const existing = this.organizationMembershipForUserAnyStatus(userId, invite.organization_id);
    if (existing?.status === 'active') return { status: 'already_member', membership: existing };
    if (existing?.status === 'pending_approval') return { status: 'pending_approval', membership: existing };

    const previousAcceptance = this.db
      .prepare('SELECT status FROM organization_invite_acceptances WHERE invite_id = ? AND user_id = ?')
      .get(invite.invite_id, userId) as { status: string } | undefined;
    if (previousAcceptance?.status === 'rejected') {
      throw httpError(409, 'conflict', 'This invite request was rejected');
    }

    const approvalRequired = Boolean(invite.approval_required);
    const teamIds = this.listInviteTeamIds(invite.invite_id);
    const requestId = newID('mreq');
    const accepted = this.db.transaction(() => {
      const consumed = this.db
        .prepare(`
          UPDATE organization_invites
          SET used_count = used_count + 1
          WHERE invite_id = ?
            AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > ?)
            AND (max_uses IS NULL OR used_count < max_uses)
        `)
        .run(invite.invite_id, now).changes;
      if (consumed !== 1) return false;
      if (!approvalRequired) this.assertSeatAvailableForActivation(invite.organization_id, limits.maxActiveMembers);

      this.db
        .prepare('INSERT INTO organization_invite_acceptances(request_id, invite_id, organization_id, user_id, requested_role, requested_team_ids_json, status, accepted_at, decided_by_user_id, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(requestId, invite.invite_id, invite.organization_id, userId, invite.role, JSON.stringify(teamIds), approvalRequired ? 'pending_approval' : 'approved', now, approvalRequired ? null : userId, approvalRequired ? null : now);

      if (existing) {
        this.db
          .prepare('UPDATE organization_memberships SET role = ?, status = ?, updated_at = ?, approved_by_user_id = ?, approved_at = ?, rejected_by_user_id = NULL, rejected_at = NULL, invite_id = ? WHERE organization_id = ? AND user_id = ?')
          .run(invite.role, approvalRequired ? 'pending_approval' : 'active', now, approvalRequired ? null : userId, approvalRequired ? null : now, invite.invite_id, invite.organization_id, userId);
      } else {
        this.db
          .prepare('INSERT INTO organization_memberships(organization_id, user_id, role, status, created_at, updated_at, approved_by_user_id, approved_at, invite_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(invite.organization_id, userId, invite.role, approvalRequired ? 'pending_approval' : 'active', now, now, approvalRequired ? null : userId, approvalRequired ? null : now, invite.invite_id);
      }
      if (!approvalRequired) {
        for (const teamId of teamIds) {
          if (this.teamBelongsToOrganization(teamId, invite.organization_id)) {
            this.db
              .prepare('INSERT INTO team_memberships(team_id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(team_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at')
              .run(teamId, invite.organization_id, userId, 'member', now, now);
            this.writeAuditEvent(invite.organization_id, userId, 'team_member.upserted', teamId, { userId, role: 'member', source: 'organization_invite', inviteId: invite.invite_id }, now);
          }
        }
      }
      return true;
    })();

    if (!accepted) return null;
    this.writeAuditEvent(invite.organization_id, userId, 'organization_invite.accepted', invite.invite_id, { role: invite.role, approvalRequired, teamIds }, now);
    if (approvalRequired) this.writeAuditEvent(invite.organization_id, userId, 'organization_membership.pending', requestId, { inviteId: invite.invite_id, role: invite.role, teamIds }, now);
    else this.writeAuditEvent(invite.organization_id, userId, 'organization_membership.approved', requestId, { inviteId: invite.invite_id, role: invite.role, teamIds, autoApproved: true }, now);

    const membership = this.organizationMembershipForUserAnyStatus(userId, invite.organization_id) ?? missingOrganization(invite.organization_id);
    return { status: approvalRequired ? 'pending_approval' : 'joined', membership };
  }

  listOrganizationMembershipRequests(organizationId: string, status = 'pending_approval'): OrganizationMembershipRequestRecord[] {
    const rows = this.db
      .prepare(`
        SELECT a.request_id, a.invite_id, a.organization_id, o.name AS organization_name, a.user_id, u.email AS user_email, u.name AS user_name,
               i.label AS invite_label, i.revoked_at AS invite_revoked_at, a.requested_role, a.requested_team_ids_json, a.status, a.accepted_at, a.decided_by_user_id, a.decided_at
        FROM organization_invite_acceptances a
        JOIN organizations o ON o.id = a.organization_id
        JOIN users u ON u.id = a.user_id
        JOIN organization_invites i ON i.invite_id = a.invite_id
        WHERE a.organization_id = ? AND a.status = ?
        ORDER BY a.accepted_at ASC
      `)
      .all(organizationId, status) as OrganizationMembershipRequestRow[];
    return rows.map(mapOrganizationMembershipRequestRow);
  }

  listOrganizationMembershipRequestsForUser(userId: string): OrganizationMembershipRequestRecord[] {
    const rows = this.db
      .prepare(`
        SELECT a.request_id, a.invite_id, a.organization_id, o.name AS organization_name, a.user_id, u.email AS user_email, u.name AS user_name,
               i.label AS invite_label, i.revoked_at AS invite_revoked_at, a.requested_role, a.requested_team_ids_json, a.status, a.accepted_at, a.decided_by_user_id, a.decided_at
        FROM organization_invite_acceptances a
        JOIN organizations o ON o.id = a.organization_id
        JOIN users u ON u.id = a.user_id
        JOIN organization_invites i ON i.invite_id = a.invite_id
        WHERE a.user_id = ? AND a.status IN ('pending_approval', 'rejected')
        ORDER BY a.accepted_at DESC
      `)
      .all(userId) as OrganizationMembershipRequestRow[];
    return rows.map(mapOrganizationMembershipRequestRow);
  }

  getOrganizationMembershipRequest(requestId: string, organizationId: string): OrganizationMembershipRequestRecord | null {
    const row = this.db
      .prepare(`
        SELECT a.request_id, a.invite_id, a.organization_id, o.name AS organization_name, a.user_id, u.email AS user_email, u.name AS user_name,
               i.label AS invite_label, i.revoked_at AS invite_revoked_at, a.requested_role, a.requested_team_ids_json, a.status, a.accepted_at, a.decided_by_user_id, a.decided_at
        FROM organization_invite_acceptances a
        JOIN organizations o ON o.id = a.organization_id
        JOIN users u ON u.id = a.user_id
        JOIN organization_invites i ON i.invite_id = a.invite_id
        WHERE a.request_id = ? AND a.organization_id = ?
      `)
      .get(requestId, organizationId) as OrganizationMembershipRequestRow | undefined;
    return row ? mapOrganizationMembershipRequestRow(row) : null;
  }

  approveOrganizationMembershipRequest(requestId: string, organizationId: string, actorUserId: string, now = new Date().toISOString(), limits: MembershipActivationLimits = {}): OrganizationMembershipRequestRecord | null {
    const existing = this.getOrganizationMembershipRequest(requestId, organizationId);
    if (!existing || existing.status !== 'pending_approval') return null;
    let changed = false;
    try {
      changed = this.db.transaction(() => {
        this.assertSeatAvailableForActivation(organizationId, limits.maxActiveMembers);
        const acceptance = this.db
          .prepare("UPDATE organization_invite_acceptances SET status = 'approved', decided_by_user_id = ?, decided_at = ? WHERE request_id = ? AND organization_id = ? AND status = 'pending_approval'")
          .run(actorUserId, now, requestId, organizationId).changes;
        if (acceptance !== 1) return false;
        const membership = this.db
          .prepare("UPDATE organization_memberships SET role = ?, status = 'active', updated_at = ?, approved_by_user_id = ?, approved_at = ?, rejected_by_user_id = NULL, rejected_at = NULL WHERE organization_id = ? AND user_id = ? AND status = 'pending_approval'")
          .run(existing.requestedRole, now, actorUserId, now, organizationId, existing.userId).changes;
        if (membership !== 1) throw new Error('pending membership was not updated');
        for (const teamId of existing.requestedTeamIds) {
          if (this.teamBelongsToOrganization(teamId, organizationId)) {
            this.db
              .prepare('INSERT INTO team_memberships(team_id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(team_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at')
              .run(teamId, organizationId, existing.userId, 'member', now, now);
            this.writeAuditEvent(organizationId, actorUserId, 'team_member.upserted', teamId, { userId: existing.userId, role: 'member', source: 'organization_invite', inviteId: existing.inviteId }, now);
          }
        }
        return true;
      })();
    } catch (error) {
      if (typeof (error as { statusCode?: unknown }).statusCode === 'number') throw error;
      return null;
    }
    if (!changed) return null;
    this.writeAuditEvent(organizationId, actorUserId, 'organization_membership.approved', requestId, { inviteId: existing.inviteId, userId: existing.userId, role: existing.requestedRole, teamIds: existing.requestedTeamIds }, now);
    return this.getOrganizationMembershipRequest(requestId, organizationId);
  }

  rejectOrganizationMembershipRequest(requestId: string, organizationId: string, actorUserId: string, now = new Date().toISOString()): OrganizationMembershipRequestRecord | null {
    const existing = this.getOrganizationMembershipRequest(requestId, organizationId);
    if (!existing || existing.status !== 'pending_approval') return null;
    let changed = false;
    try {
      changed = this.db.transaction(() => {
        const acceptance = this.db
          .prepare("UPDATE organization_invite_acceptances SET status = 'rejected', decided_by_user_id = ?, decided_at = ? WHERE request_id = ? AND organization_id = ? AND status = 'pending_approval'")
          .run(actorUserId, now, requestId, organizationId).changes;
        if (acceptance !== 1) return false;
        const membership = this.db
          .prepare("UPDATE organization_memberships SET status = 'rejected', updated_at = ?, rejected_by_user_id = ?, rejected_at = ? WHERE organization_id = ? AND user_id = ? AND status = 'pending_approval'")
          .run(now, actorUserId, now, organizationId, existing.userId).changes;
        if (membership !== 1) throw new Error('pending membership was not updated');
        return true;
      })();
    } catch {
      return null;
    }
    if (!changed) return null;
    this.writeAuditEvent(organizationId, actorUserId, 'organization_membership.rejected', requestId, { inviteId: existing.inviteId, userId: existing.userId, role: existing.requestedRole, teamIds: existing.requestedTeamIds }, now);
    return this.getOrganizationMembershipRequest(requestId, organizationId);
  }

  private findUsableInvite(token: string, now: string): OrganizationInviteLookupRow | null {
    if (!token.startsWith('invite_')) return null;
    const row = this.db
      .prepare(`
        SELECT i.*, o.name AS organization_name
        FROM organization_invites i
        JOIN organizations o ON o.id = i.organization_id
        WHERE i.token_hash = ?
          AND i.revoked_at IS NULL
          AND (i.expires_at IS NULL OR i.expires_at > ?)
          AND (i.max_uses IS NULL OR i.used_count < i.max_uses)
      `)
      .get(hashToken(token), now) as OrganizationInviteLookupRow | undefined;
    return row ?? null;
  }

  listProjects(organizationId = DEFAULT_ORGANIZATION_ID): ProjectRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM projects WHERE organization_id = ? ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE ASC')
      .all(organizationId) as ProjectRow[];
    return rows.map(mapProjectRow);
  }

  createProject(input: CreateProjectInput, now = new Date().toISOString()): ProjectRecord {
    const projectId = newID('prj');
    const cleanName = input.name.trim();
    const slug = uniqueProjectSlug(this.db, input.organizationId, input.slug ?? cleanName);
    this.db
      .prepare('INSERT INTO projects(project_id, organization_id, name, slug, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(projectId, input.organizationId, cleanName, slug, input.description?.trim() || null, now, now);
    this.writeAuditEvent(input.organizationId, input.userId, 'project.created', projectId, { name: cleanName, slug }, now);
    return this.getProject(projectId) ?? missingProject(projectId);
  }

  getProject(projectId: string): ProjectRecord | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE project_id = ?').get(projectId) as ProjectRow | undefined;
    return row ? mapProjectRow(row) : null;
  }

  listTeams(organizationId = DEFAULT_ORGANIZATION_ID): TeamRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM teams WHERE organization_id = ? ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE ASC')
      .all(organizationId) as TeamRow[];
    return rows.map(mapTeamRow);
  }

  createTeam(input: CreateTeamInput, now = new Date().toISOString()): TeamMembershipRecord {
    const teamId = newID('team');
    const cleanName = input.name.trim();
    const slug = uniqueTeamSlug(this.db, input.organizationId, input.slug ?? cleanName);
    const tx = this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO teams(team_id, organization_id, name, slug, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(teamId, input.organizationId, cleanName, slug, input.description?.trim() || null, now, now);
      this.db
        .prepare('INSERT INTO team_memberships(team_id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(teamId, input.organizationId, input.userId, 'owner', now, now);
    });
    tx();
    this.writeAuditEvent(input.organizationId, input.userId, 'team.created', teamId, { name: cleanName, slug }, now);
    return this.listTeamMembers(teamId)[0] ?? missingTeam(teamId);
  }

  listTeamMembers(teamId: string): TeamMembershipRecord[] {
    const rows = this.db
      .prepare(`
        SELECT t.team_id, t.organization_id, t.name, t.slug, t.description, t.created_at, t.updated_at, t.archived_at, m.user_id, m.role
        FROM team_memberships m
        JOIN teams t ON t.team_id = m.team_id
        WHERE m.team_id = ?
        ORDER BY m.created_at ASC
      `)
      .all(teamId) as TeamMembershipRow[];
    return rows.map(mapTeamMembershipRow);
  }

  upsertTeamMember(input: UpsertTeamMemberInput, now = new Date().toISOString()): TeamMembershipRecord {
    if (!this.teamBelongsToOrganization(input.teamId, input.organizationId)) {
      throw httpError(404, 'not_found', 'Team not found');
    }
    if (!this.organizationMembershipForUser(input.userId, input.organizationId)) {
      throw httpError(400, 'bad_request', 'User is not a member of the selected organization');
    }
    const role = input.role?.trim() || 'member';
    this.db
      .prepare(`
        INSERT INTO team_memberships(team_id, organization_id, user_id, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(team_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at
      `)
      .run(input.teamId, input.organizationId, input.userId, role, now, now);
    this.writeAuditEvent(input.organizationId, input.actorUserId, 'team_member.upserted', input.teamId, { userId: input.userId, role }, now);
    return this.listTeamMembers(input.teamId).find((member) => member.userId === input.userId) ?? missingTeam(input.teamId);
  }

  removeTeamMember(input: RemoveTeamMemberInput, now = new Date().toISOString()): TeamMembershipRecord | null {
    if (!this.teamBelongsToOrganization(input.teamId, input.organizationId)) {
      throw httpError(404, 'not_found', 'Team not found');
    }
    const members = this.listTeamMembers(input.teamId);
    const member = members.find((entry) => entry.userId === input.userId);
    if (!member) return null;
    if (member.role === 'owner' && members.filter((entry) => entry.role === 'owner').length <= 1) {
      throw httpError(400, 'bad_request', 'Cannot remove the last team owner');
    }
    this.db
      .prepare('DELETE FROM team_memberships WHERE team_id = ? AND organization_id = ? AND user_id = ?')
      .run(input.teamId, input.organizationId, input.userId);
    this.writeAuditEvent(input.organizationId, input.actorUserId, 'team_member.removed', input.teamId, { userId: input.userId, role: member.role }, now);
    return member;
  }

  listPolicies(organizationId = DEFAULT_ORGANIZATION_ID): PolicyRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM policies WHERE organization_id = ? ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE ASC')
      .all(organizationId) as PolicyRow[];
    return rows.map(mapPolicyRow);
  }

  createPolicy(input: CreatePolicyInput, now = new Date().toISOString()): PolicyRecord {
    if (input.projectId && !this.projectBelongsToOrganization(input.projectId, input.organizationId)) {
      throw httpError(400, 'bad_request', 'Project is not in the selected organization');
    }
    if (input.teamId && !this.teamBelongsToOrganization(input.teamId, input.organizationId)) {
      throw httpError(400, 'bad_request', 'Team is not in the selected organization');
    }
    const policyId = newID('pol');
    const cleanName = input.name.trim();
    const requiredApprovals = Math.min(Math.max(Math.trunc(input.requiredApprovals ?? 1), 1), 10);
    this.db
      .prepare('INSERT INTO policies(policy_id, organization_id, name, description, project_id, team_id, required_approvals, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        policyId,
        input.organizationId,
        cleanName,
        input.description?.trim() || null,
        input.projectId ?? null,
        input.teamId ?? null,
        requiredApprovals,
        input.enabled === false ? 0 : 1,
        now,
        now
      );
    this.writeAuditEvent(input.organizationId, input.userId, 'policy.created', policyId, { name: cleanName, requiredApprovals }, now);
    return this.getPolicy(policyId) ?? missingPolicy(policyId);
  }

  getPolicy(policyId: string): PolicyRecord | null {
    const row = this.db.prepare('SELECT * FROM policies WHERE policy_id = ?').get(policyId) as PolicyRow | undefined;
    return row ? mapPolicyRow(row) : null;
  }

  updatePolicy(input: UpdatePolicyInput, now = new Date().toISOString()): PolicyRecord | null {
    const existing = this.db
      .prepare('SELECT * FROM policies WHERE policy_id = ? AND organization_id = ?')
      .get(input.policyId, input.organizationId) as PolicyRow | undefined;
    if (!existing) return null;
    if (input.projectId && !this.projectBelongsToOrganization(input.projectId, input.organizationId)) {
      throw httpError(400, 'bad_request', 'Project is not in the selected organization');
    }
    if (input.teamId && !this.teamBelongsToOrganization(input.teamId, input.organizationId)) {
      throw httpError(400, 'bad_request', 'Team is not in the selected organization');
    }
    const name = input.name?.trim() || existing.name;
    const description = input.description === undefined ? existing.description : input.description.trim() || null;
    const projectId = input.projectId === undefined ? existing.project_id : input.projectId || null;
    const teamId = input.teamId === undefined ? existing.team_id : input.teamId || null;
    const requiredApprovals = input.requiredApprovals === undefined ? existing.required_approvals : Math.min(Math.max(Math.trunc(input.requiredApprovals), 1), 10);
    const enabled = input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0;
    const archivedAt = input.archived === undefined ? existing.archived_at : input.archived ? (existing.archived_at ?? now) : null;
    this.db
      .prepare('UPDATE policies SET name = ?, description = ?, project_id = ?, team_id = ?, required_approvals = ?, enabled = ?, archived_at = ?, updated_at = ? WHERE policy_id = ? AND organization_id = ?')
      .run(name, description, projectId, teamId, requiredApprovals, enabled, archivedAt, now, input.policyId, input.organizationId);
    this.writeAuditEvent(input.organizationId, input.userId, 'policy.updated', input.policyId, { name, requiredApprovals, projectId, teamId, enabled: Boolean(enabled), archived: Boolean(archivedAt) }, now);
    return this.getPolicy(input.policyId) ?? missingPolicy(input.policyId);
  }

  projectBelongsToOrganization(projectId: string, organizationId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM projects WHERE project_id = ? AND organization_id = ?').get(projectId, organizationId));
  }

  teamBelongsToOrganization(teamId: string, organizationId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM teams WHERE team_id = ? AND organization_id = ?').get(teamId, organizationId));
  }

  policyBelongsToOrganization(policyId: string, organizationId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM policies WHERE policy_id = ? AND organization_id = ?').get(policyId, organizationId));
  }

  createAgentToken(input: CreateAgentTokenInput, now = new Date().toISOString()): AgentCredential {
    const agentId = newID('agt');
    const token = `agent_${randomToken()}`;
    const scopes = input.scopes?.length ? input.scopes : ['approval:create'];
    const organizationId = input.organizationId ?? DEFAULT_ORGANIZATION_ID;
    if (input.projectId && !this.projectBelongsToOrganization(input.projectId, organizationId)) {
      throw httpError(400, 'bad_request', 'Project is not in the selected organization');
    }
    if (input.teamId && !this.teamBelongsToOrganization(input.teamId, organizationId)) {
      throw httpError(400, 'bad_request', 'Team is not in the selected organization');
    }
    if (input.defaultApprovalPolicy && !this.policyBelongsToOrganization(input.defaultApprovalPolicy, organizationId)) {
      throw httpError(400, 'bad_request', 'Policy is not in the selected organization');
    }
    this.db
      .prepare(
        `INSERT INTO agent_tokens(
          agent_id, organization_id, owner_user_id, project_id, team_id, default_approval_policy, name, token_hash, scopes_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        agentId,
        organizationId,
        input.ownerUserId ?? null,
        input.projectId ?? null,
        input.teamId ?? null,
        input.defaultApprovalPolicy ?? null,
        input.name.trim(),
        hashToken(token),
        JSON.stringify(scopes),
        now
      );
    this.writeAuditEvent(organizationId, input.ownerUserId ?? agentId, 'agent_token.created', agentId, { name: input.name.trim(), scopes, projectId: input.projectId, teamId: input.teamId }, now);
    return {
      agentId,
      name: input.name.trim(),
      token,
      scopes,
      organizationId,
      ownerUserId: input.ownerUserId,
      projectId: input.projectId,
      teamId: input.teamId,
      defaultApprovalPolicy: input.defaultApprovalPolicy,
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

  revokeAgentToken(agentId: string, organizationId = DEFAULT_ORGANIZATION_ID, now = new Date().toISOString()): AgentTokenRecord | null {
    const row = this.db
      .prepare('SELECT * FROM agent_tokens WHERE agent_id = ? AND organization_id = ?')
      .get(agentId, organizationId) as AgentTokenRow | undefined;
    if (!row) return null;
    if (!row.revoked_at) {
      this.db.prepare('UPDATE agent_tokens SET revoked_at = ? WHERE agent_id = ? AND organization_id = ?').run(now, agentId, organizationId);
      row.revoked_at = now;
      this.writeAuditEvent(organizationId, row.owner_user_id ?? agentId, 'agent_token.revoked', agentId, { name: row.name }, now);
    }
    return mapAgentTokenRow(row);
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
      ownerUserId: row.owner_user_id ?? undefined,
      projectId: row.project_id ?? undefined,
      teamId: row.team_id ?? undefined,
      defaultApprovalPolicy: row.default_approval_policy ?? undefined
    };
  }

  createApprovalRequest(input: CreateApprovalInput, now = new Date().toISOString()): ApprovalRequest {
    const parsed = CreateApprovalRequestSchema.parse(input);
    const id = newID('req');
    const organizationId = input.organizationId ?? DEFAULT_ORGANIZATION_ID;
    const requesterAgentId = input.agentId ?? parsed.requester.agentId ?? 'agent_unknown';
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
    return this.getApprovalRequest(id, undefined, now) ?? missingApproval(id);
  }

  listApprovalRequests(organizationId = DEFAULT_ORGANIZATION_ID, currentUserId?: string, now = new Date().toISOString()): ApprovalRequest[] {
    this.expirePendingApprovals(organizationId, now);
    const rows = this.db
      .prepare('SELECT * FROM approval_requests WHERE organization_id = ? ORDER BY created_at DESC')
      .all(organizationId) as ApprovalRow[];
    return rows.map((row) => this.mapApprovalWithProgress(row, currentUserId));
  }

  getApprovalRequest(id: string, currentUserId?: string, now = new Date().toISOString()): ApprovalRequest | null {
    this.expirePendingApproval(id, undefined, now);
    const row = this.approvalRow(id);
    return row ? this.mapApprovalWithProgress(row, currentUserId) : null;
  }

  getApprovalRequestForOrganization(id: string, organizationId: string, currentUserId?: string, now = new Date().toISOString()): ApprovalRequest | null {
    this.expirePendingApproval(id, organizationId, now);
    const row = this.approvalRow(id, organizationId);
    return row ? this.mapApprovalWithProgress(row, currentUserId) : null;
  }

  respondToApprovalRequest(id: string, response: RespondApprovalRequest, responderUserId = DEFAULT_USER_ID, now = new Date().toISOString()): ApprovalRequest | null {
    this.expirePendingApproval(id, undefined, now);
    const row = this.approvalRow(id);
    return row ? this.respondToApprovalRow(row, response, responderUserId, now) : null;
  }

  respondToApprovalRequestForOrganization(id: string, organizationId: string, response: RespondApprovalRequest, responderUserId = DEFAULT_USER_ID, now = new Date().toISOString()): ApprovalRequest | null {
    this.expirePendingApproval(id, organizationId, now);
    const row = this.approvalRow(id, organizationId);
    return row ? this.respondToApprovalRow(row, response, responderUserId, now) : null;
  }

  abandonApprovalRequest(id: string, actorId: string, now = new Date().toISOString()): ApprovalRequest | null {
    this.expirePendingApproval(id, undefined, now);
    const row = this.approvalRow(id);
    return row ? this.abandonApprovalRow(row, actorId, now) : null;
  }

  abandonApprovalRequestForOrganization(id: string, organizationId: string, actorId: string, now = new Date().toISOString()): ApprovalRequest | null {
    this.expirePendingApproval(id, organizationId, now);
    const row = this.approvalRow(id, organizationId);
    return row ? this.abandonApprovalRow(row, actorId, now) : null;
  }

  private expirePendingApprovals(organizationId: string, now: string): void {
    const rows = this.db
      .prepare('SELECT id, organization_id FROM approval_requests WHERE organization_id = ? AND status = ? AND expires_at IS NOT NULL AND expires_at <= ?')
      .all(organizationId, 'pending', now) as Array<{ id: string; organization_id: string }>;
    for (const row of rows) this.markApprovalExpired(row.id, row.organization_id, now);
  }

  private expirePendingApproval(id: string, organizationId: string | undefined, now: string): void {
    const row = organizationId
      ? (this.db
          .prepare('SELECT id, organization_id FROM approval_requests WHERE id = ? AND organization_id = ? AND status = ? AND expires_at IS NOT NULL AND expires_at <= ?')
          .get(id, organizationId, 'pending', now) as { id: string; organization_id: string } | undefined)
      : (this.db
          .prepare('SELECT id, organization_id FROM approval_requests WHERE id = ? AND status = ? AND expires_at IS NOT NULL AND expires_at <= ?')
          .get(id, 'pending', now) as { id: string; organization_id: string } | undefined);
    if (row) this.markApprovalExpired(row.id, row.organization_id, now);
  }

  private markApprovalExpired(id: string, organizationId: string, now: string): void {
    const result = this.db
      .prepare('UPDATE approval_requests SET status = ?, responded_at = ?, response_json = ? WHERE id = ? AND organization_id = ? AND status = ?')
      .run('expired', now, JSON.stringify({ message: 'expired' }), id, organizationId, 'pending');
    if (result.changes > 0) this.writeAuditEvent(organizationId, 'system', 'approval.expired', id, {}, now);
  }

  private approvalRow(id: string, organizationId?: string): ApprovalRow | null {
    const row = organizationId
      ? (this.db.prepare('SELECT * FROM approval_requests WHERE id = ? AND organization_id = ?').get(id, organizationId) as ApprovalRow | undefined)
      : (this.db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id) as ApprovalRow | undefined);
    return row ?? null;
  }

  private mapApprovalWithProgress(row: ApprovalRow, currentUserId?: string): ApprovalRequest {
    return mapApprovalRow(row, this.approvalPolicyProgress(row, currentUserId));
  }

  private approvalPolicyProgress(row: ApprovalRow, currentUserId?: string): ApprovalPolicyProgress | undefined {
    const policy = this.approvalPolicyForRow(row);
    if (!policy) return undefined;
    const voteRows = this.db
      .prepare('SELECT * FROM approval_votes WHERE request_id = ? ORDER BY step ASC, created_at ASC')
      .all(row.id) as ApprovalVoteRow[];
    const votes = voteRows.map(mapApprovalVoteRow);
    const receivedApprovals = votes.filter((vote) => vote.choiceId === 'approve').length;
    const currentUserVote = currentUserId ? votes.find((vote) => vote.approverUserId === currentUserId) : undefined;
    const response = row.response_json ? parseJSON<{ choiceId?: string } | undefined>(row.response_json, undefined) : undefined;
    const state = row.status === 'responded' ? (response?.choiceId && response.choiceId !== 'approve' ? 'denied' : 'approved') : row.status;
    return {
      policyId: policy.policy_id,
      state,
      currentStep: 1,
      totalSteps: 1,
      requiredApprovals: policy.required_approvals,
      receivedApprovals,
      currentUserHasVoted: Boolean(currentUserVote),
      ...(currentUserVote ? { currentUserVote } : {}),
      waitingFor: Math.max(policy.required_approvals - receivedApprovals, 0),
      votes
    };
  }

  private approvalPolicyForRow(row: ApprovalRow): PolicyRow | null {
    const metadata = parseJSON<Record<string, string>>(row.metadata_json, {});
    const policyId = metadata.defaultApprovalPolicy || metadata.policyId;
    if (!policyId) return null;
    const policy = this.db
      .prepare('SELECT * FROM policies WHERE policy_id = ? AND organization_id = ? AND enabled = 1 AND archived_at IS NULL')
      .get(policyId, row.organization_id) as PolicyRow | undefined;
    return policy ?? null;
  }

  private assertApprovalResponderEligible(row: ApprovalRow, responderUserId: string, policy: PolicyRow | null): void {
    const membership = this.organizationMembershipForUser(responderUserId, row.organization_id);
    if (!membership) throw httpError(403, 'forbidden', 'Responder is not an active member of this organization');
    if (!approvalOrganizationRoleCanRespond(membership.role)) throw httpError(403, 'forbidden', 'Responder role is not eligible to approve requests');
    if (!policy?.team_id) return;
    const teamRole = this.teamMembershipRole(policy.team_id, row.organization_id, responderUserId);
    if (!teamRole || !approvalTeamRoleCanRespond(teamRole)) {
      throw httpError(403, 'forbidden', 'Responder is not eligible for this team approval policy');
    }
  }

  private teamMembershipRole(teamId: string, organizationId: string, userId: string): string | null {
    const row = this.db
      .prepare('SELECT role FROM team_memberships WHERE team_id = ? AND organization_id = ? AND user_id = ?')
      .get(teamId, organizationId, userId) as { role: string } | undefined;
    return row?.role ?? null;
  }

  private respondToApprovalRow(row: ApprovalRow, response: RespondApprovalRequest, responderUserId: string, now: string): ApprovalRequest {
    const parsed = RespondApprovalRequestSchema.parse(response);
    const current = this.mapApprovalWithProgress(row, responderUserId);
    if (current.status !== 'pending') return current;
    if (parsed.choiceId && !current.choices.some((choice) => choice.id === parsed.choiceId)) {
      throw httpError(400, 'bad_request', `unknown choiceId: ${parsed.choiceId}`);
    }
    const policy = this.approvalPolicyForRow(row);
    this.assertApprovalResponderEligible(row, responderUserId, policy);
    if (policy && policy.required_approvals > 1 && parsed.choiceId) {
      this.recordApprovalVote(row.id, policy.policy_id, responderUserId, parsed, now);
      this.writeAuditEvent(row.organization_id, responderUserId, 'approval.vote_recorded', row.id, { policyId: policy.policy_id, choiceId: parsed.choiceId }, now);
      if (parsed.choiceId === 'approve' && this.approvalVoteCount(row.id, 'approve') < policy.required_approvals) {
        return this.getApprovalRequestForOrganization(row.id, row.organization_id, responderUserId) ?? missingApproval(row.id);
      }
    }
    this.db
      .prepare('UPDATE approval_requests SET status = ?, response_json = ?, responded_at = ? WHERE id = ? AND organization_id = ? AND status = ?')
      .run('responded', JSON.stringify(parsed), now, row.id, row.organization_id, 'pending');
    this.writeAuditEvent(row.organization_id, responderUserId, 'approval.responded', row.id, parsed, now);
    return this.getApprovalRequestForOrganization(row.id, row.organization_id, responderUserId) ?? missingApproval(row.id);
  }

  private recordApprovalVote(requestId: string, policyId: string, responderUserId: string, response: RespondApprovalRequest, now: string): void {
    const parsed = RespondApprovalRequestSchema.parse(response);
    this.db
      .prepare(`
        INSERT INTO approval_votes(vote_id, request_id, policy_id, step, approver_user_id, source, choice_id, message, answers_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(request_id, approver_user_id, step) DO UPDATE SET
          choice_id = excluded.choice_id,
          message = excluded.message,
          answers_json = excluded.answers_json,
          updated_at = excluded.updated_at
      `)
      .run(
        newID('vote'),
        requestId,
        policyId,
        1,
        responderUserId,
        'human',
        parsed.choiceId ?? 'response',
        parsed.message ?? null,
        parsed.answers ? JSON.stringify(parsed.answers) : null,
        now,
        now
      );
  }

  private approvalVoteCount(requestId: string, choiceId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM approval_votes WHERE request_id = ? AND step = 1 AND choice_id = ?')
      .get(requestId, choiceId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  private abandonApprovalRow(row: ApprovalRow, actorId: string, now: string): ApprovalRequest {
    const current = this.mapApprovalWithProgress(row);
    if (current.status !== 'pending') return current;
    this.db
      .prepare('UPDATE approval_requests SET status = ?, responded_at = ?, response_json = ? WHERE id = ? AND organization_id = ? AND status = ?')
      .run('abandoned', now, JSON.stringify({ message: 'abandoned' }), row.id, row.organization_id, 'pending');
    this.writeAuditEvent(row.organization_id, actorId, 'approval.abandoned', row.id, {}, now);
    return this.getApprovalRequestForOrganization(row.id, row.organization_id) ?? missingApproval(row.id);
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
    const device = this.getDeviceForUser(deviceId, input.userId) ?? missingDevice(deviceId);
    this.writeAuditEvent(input.organizationId, input.userId, existing ? 'device.updated' : 'device.registered', deviceId, { name: input.deviceName.trim(), platform: input.platform }, now);
    return device;
  }

  createPairingToken(userId: string, organizationId: string, now = new Date().toISOString(), ttlSeconds = 10 * 60): PairingTokenRecord {
    const token = `pair_${randomToken()}`;
    const expiresAt = new Date(new Date(now).getTime() + ttlSeconds * 1000).toISOString();
    this.db
      .prepare('INSERT INTO pairing_codes(token_hash, user_id, organization_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(hashToken(token), userId, organizationId, expiresAt, now);
    return { token, expiresAt };
  }

  pairDeviceWithCode(pairingCode: string, deviceName: string, platform: string | undefined, now = new Date().toISOString()): DeviceCredential | null {
    if (!pairingCode.startsWith('pair_')) return null;
    const row = this.db
      .prepare('SELECT * FROM pairing_codes WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
      .get(hashToken(pairingCode), now) as PairingCodeRow | undefined;
    if (!row) return null;
    const token = `device_${randomToken()}`;
    const deviceId = newID('dev');
    const tx = this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO devices(device_id, user_id, organization_id, name, platform, token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(deviceId, row.user_id, row.organization_id, deviceName.trim(), platform ?? null, hashToken(token), now, now);
      this.db.prepare('UPDATE pairing_codes SET used_at = ? WHERE token_hash = ?').run(now, row.token_hash);
    });
    tx();
    this.writeAuditEvent(row.organization_id, row.user_id, 'device.paired', deviceId, { name: deviceName.trim(), platform }, now);
    return { deviceId, token };
  }

  verifyDeviceToken(token: string): DeviceTokenAuth | null {
    if (!token.startsWith('device_')) return null;
    const row = this.db
      .prepare('SELECT * FROM devices WHERE token_hash = ? AND unregistered_at IS NULL')
      .get(hashToken(token)) as DeviceRow | undefined;
    if (!row) return null;
    return {
      source: 'device',
      deviceId: row.device_id,
      userId: row.user_id,
      organizationId: row.organization_id
    };
  }

  listDevicesForUser(userId: string): DeviceRecord[] {
    const rows = this.db.prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as DeviceRow[];
    return rows.map(mapDeviceRow);
  }

  listPushDevicesForOrganization(organizationId: string): DeviceRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM devices WHERE organization_id = ? AND expo_push_token IS NOT NULL AND unregistered_at IS NULL ORDER BY updated_at DESC')
      .all(organizationId) as DeviceRow[];
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
    const device = this.getDeviceForUser(deviceId, userId);
    if (device) this.writeAuditEvent(device.organizationId, userId, 'device.push_token.updated', deviceId, {}, now);
    return device;
  }

  unregisterDevice(deviceId: string, userId: string, now = new Date().toISOString()): DeviceRecord | null {
    this.db.prepare('UPDATE devices SET unregistered_at = ?, expo_push_token = NULL, updated_at = ? WHERE device_id = ? AND user_id = ?').run(now, now, deviceId, userId);
    const device = this.getDeviceForUser(deviceId, userId);
    if (device) this.writeAuditEvent(device.organizationId, userId, 'device.unregistered', deviceId, {}, now);
    return device;
  }

  createEventTicket(input: EventTicketInput, now = new Date().toISOString()): EventTicketRecord {
    const ticket = `evt_${randomToken()}`;
    const ttlSeconds = Math.min(Math.max(input.ttlSeconds ?? 60, 5), 300);
    const expiresAt = new Date(new Date(now).getTime() + ttlSeconds * 1000).toISOString();
    this.db
      .prepare('INSERT INTO event_tickets(ticket_hash, source, organization_id, user_id, agent_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(hashToken(ticket), input.source, input.organizationId, input.userId ?? null, input.agentId ?? null, expiresAt, now);
    return { ticket, expiresAt };
  }

  verifyEventTicket(ticket: string, now = new Date().toISOString()): EventTicketAuth | null {
    if (!ticket.startsWith('evt_')) return null;
    const row = this.db
      .prepare('SELECT * FROM event_tickets WHERE ticket_hash = ? AND expires_at > ?')
      .get(hashToken(ticket), now) as EventTicketRow | undefined;
    if (!row) return null;
    const used = this.db.prepare('UPDATE event_tickets SET last_used_at = ? WHERE ticket_hash = ? AND last_used_at IS NULL').run(now, hashToken(ticket));
    if (used.changes === 0) return null;
    return {
      source: row.source,
      organizationId: row.organization_id,
      userId: row.user_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      expiresAt: row.expires_at
    };
  }

  createApprovalWaiterToken(requestId: string, organizationId: string, agentId: string, requestExpiresAt: string | undefined, now = new Date().toISOString()): ApprovalWaiterTokenRecord {
    const token = `wait_${randomToken()}`;
    const expiresAt = waiterExpiresAt(now, requestExpiresAt);
    this.db
      .prepare('INSERT INTO approval_waiter_tokens(token_hash, request_id, organization_id, agent_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(hashToken(token), requestId, organizationId, agentId, expiresAt, now);
    return { token, expiresAt };
  }

  verifyApprovalWaiterToken(token: string, requestId: string, now = new Date().toISOString()): ApprovalWaiterAuth | null {
    if (!token.startsWith('wait_')) return null;
    const row = this.db
      .prepare('SELECT * FROM approval_waiter_tokens WHERE token_hash = ? AND request_id = ? AND expires_at > ?')
      .get(hashToken(token), requestId, now) as ApprovalWaiterTokenRow | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE approval_waiter_tokens SET last_used_at = ? WHERE token_hash = ?').run(now, hashToken(token));
    return {
      requestId: row.request_id,
      organizationId: row.organization_id,
      agentId: row.agent_id,
      expiresAt: row.expires_at
    };
  }

  recordHeartbeat(userId: string, organizationId: string, now = new Date().toISOString()): AvailabilityRecord {
    this.db
      .prepare(`
        INSERT INTO user_availability(user_id, organization_id, state, last_seen_at, updated_at)
        VALUES (?, ?, COALESCE((SELECT state FROM user_availability WHERE user_id = ? AND organization_id = ?), 'available'), ?, ?)
        ON CONFLICT(user_id, organization_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
      `)
      .run(userId, organizationId, userId, organizationId, now, now);
    return this.getAvailability(userId, organizationId) ?? missingAvailability(userId);
  }

  setAvailability(userId: string, organizationId: string, state: string, now = new Date().toISOString()): AvailabilityRecord {
    this.db
      .prepare(`
        INSERT INTO user_availability(user_id, organization_id, state, last_seen_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, organization_id) DO UPDATE SET state = excluded.state, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
      `)
      .run(userId, organizationId, state, now, now);
    return this.getAvailability(userId, organizationId) ?? missingAvailability(userId);
  }

  getAvailability(userId: string, organizationId: string): AvailabilityRecord | null {
    const row = this.db
      .prepare('SELECT * FROM user_availability WHERE user_id = ? AND organization_id = ?')
      .get(userId, organizationId) as AvailabilityRow | undefined;
    return row ? mapAvailabilityRow(row) : null;
  }

  listAuditEvents(organizationId: string, limit = 100): AuditEventRecord[] {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = this.db
      .prepare('SELECT * FROM audit_events WHERE organization_id = ? ORDER BY created_at DESC, event_id DESC LIMIT ?')
      .all(organizationId, safeLimit) as AuditEventRow[];
    return rows.map(mapAuditEventRow);
  }

  listAuditEventsAfter(organizationId: string, afterEventId = 0, limit = 100): AuditEventRecord[] {
    const safeAfter = Math.max(Math.trunc(afterEventId), 0);
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = this.db
      .prepare('SELECT * FROM audit_events WHERE organization_id = ? AND event_id > ? ORDER BY event_id ASC LIMIT ?')
      .all(organizationId, safeAfter, safeLimit) as AuditEventRow[];
    return rows.map(mapAuditEventRow);
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

function mapOrganizationInviteRow(row: OrganizationInviteRow, teamIds: string[] = []): OrganizationInviteRecord {
  return {
    inviteId: row.invite_id,
    organizationId: row.organization_id,
    label: row.label ?? undefined,
    role: row.role,
    approvalRequired: Boolean(row.approval_required),
    teamIds,
    email: row.email ?? undefined,
    domain: row.domain ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    maxUses: row.max_uses ?? undefined,
    usedCount: row.used_count,
    emailLastStatus: row.email_last_status ?? undefined,
    emailLastSentAt: row.email_last_sent_at ?? undefined,
    emailLastError: row.email_last_error ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    createdAt: row.created_at
  };
}

function mapOrganizationMembershipRequestRow(row: OrganizationMembershipRequestRow): OrganizationMembershipRequestRecord {
  return {
    requestId: row.request_id,
    inviteId: row.invite_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name ?? undefined,
    userId: row.user_id,
    userEmail: row.user_email?.trim() || undefined,
    userName: row.user_name?.trim() || undefined,
    inviteLabel: row.invite_label ?? undefined,
    inviteRevokedAt: row.invite_revoked_at ?? undefined,
    requestedRole: row.requested_role,
    requestedTeamIds: parseJSON<string[]>(row.requested_team_ids_json, []),
    status: row.status,
    acceptedAt: row.accepted_at,
    decidedByUserId: row.decided_by_user_id ?? undefined,
    decidedAt: row.decided_at ?? undefined
  };
}

function mapProjectRow(row: ProjectRow): ProjectRecord {
  return {
    projectId: row.project_id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? undefined
  };
}

function mapTeamRow(row: TeamRow): TeamRecord {
  return {
    teamId: row.team_id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? undefined
  };
}

function mapTeamMembershipRow(row: TeamMembershipRow): TeamMembershipRecord {
  return {
    ...mapTeamRow(row),
    userId: row.user_id,
    role: row.role
  };
}

function mapPolicyRow(row: PolicyRow): PolicyRecord {
  return {
    policyId: row.policy_id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description ?? undefined,
    projectId: row.project_id ?? undefined,
    teamId: row.team_id ?? undefined,
    requiredApprovals: row.required_approvals,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? undefined
  };
}

function mapAgentTokenRow(row: AgentTokenRow): AgentTokenRecord {
  return {
    agentId: row.agent_id,
    name: row.name,
    scopes: parseJSON<string[]>(row.scopes_json, []),
    organizationId: row.organization_id,
    ownerUserId: row.owner_user_id ?? undefined,
    projectId: row.project_id ?? undefined,
    teamId: row.team_id ?? undefined,
    defaultApprovalPolicy: row.default_approval_policy ?? undefined,
    lastRequestAt: row.last_request_at ?? undefined,
    createdAt: row.created_at,
    revokedAt: row.revoked_at ?? undefined
  };
}

function mapAvailabilityRow(row: AvailabilityRow): AvailabilityRecord {
  return {
    userId: row.user_id,
    organizationId: row.organization_id,
    state: row.state,
    lastSeenAt: row.last_seen_at ?? undefined,
    updatedAt: row.updated_at
  };
}

function mapAuditEventRow(row: AuditEventRow): AuditEventRecord {
  return {
    eventId: row.event_id,
    organizationId: row.organization_id,
    userId: row.user_id,
    eventType: row.event_type,
    targetId: row.target_id,
    payload: parseJSON<unknown>(row.payload_json, {}),
    createdAt: row.created_at
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

function mapApprovalRow(row: ApprovalRow, policyProgress?: ApprovalPolicyProgress): ApprovalRequest {
  return ApprovalRequestSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
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
    response: row.response_json ? parseJSON(row.response_json, undefined) : undefined,
    policyProgress
  });
}

function mapApprovalVoteRow(row: ApprovalVoteRow): ApprovalVoteRecord {
  return {
    voteId: row.vote_id,
    requestId: row.request_id,
    policyId: row.policy_id ?? undefined,
    step: row.step,
    approverUserId: row.approver_user_id,
    source: row.source,
    choiceId: row.choice_id,
    message: row.message ?? undefined,
    answers: parseJSON<Record<string, string[]> | undefined>(row.answers_json, undefined),
    createdAt: row.created_at
  };
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

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

function uniqueProjectSlug(db: Database.Database, organizationId: string, input: string): string {
  const base = slugify(input);
  let candidate = base;
  let suffix = 2;
  while (db.prepare('SELECT 1 FROM projects WHERE organization_id = ? AND slug = ?').get(organizationId, candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function uniqueTeamSlug(db: Database.Database, organizationId: string, input: string): string {
  const base = slugify(input);
  let candidate = base;
  let suffix = 2;
  while (db.prepare('SELECT 1 FROM teams WHERE organization_id = ? AND slug = ?').get(organizationId, candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeInviteDomain(value: string | undefined): string | undefined {
  const candidate = value?.trim().toLowerCase().replace(/^@+/, '');
  if (!candidate) return undefined;
  const labels = candidate.split('.');
  const valid =
    candidate.length <= 253 &&
    labels.length >= 2 &&
    labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (!valid) throw httpError(400, 'bad_request', 'Invite domain must be a valid email domain');
  return candidate;
}

function domainFromEmail(email: string | undefined): string | undefined {
  const at = email?.lastIndexOf('@') ?? -1;
  return at > 0 ? email?.slice(at + 1).toLowerCase() : undefined;
}

function ensureColumn(db: Database.Database, table: string, column: string, alterSQL: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!rows.some((row) => row.name === column)) db.exec(alterSQL);
}

function retentionCutoff(now: string, days: number): string {
  if (!Number.isInteger(days) || days < 0) throw new Error('retention days must be a non-negative integer');
  const timestamp = Date.parse(now);
  if (Number.isNaN(timestamp)) throw new Error('retention cleanup requires a valid ISO timestamp');
  return new Date(timestamp - days * 24 * 60 * 60 * 1000).toISOString();
}

function waiterExpiresAt(now: string, requestExpiresAt: string | undefined): string {
  const nowTimestamp = Date.parse(now);
  if (Number.isNaN(nowTimestamp)) throw new Error('waiter token creation requires a valid ISO timestamp');
  if (requestExpiresAt) {
    const requestExpiry = Date.parse(requestExpiresAt);
    if (!Number.isNaN(requestExpiry)) return new Date(requestExpiry + 60 * 60 * 1000).toISOString();
  }
  return new Date(nowTimestamp + 24 * 60 * 60 * 1000).toISOString();
}

function approvalOrganizationRoleCanRespond(role: string): boolean {
  return ['owner', 'admin', 'approver', 'member'].includes(role);
}

function approvalTeamRoleCanRespond(role: string): boolean {
  return ['owner', 'lead', 'member'].includes(role);
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

function missingOrganization(id: string): never {
  throw new Error(`organization ${id} was not created`);
}

function missingProject(id: string): never {
  throw new Error(`project ${id} was not created`);
}

function missingTeam(id: string): never {
  throw new Error(`team ${id} was not created`);
}

function missingPolicy(id: string): never {
  throw new Error(`policy ${id} was not created`);
}

function missingInvite(id: string): never {
  throw new Error(`invite ${id} was not created`);
}

function missingAvailability(userId: string): never {
  throw new Error(`availability for ${userId} was not saved`);
}

interface AvailabilityRow {
  user_id: string;
  organization_id: string;
  state: string;
  last_seen_at: string | null;
  updated_at: string;
}

interface AuditEventRow {
  event_id: number;
  organization_id: string;
  user_id: string;
  event_type: string;
  target_id: string;
  payload_json: string;
  created_at: string;
}

interface ProjectRow {
  project_id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface TeamRow {
  team_id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface TeamMembershipRow extends TeamRow {
  user_id: string;
  role: string;
}

interface PolicyRow {
  policy_id: string;
  organization_id: string;
  name: string;
  description: string | null;
  project_id: string | null;
  team_id: string | null;
  required_approvals: number;
  enabled: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface OrganizationMembershipRow {
  organization_id: string;
  name: string;
  user_id: string;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface OrganizationInviteRow {
  invite_id: string;
  organization_id: string;
  created_by_user_id: string;
  label: string | null;
  role: string;
  approval_required: number;
  token_hash: string;
  email: string | null;
  domain: string | null;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  email_last_status: string | null;
  email_last_sent_at: string | null;
  email_last_error: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface OrganizationInviteLookupRow extends OrganizationInviteRow {
  organization_name: string;
}

interface OrganizationMembershipRequestRow {
  request_id: string;
  invite_id: string;
  organization_id: string;
  organization_name: string | null;
  user_id: string;
  user_email: string | null;
  user_name: string | null;
  invite_label: string | null;
  invite_revoked_at: string | null;
  requested_role: string;
  requested_team_ids_json: string;
  status: string;
  accepted_at: string;
  decided_by_user_id: string | null;
  decided_at: string | null;
}

interface AgentTokenRow {
  agent_id: string;
  organization_id: string;
  owner_user_id: string | null;
  project_id: string | null;
  team_id: string | null;
  default_approval_policy: string | null;
  name: string;
  token_hash: string;
  scopes_json: string;
  last_request_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface PairingCodeRow {
  token_hash: string;
  user_id: string;
  organization_id: string;
  expires_at: string;
  created_at: string;
  used_at: string | null;
}

interface EventTicketRow {
  ticket_hash: string;
  source: string;
  organization_id: string;
  user_id: string | null;
  agent_id: string | null;
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
}

interface ApprovalWaiterTokenRow {
  token_hash: string;
  request_id: string;
  organization_id: string;
  agent_id: string;
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
}

interface DeviceRow {
  device_id: string;
  user_id: string;
  organization_id: string;
  name: string;
  platform: string | null;
  installation_id: string | null;
  expo_push_token: string | null;
  token_hash: string | null;
  created_at: string;
  updated_at: string;
  unregistered_at: string | null;
}

interface ApprovalVoteRow {
  vote_id: string;
  request_id: string;
  policy_id: string | null;
  step: number;
  approver_user_id: string;
  source: string;
  choice_id: string;
  message: string | null;
  answers_json: string | null;
  created_at: string;
  updated_at: string;
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
  status TEXT NOT NULL DEFAULT 'active',
  approved_by_user_id TEXT,
  approved_at TEXT,
  rejected_by_user_id TEXT,
  rejected_at TEXT,
  invite_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS organization_memberships_status_idx ON organization_memberships(organization_id, status);

CREATE TABLE IF NOT EXISTS organization_invites (
  invite_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT,
  role TEXT NOT NULL,
  approval_required INTEGER NOT NULL DEFAULT 1,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT,
  domain TEXT,
  expires_at TEXT,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  email_last_status TEXT,
  email_last_sent_at TEXT,
  email_last_error TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS organization_invites_org_idx ON organization_invites(organization_id, revoked_at, created_at);
CREATE INDEX IF NOT EXISTS organization_invites_token_idx ON organization_invites(token_hash);

CREATE TABLE IF NOT EXISTS organization_invite_teams (
  invite_id TEXT NOT NULL REFERENCES organization_invites(invite_id),
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  PRIMARY KEY (invite_id, team_id)
);

CREATE INDEX IF NOT EXISTS organization_invite_teams_team_idx ON organization_invite_teams(team_id);

CREATE TABLE IF NOT EXISTS organization_invite_acceptances (
  request_id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL REFERENCES organization_invites(invite_id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  requested_role TEXT NOT NULL,
  requested_team_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  decided_by_user_id TEXT,
  decided_at TEXT,
  UNIQUE(invite_id, user_id)
);

CREATE INDEX IF NOT EXISTS organization_invite_acceptances_org_status_idx ON organization_invite_acceptances(organization_id, status, accepted_at);
CREATE INDEX IF NOT EXISTS organization_invite_acceptances_user_idx ON organization_invite_acceptances(user_id);

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE(organization_id, slug)
);

CREATE INDEX IF NOT EXISTS projects_org_idx ON projects(organization_id, archived_at, name);

CREATE TABLE IF NOT EXISTS teams (
  team_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE(organization_id, slug)
);

CREATE INDEX IF NOT EXISTS teams_org_idx ON teams(organization_id, archived_at, name);

CREATE TABLE IF NOT EXISTS team_memberships (
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS team_memberships_user_idx ON team_memberships(organization_id, user_id);

CREATE TABLE IF NOT EXISTS policies (
  policy_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  description TEXT,
  project_id TEXT REFERENCES projects(project_id),
  team_id TEXT REFERENCES teams(team_id),
  required_approvals INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS policies_org_idx ON policies(organization_id, enabled, archived_at, name);

CREATE TABLE IF NOT EXISTS agent_tokens (
  agent_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  owner_user_id TEXT REFERENCES users(id),
  project_id TEXT REFERENCES projects(project_id),
  team_id TEXT REFERENCES teams(team_id),
  default_approval_policy TEXT REFERENCES policies(policy_id),
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

CREATE TABLE IF NOT EXISTS approval_votes (
  vote_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  policy_id TEXT REFERENCES policies(policy_id),
  step INTEGER NOT NULL DEFAULT 1,
  approver_user_id TEXT NOT NULL REFERENCES users(id),
  source TEXT NOT NULL,
  choice_id TEXT NOT NULL,
  message TEXT,
  answers_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(request_id, approver_user_id, step)
);

CREATE INDEX IF NOT EXISTS approval_votes_request_idx ON approval_votes(request_id, step, created_at);

CREATE TABLE IF NOT EXISTS approval_waiter_tokens (
  token_hash TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  agent_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS approval_waiter_tokens_request_idx ON approval_waiter_tokens(request_id, expires_at);
CREATE INDEX IF NOT EXISTS approval_waiter_tokens_expires_idx ON approval_waiter_tokens(expires_at);

CREATE TABLE IF NOT EXISTS event_tickets (
  ticket_hash TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  user_id TEXT,
  agent_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS event_tickets_expires_idx ON event_tickets(expires_at);

CREATE TABLE IF NOT EXISTS user_availability (
  user_id TEXT NOT NULL REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  state TEXT NOT NULL,
  last_seen_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, organization_id)
);

CREATE TABLE IF NOT EXISTS pairing_codes (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS pairing_codes_expires_idx ON pairing_codes(expires_at);

CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  platform TEXT,
  installation_id TEXT,
  expo_push_token TEXT,
  token_hash TEXT UNIQUE,
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
