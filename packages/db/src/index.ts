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
}

export interface OrganizationInviteRecord {
  inviteId: string;
  organizationId: string;
  label: string | undefined;
  role: string;
  email: string | undefined;
  expiresAt: string | undefined;
  maxUses: number | undefined;
  usedCount: number;
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
  email?: string;
  expiresAt?: string;
  maxUses?: number;
  publicURL?: string;
}

export interface InvitePreviewRecord {
  organizationId: string;
  organizationName: string;
  label: string | undefined;
  role: string;
  email: string | undefined;
  expiresAt: string | undefined;
}

export interface AcceptInviteResult {
  status: 'joined' | 'already_member';
  membership: OrganizationMembershipRecord;
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

  listOrganizationsForUser(userId: string): OrganizationMembershipRecord[] {
    const rows = this.db
      .prepare(`
        SELECT o.id AS organization_id, o.name, o.created_at, o.updated_at, m.user_id, m.role
        FROM organization_memberships m
        JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = ?
        ORDER BY o.created_at ASC
      `)
      .all(userId) as OrganizationMembershipRow[];
    return rows.map(mapOrganizationMembershipRow);
  }

  listOrganizationMembers(organizationId: string): OrganizationMembershipRecord[] {
    const rows = this.db
      .prepare(`
        SELECT o.id AS organization_id, o.name, o.created_at, o.updated_at, m.user_id, m.role
        FROM organization_memberships m
        JOIN organizations o ON o.id = m.organization_id
        WHERE m.organization_id = ?
        ORDER BY m.created_at ASC
      `)
      .all(organizationId) as OrganizationMembershipRow[];
    return rows.map(mapOrganizationMembershipRow);
  }

