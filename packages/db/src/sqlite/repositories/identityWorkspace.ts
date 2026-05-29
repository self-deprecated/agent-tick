import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  DEFAULT_USER_ID,
  DEFAULT_WORKSPACE_ID,
  type ClerkIdentityProfile,
  type DeleteWorkspaceDataResult,
  type HumanIdentityResult,
  type UpdateWorkspaceEntitlementInput,
  type UserProfileRecord,
  type WorkspaceMemberKind,
  type WorkspaceMemberRecord,
  type WorkspaceRecord,
  type WorkspaceRole,
  type WorkspaceType
} from '../../store/types.js';

export interface SQLiteIdentityWorkspaceRepositoryDeps {
  writeAuditEvent(workspaceId: string, userId: string, eventType: string, targetId: string, payload: unknown, now?: string): void;
  revokeAgentTokensForOwner(userId: string, now?: string): number;
  deleteRoutingRule(routingRuleId: string, workspaceId: string, now?: string): boolean;
}

export class SQLiteIdentityWorkspaceRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly deps: SQLiteIdentityWorkspaceRepositoryDeps
  ) {}

  loginOrCreateClerkIdentity(profile: ClerkIdentityProfile, now = new Date().toISOString()): HumanIdentityResult {
    this.upsertClerkUser(profile, now);
    const userId = this.userIdForClerkSubject(profile.issuer, profile.subject);
    if (!userId) throw new Error('Clerk identity was not stored');
    return this.defaultMembershipForUser(userId);
  }

  upsertClerkUser(profile: ClerkIdentityProfile, now = new Date().toISOString()): string {
    if (!profile.emailVerified) throw new Error('Clerk users must have a verified primary email');
    const email = normalizeEmail(profile.email);
    if (!email) throw new Error('Clerk users must have a verified primary email');
    const existingIdentity = this.db.prepare('SELECT user_id FROM auth_identities WHERE provider = ? AND issuer = ? AND subject = ?').get('clerk', profile.issuer, profile.subject) as { user_id: string } | undefined;
    if (existingIdentity) {
      this.db.prepare('UPDATE users SET email = ?, email_verified = 1, name = ?, sign_in_method = ?, revoked_at = NULL, updated_at = ? WHERE id = ?').run(email, profile.name, profile.authMethod ?? null, now, existingIdentity.user_id);
      this.db.prepare('UPDATE auth_identities SET email = ?, email_verified = 1, name = ?, auth_method = ?, last_seen_at = ?, updated_at = ? WHERE provider = ? AND issuer = ? AND subject = ?').run(email, profile.name, profile.authMethod ?? null, now, now, 'clerk', profile.issuer, profile.subject);
      this.ensurePersonalWorkspaceForUser(existingIdentity.user_id, now);
      return existingIdentity.user_id;
    }

    const collision = this.db.prepare('SELECT id, email_verified FROM users WHERE lower(email) = lower(?) AND email <> ?').get(email, '') as { id: string; email_verified: number | boolean } | undefined;
    if (collision) {
      this.db.prepare('UPDATE users SET email = ?, email_verified = 1, name = ?, sign_in_method = ?, revoked_at = NULL, updated_at = ? WHERE id = ?').run(email, profile.name, profile.authMethod ?? null, now, collision.id);
      this.db.prepare('INSERT INTO auth_identities(provider, issuer, subject, user_id, email, email_verified, name, auth_method, first_seen_at, last_seen_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)').run('clerk', profile.issuer, profile.subject, collision.id, email, profile.name, profile.authMethod ?? null, now, now, now);
      this.ensurePersonalWorkspaceForUser(collision.id, now);
      return collision.id;
    }

    const userId = id('usr');
    this.db.prepare('INSERT INTO users(id, email, email_verified, name, sign_in_method, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?)').run(userId, email, profile.name, profile.authMethod ?? null, now, now);
    this.db.prepare('INSERT INTO auth_identities(provider, issuer, subject, user_id, email, email_verified, name, auth_method, first_seen_at, last_seen_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)').run('clerk', profile.issuer, profile.subject, userId, email, profile.name, profile.authMethod ?? null, now, now, now);
    this.ensurePersonalWorkspaceForUser(userId, now);
    return userId;
  }

  userIdForClerkSubject(issuer: string, subject: string): string | null {
    const row = this.db.prepare('SELECT user_id FROM auth_identities WHERE provider = ? AND issuer = ? AND subject = ?').get('clerk', issuer, subject) as { user_id: string } | undefined;
    return row?.user_id ?? null;
  }

  defaultMembershipForUser(userId: string): HumanIdentityResult {
    const membership = this.db.prepare(`
      SELECT wm.workspace_id, wm.role, wm.member_kind
      FROM workspace_members wm
      JOIN workspaces w ON w.workspace_id = wm.workspace_id
      JOIN users u ON u.id = wm.user_id
      WHERE wm.user_id = ? AND wm.status = 'active' AND w.type = 'personal' AND u.revoked_at IS NULL
      ORDER BY w.created_at ASC
      LIMIT 1
    `).get(userId) as { workspace_id: string; role: string; member_kind: string } | undefined;
    if (!membership) throw new Error('Personal Workspace is missing for user');
    return { userId, workspaceId: membership.workspace_id, workspaceType: 'personal', role: membership.role, memberKind: membership.member_kind as WorkspaceMemberKind };
  }

  userProfile(userId: string): UserProfileRecord | null {
    const row = this.db.prepare('SELECT id, email, name, sign_in_method FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    return row ? mapUserProfile(row) : null;
  }

  listWorkspacesForUser(userId: string): WorkspaceMemberRecord[] {
    return (this.db.prepare(WORKSPACE_MEMBER_SELECT + ` WHERE wm.user_id = ? AND wm.status = 'active' ORDER BY w.type = 'personal' DESC, lower(w.name) ASC`).all(userId) as WorkspaceMemberRow[]).map(mapWorkspaceMember);
  }

  listWorkspaceMembers(workspaceId: string): WorkspaceMemberRecord[] {
    return (this.db.prepare(WORKSPACE_MEMBER_SELECT + ` WHERE wm.workspace_id = ? AND wm.status = 'active' ORDER BY lower(u.email), wm.user_id`).all(workspaceId) as WorkspaceMemberRow[]).map(mapWorkspaceMember);
  }

  workspaceMembershipForUser(userId: string, workspaceId: string): HumanIdentityResult | null {
    const row = this.db.prepare(`
      SELECT wm.workspace_id, wm.user_id, w.type AS workspace_type, wm.role, wm.member_kind
      FROM workspace_members wm
      JOIN workspaces w ON w.workspace_id = wm.workspace_id
      WHERE wm.workspace_id = ? AND wm.user_id = ? AND wm.status = ?
    `).get(workspaceId, userId, 'active') as { workspace_id: string; user_id: string; workspace_type: string; role: string; member_kind: string } | undefined;
    return row ? { userId: row.user_id, workspaceId: row.workspace_id, workspaceType: row.workspace_type as WorkspaceType, role: row.role, memberKind: row.member_kind as WorkspaceMemberKind } : null;
  }

  workspaceMembershipForUserAnyStatus(userId: string, workspaceId: string): WorkspaceMemberRecord | null {
    const row = this.db.prepare(WORKSPACE_MEMBER_SELECT + ` WHERE wm.workspace_id = ? AND wm.user_id = ?`).get(workspaceId, userId) as WorkspaceMemberRow | undefined;
    return row ? mapWorkspaceMember(row) : null;
  }

  createSharedWorkspaceForUser(userId: string, name: string, now = new Date().toISOString(), clerkOrganizationId?: string): WorkspaceMemberRecord {
    this.ensureUserExists(userId, now);
    const workspaceId = id('wsp');
    this.db.prepare('INSERT INTO workspaces(workspace_id, type, name, clerk_organization_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(workspaceId, 'shared', name.trim(), clerkOrganizationId ?? null, now, now);
    this.db.prepare('INSERT INTO workspace_members(workspace_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(workspaceId, userId, 'owner', 'active', now, now);
    this.deps.writeAuditEvent(workspaceId, userId, 'workspace.created', workspaceId, { name: name.trim(), type: 'shared', clerkOrganizationId }, now);
    return this.workspaceMemberOrThrow(userId, workspaceId);
  }

  workspaceByClerkOrganizationId(clerkOrganizationId: string): WorkspaceRecord | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE clerk_organization_id = ?').get(clerkOrganizationId) as WorkspaceRow | undefined;
    return row ? mapWorkspace(row) : null;
  }

  upsertClerkWorkspace(clerkOrganizationId: string, name: string, ownerUserId?: string, now = new Date().toISOString()): WorkspaceRecord {
    const existing = this.workspaceByClerkOrganizationId(clerkOrganizationId);
    if (existing) {
      this.db.prepare('UPDATE workspaces SET name = ?, updated_at = ? WHERE workspace_id = ?').run(name.trim(), now, existing.workspaceId);
      return mapWorkspace(this.workspaceRow(existing.workspaceId)!);
    }
    const workspaceId = id('wsp');
    this.db.prepare('INSERT INTO workspaces(workspace_id, type, name, clerk_organization_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(workspaceId, 'shared', name.trim(), clerkOrganizationId, now, now);
    if (ownerUserId) {
      this.ensureUserExists(ownerUserId, now);
      this.db.prepare('INSERT INTO workspace_members(workspace_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(workspaceId, ownerUserId, 'owner', 'active', now, now);
    }
    this.deps.writeAuditEvent(workspaceId, ownerUserId ?? 'system', 'workspace.clerk_synced', workspaceId, { clerkOrganizationId, name: name.trim() }, now);
    return mapWorkspace(this.workspaceRow(workspaceId)!);
  }

  upsertClerkWorkspaceMember(clerkOrganizationId: string, clerkMembershipId: string | undefined, userId: string, role: WorkspaceRole | string, now = new Date().toISOString()): WorkspaceMemberRecord {
    const workspace = this.workspaceByClerkOrganizationId(clerkOrganizationId);
    if (!workspace) throw new Error('Clerk-backed Shared Workspace not found');
    this.ensureUserExists(userId, now);
    this.db.prepare(`
      INSERT INTO workspace_members(workspace_id, user_id, role, member_kind, status, clerk_membership_id, created_at, updated_at)
      VALUES (?, ?, ?, 'internal', 'active', ?, ?, ?)
      ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role, member_kind = 'internal', status = 'active', clerk_membership_id = excluded.clerk_membership_id, updated_at = excluded.updated_at
    `).run(workspace.workspaceId, userId, role, clerkMembershipId ?? null, now, now);
    return this.workspaceMemberOrThrow(userId, workspace.workspaceId);
  }

  removeClerkWorkspaceMember(clerkOrganizationId: string, userIdOrMembershipId: string, now = new Date().toISOString()): void {
    const workspace = this.workspaceByClerkOrganizationId(clerkOrganizationId);
    if (!workspace) return;
    const row = this.db.prepare('SELECT user_id FROM workspace_members WHERE workspace_id = ? AND (user_id = ? OR clerk_membership_id = ?)').get(workspace.workspaceId, userIdOrMembershipId, userIdOrMembershipId) as { user_id: string } | undefined;
    if (row) this.removeWorkspaceMember(workspace.workspaceId, row.user_id, now);
  }

  revokeUserAccess(userId: string, now = new Date().toISOString()): void {
    this.db.prepare('UPDATE users SET revoked_at = ?, updated_at = ? WHERE id = ?').run(now, now, userId);
    this.db.prepare('UPDATE approval_devices SET unregistered_at = COALESCE(unregistered_at, ?), updated_at = ? WHERE user_id = ?').run(now, now, userId);
    this.deps.revokeAgentTokensForOwner(userId, now);
  }

  updateWorkspace(workspaceId: string, name: string, now = new Date().toISOString()): WorkspaceRecord | null {
    const workspace = this.workspaceRow(workspaceId);
    if (!workspace) return null;
    if (workspace.type === 'personal') throw new Error('Personal Workspace cannot be renamed');
    this.db.prepare('UPDATE workspaces SET name = ?, updated_at = ? WHERE workspace_id = ?').run(name.trim(), now, workspaceId);
    return mapWorkspace(this.workspaceRow(workspaceId)!);
  }

  updateWorkspaceEntitlement(workspaceId: string, input: UpdateWorkspaceEntitlementInput, now = new Date().toISOString()): WorkspaceRecord | null {
    const workspace = this.workspaceRow(workspaceId);
    if (!workspace) return null;
    this.db.prepare('UPDATE workspaces SET responses_entitled_until = ?, updated_at = ? WHERE workspace_id = ?').run(input.responsesEntitledUntil ?? null, now, workspaceId);
    this.deps.writeAuditEvent(workspaceId, 'system', 'workspace.entitlement_updated', workspaceId, { responsesEntitledUntil: input.responsesEntitledUntil ?? null }, now);
    return mapWorkspace(this.workspaceRow(workspaceId)!);
  }

  workspaceResponsesEntitled(workspaceId: string, now = new Date().toISOString()): boolean {
    const workspace = this.workspaceRow(workspaceId);
    if (!workspace || workspace.type !== 'shared' || !workspace.responses_entitled_until) return false;
    return new Date(workspace.responses_entitled_until).getTime() > new Date(now).getTime();
  }

  addWorkspaceMemberByEmail(workspaceId: string, emailInput: string, role: WorkspaceRole | string = 'member', now = new Date().toISOString(), memberKind: WorkspaceMemberKind = 'internal'): WorkspaceMemberRecord {
    const workspace = this.workspaceRow(workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    if (workspace.type === 'personal') throw new Error('Personal Workspace cannot add members');
    assertValidWorkspaceMemberKind(role, memberKind);
    const email = normalizeEmail(emailInput);
    if (!email) throw new Error('A member email is required');
    let user = this.db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email) as UserRow | undefined;
    if (!user) {
      const userId = id('usr');
      this.db.prepare('INSERT INTO users(id, email, email_verified, name, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)').run(userId, email, email.split('@')[0] || email, now, now);
      this.ensurePersonalWorkspaceForUser(userId, now);
      user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
    }
    this.db.prepare(`
      INSERT INTO workspace_members(workspace_id, user_id, role, member_kind, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role, member_kind = excluded.member_kind, status = 'active', updated_at = excluded.updated_at
    `).run(workspaceId, user.id, role, memberKind, now, now);
    this.deps.writeAuditEvent(workspaceId, user.id, 'workspace_member.added', user.id, { role, memberKind, email }, now);
    return this.workspaceMemberOrThrow(user.id, workspaceId);
  }

  removeWorkspaceMember(workspaceId: string, userId: string, now = new Date().toISOString()): void {
    this.db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').run(workspaceId, userId);
    this.db.prepare('UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE workspace_id = ? AND bound_recipient_user_id = ?').run(now, workspaceId, userId);
    this.db.prepare('DELETE FROM routing_rule_recipients WHERE user_id = ? AND routing_rule_id IN (SELECT routing_rule_id FROM routing_rules WHERE workspace_id = ?)').run(userId, workspaceId);
    const emptyRules = this.db.prepare(`
      SELECT rr.routing_rule_id FROM routing_rules rr
      LEFT JOIN routing_rule_recipients rrr ON rrr.routing_rule_id = rr.routing_rule_id
      WHERE rr.workspace_id = ?
      GROUP BY rr.routing_rule_id
      HAVING COUNT(rrr.user_id) = 0
    `).all(workspaceId) as { routing_rule_id: string }[];
    for (const rule of emptyRules) this.deps.deleteRoutingRule(rule.routing_rule_id, workspaceId, now);
    this.deps.writeAuditEvent(workspaceId, userId, 'workspace_member.removed', userId, {}, now);
  }

  workspaceSeatUsage(workspaceId: string): { activeMembers: number; pendingMembers: number } {
    const activeMembers = (this.db.prepare(`SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = ? AND status = 'active'`).get(workspaceId) as CountRow).count;
    return { activeMembers, pendingMembers: 0 };
  }

  deleteWorkspaceData(workspaceId: string, now = new Date().toISOString()): DeleteWorkspaceDataResult {
    const workspace = this.workspaceRow(workspaceId);
    if (!workspace || workspace.type === 'personal') return { workspaceId, agentTokensRevoked: 0, devicesUnregistered: 0, deleted: false };
    const agentTokensRevoked = this.db.prepare('UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE workspace_id = ?').run(now, workspaceId).changes;
    this.db.prepare('DELETE FROM workspaces WHERE workspace_id = ?').run(workspaceId);
    return { workspaceId, agentTokensRevoked, devicesUnregistered: 0, deleted: true };
  }

  ensureUserExists(userId: string, now: string): void {
    this.db.prepare(`INSERT OR IGNORE INTO users(id, email, email_verified, name, created_at, updated_at) VALUES (?, '', 0, ?, ?, ?)`).run(userId, userId, now, now);
    this.ensurePersonalWorkspaceForUser(userId, now);
  }

  ensurePersonalWorkspaceForUser(userId: string, now: string): void {
    const existing = this.db.prepare(`
      SELECT w.workspace_id FROM workspaces w
      JOIN workspace_members wm ON wm.workspace_id = w.workspace_id
      WHERE w.type = 'personal' AND wm.user_id = ?
      LIMIT 1
    `).get(userId) as { workspace_id: string } | undefined;
    if (existing) return;
    const workspaceId = userId === DEFAULT_USER_ID ? DEFAULT_WORKSPACE_ID : id('wsp');
    this.db.prepare(`INSERT OR IGNORE INTO workspaces(workspace_id, type, name, created_at, updated_at) VALUES (?, 'personal', 'Personal', ?, ?)`).run(workspaceId, now, now);
    this.db.prepare(`INSERT OR IGNORE INTO workspace_members(workspace_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, 'owner', 'active', ?, ?)`).run(workspaceId, userId, now, now);
    this.ensurePersonalEntitlementRow(userId, now);
  }

  workspaceMemberOrThrow(userId: string, workspaceId: string): WorkspaceMemberRecord {
    const row = this.workspaceMembershipForUserAnyStatus(userId, workspaceId);
    if (!row) throw new Error('Workspace Member not found');
    return row;
  }

  workspaceRow(workspaceId: string): WorkspaceRow | undefined {
    return this.db.prepare('SELECT * FROM workspaces WHERE workspace_id = ?').get(workspaceId) as WorkspaceRow | undefined;
  }

  private ensurePersonalEntitlementRow(userId: string, now: string): void {
    this.db.prepare(`INSERT OR IGNORE INTO personal_entitlements(user_id, trial_started_at, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(userId, now, now, now);
  }
}

interface CountRow { count: number }
interface UserRow { id: string; email: string | null; email_verified: number; name: string | null; sign_in_method: string | null }
interface WorkspaceRow { workspace_id: string; type: string; name: string; clerk_organization_id: string | null; responses_entitled_until: string | null; created_at: string; updated_at: string }
interface WorkspaceMemberRow extends WorkspaceRow { user_id: string; role: string; status: string; member_kind: string; email: string | null; display_name: string | null; clerk_membership_id: string | null }

const WORKSPACE_MEMBER_SELECT = `
  SELECT w.workspace_id, w.type, w.name, w.clerk_organization_id, w.created_at, w.updated_at,
         wm.user_id, wm.role, wm.status, wm.member_kind, wm.clerk_membership_id,
         u.email, u.name AS display_name
  FROM workspace_members wm
  JOIN workspaces w ON w.workspace_id = wm.workspace_id
  JOIN users u ON u.id = wm.user_id
`;

function mapUserProfile(row: UserRow): UserProfileRecord {
  return {
    userId: row.id,
    ...(row.email ? { email: row.email } : {}),
    ...(row.name ? { name: row.name } : {}),
    ...(row.sign_in_method ? { signInMethod: row.sign_in_method } : {})
  };
}

function mapWorkspace(row: WorkspaceRow): WorkspaceRecord {
  return {
    workspaceId: row.workspace_id,
    type: row.type as WorkspaceType,
    name: row.name,
    ...(row.clerk_organization_id ? { clerkOrganizationId: row.clerk_organization_id } : {}),
    ...(row.responses_entitled_until ? { responsesEntitledUntil: row.responses_entitled_until } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapWorkspaceMember(row: WorkspaceMemberRow): WorkspaceMemberRecord {
  return {
    ...mapWorkspace(row),
    userId: row.user_id,
    role: row.role,
    status: row.status,
    memberKind: row.member_kind as WorkspaceMemberKind,
    ...(row.email ? { email: row.email } : {}),
    ...(row.display_name ? { displayName: row.display_name } : {}),
    ...(row.clerk_membership_id ? { clerkMembershipId: row.clerk_membership_id } : {})
  };
}

function assertValidWorkspaceMemberKind(role: WorkspaceRole | string, memberKind: WorkspaceMemberKind): void {
  if (memberKind === 'external_approver' && role !== 'member') throw new Error('External approvers must use the member role');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;
}