  organizationMembershipForUser(userId: string, organizationId: string): HumanIdentityResult | null {
    const row = this.db
      .prepare('SELECT organization_id, role FROM organization_memberships WHERE user_id = ? AND organization_id = ?')
      .get(userId, organizationId) as { organization_id: string; role: string } | undefined;
    return row ? { userId, organizationId: row.organization_id, role: row.role } : null;
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
      name: cleanName,
      createdAt: now,
      updatedAt: now
    };
  }

  listOrganizationInvites(organizationId: string): OrganizationInviteRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM organization_invites WHERE organization_id = ? ORDER BY created_at DESC')
      .all(organizationId) as OrganizationInviteRow[];
    return rows.map(mapOrganizationInviteRow);
  }

  createOrganizationInvite(input: CreateOrganizationInviteInput, now = new Date().toISOString()): OrganizationInviteRecord {
    const inviteId = newID('inv');
    const token = `invite_${randomToken()}`;
    const role = input.role?.trim() || 'member';
    const maxUses = Math.min(Math.max(Math.trunc(input.maxUses ?? 1), 1), 100);
    this.db
      .prepare('INSERT INTO organization_invites(invite_id, organization_id, created_by_user_id, label, role, token_hash, email, expires_at, max_uses, used_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        inviteId,
        input.organizationId,
        input.userId,
        input.label?.trim() || null,
        role,
        hashToken(token),
        input.email?.trim().toLowerCase() || null,
        input.expiresAt ?? null,
        maxUses,
        0,
        now
      );
    this.writeAuditEvent(input.organizationId, input.userId, 'organization_invite.created', inviteId, { role, email: input.email?.trim().toLowerCase() }, now);
    const invite = this.getOrganizationInvite(inviteId) ?? missingInvite(inviteId);
    return {
      ...invite,
      token,
      ...(input.publicURL ? { url: `${input.publicURL.replace(/\/+$/, '')}/invite/${encodeURIComponent(token)}` } : {})
    };
  }

  getOrganizationInvite(inviteId: string): OrganizationInviteRecord | null {
    const row = this.db.prepare('SELECT * FROM organization_invites WHERE invite_id = ?').get(inviteId) as OrganizationInviteRow | undefined;
    return row ? mapOrganizationInviteRow(row) : null;
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
    return mapOrganizationInviteRow(row);
  }

  previewInvite(token: string, now = new Date().toISOString()): InvitePreviewRecord | null {
    const row = this.findUsableInvite(token, now);
    if (!row) return null;
    return {
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      label: row.label ?? undefined,
      role: row.role,
      email: row.email ?? undefined,
      expiresAt: row.expires_at ?? undefined
    };
  }

  acceptInvite(token: string, userId: string, now = new Date().toISOString()): AcceptInviteResult | null {
    const invite = this.findUsableInvite(token, now);
    if (!invite) return null;
    const user = this.db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined;
    const inviteEmail = invite.email?.trim().toLowerCase();
    if (inviteEmail && user?.email?.trim().toLowerCase() !== inviteEmail) {
      throw httpError(403, 'forbidden', 'This invite is restricted to a different email address');
    }

    const existing = this.organizationMembershipForUser(userId, invite.organization_id);
    if (existing) {
      const membership = this.listOrganizationsForUser(userId).find((entry) => entry.organizationId === invite.organization_id) ?? missingOrganization(invite.organization_id);
      return { status: 'already_member', membership };
    }

    const tx = this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO organization_memberships(organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(invite.organization_id, userId, invite.role, now, now);
      this.db.prepare('UPDATE organization_invites SET used_count = used_count + 1 WHERE invite_id = ?').run(invite.invite_id);
    });
    tx();
    this.writeAuditEvent(invite.organization_id, userId, 'organization_invite.accepted', invite.invite_id, { role: invite.role }, now);
    const membership = this.listOrganizationsForUser(userId).find((entry) => entry.organizationId === invite.organization_id) ?? missingOrganization(invite.organization_id);
    return { status: 'joined', membership };
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
    const row = this.approvalRow(id);
    return row ? mapApprovalRow(row) : null;
  }

  getApprovalRequestForOrganization(id: string, organizationId: string): ApprovalRequest | null {
    const row = this.approvalRow(id, organizationId);
    return row ? mapApprovalRow(row) : null;
  }

  respondToApprovalRequest(id: string, response: RespondApprovalRequest, responderUserId = DEFAULT_USER_ID, now = new Date().toISOString()): ApprovalRequest | null {
    const row = this.approvalRow(id);
    return row ? this.respondToApprovalRow(row, response, responderUserId, now) : null;
  }

  respondToApprovalRequestForOrganization(id: string, organizationId: string, response: RespondApprovalRequest, responderUserId = DEFAULT_USER_ID, now = new Date().toISOString()): ApprovalRequest | null {
    const row = this.approvalRow(id, organizationId);
    return row ? this.respondToApprovalRow(row, response, responderUserId, now) : null;
  }

  abandonApprovalRequest(id: string, actorId: string, now = new Date().toISOString()): ApprovalRequest | null {
    const row = this.approvalRow(id);
    return row ? this.abandonApprovalRow(row, actorId, now) : null;
  }

  abandonApprovalRequestForOrganization(id: string, organizationId: string, actorId: string, now = new Date().toISOString()): ApprovalRequest | null {
    const row = this.approvalRow(id, organizationId);
    return row ? this.abandonApprovalRow(row, actorId, now) : null;
  }

  private approvalRow(id: string, organizationId?: string): ApprovalRow | null {
    const row = organizationId
      ? (this.db.prepare('SELECT * FROM approval_requests WHERE id = ? AND organization_id = ?').get(id, organizationId) as ApprovalRow | undefined)
      : (this.db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id) as ApprovalRow | undefined);
    return row ?? null;
  }

  private respondToApprovalRow(row: ApprovalRow, response: RespondApprovalRequest, responderUserId: string, now: string): ApprovalRequest {
    const parsed = RespondApprovalRequestSchema.parse(response);
    const current = mapApprovalRow(row);
    if (current.status !== 'pending') return current;
    if (parsed.choiceId && !current.choices.some((choice) => choice.id === parsed.choiceId)) {
      throw new Error(`unknown choiceId: ${parsed.choiceId}`);
    }
    this.db
      .prepare('UPDATE approval_requests SET status = ?, response_json = ?, responded_at = ? WHERE id = ? AND organization_id = ? AND status = ?')
      .run('responded', JSON.stringify(parsed), now, row.id, row.organization_id, 'pending');
    this.writeAuditEvent(row.organization_id, responderUserId, 'approval.responded', row.id, parsed, now);
    return this.getApprovalRequestForOrganization(row.id, row.organization_id) ?? missingApproval(row.id);
  }

  private abandonApprovalRow(row: ApprovalRow, actorId: string, now: string): ApprovalRequest {
    const current = mapApprovalRow(row);
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

  createPairingToken(userId: string, organizationId: string, now = new Date().toISOString()): PairingTokenRecord {
    const token = `pair_${randomToken()}`;
    const expiresAt = new Date(new Date(now).getTime() + 10 * 60_000).toISOString();
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
    this.db.prepare('UPDATE event_tickets SET last_used_at = ? WHERE ticket_hash = ?').run(now, hashToken(ticket));
    return {
      source: row.source,
      organizationId: row.organization_id,
      userId: row.user_id ?? undefined,
      agentId: row.agent_id ?? undefined,
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapOrganizationInviteRow(row: OrganizationInviteRow): OrganizationInviteRecord {
  return {
    inviteId: row.invite_id,
    organizationId: row.organization_id,
    label: row.label ?? undefined,
    role: row.role,
    email: row.email ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    maxUses: row.max_uses ?? undefined,
    usedCount: row.used_count,
    revokedAt: row.revoked_at ?? undefined,
    createdAt: row.created_at
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
  created_at: string;
  updated_at: string;
}

interface OrganizationInviteRow {
  invite_id: string;
  organization_id: string;
  created_by_user_id: string;
  label: string | null;
  role: string;
  token_hash: string;
  email: string | null;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  revoked_at: string | null;
  created_at: string;
}

interface OrganizationInviteLookupRow extends OrganizationInviteRow {
  organization_name: string;
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

CREATE TABLE IF NOT EXISTS organization_invites (
  invite_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT,
  role TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT,
  expires_at TEXT,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS organization_invites_org_idx ON organization_invites(organization_id, revoked_at, created_at);
CREATE INDEX IF NOT EXISTS organization_invites_token_idx ON organization_invites(token_hash);

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
