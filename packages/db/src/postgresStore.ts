import crypto from 'node:crypto';
import {
  CreateAgentTokenSchema,
  CreateAudienceChannelSchema,
  CreateExternalApproverInviteSchema,
  CreateExternalApproverSchema,
  CreateRequestSchema,
  CreateRoutingRuleSchema,
  CreateStatusUpdateSchema,
  RequestRecordSchema,
  RespondRequestSchema,
  RoutingRuleRecordSchema,
  semanticStatusUpdateState,
  statusUpdateStateBehavior,
  type CreateRoutingRule,
  type UpdateRoutingRule,
  type WorkspaceMemberKind,
  type WorkspaceRole,
  type WorkspaceType
} from '@self-deprecated/agent-tick-shared';
import { PostgresStoreConnection, type PostgresStoreOptions } from './postgres.js';
import {
  DEFAULT_REQUEST_WAITER_LEASE_MS,
  DEFAULT_USER_ID,
  DEFAULT_WORKSPACE_ID,
  type AgentCredential,
  type ActivityItem,
  type AgentTokenAuth,
  type AgentTokenRecord,
  type AuditEventRecord,
  type AudienceChannelRecord,
  type AudienceSubscriptionRecord,
  type Choice,
  type ClerkIdentityProfile,
  type CreateAgentTokenInput,
  type CreateExternalApproverInviteInput,
  type CreateRequestInput,
  type CreateStatusUpdateInput,
  type DeviceCredential,
  type DeviceRecord,
  type DeviceRegistrationInput,
  type DeviceTokenAuth,
  type EventTicketAuth,
  type EventTicketInput,
  type EventTicketRecord,
  type ExternalApproverInviteCredential,
  type ExternalApproverInviteRecord,
  type ExternalApproverRecord,
  type ExternalApproverStatus,
  type AvailabilityRecord,
  type BillingIdentityConflictRecord,
  type BillingProductRecord,
  type BillingPurchaseAttemptRecord,
  type BillingReceiptOwnerRecord,
  type BillingTransactionRecord,
  type ClaimBillingReceiptOwnerInput,
  type ClaimBillingReceiptOwnerResult,
  type CleanupExpiredSecretsResult,
  type CleanupRetentionResult,
  type CreateBillingPurchaseAttemptInput,
  type DeleteWorkspaceDataResult,
  type HumanIdentityResult,
  type MobileDiagnosticInput,
  type MobileDiagnosticRecord,
  type PairingTokenRecord,
  type PersonalEntitlementRecord,
  type RequestAgentWaiterSummary,
  type RequestRecipient,
  type RetentionPolicy,
  type RequestRecord,
  type RequestWaiterAuth,
  type RequestWaiterRecord,
  type RequestWaiterTokenRecord,
  type RespondRequest,
  type ResponseRecord,
  type RoutingRuleRecord,
  type StatusUpdateRecord,
  type TransferAccountBoundBillingPurchasesInput,
  type TransferAccountBoundBillingPurchasesResult,
  type UpdateAgentToken,
  type UpdatePersonalEntitlementInput,
  type UpdateWorkspaceEntitlementInput,
  type UpsertBillingIdentityConflictInput,
  type UpsertBillingProductInput,
  type UpsertBillingTransactionInput,
  type UpsertBillingTransactionResult,
  type UserProfileRecord,
  type WorkspaceMemberRecord,
  type WorkspaceRecord
} from './store/types.js';

/**
 * PostgreSQL store implementation slice for identity, Workspaces, Routing
 * Rules, External Approvers, and Audience Channels.
 */
export class PostgresAgentTickStore extends PostgresStoreConnection {
  private get db() {
    return this.pool;
  }

  static open(options: PostgresStoreOptions): PostgresAgentTickStore {
    return new PostgresAgentTickStore(options);
  }

  async ensureSingleTenantDefaults(now = new Date().toISOString()): Promise<void> {
    await this.db.query(`INSERT INTO users(id, email, email_verified, name, created_at, updated_at) VALUES ($1, '', false, 'Local user', $2, $3) ON CONFLICT (id) DO NOTHING`, [DEFAULT_USER_ID, now, now]);
    await this.db.query(`INSERT INTO workspaces(workspace_id, type, name, created_at, updated_at) VALUES ($1, 'personal', 'Personal', $2, $3) ON CONFLICT (workspace_id) DO NOTHING`, [DEFAULT_WORKSPACE_ID, now, now]);
    await this.db.query(`INSERT INTO workspace_members(workspace_id, user_id, role, status, created_at, updated_at) VALUES ($1, $2, 'owner', 'active', $3, $4) ON CONFLICT (workspace_id, user_id) DO NOTHING`, [DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID, now, now]);
    await this.ensurePersonalEntitlementRow(DEFAULT_USER_ID, now);
  }

  async loginOrCreateClerkIdentity(profile: ClerkIdentityProfile, now = new Date().toISOString()): Promise<HumanIdentityResult> {
    await this.upsertClerkUser(profile, now);
    const userId = await this.userIdForClerkSubject(profile.issuer, profile.subject);
    if (!userId) throw new Error('Clerk identity was not stored');
    return this.defaultMembershipForUser(userId);
  }

  async upsertClerkUser(profile: ClerkIdentityProfile, now = new Date().toISOString()): Promise<string> {
    if (!profile.emailVerified) throw new Error('Clerk users must have a verified primary email');
    const email = normalizeEmail(profile.email);
    if (!email) throw new Error('Clerk users must have a verified primary email');
    return this.transaction(async () => {
      await this.db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`clerk:${profile.issuer}:${profile.subject}:${email}`]);
      const existingIdentity = await this.one<{ user_id: string }>('SELECT user_id FROM auth_identities WHERE provider = $1 AND issuer = $2 AND subject = $3', ['clerk', profile.issuer, profile.subject]);
      if (existingIdentity) {
        await this.db.query('UPDATE users SET email = $1, email_verified = true, name = $2, sign_in_method = $3, revoked_at = NULL, updated_at = $4 WHERE id = $5', [email, profile.name, profile.authMethod ?? null, now, existingIdentity.user_id]);
        await this.db.query('UPDATE auth_identities SET email = $1, email_verified = true, name = $2, auth_method = $3, last_seen_at = $4, updated_at = $5 WHERE provider = $6 AND issuer = $7 AND subject = $8', [email, profile.name, profile.authMethod ?? null, now, now, 'clerk', profile.issuer, profile.subject]);
        await this.ensurePersonalWorkspaceForUser(existingIdentity.user_id, now);
        return existingIdentity.user_id;
      }

      const collision = await this.one<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1) AND email <> $2', [email, '']);
      if (collision) {
        await this.db.query('UPDATE users SET email = $1, email_verified = true, name = $2, sign_in_method = $3, revoked_at = NULL, updated_at = $4 WHERE id = $5', [email, profile.name, profile.authMethod ?? null, now, collision.id]);
        const identity = await this.one<{ user_id: string }>(`
          INSERT INTO auth_identities(provider, issuer, subject, user_id, email, email_verified, name, auth_method, first_seen_at, last_seen_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10)
          ON CONFLICT(provider, issuer, subject) DO UPDATE SET email = excluded.email, email_verified = excluded.email_verified, name = excluded.name, auth_method = excluded.auth_method, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
          RETURNING user_id
        `, ['clerk', profile.issuer, profile.subject, collision.id, email, profile.name, profile.authMethod ?? null, now, now, now]);
        const linkedUserId = identity?.user_id ?? collision.id;
        await this.ensurePersonalWorkspaceForUser(linkedUserId, now);
        return linkedUserId;
      }

      const userId = id('usr');
      await this.db.query('INSERT INTO users(id, email, email_verified, name, sign_in_method, created_at, updated_at) VALUES ($1,$2,true,$3,$4,$5,$6)', [userId, email, profile.name, profile.authMethod ?? null, now, now]);
      const identity = await this.one<{ user_id: string }>(`
        INSERT INTO auth_identities(provider, issuer, subject, user_id, email, email_verified, name, auth_method, first_seen_at, last_seen_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10)
        ON CONFLICT(provider, issuer, subject) DO UPDATE SET email = excluded.email, email_verified = excluded.email_verified, name = excluded.name, auth_method = excluded.auth_method, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
        RETURNING user_id
      `, ['clerk', profile.issuer, profile.subject, userId, email, profile.name, profile.authMethod ?? null, now, now, now]);
      const linkedUserId = identity?.user_id ?? userId;
      await this.db.query('UPDATE users SET email = $1, email_verified = true, name = $2, sign_in_method = $3, revoked_at = NULL, updated_at = $4 WHERE id = $5', [email, profile.name, profile.authMethod ?? null, now, linkedUserId]);
      await this.ensurePersonalWorkspaceForUser(linkedUserId, now);
      return linkedUserId;
    });
  }

  async userIdForClerkSubject(issuer: string, subject: string): Promise<string | null> {
    return (await this.one<{ user_id: string }>('SELECT user_id FROM auth_identities WHERE provider = $1 AND issuer = $2 AND subject = $3', ['clerk', issuer, subject]))?.user_id ?? null;
  }

  async defaultMembershipForUser(userId: string): Promise<HumanIdentityResult> {
    const row = await this.one<{ workspace_id: string; role: string; member_kind: string }>(`
      SELECT wm.workspace_id, wm.role, wm.member_kind
      FROM workspace_members wm
      JOIN workspaces w ON w.workspace_id = wm.workspace_id
      JOIN users u ON u.id = wm.user_id
      WHERE wm.user_id = $1 AND wm.status = 'active' AND w.type = 'personal' AND u.revoked_at IS NULL
      ORDER BY w.created_at ASC LIMIT 1`, [userId]);
    if (!row) throw new Error('Personal Workspace is missing for user');
    return { userId, workspaceId: row.workspace_id, workspaceType: 'personal', role: row.role, memberKind: row.member_kind as WorkspaceMemberKind };
  }

  async userProfile(userId: string): Promise<UserProfileRecord | null> {
    const row = await this.one<UserRow>('SELECT id, email, name, sign_in_method FROM users WHERE id = $1', [userId]);
    return row ? mapUserProfile(row) : null;
  }

  async listWorkspacesForUser(userId: string): Promise<WorkspaceMemberRecord[]> {
    return (await this.all<WorkspaceMemberRow>(WORKSPACE_MEMBER_SELECT + ` WHERE wm.user_id = $1 AND wm.status = 'active' ORDER BY w.type = 'personal' DESC, lower(w.name) ASC`, [userId])).map(mapWorkspaceMember);
  }

  async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberRecord[]> {
    return (await this.all<WorkspaceMemberRow>(WORKSPACE_MEMBER_SELECT + ` WHERE wm.workspace_id = $1 AND wm.status = 'active' ORDER BY lower(u.email), wm.user_id`, [workspaceId])).map(mapWorkspaceMember);
  }

  async workspaceMembershipForUser(userId: string, workspaceId: string): Promise<HumanIdentityResult | null> {
    const row = await this.one<{ workspace_id: string; user_id: string; workspace_type: string; role: string; member_kind: string }>(`
      SELECT wm.workspace_id, wm.user_id, w.type AS workspace_type, wm.role, wm.member_kind
      FROM workspace_members wm JOIN workspaces w ON w.workspace_id = wm.workspace_id
      WHERE wm.workspace_id = $1 AND wm.user_id = $2 AND wm.status = 'active'`, [workspaceId, userId]);
    return row ? { userId: row.user_id, workspaceId: row.workspace_id, workspaceType: row.workspace_type as WorkspaceType, role: row.role, memberKind: row.member_kind as WorkspaceMemberKind } : null;
  }

  async workspaceMembershipForUserAnyStatus(userId: string, workspaceId: string): Promise<WorkspaceMemberRecord | null> {
    const row = await this.one<WorkspaceMemberRow>(WORKSPACE_MEMBER_SELECT + ` WHERE wm.workspace_id = $1 AND wm.user_id = $2`, [workspaceId, userId]);
    return row ? mapWorkspaceMember(row) : null;
  }

  async createSharedWorkspaceForUser(userId: string, name: string, now = new Date().toISOString(), clerkOrganizationId?: string): Promise<WorkspaceMemberRecord> {
    await this.ensureUserExists(userId, now);
    const workspaceId = id('wsp');
    await this.db.query('INSERT INTO workspaces(workspace_id, type, name, clerk_organization_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, 'shared', name.trim(), clerkOrganizationId ?? null, now, now]);
    await this.db.query('INSERT INTO workspace_members(workspace_id, user_id, role, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, userId, 'owner', 'active', now, now]);
    await this.writeAuditEvent(workspaceId, userId, 'workspace.created', workspaceId, { name: name.trim(), type: 'shared', clerkOrganizationId }, now);
    return this.workspaceMemberOrThrow(userId, workspaceId);
  }

  async workspaceByClerkOrganizationId(clerkOrganizationId: string): Promise<WorkspaceRecord | null> {
    const row = await this.one<WorkspaceRow>('SELECT * FROM workspaces WHERE clerk_organization_id = $1', [clerkOrganizationId]);
    return row ? mapWorkspace(row) : null;
  }

  async upsertClerkWorkspace(clerkOrganizationId: string, name: string, ownerUserId?: string, now = new Date().toISOString()): Promise<WorkspaceRecord> {
    return this.transaction(async () => {
      const existing = await this.workspaceByClerkOrganizationId(clerkOrganizationId);
      if (existing) {
        await this.db.query('UPDATE workspaces SET name = $1, updated_at = $2 WHERE workspace_id = $3', [name.trim(), now, existing.workspaceId]);
        return mapWorkspace((await this.workspaceRow(existing.workspaceId))!);
      }
      const workspaceId = id('wsp');
      await this.db.query('INSERT INTO workspaces(workspace_id, type, name, clerk_organization_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, 'shared', name.trim(), clerkOrganizationId, now, now]);
      if (ownerUserId) {
        await this.ensureUserExists(ownerUserId, now);
        await this.db.query('INSERT INTO workspace_members(workspace_id, user_id, role, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id, user_id) DO NOTHING', [workspaceId, ownerUserId, 'owner', 'active', now, now]);
      }
      await this.writeAuditEvent(workspaceId, ownerUserId ?? 'system', 'workspace.clerk_synced', workspaceId, { clerkOrganizationId, name: name.trim() }, now);
      return mapWorkspace((await this.workspaceRow(workspaceId))!);
    });
  }

  async upsertClerkWorkspaceMember(clerkOrganizationId: string, clerkMembershipId: string | undefined, userId: string, role: WorkspaceRole | string, now = new Date().toISOString()): Promise<WorkspaceMemberRecord> {
    const workspace = await this.workspaceByClerkOrganizationId(clerkOrganizationId);
    if (!workspace) throw new Error('Clerk-backed Shared Workspace not found');
    await this.ensureUserExists(userId, now);
    await this.db.query(`INSERT INTO workspace_members(workspace_id, user_id, role, member_kind, status, clerk_membership_id, created_at, updated_at)
      VALUES ($1,$2,$3,'internal','active',$4,$5,$6)
      ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role, member_kind = 'internal', status = 'active', clerk_membership_id = excluded.clerk_membership_id, updated_at = excluded.updated_at`, [workspace.workspaceId, userId, role, clerkMembershipId ?? null, now, now]);
    return this.workspaceMemberOrThrow(userId, workspace.workspaceId);
  }

  async removeClerkWorkspaceMember(clerkOrganizationId: string, userIdOrMembershipId: string, now = new Date().toISOString()): Promise<void> {
    const workspace = await this.workspaceByClerkOrganizationId(clerkOrganizationId);
    if (!workspace) return;
    const row = await this.one<{ user_id: string }>('SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND (user_id = $2 OR clerk_membership_id = $3)', [workspace.workspaceId, userIdOrMembershipId, userIdOrMembershipId]);
    if (row) await this.removeWorkspaceMember(workspace.workspaceId, row.user_id, now);
  }

  async revokeUserAccess(userId: string, now = new Date().toISOString()): Promise<void> {
    await this.db.query('UPDATE users SET revoked_at = $1, updated_at = $2 WHERE id = $3', [now, now, userId]);
    await this.db.query('UPDATE approval_devices SET unregistered_at = COALESCE(unregistered_at, $1), updated_at = $2 WHERE user_id = $3', [now, now, userId]);
  }

  async updateWorkspace(workspaceId: string, name: string, now = new Date().toISOString()): Promise<WorkspaceRecord | null> {
    const workspace = await this.workspaceRow(workspaceId);
    if (!workspace) return null;
    if (workspace.type === 'personal') throw new Error('Personal Workspace cannot be renamed');
    await this.db.query('UPDATE workspaces SET name = $1, updated_at = $2 WHERE workspace_id = $3', [name.trim(), now, workspaceId]);
    return mapWorkspace((await this.workspaceRow(workspaceId))!);
  }

  async updateWorkspaceEntitlement(workspaceId: string, input: UpdateWorkspaceEntitlementInput, now = new Date().toISOString()): Promise<WorkspaceRecord | null> {
    const workspace = await this.workspaceRow(workspaceId);
    if (!workspace) return null;
    await this.db.query('UPDATE workspaces SET responses_entitled_until = $1, updated_at = $2 WHERE workspace_id = $3', [input.responsesEntitledUntil ?? null, now, workspaceId]);
    await this.writeAuditEvent(workspaceId, 'system', 'workspace.entitlement_updated', workspaceId, { responsesEntitledUntil: input.responsesEntitledUntil ?? null }, now);
    return mapWorkspace((await this.workspaceRow(workspaceId))!);
  }

  async workspaceResponsesEntitled(workspaceId: string, now = new Date().toISOString()): Promise<boolean> {
    const workspace = await this.workspaceRow(workspaceId);
    if (!workspace || workspace.type !== 'shared' || !workspace.responses_entitled_until) return false;
    return Date.parse(workspace.responses_entitled_until) > Date.parse(now);
  }

  async addWorkspaceMemberByEmail(workspaceId: string, emailInput: string, role: WorkspaceRole | string = 'member', now = new Date().toISOString(), memberKind: WorkspaceMemberKind = 'internal'): Promise<WorkspaceMemberRecord> {
    const workspace = await this.workspaceRow(workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    if (workspace.type === 'personal') throw new Error('Personal Workspace cannot add members');
    assertValidWorkspaceMemberKind(role, memberKind);
    const email = normalizeEmail(emailInput);
    if (!email) throw new Error('A member email is required');
    let user = await this.one<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
    if (!user) {
      const userId = id('usr');
      await this.db.query('INSERT INTO users(id, email, email_verified, name, created_at, updated_at) VALUES ($1,$2,false,$3,$4,$5)', [userId, email, email.split('@')[0] || email, now, now]);
      await this.ensurePersonalWorkspaceForUser(userId, now);
      user = (await this.one<UserRow>('SELECT * FROM users WHERE id = $1', [userId]))!;
    }
    await this.db.query(`INSERT INTO workspace_members(workspace_id, user_id, role, member_kind, status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,'active',$5,$6)
      ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role, member_kind = excluded.member_kind, status = 'active', updated_at = excluded.updated_at`, [workspaceId, user.id, role, memberKind, now, now]);
    await this.writeAuditEvent(workspaceId, user.id, 'workspace_member.added', user.id, { role, memberKind, email }, now);
    return this.workspaceMemberOrThrow(user.id, workspaceId);
  }

  async removeWorkspaceMember(workspaceId: string, userId: string, now = new Date().toISOString()): Promise<void> {
    await this.transaction(async () => {
      await this.db.query('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
      await this.db.query('UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, $1) WHERE workspace_id = $2 AND bound_recipient_user_id = $3', [now, workspaceId, userId]);
      await this.db.query('DELETE FROM routing_rule_recipients WHERE user_id = $1 AND routing_rule_id IN (SELECT routing_rule_id FROM routing_rules WHERE workspace_id = $2)', [userId, workspaceId]);
      const emptyRules = await this.all<{ routing_rule_id: string }>(`
        SELECT rr.routing_rule_id FROM routing_rules rr
        LEFT JOIN routing_rule_recipients rrr ON rrr.routing_rule_id = rr.routing_rule_id
        WHERE rr.workspace_id = $1
        GROUP BY rr.routing_rule_id
        HAVING COUNT(rrr.user_id) = 0
      `, [workspaceId]);
      for (const rule of emptyRules) await this.deleteRoutingRule(rule.routing_rule_id, workspaceId, now);
      await this.writeAuditEvent(workspaceId, userId, 'workspace_member.removed', userId, {}, now);
    });
  }

  async workspaceSeatUsage(workspaceId: string): Promise<{ activeMembers: number; pendingMembers: number }> {
    const row = await this.one<{ count: string }>(`SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = $1 AND status = 'active'`, [workspaceId]);
    return { activeMembers: Number(row?.count ?? 0), pendingMembers: 0 };
  }

  async createRoutingRule(input: CreateRoutingRule, now = new Date().toISOString()): Promise<RoutingRuleRecord> {
    const parsed = CreateRoutingRuleSchema.parse(input);
    const workspace = await this.workspaceRow(parsed.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    if (workspace.type === 'personal') throw new Error('Personal Workspace advanced routing is reserved for later');
    const recipients = unique(parsed.recipientUserIds);
    const memberships = [] as HumanIdentityResult[];
    for (const userId of recipients) {
      const membership = await this.workspaceMembershipForUser(userId, parsed.workspaceId);
      if (!membership) throw new Error(`Routing Rule recipient is not an active Workspace Member: ${userId}`);
      memberships.push(membership);
    }
    assertValidRoutingRuleRecipients(memberships, parsed.requiredResponseMode, parsed.requiredResponseCount);
    const routingRuleId = id('rul');
    await this.db.query('INSERT INTO routing_rules(routing_rule_id, workspace_id, name, required_response_mode, required_response_count, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [routingRuleId, parsed.workspaceId, parsed.name.trim(), parsed.requiredResponseMode, parsed.requiredResponseCount, now, now]);
    await this.insertRoutingRuleRecipients(routingRuleId, recipients, now);
    await this.writeAuditEvent(parsed.workspaceId, DEFAULT_USER_ID, 'routing_rule.created', routingRuleId, { name: parsed.name.trim() }, now);
    return (await this.getRoutingRule(routingRuleId))!;
  }

  async listRoutingRules(workspaceId: string): Promise<RoutingRuleRecord[]> {
    return Promise.all((await this.all<RoutingRuleRow>('SELECT * FROM routing_rules WHERE workspace_id = $1 ORDER BY lower(name)', [workspaceId])).map((row) => this.mapRoutingRule(row)));
  }

  async getRoutingRule(routingRuleId: string): Promise<RoutingRuleRecord | null> {
    const row = await this.one<RoutingRuleRow>('SELECT * FROM routing_rules WHERE routing_rule_id = $1', [routingRuleId]);
    return row ? this.mapRoutingRule(row) : null;
  }

  async updateRoutingRule(routingRuleId: string, input: UpdateRoutingRule, now = new Date().toISOString()): Promise<RoutingRuleRecord | null> {
    const existing = await this.getRoutingRule(routingRuleId);
    if (!existing) return null;
    const name = input.name?.trim() ?? existing.name;
    const mode = input.requiredResponseMode ?? existing.requiredResponseMode;
    const count = input.requiredResponseCount ?? existing.requiredResponseCount;
    const recipients = input.recipientUserIds ? unique(input.recipientUserIds) : existing.recipientUserIds;
    if (!recipients.length) throw new Error('Routing Rules must have at least one recipient');
    const memberships = [] as HumanIdentityResult[];
    for (const userId of recipients) {
      const membership = await this.workspaceMembershipForUser(userId, existing.workspaceId);
      if (!membership) throw new Error(`Routing Rule recipient is not an active Workspace Member: ${userId}`);
      memberships.push(membership);
    }
    assertValidRoutingRuleRecipients(memberships, mode, count);
    await this.db.query('UPDATE routing_rules SET name = $1, required_response_mode = $2, required_response_count = $3, updated_at = $4 WHERE routing_rule_id = $5', [name, mode, count, now, routingRuleId]);
    if (input.recipientUserIds) {
      await this.db.query('DELETE FROM routing_rule_recipients WHERE routing_rule_id = $1', [routingRuleId]);
      await this.insertRoutingRuleRecipients(routingRuleId, recipients, now);
    }
    return this.getRoutingRule(routingRuleId);
  }

  async deleteRoutingRule(routingRuleId: string, workspaceId: string, now = new Date().toISOString()): Promise<boolean> {
    const existing = await this.getRoutingRule(routingRuleId);
    if (!existing || existing.workspaceId !== workspaceId) return false;
    await this.db.query('UPDATE agent_tokens SET routing_rule_id = NULL WHERE workspace_id = $1 AND routing_rule_id = $2', [workspaceId, routingRuleId]);
    await this.db.query('DELETE FROM routing_rules WHERE routing_rule_id = $1', [routingRuleId]);
    await this.writeAuditEvent(workspaceId, DEFAULT_USER_ID, 'routing_rule.deleted', routingRuleId, {}, now);
    return true;
  }

  async createAudienceChannel(input: unknown, createdByUserId: string, now = new Date().toISOString()): Promise<AudienceChannelRecord> {
    const parsed = CreateAudienceChannelSchema.parse(input);
    const workspace = await this.workspaceRow(parsed.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    if (workspace.type !== 'shared') throw new Error('Audience Channels require a Shared Workspace');
    const creator = await this.workspaceMembershipForUser(createdByUserId, parsed.workspaceId);
    if (!creator || creator.memberKind === 'external_approver') throw new Error('Internal Workspace member required');
    const channelId = id('aud');
    await this.db.query(`INSERT INTO audience_channels(channel_id, workspace_id, name, slug, visibility, status, created_by_user_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8)`, [channelId, parsed.workspaceId, parsed.name.trim(), parsed.slug ?? null, parsed.visibility, createdByUserId, now, now]);
    await this.writeAuditEvent(parsed.workspaceId, createdByUserId, 'audience_channel.created', channelId, { name: parsed.name.trim(), visibility: parsed.visibility }, now);
    return (await this.getAudienceChannel(channelId))!;
  }

  async listAudienceChannels(workspaceId: string): Promise<AudienceChannelRecord[]> {
    return (await this.all<AudienceChannelRow>('SELECT * FROM audience_channels WHERE workspace_id = $1 ORDER BY lower(name)', [workspaceId])).map(mapAudienceChannel);
  }

  async getAudienceChannel(channelId: string): Promise<AudienceChannelRecord | null> {
    const row = await this.one<AudienceChannelRow>('SELECT * FROM audience_channels WHERE channel_id = $1', [channelId]);
    return row ? mapAudienceChannel(row) : null;
  }

  async setAudienceSubscription(channelId: string, userId: string, status = 'active', now = new Date().toISOString()): Promise<AudienceSubscriptionRecord> {
    const channel = await this.getAudienceChannel(channelId);
    if (!channel || channel.status !== 'active') throw new Error('Audience Channel not found');
    await this.ensureUserExists(userId, now);
    await this.db.query(`INSERT INTO audience_subscriptions(channel_id, user_id, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(channel_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`, [channelId, userId, status, now, now]);
    return (await this.getAudienceSubscription(channelId, userId))!;
  }

  async getAudienceSubscription(channelId: string, userId: string): Promise<AudienceSubscriptionRecord | null> {
    const row = await this.one<AudienceSubscriptionRow>('SELECT * FROM audience_subscriptions WHERE channel_id = $1 AND user_id = $2', [channelId, userId]);
    return row ? mapAudienceSubscription(row) : null;
  }

  async createExternalApprover(workspaceId: string, input: unknown, createdByUserId: string, now = new Date().toISOString()): Promise<ExternalApproverRecord> {
    const parsed = CreateExternalApproverSchema.parse(input);
    const workspace = await this.workspaceRow(workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    if (workspace.type !== 'shared') throw new Error('External Approvers require a Shared Workspace');
    if (!(await this.workspaceMembershipForUser(createdByUserId, workspaceId))) throw new Error('External Approver creator must be a Workspace Member');
    const externalApproverId = id('xapp');
    await this.db.query('INSERT INTO external_approvers(external_approver_id, workspace_id, external_subject, display_name, created_by_user_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [externalApproverId, workspaceId, parsed.externalSubject ?? null, parsed.displayName ?? null, createdByUserId, now, now]);
    await this.writeAuditEvent(workspaceId, createdByUserId, 'external_approver.created', externalApproverId, { externalSubject: parsed.externalSubject, displayName: parsed.displayName }, now);
    return this.externalApproverOrThrow(externalApproverId);
  }

  async getExternalApprover(externalApproverId: string, workspaceId: string): Promise<ExternalApproverRecord | null> {
    const row = await this.one<ExternalApproverRow>('SELECT * FROM external_approvers WHERE external_approver_id = $1 AND workspace_id = $2', [externalApproverId, workspaceId]);
    return row ? mapExternalApprover(row) : null;
  }

  async getExternalApproverStatus(externalApproverId: string, workspaceId: string): Promise<ExternalApproverStatus | null> {
    const approver = await this.getExternalApprover(externalApproverId, workspaceId);
    if (!approver) return null;
    const invitePending = Number((await this.one<{ count: string }>(`SELECT COUNT(*) AS count FROM external_approver_invites WHERE external_approver_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > $2`, [externalApproverId, new Date().toISOString()]))?.count ?? 0) > 0;
    return { ...approver, invitePending, connected: Boolean(approver.userId), routeReady: Boolean(approver.routingRuleId && approver.agentTokenId) };
  }

  async createExternalApproverInvite(input: CreateExternalApproverInviteInput, now = new Date().toISOString()): Promise<ExternalApproverInviteCredential> {
    const parsed = CreateExternalApproverInviteSchema.parse(input);
    const workspace = await this.workspaceRow(input.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    if (workspace.type !== 'shared') throw new Error('External Approver invites require a Shared Workspace');
    const externalApprover = parsed.externalApproverId ? await this.getExternalApprover(parsed.externalApproverId, input.workspaceId) : null;
    if (parsed.externalApproverId && !externalApprover) throw new Error('External Approver not found in Workspace');
    const token = `xinv_${crypto.randomBytes(24).toString('base64url')}`;
    const inviteId = id('xinv');
    const expiresAt = addMs(now, parsed.expiresInMinutes * 60_000);
    await this.db.query(`INSERT INTO external_approver_invites(invite_id, workspace_id, external_approver_id, external_subject, display_name, token_hash, created_by_user_id, expires_at, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [inviteId, input.workspaceId, parsed.externalApproverId ?? null, parsed.externalSubject ?? externalApprover?.externalSubject ?? null, parsed.displayName ?? externalApprover?.displayName ?? null, hashSecret(token), input.createdByUserId, expiresAt, now, now]);
    await this.writeAuditEvent(input.workspaceId, input.createdByUserId, 'external_approver_invite.created', inviteId, { externalSubject: parsed.externalSubject, displayName: parsed.displayName }, now);
    const record = await this.externalApproverInviteOrThrow(inviteId);
    const deepLink = externalApproverInviteDeepLink(token, input.publicURL);
    return { ...record, token, deepLink, qrPayload: deepLink };
  }

  async getExternalApproverInviteByToken(token: string, now = new Date().toISOString()): Promise<ExternalApproverInviteRecord | null> {
    const row = await this.one<ExternalApproverInviteRow>(EXTERNAL_APPROVER_INVITE_SELECT + ` WHERE eai.token_hash = $1 AND eai.expires_at > $2 AND eai.revoked_at IS NULL`, [hashSecret(token), now]);
    return row ? mapExternalApproverInvite(row) : null;
  }

  async acceptExternalApproverInvite(token: string, userId: string, now = new Date().toISOString()): Promise<WorkspaceMemberRecord | null> {
    const row = await this.one<ExternalApproverInviteRow>(EXTERNAL_APPROVER_INVITE_SELECT + ` WHERE eai.token_hash = $1 AND eai.expires_at > $2 AND eai.revoked_at IS NULL AND eai.accepted_at IS NULL`, [hashSecret(token), now]);
    if (!row) return null;
    await this.ensureUserExists(userId, now);
    await this.db.query(`INSERT INTO workspace_members(workspace_id, user_id, role, member_kind, status, created_at, updated_at) VALUES ($1,$2,'member','external_approver','active',$3,$4) ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = 'member', member_kind = 'external_approver', status = 'active', updated_at = excluded.updated_at`, [row.workspace_id, userId, now, now]);
    await this.db.query('UPDATE external_approver_invites SET accepted_by_user_id = $1, accepted_at = $2, updated_at = $3 WHERE invite_id = $4', [userId, now, now, row.invite_id]);
    if (row.external_approver_id) await this.db.query('UPDATE external_approvers SET user_id = $1, display_name = COALESCE(display_name, $2), external_subject = COALESCE(external_subject, $3), updated_at = $4 WHERE external_approver_id = $5 AND workspace_id = $6', [userId, row.display_name, row.external_subject, now, row.external_approver_id, row.workspace_id]);
    await this.writeAuditEvent(row.workspace_id, userId, 'external_approver_invite.accepted', row.invite_id, { externalSubject: row.external_subject, externalApproverId: row.external_approver_id }, now);
    return this.workspaceMemberOrThrow(userId, row.workspace_id);
  }

  async revokeExternalApproverInvite(inviteId: string, workspaceId: string, now = new Date().toISOString()): Promise<ExternalApproverInviteRecord | null> {
    const existing = await this.one<ExternalApproverInviteRow>(EXTERNAL_APPROVER_INVITE_SELECT + ` WHERE eai.invite_id = $1 AND eai.workspace_id = $2`, [inviteId, workspaceId]);
    if (!existing) return null;
    await this.db.query('UPDATE external_approver_invites SET revoked_at = COALESCE(revoked_at, $1), updated_at = $2 WHERE invite_id = $3', [now, now, inviteId]);
    return this.externalApproverInviteOrThrow(inviteId);
  }

  async createExternalApproverAgentToken(externalApproverId: string, workspaceId: string, createdByUserId: string, now = new Date().toISOString()): Promise<AgentCredential | null> {
    const approver = await this.getExternalApprover(externalApproverId, workspaceId);
    if (!approver || !approver.userId) return null;
    const routingRuleId = approver.routingRuleId ?? (await this.createRoutingRule({ workspaceId, name: `${approver.displayName ?? approver.externalSubject ?? approver.userId} approvals`, recipientUserIds: [approver.userId], requiredResponseMode: 'any_one', requiredResponseCount: 1 }, now)).routingRuleId;
    const credential = await this.createAgentToken({ workspaceId, creatorUserId: createdByUserId, label: `${approver.displayName ?? approver.externalSubject ?? 'External Approver'} agent`, routingRuleId, boundRecipientUserId: approver.userId }, now);
    await this.db.query('UPDATE external_approvers SET routing_rule_id = $1, agent_token_id = $2, updated_at = $3 WHERE external_approver_id = $4 AND workspace_id = $5', [routingRuleId, credential.agentTokenId, now, externalApproverId, workspaceId]);
    await this.writeAuditEvent(workspaceId, createdByUserId, 'external_approver.agent_token_created', externalApproverId, { agentTokenId: credential.agentTokenId, routingRuleId }, now);
    return credential;
  }

  async createAgentToken(input: CreateAgentTokenInput, now = new Date().toISOString()): Promise<AgentCredential> {
    const parsed = CreateAgentTokenSchema.parse(input);
    const workspaceId = parsed.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const workspace = await this.workspaceRow(workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    const boundRecipientUserId = parsed.boundRecipientUserId ?? null;
    if (boundRecipientUserId) await this.assertActiveWorkspaceMember(boundRecipientUserId, workspaceId);
    if (parsed.routingRuleId) {
      await this.assertRuleInWorkspace(parsed.routingRuleId, workspaceId);
      if (boundRecipientUserId) await this.assertRoutingRuleTargetsBoundRecipient(parsed.routingRuleId, boundRecipientUserId);
    }
    const token = `agent_${crypto.randomBytes(24).toString('base64url')}`;
    const agentTokenId = id('agt');
    const scopes = parsed.scopes?.length ? parsed.scopes : ['activity:create'];
    await this.db.query(`INSERT INTO agent_tokens(agent_token_id, workspace_id, creator_user_id, routing_rule_id, bound_recipient_user_id, label, token_hash, scopes_json, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [agentTokenId, workspaceId, input.creatorUserId ?? null, parsed.routingRuleId ?? null, boundRecipientUserId, parsed.label.trim(), hashSecret(token), JSON.stringify(scopes), now]);
    await this.writeAuditEvent(workspaceId, input.creatorUserId ?? DEFAULT_USER_ID, 'agent_token.created', agentTokenId, { label: parsed.label.trim() }, now);
    return { ...(await this.agentTokenOrThrow(agentTokenId)), token };
  }

  async listAgentTokens(workspaceId?: string): Promise<AgentTokenRecord[]> {
    const rows = workspaceId
      ? await this.all<AgentTokenRow>(AGENT_TOKEN_SELECT + ' WHERE at.workspace_id = $1 ORDER BY at.created_at DESC', [workspaceId])
      : await this.all<AgentTokenRow>(AGENT_TOKEN_SELECT + ' ORDER BY at.created_at DESC');
    return rows.map(mapAgentToken);
  }


  async updateAgentToken(agentTokenId: string, workspaceId: string, input: UpdateAgentToken, now = new Date().toISOString()): Promise<AgentTokenRecord | null> {
    const existing = await this.agentTokenRow(agentTokenId, workspaceId);
    if (!existing) return null;
    const label = input.label?.trim() ?? existing.label;
    const routingRuleId = Object.prototype.hasOwnProperty.call(input, 'routingRuleId') ? input.routingRuleId ?? null : existing.routing_rule_id;
    const boundRecipientUserId = Object.prototype.hasOwnProperty.call(input, 'boundRecipientUserId') ? input.boundRecipientUserId ?? null : existing.bound_recipient_user_id;
    if (boundRecipientUserId) await this.assertActiveWorkspaceMember(boundRecipientUserId, workspaceId);
    if (routingRuleId) {
      await this.assertRuleInWorkspace(routingRuleId, workspaceId);
      if (boundRecipientUserId) await this.assertRoutingRuleTargetsBoundRecipient(routingRuleId, boundRecipientUserId);
    }
    await this.db.query('UPDATE agent_tokens SET label = $1, routing_rule_id = $2, bound_recipient_user_id = $3 WHERE agent_token_id = $4 AND workspace_id = $5', [label, routingRuleId, boundRecipientUserId, agentTokenId, workspaceId]);
    const updated = await this.agentTokenRow(agentTokenId, workspaceId);
    return updated ? mapAgentToken(updated) : null;
  }

  async revokeAgentToken(agentTokenId: string, workspaceId?: string, now = new Date().toISOString()): Promise<AgentTokenRecord | null> {
    const row = workspaceId ? await this.agentTokenRow(agentTokenId, workspaceId) : await this.agentTokenRowById(agentTokenId);
    if (!row) return null;
    await this.db.query('UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, $1) WHERE agent_token_id = $2', [now, agentTokenId]);
    const updated = (await this.agentTokenRowById(agentTokenId))!;
    await this.writeAuditEvent(updated.workspace_id, DEFAULT_USER_ID, 'agent_token.revoked', agentTokenId, {}, now);
    return mapAgentToken(updated);
  }

  async revokeAgentTokensForOwner(userId: string, now = new Date().toISOString()): Promise<number> {
    return (await this.db.query('UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, $1) WHERE creator_user_id = $2', [now, userId])).rowCount ?? 0;
  }

  async verifyAgentToken(token: string, now = new Date().toISOString()): Promise<AgentTokenAuth | null> {
    const row = await this.one<AgentTokenRow>(AGENT_TOKEN_SELECT + ' WHERE at.token_hash = $1 AND at.revoked_at IS NULL', [hashSecret(token)]);
    if (!row) return null;
    await this.db.query('UPDATE agent_tokens SET last_check_in_at = $1 WHERE agent_token_id = $2', [now, row.agent_token_id]);
    return { source: 'agent', agentTokenId: row.agent_token_id, label: row.label, scopes: JSON.parse(row.scopes_json) as string[], workspaceId: row.workspace_id, workspaceType: row.workspace_type as WorkspaceType, routingRuleId: row.routing_rule_id ?? undefined, boundRecipientUserId: row.bound_recipient_user_id ?? undefined, creatorUserId: row.creator_user_id ?? undefined };
  }

  async createRequest(input: CreateRequestInput, now = new Date().toISOString()): Promise<RequestRecord> {
    const parsed = CreateRequestSchema.parse(input);
    const workspaceId = input.workspaceId ?? (await this.agentTokenRowById(input.agentTokenId ?? ''))?.workspace_id ?? DEFAULT_WORKSPACE_ID;
    const route = parsed.deliveryKind === 'audience_channel'
      ? await this.routeForAudienceRequest(workspaceId, parsed.audienceChannelId)
      : await this.routeForActivity(workspaceId, input.agentTokenId, input.routingRuleId);
    const requestId = id('req');
    const choices = defaultChoices(parsed.requestType, parsed.choices);
    const requester = { ...parsed.requester, ...(input.agentTokenId ? { agentTokenId: input.agentTokenId } : {}) };
    await this.db.query(`INSERT INTO requests(id, workspace_id, agent_token_id, routing_rule_id, session_id, session_metadata_json, requester_json, request_type, delivery_kind, response_policy, audience_channel_id, closes_at, tie_policy, title, body, command, choices_json, questions_json, default_choice, allow_freeform_reply, deadline, risk, metadata_json, status, required_response_count, aggregate_result_json, created_at, is_test, test_label)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,'pending',$24,$25,$26,$27,$28)`, [
      requestId, workspaceId, input.agentTokenId ?? null, route.routingRuleId ?? null, parsed.sessionId ?? null, JSON.stringify(parsed.session ?? {}), JSON.stringify(requester), parsed.requestType, parsed.deliveryKind, parsed.responsePolicy, parsed.audienceChannelId ?? null, parsed.closesAt ?? null, parsed.tiePolicy ?? null, parsed.title, parsed.body ?? null, parsed.command ?? null, JSON.stringify(choices), JSON.stringify(parsed.questions ?? []), parsed.defaultChoice ?? null, parsed.allowFreeformReply ?? false, parsed.deadline ?? null, parsed.risk ?? null, JSON.stringify(parsed.metadata ?? {}), route.requiredResponseCount, null, now, input.isTest ?? false, input.testLabel ?? null
    ]);
    await this.insertRequestRecipients(requestId, route.recipientUserIds, now);
    if (input.agentTokenId) await this.db.query('UPDATE agent_tokens SET last_activity_at = $1 WHERE agent_token_id = $2', [now, input.agentTokenId]);
    await this.writeAuditEvent(workspaceId, input.userId ?? input.agentTokenId ?? DEFAULT_USER_ID, input.isTest ? 'request.test_created' : 'request.created', requestId, { title: parsed.title }, now);
    return this.requestOrThrow(requestId, input.userId, now);
  }

  async listRequestsForUser(userId: string, workspaceId?: string, now = new Date().toISOString(), limit?: number): Promise<RequestRecord[]> {
    await this.expirePendingRequests(now);
    const boundedLimit = limit === undefined ? undefined : clampLimit(limit, 1000);
    const limitClause = boundedLimit === undefined ? '' : workspaceId ? ' LIMIT $3' : ' LIMIT $2';
    const rows = workspaceId
      ? await this.all<RequestRow>(REQUEST_SELECT + ` JOIN request_recipients rr ON rr.request_id = r.id WHERE rr.user_id = $1 AND r.workspace_id = $2 ORDER BY r.created_at DESC${limitClause}`, boundedLimit === undefined ? [userId, workspaceId] : [userId, workspaceId, boundedLimit])
      : await this.all<RequestRow>(REQUEST_SELECT + ` JOIN request_recipients rr ON rr.request_id = r.id WHERE rr.user_id = $1 ORDER BY r.created_at DESC${limitClause}`, boundedLimit === undefined ? [userId] : [userId, boundedLimit]);
    return this.mapRequests(rows, userId, now);
  }

  async listAudienceRequestsForUser(userId: string, now = new Date().toISOString(), limit?: number): Promise<RequestRecord[]> {
    await this.expirePendingRequests(now);
    const boundedLimit = limit === undefined ? undefined : clampLimit(limit, 1000);
    const rows = await this.all<RequestRow>(REQUEST_SELECT + ` JOIN audience_subscriptions aus ON aus.channel_id = r.audience_channel_id WHERE aus.user_id = $1 AND aus.status = 'active' AND r.delivery_kind = 'audience_channel' ORDER BY r.created_at DESC${boundedLimit === undefined ? '' : ' LIMIT $2'}`, boundedLimit === undefined ? [userId] : [userId, boundedLimit]);
    return this.mapRequests(rows, userId, now);
  }

  async getRequestForUser(idValue: string, userId: string, now = new Date().toISOString()): Promise<RequestRecord | null> {
    await this.expirePendingRequests(now);
    const row = await this.one<RequestRow>(REQUEST_SELECT + ` JOIN request_recipients rr ON rr.request_id = r.id WHERE r.id = $1 AND rr.user_id = $2`, [idValue, userId]);
    return row ? this.mapRequest(row, userId, now) : null;
  }

  async getRequestForWorkspace(idValue: string, workspaceId: string, currentUserId?: string, now = new Date().toISOString()): Promise<RequestRecord | null> {
    await this.expirePendingRequests(now);
    const row = await this.one<RequestRow>(REQUEST_SELECT + ' WHERE r.id = $1 AND r.workspace_id = $2', [idValue, workspaceId]);
    return row ? this.mapRequest(row, currentUserId, now) : null;
  }

  async respondToRequestForWorkspace(idValue: string, workspaceId: string, response: RespondRequest, responderUserId: string, now = new Date().toISOString()): Promise<RequestRecord | null> {
    return this.transaction(async () => {
      const parsed = RespondRequestSchema.parse(response);
      const existing = await this.getRequestForWorkspace(idValue, workspaceId, responderUserId, now);
      if (!existing) return null;
      if (existing.status !== 'pending') return existing;
      const recipient = await this.one<RequestRecipientRow>('SELECT * FROM request_recipients WHERE request_id = $1 AND user_id = $2', [idValue, responderUserId]);
      if (!recipient) {
        const error = new Error('User is not a routed recipient for this Request') as Error & { code?: string; statusCode?: number };
        error.code = 'not_routed_recipient'; error.statusCode = 403; throw error;
      }
      if (await this.one<ResponseRow>('SELECT * FROM responses WHERE request_id = $1 AND user_id = $2', [idValue, responderUserId])) return this.mapRequest((await this.requestRow(idValue))!, responderUserId, now);
      const responseId = id('rsp');
      await this.db.query(`INSERT INTO responses(response_id, request_id, user_id, source, choice_id, message, answers_json, final, created_at, updated_at) VALUES ($1,$2,$3,'remote',$4,$5,$6,false,$7,$8)`, [responseId, idValue, responderUserId, parsed.choiceId ?? null, parsed.message ?? null, parsed.answers ? JSON.stringify(parsed.answers) : null, now, now]);
      await this.db.query('UPDATE request_recipients SET responded_at = $1, updated_at = $2 WHERE request_id = $3 AND user_id = $4', [now, now, idValue, responderUserId]);
      const key = parsed.choiceId ?? parsed.message ?? JSON.stringify(parsed.answers ?? {});
      const received = Number((await this.one<{ count: string }>('SELECT COUNT(*) AS count FROM responses WHERE request_id = $1 AND COALESCE(choice_id, message, answers_json, $2) = $3', [idValue, key, key]))?.count ?? 0);
      if (received >= existing.quorum!.requiredResponseCount) {
        const finalPayload = { ...(parsed.choiceId ? { choiceId: parsed.choiceId } : {}), ...(parsed.message ? { message: parsed.message } : {}), ...(parsed.answers ? { answers: parsed.answers } : {}) };
        await this.db.query('UPDATE responses SET final = true WHERE response_id = $1', [responseId]);
        await this.db.query('UPDATE requests SET status = $1, responded_at = $2, response_json = $3, final_choice_id = $4 WHERE id = $5', ['responded', now, JSON.stringify(finalPayload), parsed.choiceId ?? null, idValue]);
        await this.writeAuditEvent(workspaceId, responderUserId, 'request.responded', idValue, { choiceId: parsed.choiceId }, now);
      }
      return this.mapRequest((await this.requestRow(idValue))!, responderUserId, now);
    });
  }

  async respondToAudienceRequest(idValue: string, response: RespondRequest, responderUserId: string, now = new Date().toISOString()): Promise<RequestRecord | null> {
    const parsed = RespondRequestSchema.parse(response);
    if (!parsed.choiceId) throw new Error('Audience Responses must include a choiceId');
    await this.finalizeDueAudienceRequests(now);
    const requestRow = await this.requestRow(idValue);
    const existing = await this.getRequestForWorkspace(idValue, requestRow?.workspace_id ?? '', responderUserId, now);
    if (!existing || existing.deliveryKind !== 'audience_channel' || !existing.audienceChannelId) return null;
    if (existing.status !== 'pending') return existing;
    if (existing.closesAt && Date.parse(existing.closesAt) <= Date.parse(now)) { await this.finalizeDueAudienceRequests(now); return this.getRequestForWorkspace(idValue, existing.workspaceId, responderUserId, now); }
    const subscription = await this.getAudienceSubscription(existing.audienceChannelId, responderUserId);
    if (!subscription || subscription.status !== 'active') { const error = new Error('User is not subscribed to this Audience Channel') as Error & { code?: string; statusCode?: number }; error.code = 'not_audience_subscriber'; error.statusCode = 403; throw error; }
    if (!existing.choices.some((choice) => choice.id === parsed.choiceId)) throw new Error('Audience Response choice is not valid for this Request');
    if (await this.one<ResponseRow>('SELECT * FROM responses WHERE request_id = $1 AND user_id = $2', [idValue, responderUserId])) return this.mapRequest((await this.requestRow(idValue))!, responderUserId, now);
    await this.db.query(`INSERT INTO responses(response_id, request_id, user_id, source, choice_id, message, answers_json, final, created_at, updated_at) VALUES ($1,$2,$3,'audience',$4,NULL,NULL,false,$5,$6)`, [id('rsp'), idValue, responderUserId, parsed.choiceId, now, now]);
    return this.mapRequest((await this.requestRow(idValue))!, responderUserId, now);
  }

  async abandonRequestForWorkspace(idValue: string, workspaceId: string, actorId: string, now = new Date().toISOString()): Promise<RequestRecord | null> {
    const existing = await this.getRequestForWorkspace(idValue, workspaceId, undefined, now);
    if (!existing) return null;
    if (existing.status === 'pending') {
      await this.db.query('UPDATE requests SET status = $1, responded_at = $2, response_json = $3 WHERE id = $4 AND workspace_id = $5', ['resolved', now, JSON.stringify({ message: 'resolved' }), idValue, workspaceId]);
      await this.writeAuditEvent(workspaceId, actorId, 'request.resolved', idValue, {}, now);
    }
    return this.getRequestForWorkspace(idValue, workspaceId, undefined, now);
  }

  async createRequestWaiterToken(requestId: string, workspaceId: string, agentTokenId: string, requestDeadline?: string, now = new Date().toISOString()): Promise<RequestWaiterTokenRecord> {
    const token = `wait_${crypto.randomBytes(24).toString('base64url')}`;
    const waiterId = id('waiter');
    const expiresAt = addMs(requestDeadline && Date.parse(requestDeadline) > Date.parse(now) ? requestDeadline : now, 65 * 60_000);
    const leaseExpiresAt = addMs(now, DEFAULT_REQUEST_WAITER_LEASE_MS);
    await this.db.query(`INSERT INTO request_waiters(waiter_id, request_id, workspace_id, agent_token_id, transport, state, last_seen_at, lease_expires_at, credential_expires_at, created_at, updated_at) VALUES ($1,$2,$3,$4,'long_poll','waiting',$5,$6,$7,$8,$9)`, [waiterId, requestId, workspaceId, agentTokenId, now, leaseExpiresAt, expiresAt, now, now]);
    await this.db.query('INSERT INTO request_waiter_tokens(token_hash, waiter_id, request_id, workspace_id, agent_token_id, expires_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [hashSecret(token), waiterId, requestId, workspaceId, agentTokenId, expiresAt, now]);
    return { token, waiterId, expiresAt, leaseExpiresAt };
  }

  async verifyRequestWaiterToken(token: string, requestId: string, now = new Date().toISOString()): Promise<RequestWaiterAuth | null> {
    const row = await this.one<WaiterTokenRow>('SELECT * FROM request_waiter_tokens WHERE token_hash = $1 AND request_id = $2 AND expires_at > $3', [hashSecret(token), requestId, now]);
    if (!row || !(await this.requestWaiterById(row.waiter_id))) return null;
    await this.db.query('UPDATE request_waiter_tokens SET last_used_at = $1 WHERE token_hash = $2', [now, hashSecret(token)]);
    return { requestId: row.request_id, workspaceId: row.workspace_id, agentTokenId: row.agent_token_id, waiterId: row.waiter_id };
  }

  async renewRequestWaiter(waiterId: string, leaseExpiresAt: string, now = new Date().toISOString()): Promise<RequestWaiterRecord | null> {
    await this.db.query(`UPDATE request_waiters SET state = CASE WHEN state IN ('stopped', 'errored') THEN state ELSE 'waiting' END, last_seen_at = CASE WHEN state IN ('stopped', 'errored') THEN last_seen_at ELSE $1 END, lease_expires_at = CASE WHEN state IN ('stopped', 'errored') THEN lease_expires_at ELSE $2 END, updated_at = $3 WHERE waiter_id = $4`, [now, leaseExpiresAt, now, waiterId]);
    return this.requestWaiterById(waiterId);
  }

  async stopRequestWaiter(waiterId: string, reason: string, now = new Date().toISOString()): Promise<RequestWaiterRecord | null> {
    await this.db.query(`UPDATE request_waiters SET state = CASE WHEN state = 'errored' THEN state ELSE 'stopped' END, stopped_at = COALESCE(stopped_at, $1), stop_reason = COALESCE(stop_reason, $2), updated_at = $3 WHERE waiter_id = $4`, [now, reason, now, waiterId]);
    return this.requestWaiterById(waiterId);
  }

  async markRequestWaiterError(waiterId: string, errorCode: string, errorMessage?: string, now = new Date().toISOString()): Promise<RequestWaiterRecord | null> {
    await this.db.query(`UPDATE request_waiters SET state = CASE WHEN state = 'stopped' THEN state ELSE 'errored' END, error_code = COALESCE(error_code, $1), error_message = COALESCE(error_message, $2), updated_at = $3 WHERE waiter_id = $4`, [errorCode, errorMessage ?? null, now, waiterId]);
    return this.requestWaiterById(waiterId);
  }


  async createStatusUpdate(input: CreateStatusUpdateInput, now = new Date().toISOString()): Promise<StatusUpdateRecord> {
    const parsed = CreateStatusUpdateSchema.parse(input);
    const route = await this.routeForActivity(input.workspaceId, input.agentTokenId, input.routingRuleId);
    const statusId = id('stat');
    const sessionId = parsed.sessionId ?? parsed.threadId;
    await this.db.query(`INSERT INTO status_updates(status_id, workspace_id, agent_token_id, routing_rule_id, thread_id, session_id, session_metadata_json, message, state, next_step, host, working_directory, client_name, metadata_json, created_at, is_test, test_label)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [statusId, input.workspaceId, input.agentTokenId ?? null, route.routingRuleId ?? null, parsed.threadId ?? null, sessionId ?? null, JSON.stringify(parsed.session ?? {}), parsed.message, parsed.state, parsed.nextStep ?? null, parsed.host ?? null, parsed.workingDirectory ?? null, parsed.clientName ?? null, JSON.stringify(parsed.metadata ?? {}), now, input.isTest ?? false, input.testLabel ?? null]);
    await this.insertStatusUpdateRecipients(statusId, route.recipientUserIds, now);
    if (input.agentTokenId) await this.db.query('UPDATE agent_tokens SET last_activity_at = $1 WHERE agent_token_id = $2', [now, input.agentTokenId]);
    await this.writeAuditEvent(input.workspaceId, input.userId ?? input.agentTokenId ?? DEFAULT_USER_ID, input.isTest ? 'status_update.test_created' : 'status_update.created', statusId, { state: parsed.state }, now);
    return this.statusUpdateOrThrow(statusId);
  }

  async getStatusUpdate(statusId: string, workspaceId: string): Promise<StatusUpdateRecord | null> {
    const row = await this.one<StatusUpdateRow>(STATUS_UPDATE_SELECT + ' WHERE su.status_id = $1 AND su.workspace_id = $2', [statusId, workspaceId]);
    return row ? this.mapStatusUpdate(row) : null;
  }

  async listLatestStatusUpdates(workspaceId: string, limit = 20): Promise<StatusUpdateRecord[]> {
    return Promise.all((await this.all<StatusUpdateRow>(STATUS_UPDATE_SELECT + ' WHERE su.workspace_id = $1 ORDER BY su.created_at DESC LIMIT $2', [workspaceId, clampLimit(limit)])).map((row) => this.mapStatusUpdate(row)));
  }

  async listActivityForUser(userId: string, workspaceId?: string, limit = 50, now = new Date().toISOString()): Promise<ActivityItem[]> {
    await this.expirePendingRequests(now);
    const boundedLimit = clampLimit(limit, 1000);
    const requestRows = workspaceId ? await this.all<RequestRow>(REQUEST_SELECT + ` JOIN request_recipients rr ON rr.request_id = r.id WHERE rr.user_id = $1 AND r.workspace_id = $2 ORDER BY r.created_at DESC LIMIT $3`, [userId, workspaceId, boundedLimit]) : await this.all<RequestRow>(REQUEST_SELECT + ` JOIN request_recipients rr ON rr.request_id = r.id WHERE rr.user_id = $1 ORDER BY r.created_at DESC LIMIT $2`, [userId, boundedLimit]);
    const statusRows = workspaceId ? await this.all<StatusUpdateRow>(STATUS_UPDATE_SELECT + ` JOIN status_update_recipients sur ON sur.status_id = su.status_id WHERE sur.user_id = $1 AND su.workspace_id = $2 ORDER BY su.created_at DESC LIMIT $3`, [userId, workspaceId, boundedLimit]) : await this.all<StatusUpdateRow>(STATUS_UPDATE_SELECT + ` JOIN status_update_recipients sur ON sur.status_id = su.status_id WHERE sur.user_id = $1 ORDER BY su.created_at DESC LIMIT $2`, [userId, boundedLimit]);
    const statusItems = await Promise.all(statusRows.map(async (row) => ({ kind: 'status_update' as const, id: row.status_id, workspaceId: row.workspace_id, createdAt: row.created_at, statusUpdate: await this.mapStatusUpdate(row) })));
    const mappedRequests = await this.mapRequests(requestRows, userId, now);
    const requestItems = requestRows.map((row, index) => ({ kind: 'request' as const, id: row.id, workspaceId: row.workspace_id, createdAt: row.created_at, request: mappedRequests[index]! }));
    return [...requestItems, ...statusItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, clampLimit(limit));
  }

  async pendingRequestCountForUser(userId: string, workspaceId?: string, now = new Date().toISOString()): Promise<number> {
    await this.expirePendingRequests(now);
    const params = workspaceId ? [userId, workspaceId] : [userId];
    const sql = `SELECT COUNT(*) AS count FROM requests r JOIN request_recipients rr ON rr.request_id = r.id AND rr.user_id = $1 LEFT JOIN responses rsp ON rsp.request_id = r.id AND rsp.user_id = rr.user_id WHERE r.status = 'pending' AND rsp.response_id IS NULL${workspaceId ? ' AND r.workspace_id = $2' : ''}`;
    return Number((await this.one<{ count: string }>(sql, params))?.count ?? 0);
  }

  async registerDevice(input: DeviceRegistrationInput, now = new Date().toISOString()): Promise<DeviceRecord> {
    await this.ensureUserExists(input.userId, now);
    const name = input.deviceName.trim();
    const platform = input.platform?.trim() || null;
    const installationId = input.installationId?.trim() || null;
    const expoPushToken = input.expoPushToken ?? null;
    if (installationId) {
      const existing = await this.one<DeviceRow>(`SELECT * FROM approval_devices WHERE user_id = $1 AND installation_id = $2 ORDER BY CASE WHEN unregistered_at IS NULL THEN 0 ELSE 1 END ASC, updated_at DESC, created_at DESC, device_id DESC LIMIT 1`, [input.userId, installationId]);
      if (existing) {
        await this.db.query('UPDATE approval_devices SET name = $1, platform = $2, expo_push_token = $3, unregistered_at = NULL, updated_at = $4 WHERE device_id = $5 AND user_id = $6', [name, platform ?? existing.platform, expoPushToken ?? existing.expo_push_token, now, existing.device_id, input.userId]);
        await this.retireDuplicateDevicesForInstallation(input.userId, installationId, existing.device_id, now);
        await this.writeAuditEvent((await this.defaultMembershipForUser(input.userId)).workspaceId, input.userId, 'approval_device.registered', existing.device_id, { name, platform }, now);
        return this.deviceOrThrow(existing.device_id, input.userId);
      }
    }
    const deviceId = id('dev');
    await this.db.query('INSERT INTO approval_devices(device_id, user_id, name, platform, installation_id, expo_push_token, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [deviceId, input.userId, name, platform, installationId, expoPushToken, now, now]);
    await this.writeAuditEvent((await this.defaultMembershipForUser(input.userId)).workspaceId, input.userId, 'approval_device.registered', deviceId, { name, platform }, now);
    return this.deviceOrThrow(deviceId, input.userId);
  }

  async listDevicesForUser(userId: string): Promise<DeviceRecord[]> { return (await this.all<DeviceRow>('SELECT * FROM approval_devices WHERE user_id = $1 AND unregistered_at IS NULL ORDER BY created_at DESC', [userId])).map(mapDevice); }
  async listPushDevicesForRequestRecipients(requestId: string): Promise<DeviceRecord[]> { return uniqueDevicesByPushToken(await this.all<DeviceRow>(`SELECT d.* FROM approval_devices d JOIN request_recipients rr ON rr.user_id = d.user_id WHERE rr.request_id = $1 AND d.unregistered_at IS NULL AND d.expo_push_token IS NOT NULL AND d.expo_push_token <> '' ORDER BY d.updated_at DESC, d.created_at DESC`, [requestId])); }
  async listPushDevicesForAudienceChannel(channelId: string): Promise<DeviceRecord[]> { return uniqueDevicesByPushToken(await this.all<DeviceRow>(`SELECT d.* FROM approval_devices d JOIN audience_subscriptions aus ON aus.user_id = d.user_id WHERE aus.channel_id = $1 AND aus.status = 'active' AND d.unregistered_at IS NULL AND d.expo_push_token IS NOT NULL AND d.expo_push_token <> '' ORDER BY d.updated_at DESC, d.created_at DESC`, [channelId])); }
  async listPushDevicesForUsers(userIds: string[]): Promise<DeviceRecord[]> { if (!userIds.length) return []; return uniqueDevicesByPushToken(await this.all<DeviceRow>(`SELECT * FROM approval_devices WHERE user_id = ANY($1) AND unregistered_at IS NULL AND expo_push_token IS NOT NULL AND expo_push_token <> '' ORDER BY updated_at DESC, created_at DESC`, [userIds])); }
  async getDeviceForUser(deviceId: string, userId: string): Promise<DeviceRecord | null> { const row = await this.one<DeviceRow>('SELECT * FROM approval_devices WHERE device_id = $1 AND user_id = $2', [deviceId, userId]); return row ? mapDevice(row) : null; }
  async updateDeviceName(deviceId: string, userId: string, name: string, now = new Date().toISOString()): Promise<DeviceRecord | null> { await this.db.query('UPDATE approval_devices SET name = $1, updated_at = $2 WHERE device_id = $3 AND user_id = $4', [name.trim(), now, deviceId, userId]); return this.getDeviceForUser(deviceId, userId); }
  async updateDevicePushToken(deviceId: string, userId: string, expoPushToken: string, now = new Date().toISOString()): Promise<DeviceRecord | null> { await this.db.query(`UPDATE approval_devices SET expo_push_token = $1, unregistered_at = CASE WHEN $2 <> '' THEN NULL ELSE unregistered_at END, updated_at = $3 WHERE device_id = $4 AND user_id = $5`, [expoPushToken, expoPushToken, now, deviceId, userId]); return this.getDeviceForUser(deviceId, userId); }
  async unregisterDevice(deviceId: string, userId: string, now = new Date().toISOString()): Promise<DeviceRecord | null> { await this.db.query('UPDATE approval_devices SET unregistered_at = COALESCE(unregistered_at, $1), expo_push_token = NULL, token_hash = NULL, updated_at = $2 WHERE device_id = $3 AND user_id = $4', [now, now, deviceId, userId]); return this.getDeviceForUser(deviceId, userId); }

  async createPairingToken(userId: string, workspaceId: string, now = new Date().toISOString(), ttlSeconds = 10 * 60): Promise<PairingTokenRecord> { const token = `pair_${crypto.randomBytes(20).toString('base64url')}`; const expiresAt = addMs(now, ttlSeconds * 1000); await this.db.query('INSERT INTO device_pairing_codes(token_hash, user_id, workspace_id, expires_at, created_at) VALUES ($1,$2,$3,$4,$5)', [hashSecret(token), userId, workspaceId, expiresAt, now]); return { token, expiresAt }; }
  async pairDeviceWithCode(pairingCode: string, deviceName: string, platform?: string, now = new Date().toISOString()): Promise<DeviceCredential | null> { const row = await this.one<PairingRow>('SELECT * FROM device_pairing_codes WHERE token_hash = $1 AND expires_at > $2 AND used_at IS NULL', [hashSecret(pairingCode), now]); if (!row) return null; const token = `device_${crypto.randomBytes(24).toString('base64url')}`; const device = await this.registerDevice({ userId: row.user_id, deviceName, ...(platform ? { platform } : {}) }, now); await this.db.query('UPDATE approval_devices SET token_hash = $1, updated_at = $2 WHERE device_id = $3', [hashSecret(token), now, device.deviceId]); await this.db.query('UPDATE device_pairing_codes SET used_at = $1 WHERE token_hash = $2', [now, hashSecret(pairingCode)]); return { deviceId: device.deviceId, token }; }
  async verifyDeviceToken(token: string): Promise<DeviceTokenAuth | null> { const row = await this.one<DeviceRow>('SELECT * FROM approval_devices WHERE token_hash = $1 AND unregistered_at IS NULL', [hashSecret(token)]); if (!row) return null; return { source: 'device', deviceId: row.device_id, userId: row.user_id, workspaceId: (await this.defaultMembershipForUser(row.user_id)).workspaceId }; }

  async recordHeartbeat(userId: string, workspaceId: string, now = new Date().toISOString()): Promise<AvailabilityRecord> { return this.setAvailability(userId, workspaceId, 'available', now, true); }
  async setAvailability(userId: string, workspaceId: string, state: string, now = new Date().toISOString(), heartbeat = false): Promise<AvailabilityRecord> { await this.db.query(`INSERT INTO availability(user_id, workspace_id, state, last_seen_at, updated_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(user_id, workspace_id) DO UPDATE SET state = excluded.state, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at`, [userId, workspaceId, state, heartbeat ? now : null, now]); return (await this.getAvailability(userId, workspaceId))!; }
  async getAvailability(userId: string, workspaceId: string): Promise<AvailabilityRecord | null> { const row = await this.one<AvailabilityRow>('SELECT * FROM availability WHERE user_id = $1 AND workspace_id = $2', [userId, workspaceId]); return row ? mapAvailability(row) : null; }

  async createEventTicket(input: EventTicketInput, now = new Date().toISOString()): Promise<EventTicketRecord> { const ticket = `evt_${crypto.randomBytes(20).toString('base64url')}`; const expiresAt = addMs(now, (input.ttlSeconds ?? 30) * 1000); await this.db.query('INSERT INTO event_tickets(token_hash, source, workspace_id, user_id, expires_at, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [hashSecret(ticket), input.source, input.workspaceId, input.userId, expiresAt, now]); return { ticket, expiresAt }; }
  async verifyEventTicket(ticket: string, now = new Date().toISOString()): Promise<EventTicketAuth | null> { const row = await this.one<EventTicketRow>('SELECT * FROM event_tickets WHERE token_hash = $1 AND expires_at > $2 AND used_at IS NULL', [hashSecret(ticket), now]); if (!row) return null; await this.db.query('UPDATE event_tickets SET used_at = $1 WHERE token_hash = $2', [now, hashSecret(ticket)]); return { source: row.source, workspaceId: row.workspace_id, userId: row.user_id }; }

  async recordMobileDiagnostics(events: MobileDiagnosticInput[]): Promise<number> { for (const event of events) await this.db.query('INSERT INTO mobile_diagnostics(diagnostic_id, workspace_id, user_id, device_id, level, area, message, metadata_json, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id('diag'), event.workspaceId, event.userId, event.deviceId ?? null, event.level, event.area, event.message, event.metadata ? JSON.stringify(event.metadata) : '{}', event.createdAt]); return events.length; }
  async listMobileDiagnostics(workspaceId: string, limit = 100): Promise<MobileDiagnosticRecord[]> { return (await this.all<MobileDiagnosticRow>('SELECT * FROM mobile_diagnostics WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2', [workspaceId, clampLimit(limit, 1000)])).map(mapMobileDiagnostic); }
  async listAuditEvents(workspaceId: string, limit = 100): Promise<AuditEventRecord[]> { return (await this.all<AuditRow>('SELECT * FROM audit_events WHERE workspace_id = $1 ORDER BY event_id DESC LIMIT $2', [workspaceId, clampLimit(limit, 1000)])).map(mapAuditEvent); }
  async listAuditEventsAfter(workspaceId: string, afterEventId = 0, limit = 100): Promise<AuditEventRecord[]> { return (await this.all<AuditRow>('SELECT * FROM audit_events WHERE workspace_id = $1 AND event_id > $2 ORDER BY event_id ASC LIMIT $3', [workspaceId, afterEventId, clampLimit(limit, 1000)])).map(mapAuditEvent); }

  async writeAuditEvent(workspaceId: string, userId: string, eventType: string, targetId: string, payload: unknown, now = new Date().toISOString()): Promise<void> {
    await this.db.query('INSERT INTO audit_events(workspace_id, user_id, event_type, target_id, payload_json, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, userId, eventType, targetId, JSON.stringify(payload ?? {}), now]);
  }

  async cleanupExpiredSecrets(now = new Date().toISOString()): Promise<CleanupExpiredSecretsResult> {
    const eventTickets = (await this.db.query('DELETE FROM event_tickets WHERE expires_at <= $1 OR used_at IS NOT NULL', [now])).rowCount ?? 0;
    const pairingCodes = (await this.db.query('DELETE FROM device_pairing_codes WHERE expires_at <= $1 OR used_at IS NOT NULL', [now])).rowCount ?? 0;
    const requestWaiterTokens = (await this.db.query('DELETE FROM request_waiter_tokens WHERE expires_at <= $1', [now])).rowCount ?? 0;
    return { eventTickets, pairingCodes, requestWaiterTokens };
  }

  async cleanupRetention(policy: RetentionPolicy = {}, now = new Date().toISOString()): Promise<CleanupRetentionResult> {
    const requests = await this.deleteOlderThan('requests', 'created_at', policy.requestsDays, now);
    const statusUpdates = await this.deleteOlderThan('status_updates', 'created_at', policy.statusUpdatesDays, now);
    const auditEvents = await this.deleteOlderThan('audit_events', 'created_at', policy.auditEventsDays, now);
    const devices = await this.deleteOlderThan('approval_devices', 'unregistered_at', policy.unregisteredDevicesDays, now, 'unregistered_at IS NOT NULL');
    return { requests, statusUpdates, auditEvents, devices };
  }

  async deleteWorkspaceData(workspaceId: string, now = new Date().toISOString()): Promise<DeleteWorkspaceDataResult> {
    return this.transaction(async () => {
      const workspace = await this.workspaceRow(workspaceId);
      if (!workspace || workspace.type === 'personal') return { workspaceId, agentTokensRevoked: 0, devicesUnregistered: 0, deleted: false };
      const agentTokensRevoked = (await this.db.query('UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, $1) WHERE workspace_id = $2', [now, workspaceId])).rowCount ?? 0;
      await this.db.query('DELETE FROM workspaces WHERE workspace_id = $1', [workspaceId]);
      return { workspaceId, agentTokensRevoked, devicesUnregistered: 0, deleted: true };
    });
  }

  async getOrStartPersonalEntitlement(userId: string, now = new Date().toISOString()): Promise<PersonalEntitlementRecord> {
    await this.ensurePersonalEntitlementRow(userId, now);
    return this.personalEntitlementOrThrow(userId);
  }

  async updatePersonalEntitlement(input: UpdatePersonalEntitlementInput, now = new Date().toISOString()): Promise<PersonalEntitlementRecord> {
    await this.ensurePersonalEntitlementRow(input.userId, now);
    const existing = await this.personalEntitlementOrThrow(input.userId);
    await this.db.query(`
      UPDATE personal_entitlements
      SET app_unlocked_at = $1, hosted_subscription_ends_at = $2, hosted_subscription_canceled_at = $3, hosted_data_deleted_at = $4, updated_at = $5
      WHERE user_id = $6
    `, [
      coalesceNullableInput(input.appUnlockedAt, existing.appUnlockedAt),
      coalesceNullableInput(input.hostedSubscriptionEndsAt, existing.hostedSubscriptionEndsAt),
      coalesceNullableInput(input.hostedSubscriptionCanceledAt, existing.hostedSubscriptionCanceledAt),
      coalesceNullableInput(input.hostedDataDeletedAt, existing.hostedDataDeletedAt),
      now,
      input.userId,
    ]);
    return this.personalEntitlementOrThrow(input.userId);
  }

  async upsertBillingProducts(products: UpsertBillingProductInput[], now = new Date().toISOString()): Promise<void> {
    for (const product of products) {
      await this.db.query(`
        INSERT INTO billing_products(id, product_key, kind, entitlement_key, apple_product_id, google_product_id, google_base_plan_id, active, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(product_key) DO UPDATE SET kind = excluded.kind, entitlement_key = excluded.entitlement_key, apple_product_id = excluded.apple_product_id, google_product_id = excluded.google_product_id, google_base_plan_id = excluded.google_base_plan_id, active = excluded.active, updated_at = excluded.updated_at
      `, [id('prod'), product.productKey, product.kind, product.entitlementKey, product.appleProductId ?? null, product.googleProductId ?? null, product.googleBasePlanId ?? null, product.active !== false, now, now]);
    }
  }

  async listBillingProducts(activeOnly = true): Promise<BillingProductRecord[]> {
    const rows = activeOnly ? await this.all<BillingProductRow>('SELECT * FROM billing_products WHERE active = true ORDER BY product_key') : await this.all<BillingProductRow>('SELECT * FROM billing_products ORDER BY product_key');
    return rows.map(mapBillingProduct);
  }

  async createBillingPurchaseAttempt(input: CreateBillingPurchaseAttemptInput, now = new Date().toISOString()): Promise<BillingPurchaseAttemptRecord> {
    const attemptId = id('attempt');
    await this.db.query('INSERT INTO billing_purchase_attempts(id, user_id, product_key, product_group, platform, provider, status, provider_user_id, idempotency_key, expires_at, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [attemptId, input.userId, input.productKey, input.productGroup, input.platform, input.provider, 'pending', input.providerUserId ?? null, input.idempotencyKey, input.expiresAt, now, now]);
    return this.billingAttemptOrThrow(attemptId);
  }

  async updateBillingPurchaseAttemptStatus(attemptId: string, status: string, now = new Date().toISOString()): Promise<BillingPurchaseAttemptRecord | null> {
    await this.db.query('UPDATE billing_purchase_attempts SET status = $1, updated_at = $2 WHERE id = $3', [status, now, attemptId]);
    const row = await this.one<BillingAttemptRow>('SELECT * FROM billing_purchase_attempts WHERE id = $1', [attemptId]);
    return row ? mapBillingAttempt(row) : null;
  }

  async listActiveBillingPurchaseAttempts(userId: string, productGroup: string, now = new Date().toISOString()): Promise<BillingPurchaseAttemptRecord[]> {
    return (await this.all<BillingAttemptRow>(`SELECT * FROM billing_purchase_attempts WHERE user_id = $1 AND product_group = $2 AND status = 'pending' AND expires_at > $3 ORDER BY created_at DESC`, [userId, productGroup, now])).map(mapBillingAttempt);
  }

  async upsertBillingTransaction(input: UpsertBillingTransactionInput, now = new Date().toISOString()): Promise<UpsertBillingTransactionResult> {
    const existing = await this.findBillingTransaction(input);
    const transactionId = existing?.id ?? id('txn');
    await this.db.query(`
      INSERT INTO billing_transactions(id, user_id, provider, environment, product_key, entitlement_key, platform, provider_transaction_id, provider_original_transaction_id, provider_purchase_token, status, purchased_at, expires_at, canceled_at, revoked_at, raw_event_json, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, expires_at = excluded.expires_at, canceled_at = excluded.canceled_at, revoked_at = excluded.revoked_at, raw_event_json = excluded.raw_event_json, updated_at = excluded.updated_at
    `, [transactionId, input.userId, input.provider, input.environment, input.productKey, input.entitlementKey, input.platform, input.providerTransactionId ?? null, input.providerOriginalTransactionId ?? null, input.providerPurchaseToken ?? null, input.status, input.purchasedAt ?? null, input.expiresAt ?? null, input.canceledAt ?? null, input.revokedAt ?? null, input.rawEventJSON ?? null, existing?.created_at ?? now, now]);
    return { record: mapBillingTransaction(await this.billingTransactionOrThrow(transactionId)), created: !existing };
  }

  async listBillingTransactionsForUser(userId: string): Promise<BillingTransactionRecord[]> {
    return (await this.all<BillingTransactionRow>('SELECT * FROM billing_transactions WHERE user_id = $1 ORDER BY updated_at DESC', [userId])).map(mapBillingTransaction);
  }

  async transferAccountBoundBillingPurchases(input: TransferAccountBoundBillingPurchasesInput, now = new Date().toISOString()): Promise<TransferAccountBoundBillingPurchasesResult> {
    const fromUserIds = [...new Set(input.fromUserIds.map((userId) => userId.trim()).filter((userId) => userId && userId !== input.toUserId))];
    if (fromUserIds.length === 0 || !input.toUserId.trim()) return { transactions: [], receiptOwnersTransferred: 0 };
    const filters = [`provider = $1`, `user_id = ANY($2)`, `entitlement_key IN ('hosted_personal', 'native_app_trial')`];
    const values: unknown[] = [input.provider, fromUserIds];
    if (input.environment) { values.push(input.environment); filters.push(`environment = $${values.length}`); }
    if (input.platform) { values.push(input.platform); filters.push(`platform = $${values.length}`); }
    const rows = await this.all<BillingTransactionRow>(`SELECT * FROM billing_transactions WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC, created_at DESC`, values);
    if (rows.length === 0) return { transactions: [], receiptOwnersTransferred: 0 };
    const transactionIds = rows.map((row) => row.id);
    const receiptTransfers = new Map<string, BillingTransactionRow>();
    for (const row of rows) {
      const receiptKey = billingTransactionReceiptKey(row);
      if (!receiptKey) continue;
      const key = [row.provider, row.environment, row.platform, row.entitlement_key, receiptKey].join('\u0000');
      const existing = receiptTransfers.get(key);
      if (!existing || row.updated_at > existing.updated_at) receiptTransfers.set(key, row);
    }
    await this.transaction(async () => {
      await this.db.query('UPDATE billing_transactions SET user_id = $1, raw_event_json = COALESCE($2, raw_event_json), updated_at = $3 WHERE id = ANY($4)', [input.toUserId, input.rawEventJSON ?? null, now, transactionIds]);
      for (const row of receiptTransfers.values()) {
        const receiptKey = billingTransactionReceiptKey(row);
        if (!receiptKey) continue;
        await this.db.query(`
          INSERT INTO billing_receipt_owners(provider, environment, platform, entitlement_key, receipt_key, product_key, owner_user_id, first_seen_at, last_seen_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT(provider, environment, platform, entitlement_key, receipt_key) DO UPDATE SET product_key = excluded.product_key, owner_user_id = excluded.owner_user_id, last_seen_at = excluded.last_seen_at
        `, [row.provider, row.environment, row.platform, row.entitlement_key, receiptKey, row.product_key, input.toUserId, now, now]);
      }
    });
    const transferredRows = await this.all<BillingTransactionRow>('SELECT * FROM billing_transactions WHERE id = ANY($1) ORDER BY updated_at DESC', [transactionIds]);
    return { transactions: transferredRows.map(mapBillingTransaction), receiptOwnersTransferred: receiptTransfers.size };
  }

  async claimBillingReceiptOwner(input: ClaimBillingReceiptOwnerInput, now = new Date().toISOString()): Promise<ClaimBillingReceiptOwnerResult> {
    return this.transaction(async () => {
      const inserted = await this.db.query(`
        INSERT INTO billing_receipt_owners(provider, environment, platform, entitlement_key, receipt_key, product_key, owner_user_id, first_seen_at, last_seen_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(provider, environment, platform, entitlement_key, receipt_key) DO NOTHING
      `, [input.provider, input.environment, input.platform, input.entitlementKey, input.receiptKey, input.productKey, input.ownerUserId, now, now]);
      await this.db.query(`UPDATE billing_receipt_owners SET product_key = $1, last_seen_at = $2 WHERE provider = $3 AND environment = $4 AND platform = $5 AND entitlement_key = $6 AND receipt_key = $7`, [input.productKey, now, input.provider, input.environment, input.platform, input.entitlementKey, input.receiptKey]);
      const owner = await this.billingReceiptOwnerOrThrow(input.provider, input.environment, input.platform, input.entitlementKey, input.receiptKey);
      const created = (inserted.rowCount ?? 0) > 0;
      return { owner, created, ownedByCurrentUser: owner.ownerUserId === input.ownerUserId };
    });
  }

  async upsertBillingIdentityConflict(input: UpsertBillingIdentityConflictInput, now = new Date().toISOString()): Promise<BillingIdentityConflictRecord> {
    const existing = await this.one<BillingIdentityConflictRow>(`SELECT * FROM billing_identity_conflicts WHERE user_id = $1 AND provider = $2 AND environment = $3 AND platform = $4 AND entitlement_key = $5 AND receipt_key = $6 AND code = $7`, [input.userId, input.provider, input.environment, input.platform, input.entitlementKey, input.receiptKey, input.code]);
    const conflictId = existing?.id ?? id('bic');
    await this.db.query(`
      INSERT INTO billing_identity_conflicts(id, user_id, provider, environment, platform, product_key, entitlement_key, receipt_key, code, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT(id) DO UPDATE SET product_key = excluded.product_key, updated_at = excluded.updated_at
    `, [conflictId, input.userId, input.provider, input.environment, input.platform, input.productKey, input.entitlementKey, input.receiptKey, input.code, existing?.created_at ?? now, now]);
    return mapBillingIdentityConflict(await this.billingIdentityConflictOrThrow(conflictId));
  }

  async listBillingIdentityConflictsForUser(userId: string): Promise<BillingIdentityConflictRecord[]> {
    return (await this.all<BillingIdentityConflictRow>('SELECT * FROM billing_identity_conflicts WHERE user_id = $1 ORDER BY updated_at DESC', [userId])).map(mapBillingIdentityConflict);
  }

  async deleteHostedPersonalData(userId: string, workspaceId: string, now = new Date().toISOString()): Promise<void> {
    const workspace = await this.workspaceRow(workspaceId);
    if (!workspace || workspace.type !== 'personal') throw new Error('Personal Workspace is required for hosted data deletion');
    const tokenRows = await this.all<{ agent_token_id: string }>('SELECT agent_token_id FROM agent_tokens WHERE workspace_id = $1', [workspaceId]);
    for (const row of tokenRows) await this.revokeAgentToken(row.agent_token_id, workspaceId, now);
    await this.db.query('UPDATE approval_devices SET expo_push_token = NULL, unregistered_at = COALESCE(unregistered_at, $1), updated_at = $2 WHERE user_id = $3', [now, now, userId]);
    await this.db.query('DELETE FROM mobile_diagnostics WHERE user_id = $1', [userId]);
    await this.db.query('DELETE FROM availability WHERE user_id = $1', [userId]);
    await this.db.query('DELETE FROM status_update_recipients WHERE user_id = $1', [userId]);
    await this.db.query('DELETE FROM request_recipients WHERE user_id = $1', [userId]);
    await this.db.query('DELETE FROM routing_rule_recipients WHERE user_id = $1', [userId]);
    await this.db.query('DELETE FROM responses WHERE user_id = $1', [userId]);
    await this.updatePersonalEntitlement({ userId, hostedDataDeletedAt: now }, now);
  }

  async deleteHostedAccountData(userId: string, personalWorkspaceId: string, now = new Date().toISOString()): Promise<void> {
    await this.transaction(async () => {
      const workspace = await this.workspaceRow(personalWorkspaceId);
      if (workspace && workspace.type !== 'personal') throw new Error('Personal Workspace is required for hosted account deletion');
      const ownerMembership = await this.one<{ exists: number }>(`SELECT 1 AS exists FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role = 'owner'`, [personalWorkspaceId, userId]);
      if (workspace && !ownerMembership) throw new Error('Personal Workspace owner membership is required for hosted account deletion');
      await this.db.query('UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, $1) WHERE creator_user_id = $2', [now, userId]);
      await this.db.query('UPDATE approval_devices SET expo_push_token = NULL, token_hash = NULL, unregistered_at = COALESCE(unregistered_at, $1), updated_at = $2 WHERE user_id = $3', [now, now, userId]);
      await this.db.query('DELETE FROM mobile_diagnostics WHERE user_id = $1', [userId]);
      await this.db.query('DELETE FROM availability WHERE user_id = $1', [userId]);
      await this.db.query('DELETE FROM status_update_recipients WHERE user_id = $1', [userId]);
      await this.db.query('DELETE FROM request_recipients WHERE user_id = $1', [userId]);
      await this.db.query('DELETE FROM responses WHERE user_id = $1', [userId]);
      await this.db.query('DELETE FROM routing_rule_recipients WHERE user_id = $1', [userId]);
      await this.db.query(`DELETE FROM routing_rules WHERE workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = $1 AND workspace_id <> $2) AND NOT EXISTS (SELECT 1 FROM routing_rule_recipients WHERE routing_rule_recipients.routing_rule_id = routing_rules.routing_rule_id)`, [userId, personalWorkspaceId]);
      await this.db.query('DELETE FROM workspace_members WHERE user_id = $1 AND workspace_id <> $2', [userId, personalWorkspaceId]);
      await this.db.query('DELETE FROM auth_identities WHERE user_id = $1', [userId]);
      await this.db.query('DELETE FROM billing_receipt_owners WHERE owner_user_id = $1', [userId]);
      await this.ensurePersonalEntitlementRow(userId, now);
      await this.db.query('UPDATE personal_entitlements SET hosted_data_deleted_at = $1, updated_at = $2 WHERE user_id = $3', [now, now, userId]);
      if (workspace) await this.db.query("DELETE FROM workspaces WHERE workspace_id = $1 AND type = 'personal'", [personalWorkspaceId]);
      await this.db.query(`UPDATE users SET email = '', email_verified = false, name = '', sign_in_method = NULL, revoked_at = COALESCE(revoked_at, $1), updated_at = $2 WHERE id = $3`, [now, now, userId]);
    });
  }


  private async agentTokenRowById(agentTokenId: string): Promise<AgentTokenRow | null> {
    return this.one<AgentTokenRow>(AGENT_TOKEN_SELECT + ' WHERE at.agent_token_id = $1', [agentTokenId]);
  }

  private async agentTokenRow(agentTokenId: string, workspaceId: string): Promise<AgentTokenRow | null> {
    return this.one<AgentTokenRow>(AGENT_TOKEN_SELECT + ' WHERE at.agent_token_id = $1 AND at.workspace_id = $2', [agentTokenId, workspaceId]);
  }

  private async assertActiveWorkspaceMember(userId: string, workspaceId: string): Promise<void> {
    if (!(await this.workspaceMembershipForUser(userId, workspaceId))) throw new Error('User is not an active Workspace Member');
  }

  private async assertRuleInWorkspace(routingRuleId: string, workspaceId: string): Promise<void> {
    const rule = await this.getRoutingRule(routingRuleId);
    if (!rule || rule.workspaceId !== workspaceId) throw new Error('Routing Rule does not belong to the Workspace');
  }

  private async assertRoutingRuleTargetsBoundRecipient(routingRuleId: string, boundRecipientUserId: string): Promise<void> {
    const rule = await this.getRoutingRule(routingRuleId);
    if (!rule?.recipientUserIds.includes(boundRecipientUserId)) throw new Error('Agent Token bound recipient must be a recipient of the Routing Rule');
  }

  private async routeForAudienceRequest(workspaceId: string, audienceChannelId: string | undefined): Promise<{ routingRuleId?: string; recipientUserIds: string[]; requiredResponseCount: number }> {
    if (!audienceChannelId) throw new Error('Audience Channel Request requires an audienceChannelId');
    const channel = await this.getAudienceChannel(audienceChannelId);
    if (!channel || channel.workspaceId !== workspaceId || channel.status !== 'active') throw new Error('Audience Channel not found');
    return { recipientUserIds: [], requiredResponseCount: 1 };
  }

  private async routeForActivity(workspaceId: string, agentTokenId?: string, routingRuleId?: string): Promise<{ routingRuleId?: string; recipientUserIds: string[]; requiredResponseCount: number }> {
    const workspace = await this.workspaceRow(workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    if (workspace.type === 'personal') {
      const members = await this.listWorkspaceMembers(workspaceId);
      return { recipientUserIds: members.map((member) => member.userId), requiredResponseCount: 1 };
    }
    const token = agentTokenId ? await this.agentTokenRowById(agentTokenId) : null;
    const ruleId = routingRuleId ?? token?.routing_rule_id ?? undefined;
    if (!ruleId) {
      const error = new Error('Connected Shared Workspace Agent Token requires a Routing Rule assignment before activity can route') as Error & { code?: string; statusCode?: number };
      error.code = 'routing_required'; error.statusCode = 409; throw error;
    }
    const rule = await this.getRoutingRule(ruleId);
    if (!rule || rule.workspaceId !== workspaceId) throw new Error('Routing Rule not found for Workspace');
    if (token?.bound_recipient_user_id) await this.assertRoutingRuleTargetsBoundRecipient(rule.routingRuleId, token.bound_recipient_user_id);
    return { routingRuleId: rule.routingRuleId, recipientUserIds: rule.recipientUserIds, requiredResponseCount: rule.requiredResponseCount };
  }

  private async insertRoutingRuleRecipients(routingRuleId: string, recipientUserIds: string[], now: string): Promise<void> {
    if (!recipientUserIds.length) return;
    await this.db.query(`INSERT INTO routing_rule_recipients(routing_rule_id, user_id, created_at)
      SELECT $1, user_id, $2 FROM unnest($3::text[]) AS recipients(user_id)`, [routingRuleId, now, recipientUserIds]);
  }

  private async insertRequestRecipients(requestId: string, recipientUserIds: string[], now: string): Promise<void> {
    if (!recipientUserIds.length) return;
    await this.db.query(`INSERT INTO request_recipients(request_id, user_id, has_active_device, created_at, updated_at)
      SELECT $1, recipients.user_id,
        EXISTS(SELECT 1 FROM approval_devices d WHERE d.user_id = recipients.user_id AND d.expo_push_token IS NOT NULL AND d.unregistered_at IS NULL),
        $2, $2
      FROM unnest($3::text[]) AS recipients(user_id)`, [requestId, now, recipientUserIds]);
  }

  private async insertStatusUpdateRecipients(statusId: string, recipientUserIds: string[], now: string): Promise<void> {
    if (!recipientUserIds.length) return;
    await this.db.query(`INSERT INTO status_update_recipients(status_id, user_id, created_at)
      SELECT $1, user_id, $2 FROM unnest($3::text[]) AS recipients(user_id)`, [statusId, now, recipientUserIds]);
  }

  private async expirePendingRequests(now: string): Promise<void> {
    await this.finalizeDueAudienceRequests(now);
    const rows = await this.all<{ id: string; workspace_id: string }>(`SELECT id, workspace_id FROM requests WHERE status = 'pending' AND deadline IS NOT NULL AND deadline <= $1`, [now]);
    for (const row of rows) {
      await this.db.query(`UPDATE requests SET status = 'expired', responded_at = $1, response_json = $2 WHERE id = $3`, [now, JSON.stringify({ message: 'expired' }), row.id]);
      await this.writeAuditEvent(row.workspace_id, 'system', 'request.expired', row.id, {}, now);
    }
  }

  private async finalizeDueAudienceRequests(now: string): Promise<void> {
    const rows = await this.all<RequestRow>(REQUEST_SELECT + ` WHERE r.status = 'pending' AND r.delivery_kind = 'audience_channel' AND r.closes_at IS NOT NULL AND r.closes_at <= $1`, [now]);
    for (const row of rows) await this.finalizeAudienceRequest(row.id, now);
  }

  private async finalizeAudienceRequest(requestId: string, now: string): Promise<void> {
    const row = await this.requestRow(requestId);
    if (!row || row.status !== 'pending') return;
    const responses = await this.all<{ choice_id: string | null }>('SELECT choice_id FROM responses WHERE request_id = $1 AND choice_id IS NOT NULL', [requestId]);
    const counts: Record<string, number> = {};
    for (const response of responses) if (response.choice_id) counts[response.choice_id] = (counts[response.choice_id] ?? 0) + 1;
    const max = Math.max(0, ...Object.values(counts));
    const winners = Object.entries(counts).filter(([, count]) => count === max).map(([choice]) => choice).sort();
    const defaultChoice = row.default_choice;
    const finalChoice = winners.length === 1 ? winners[0] : defaultChoice;
    const aggregate = { choices: counts };
    if (finalChoice) {
      await this.db.query('UPDATE requests SET status = $1, responded_at = $2, response_json = $3, final_choice_id = $4, aggregate_result_json = $5 WHERE id = $6', ['responded', now, JSON.stringify({ choiceId: finalChoice }), finalChoice, JSON.stringify(aggregate), requestId]);
      await this.writeAuditEvent(row.workspace_id, 'system', 'request.audience_responded', requestId, { choiceId: finalChoice, aggregate: counts }, now);
    } else {
      await this.db.query('UPDATE requests SET status = $1, responded_at = $2, response_json = $3, aggregate_result_json = $4 WHERE id = $5', ['expired', now, JSON.stringify({ message: 'expired' }), JSON.stringify(aggregate), requestId]);
      await this.writeAuditEvent(row.workspace_id, 'system', 'request.audience_expired', requestId, { aggregate: counts }, now);
    }
  }

  private async requestRow(idValue: string): Promise<RequestRow | null> {
    return this.one<RequestRow>(REQUEST_SELECT + ' WHERE r.id = $1', [idValue]);
  }

  private async requestOrThrow(idValue: string, currentUserId?: string, now?: string): Promise<RequestRecord> {
    const row = await this.requestRow(idValue);
    if (!row) throw new Error('Request not found');
    return this.mapRequest(row, currentUserId, now);
  }

  private async mapRequests(rows: RequestRow[], currentUserId?: string, now = new Date().toISOString()): Promise<RequestRecord[]> {
    if (!rows.length) return [];
    const requestIds = rows.map((row) => row.id);
    const recipientsByRequest = groupBy(await this.all<RequestRecipientRow>('SELECT * FROM request_recipients WHERE request_id = ANY($1) ORDER BY request_id, created_at ASC', [requestIds]), (row) => row.request_id);
    const responsesByRequest = groupBy(await this.all<ResponseRow>('SELECT * FROM responses WHERE request_id = ANY($1) ORDER BY request_id, created_at ASC', [requestIds]), (row) => row.request_id);
    const waiterRows = await this.all<RequestWaiterRow>(`SELECT DISTINCT ON (request_id) * FROM request_waiters WHERE request_id = ANY($1) ORDER BY request_id, created_at DESC`, [requestIds]);
    const waitersByRequest = new Map(waiterRows.map((row) => [row.request_id, row]));
    return Promise.all(rows.map((row) => this.mapRequest(row, currentUserId, now, {
      recipients: recipientsByRequest.get(row.id) ?? [],
      responses: responsesByRequest.get(row.id) ?? [],
      waiter: waitersByRequest.get(row.id) ?? null
    })));
  }

  private async mapRequest(row: RequestRow, currentUserId?: string, now = new Date().toISOString(), preloaded?: { recipients: RequestRecipientRow[]; responses: ResponseRow[]; waiter: RequestWaiterRow | null }): Promise<RequestRecord> {
    const recipients = (preloaded?.recipients ?? await this.all<RequestRecipientRow>('SELECT * FROM request_recipients WHERE request_id = $1 ORDER BY created_at ASC', [row.id])).map(mapRequestRecipient);
    const responses = (preloaded?.responses ?? await this.all<ResponseRow>('SELECT * FROM responses WHERE request_id = $1 ORDER BY created_at ASC', [row.id])).map(mapResponse);
    const waiter = preloaded ? this.requestWaiterSummary(preloaded.waiter, now) : await this.deriveWaiterSummary(row.id, now);
    const receivedResponseCount = responses.length;
    const record = {
      id: row.id,
      workspaceId: row.workspace_id,
      workspaceType: row.workspace_type as WorkspaceType,
      ...(row.agent_token_id ? { agentTokenId: row.agent_token_id } : {}),
      ...(row.routing_rule_id ? { routingRuleId: row.routing_rule_id } : {}),
      ...(row.session_id ? { sessionId: row.session_id } : {}),
      session: JSON.parse(row.session_metadata_json || '{}'),
      requester: JSON.parse(row.requester_json),
      requestType: row.request_type,
      deliveryKind: row.delivery_kind,
      responsePolicy: row.response_policy,
      ...(row.audience_channel_id ? { audienceChannelId: row.audience_channel_id } : {}),
      ...(row.closes_at ? { closesAt: row.closes_at } : {}),
      ...(row.tie_policy ? { tiePolicy: row.tie_policy } : {}),
      ...(row.aggregate_result_json ? { aggregateResult: JSON.parse(row.aggregate_result_json) } : {}),
      title: row.title,
      ...(row.body ? { body: row.body } : {}),
      ...(row.command ? { command: row.command } : {}),
      choices: JSON.parse(row.choices_json) as Choice[],
      questions: JSON.parse(row.questions_json || '[]'),
      ...(row.default_choice ? { defaultChoice: row.default_choice } : {}),
      allowFreeformReply: row.allow_freeform_reply,
      ...(row.deadline ? { deadline: row.deadline } : {}),
      ...(row.risk ? { risk: row.risk } : {}),
      metadata: JSON.parse(row.metadata_json || '{}'),
      status: row.status,
      createdAt: row.created_at,
      ...(row.responded_at ? { respondedAt: row.responded_at } : {}),
      ...(row.response_json ? { response: JSON.parse(row.response_json) } : {}),
      ...(row.final_choice_id ? { finalChoiceId: row.final_choice_id } : {}),
      recipients,
      responses,
      quorum: { requiredResponseCount: Math.max(row.required_response_count, 1), receivedResponseCount, waitingFor: Math.max(0, Math.max(row.required_response_count, 1) - receivedResponseCount), ...(currentUserId ? { currentUserEligible: recipients.some((recipient) => recipient.userId === currentUserId), currentUserResponded: responses.some((response) => response.userId === currentUserId) } : {}), recipients, responses },
      isTest: row.is_test,
      ...(row.test_label ? { testLabel: row.test_label } : {}),
      ...(waiter ? { agentWaiter: waiter } : {})
    };
    return RequestRecordSchema.parse(record);
  }

  private async deriveWaiterSummary(requestId: string, now: string): Promise<RequestAgentWaiterSummary | null> {
    return this.requestWaiterSummary(await this.one<RequestWaiterRow>('SELECT * FROM request_waiters WHERE request_id = $1 ORDER BY created_at DESC LIMIT 1', [requestId]), now);
  }

  private requestWaiterSummary(row: RequestWaiterRow | null, now: string): RequestAgentWaiterSummary | null {
    if (!row) return null;
    let state = row.state as RequestAgentWaiterSummary['state'];
    if (state === 'waiting' && Date.parse(row.credential_expires_at) <= Date.parse(now)) state = 'expired';
    else if (state === 'waiting' && Date.parse(row.lease_expires_at) <= Date.parse(now)) state = 'stale';
    return { waiterId: row.waiter_id, state, lastSeenAt: row.last_seen_at, leaseExpiresAt: row.lease_expires_at, credentialExpiresAt: row.credential_expires_at, ...(row.stopped_at ? { stoppedAt: row.stopped_at } : {}), ...(row.stop_reason ? { stopReason: row.stop_reason } : {}), ...(row.error_code ? { errorCode: row.error_code } : {}), ...(row.error_message ? { errorMessage: row.error_message } : {}) };
  }

  private async requestWaiterById(waiterId: string): Promise<RequestWaiterRecord | null> {
    const row = await this.one<RequestWaiterRow>('SELECT * FROM request_waiters WHERE waiter_id = $1', [waiterId]);
    return row ? mapRequestWaiter(row) : null;
  }


  private async statusUpdateOrThrow(statusId: string): Promise<StatusUpdateRecord> {
    const row = await this.one<StatusUpdateRow>(STATUS_UPDATE_SELECT + ' WHERE su.status_id = $1', [statusId]);
    if (!row) throw new Error('Status Update not found');
    return this.mapStatusUpdate(row);
  }

  private async mapStatusUpdate(row: StatusUpdateRow): Promise<StatusUpdateRecord> {
    const recipientUserIds = (await this.all<{ user_id: string }>('SELECT user_id FROM status_update_recipients WHERE status_id = $1 ORDER BY created_at ASC', [row.status_id])).map((recipient) => recipient.user_id);
    const semantic = semanticStatusUpdateState(row.state);
    return { statusId: row.status_id, workspaceId: row.workspace_id, ...(row.agent_token_id ? { agentTokenId: row.agent_token_id } : {}), ...(row.agent_token_label ? { agentTokenLabel: row.agent_token_label } : {}), ...(row.routing_rule_id ? { routingRuleId: row.routing_rule_id } : {}), ...(row.thread_id ? { threadId: row.thread_id } : {}), ...(row.session_id ? { sessionId: row.session_id } : {}), session: JSON.parse(row.session_metadata_json || '{}'), message: row.message, state: row.state, ...(semantic ? { semanticState: semantic } : {}), stateBehavior: statusUpdateStateBehavior(row.state), ...(row.next_step ? { nextStep: row.next_step } : {}), ...(row.host ? { host: row.host } : {}), ...(row.working_directory ? { workingDirectory: row.working_directory } : {}), ...(row.client_name ? { clientName: row.client_name } : {}), metadata: JSON.parse(row.metadata_json || '{}'), recipientUserIds, createdAt: row.created_at, isTest: row.is_test, ...(row.test_label ? { testLabel: row.test_label } : {}) };
  }

  private async deviceOrThrow(deviceId: string, userId: string): Promise<DeviceRecord> {
    const device = await this.getDeviceForUser(deviceId, userId);
    if (!device) throw new Error('Device not found');
    return device;
  }

  private async retireDuplicateDevicesForInstallation(userId: string, installationId: string, keepDeviceId: string, now: string): Promise<number> {
    return (await this.db.query(`UPDATE approval_devices SET expo_push_token = NULL, unregistered_at = COALESCE(unregistered_at, $1), updated_at = $2 WHERE user_id = $3 AND installation_id = $4 AND device_id <> $5`, [now, now, userId, installationId, keepDeviceId])).rowCount ?? 0;
  }

  private async ensureUserExists(userId: string, now: string): Promise<void> {
    await this.db.query(`INSERT INTO users(id, email, email_verified, name, created_at, updated_at) VALUES ($1, '', false, $2, $3, $4) ON CONFLICT (id) DO NOTHING`, [userId, userId, now, now]);
    await this.ensurePersonalWorkspaceForUser(userId, now);
  }

  private async ensurePersonalWorkspaceForUser(userId: string, now: string): Promise<void> {
    const existing = await this.one<{ workspace_id: string }>(`SELECT w.workspace_id FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.workspace_id WHERE w.type = 'personal' AND wm.user_id = $1 LIMIT 1`, [userId]);
    if (existing) return;
    const workspaceId = userId === DEFAULT_USER_ID ? DEFAULT_WORKSPACE_ID : id('wsp');
    await this.db.query(`INSERT INTO workspaces(workspace_id, type, name, created_at, updated_at) VALUES ($1, 'personal', 'Personal', $2, $3) ON CONFLICT (workspace_id) DO NOTHING`, [workspaceId, now, now]);
    await this.db.query(`INSERT INTO workspace_members(workspace_id, user_id, role, status, created_at, updated_at) VALUES ($1, $2, 'owner', 'active', $3, $4) ON CONFLICT (workspace_id, user_id) DO NOTHING`, [workspaceId, userId, now, now]);
    await this.ensurePersonalEntitlementRow(userId, now);
  }

  private async ensurePersonalEntitlementRow(userId: string, now: string): Promise<void> {
    await this.db.query(`INSERT INTO personal_entitlements(user_id, trial_started_at, created_at, updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO NOTHING`, [userId, now, now, now]);
  }

  private async workspaceMemberOrThrow(userId: string, workspaceId: string): Promise<WorkspaceMemberRecord> {
    const row = await this.workspaceMembershipForUserAnyStatus(userId, workspaceId);
    if (!row) throw new Error('Workspace Member not found');
    return row;
  }

  private async workspaceRow(workspaceId: string): Promise<WorkspaceRow | null> {
    return this.one<WorkspaceRow>('SELECT * FROM workspaces WHERE workspace_id = $1', [workspaceId]);
  }

  private async mapRoutingRule(row: RoutingRuleRow): Promise<RoutingRuleRecord> {
    const recipientUserIds = (await this.all<{ user_id: string }>('SELECT user_id FROM routing_rule_recipients WHERE routing_rule_id = $1 ORDER BY created_at ASC', [row.routing_rule_id])).map((recipient) => recipient.user_id);
    return RoutingRuleRecordSchema.parse({
      routingRuleId: row.routing_rule_id,
      workspaceId: row.workspace_id,
      name: row.name,
      requiredResponseMode: row.required_response_mode,
      requiredResponseCount: requiredCount(row.required_response_mode, row.required_response_count, recipientUserIds.length),
      recipientUserIds,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  private async externalApproverOrThrow(externalApproverId: string): Promise<ExternalApproverRecord> {
    const row = await this.one<ExternalApproverRow>('SELECT * FROM external_approvers WHERE external_approver_id = $1', [externalApproverId]);
    if (!row) throw new Error('External Approver not found');
    return mapExternalApprover(row);
  }

  private async externalApproverInviteOrThrow(inviteId: string): Promise<ExternalApproverInviteRecord> {
    const row = await this.one<ExternalApproverInviteRow>(EXTERNAL_APPROVER_INVITE_SELECT + ' WHERE eai.invite_id = $1', [inviteId]);
    if (!row) throw new Error('External Approver invite not found');
    return mapExternalApproverInvite(row);
  }

  private async agentTokenOrThrow(agentTokenId: string): Promise<AgentTokenRecord> {
    const row = await this.one<AgentTokenRow>(AGENT_TOKEN_SELECT + ' WHERE at.agent_token_id = $1', [agentTokenId]);
    if (!row) throw new Error('Agent Token not found');
    return mapAgentToken(row);
  }

  private async personalEntitlementOrThrow(userId: string): Promise<PersonalEntitlementRecord> {
    const row = await this.one<PersonalEntitlementRow>('SELECT * FROM personal_entitlements WHERE user_id = $1', [userId]);
    if (!row) throw new Error('Personal entitlement not found');
    return mapPersonalEntitlement(row);
  }

  private async billingAttemptOrThrow(attemptId: string): Promise<BillingPurchaseAttemptRecord> {
    const row = await this.one<BillingAttemptRow>('SELECT * FROM billing_purchase_attempts WHERE id = $1', [attemptId]);
    if (!row) throw new Error('Billing purchase attempt not found');
    return mapBillingAttempt(row);
  }

  private async findBillingTransaction(input: UpsertBillingTransactionInput): Promise<BillingTransactionRow | null> {
    if (input.providerTransactionId) return this.one<BillingTransactionRow>('SELECT * FROM billing_transactions WHERE provider = $1 AND provider_transaction_id = $2', [input.provider, input.providerTransactionId]);
    if (input.providerPurchaseToken) return this.one<BillingTransactionRow>('SELECT * FROM billing_transactions WHERE provider = $1 AND provider_purchase_token = $2', [input.provider, input.providerPurchaseToken]);
    return null;
  }

  private async billingTransactionOrThrow(transactionId: string): Promise<BillingTransactionRow> {
    const row = await this.one<BillingTransactionRow>('SELECT * FROM billing_transactions WHERE id = $1', [transactionId]);
    if (!row) throw new Error('Billing transaction not found');
    return row;
  }

  private async billingReceiptOwnerOrThrow(provider: string, environment: string, platform: string, entitlementKey: string, receiptKey: string): Promise<BillingReceiptOwnerRecord> {
    const row = await this.one<BillingReceiptOwnerRow>(`SELECT * FROM billing_receipt_owners WHERE provider = $1 AND environment = $2 AND platform = $3 AND entitlement_key = $4 AND receipt_key = $5`, [provider, environment, platform, entitlementKey, receiptKey]);
    if (!row) throw new Error('Billing receipt owner not found');
    return mapBillingReceiptOwner(row);
  }

  private async billingIdentityConflictOrThrow(conflictId: string): Promise<BillingIdentityConflictRow> {
    const row = await this.one<BillingIdentityConflictRow>('SELECT * FROM billing_identity_conflicts WHERE id = $1', [conflictId]);
    if (!row) throw new Error('Billing identity conflict not found');
    return row;
  }

  private async deleteOlderThan(table: string, column: string, days: number | undefined, now: string, extraWhere = 'true'): Promise<number> {
    if (days === undefined) return 0;
    const cutoff = new Date(Date.parse(now) - days * 24 * 60 * 60 * 1000).toISOString();
    return (await this.db.query(`DELETE FROM ${table} WHERE ${extraWhere} AND ${column} IS NOT NULL AND ${column} < $1`, [cutoff])).rowCount ?? 0;
  }

  private async one<Row>(sql: string, params: unknown[] = []): Promise<Row | null> {
    return (await this.db.query(sql, params)).rows[0] as Row | undefined ?? null;
  }

  private async all<Row>(sql: string, params: unknown[] = []): Promise<Row[]> {
    return (await this.db.query(sql, params)).rows as Row[];
  }

}

interface UserRow { id: string; email: string | null; email_verified: boolean; name: string | null; sign_in_method: string | null }
interface WorkspaceRow { workspace_id: string; type: string; name: string; clerk_organization_id: string | null; responses_entitled_until: string | null; created_at: string; updated_at: string }
interface WorkspaceMemberRow extends WorkspaceRow { user_id: string; role: string; status: string; member_kind: string; email: string | null; display_name: string | null; clerk_membership_id: string | null }
interface RoutingRuleRow { routing_rule_id: string; workspace_id: string; name: string; required_response_mode: string; required_response_count: number; created_at: string; updated_at: string }
interface AudienceChannelRow { channel_id: string; workspace_id: string; name: string; slug: string | null; visibility: string; status: string; created_by_user_id: string; created_at: string; updated_at: string }
interface AudienceSubscriptionRow { channel_id: string; user_id: string; status: string; created_at: string; updated_at: string }
interface ExternalApproverRow { external_approver_id: string; workspace_id: string; external_subject: string | null; display_name: string | null; user_id: string | null; routing_rule_id: string | null; agent_token_id: string | null; created_by_user_id: string; created_at: string; updated_at: string }
interface ExternalApproverInviteRow { invite_id: string; workspace_id: string; workspace_name: string | null; external_approver_id: string | null; external_subject: string | null; display_name: string | null; created_by_user_id: string; accepted_by_user_id: string | null; expires_at: string; accepted_at: string | null; revoked_at: string | null; created_at: string; updated_at: string }
interface AgentTokenRow { agent_token_id: string; workspace_id: string; workspace_type: string; creator_user_id: string | null; routing_rule_id: string | null; bound_recipient_user_id: string | null; label: string; scopes_json: string; last_activity_at: string | null; last_check_in_at: string | null; created_at: string; revoked_at: string | null }
interface RequestRow { id: string; workspace_id: string; workspace_type: string; workspace_responses_entitled_until: string | null; agent_token_id: string | null; routing_rule_id: string | null; session_id: string | null; session_metadata_json: string; requester_json: string; request_type: string; delivery_kind: string; response_policy: string; audience_channel_id: string | null; closes_at: string | null; tie_policy: string | null; aggregate_result_json: string | null; title: string; body: string | null; command: string | null; choices_json: string; questions_json: string; default_choice: string | null; allow_freeform_reply: boolean; deadline: string | null; risk: string | null; metadata_json: string; status: string; required_response_count: number; created_at: string; responded_at: string | null; response_json: string | null; final_choice_id: string | null; is_test: boolean; test_label: string | null }
interface RequestRecipientRow { request_id: string; user_id: string; has_active_device: boolean; responded_at: string | null; created_at: string; updated_at: string }
interface ResponseRow { response_id: string; request_id: string; user_id: string; source: string; choice_id: string | null; message: string | null; answers_json: string | null; final: boolean; created_at: string }
interface RequestWaiterRow { waiter_id: string; request_id: string; workspace_id: string; agent_token_id: string; client_run_id: string | null; transport: string; state: string; last_seen_at: string; lease_expires_at: string; credential_expires_at: string; stopped_at: string | null; stop_reason: string | null; error_code: string | null; error_message: string | null; created_at: string; updated_at: string }
interface WaiterTokenRow { token_hash: string; waiter_id: string; request_id: string; workspace_id: string; agent_token_id: string; expires_at: string; created_at: string; last_used_at: string | null }
interface StatusUpdateRow { status_id: string; workspace_id: string; agent_token_id: string | null; agent_token_label: string | null; routing_rule_id: string | null; thread_id: string | null; session_id: string | null; session_metadata_json: string; message: string; state: string; next_step: string | null; host: string | null; working_directory: string | null; client_name: string | null; metadata_json: string; created_at: string; is_test: boolean; test_label: string | null }
interface DeviceRow { device_id: string; user_id: string; name: string; platform: string | null; installation_id: string | null; expo_push_token: string | null; created_at: string; updated_at: string; unregistered_at: string | null }
interface PairingRow { user_id: string; workspace_id: string }
interface EventTicketRow { source: string; workspace_id: string; user_id: string }
interface AvailabilityRow { user_id: string; workspace_id: string; state: string; last_seen_at: string | null; updated_at: string }
interface MobileDiagnosticRow { diagnostic_id: string; workspace_id: string; user_id: string; device_id: string | null; level: string; area: string; message: string; metadata_json: string; created_at: string }
interface AuditRow { event_id: number | string; workspace_id: string; user_id: string; event_type: string; target_id: string; payload_json: string; created_at: string }
interface PersonalEntitlementRow { user_id: string; trial_started_at: string; app_unlocked_at: string | null; hosted_subscription_ends_at: string | null; hosted_subscription_canceled_at: string | null; hosted_data_deleted_at: string | null; created_at: string; updated_at: string }
interface BillingProductRow { id: string; product_key: string; kind: string; entitlement_key: string; apple_product_id: string | null; google_product_id: string | null; google_base_plan_id: string | null; active: boolean; created_at: string; updated_at: string }
interface BillingAttemptRow { id: string; user_id: string; product_key: string; product_group: string; platform: string; provider: string; status: string; provider_user_id: string | null; idempotency_key: string; expires_at: string; created_at: string; updated_at: string }
interface BillingTransactionRow { id: string; user_id: string; provider: string; environment: string; product_key: string; entitlement_key: string; platform: string; provider_transaction_id: string | null; provider_original_transaction_id: string | null; provider_purchase_token: string | null; status: string; purchased_at: string | null; expires_at: string | null; canceled_at: string | null; revoked_at: string | null; raw_event_json: string | null; created_at: string; updated_at: string }
interface BillingReceiptOwnerRow { provider: string; environment: string; platform: string; entitlement_key: string; receipt_key: string; product_key: string; owner_user_id: string; first_seen_at: string; last_seen_at: string }
interface BillingIdentityConflictRow { id: string; user_id: string; provider: string; environment: string; platform: string; product_key: string; entitlement_key: string; receipt_key: string; code: string; created_at: string; updated_at: string }

const WORKSPACE_MEMBER_SELECT = `
  SELECT w.workspace_id, w.type, w.name, w.clerk_organization_id, w.created_at, w.updated_at,
         wm.user_id, wm.role, wm.status, wm.member_kind, wm.clerk_membership_id,
         u.email, u.name AS display_name
  FROM workspace_members wm
  JOIN workspaces w ON w.workspace_id = wm.workspace_id
  JOIN users u ON u.id = wm.user_id
`;

const EXTERNAL_APPROVER_INVITE_SELECT = `
  SELECT eai.*, w.name AS workspace_name
  FROM external_approver_invites eai
  JOIN workspaces w ON w.workspace_id = eai.workspace_id
`;

const REQUEST_SELECT = `SELECT r.*, w.type AS workspace_type, w.responses_entitled_until AS workspace_responses_entitled_until FROM requests r JOIN workspaces w ON w.workspace_id = r.workspace_id`;

const STATUS_UPDATE_SELECT = `
  SELECT su.*, at.label AS agent_token_label
  FROM status_updates su
  LEFT JOIN agent_tokens at ON at.agent_token_id = su.agent_token_id
`;

const AGENT_TOKEN_SELECT = `
  SELECT at.agent_token_id, at.workspace_id, w.type AS workspace_type, at.creator_user_id, at.routing_rule_id, at.bound_recipient_user_id, at.label, at.scopes_json, at.last_activity_at, at.last_check_in_at, at.created_at, at.revoked_at
  FROM agent_tokens at
  JOIN workspaces w ON w.workspace_id = at.workspace_id
`;

function mapUserProfile(row: UserRow): UserProfileRecord {
  return { userId: row.id, ...(row.email ? { email: row.email } : {}), ...(row.name ? { name: row.name } : {}), ...(row.sign_in_method ? { signInMethod: row.sign_in_method } : {}) };
}

function mapWorkspace(row: WorkspaceRow): WorkspaceRecord {
  return { workspaceId: row.workspace_id, type: row.type as WorkspaceType, name: row.name, ...(row.clerk_organization_id ? { clerkOrganizationId: row.clerk_organization_id } : {}), ...(row.responses_entitled_until ? { responsesEntitledUntil: row.responses_entitled_until } : {}), createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapWorkspaceMember(row: WorkspaceMemberRow): WorkspaceMemberRecord {
  return { ...mapWorkspace(row), userId: row.user_id, role: row.role, status: row.status, memberKind: row.member_kind as WorkspaceMemberKind, ...(row.email ? { email: row.email } : {}), ...(row.display_name ? { displayName: row.display_name } : {}), ...(row.clerk_membership_id ? { clerkMembershipId: row.clerk_membership_id } : {}) };
}

function mapAudienceChannel(row: AudienceChannelRow): AudienceChannelRecord {
  return { channelId: row.channel_id, workspaceId: row.workspace_id, name: row.name, ...(row.slug ? { slug: row.slug } : {}), visibility: row.visibility as 'public' | 'invite_only', status: row.status, createdByUserId: row.created_by_user_id, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapAudienceSubscription(row: AudienceSubscriptionRow): AudienceSubscriptionRecord {
  return { channelId: row.channel_id, userId: row.user_id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapExternalApprover(row: ExternalApproverRow): ExternalApproverRecord {
  return { externalApproverId: row.external_approver_id, workspaceId: row.workspace_id, ...(row.external_subject ? { externalSubject: row.external_subject } : {}), ...(row.display_name ? { displayName: row.display_name } : {}), ...(row.user_id ? { userId: row.user_id } : {}), ...(row.routing_rule_id ? { routingRuleId: row.routing_rule_id } : {}), ...(row.agent_token_id ? { agentTokenId: row.agent_token_id } : {}), createdByUserId: row.created_by_user_id, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapExternalApproverInvite(row: ExternalApproverInviteRow): ExternalApproverInviteRecord {
  return { inviteId: row.invite_id, workspaceId: row.workspace_id, ...(row.workspace_name ? { workspaceName: row.workspace_name } : {}), ...(row.external_approver_id ? { externalApproverId: row.external_approver_id } : {}), ...(row.external_subject ? { externalSubject: row.external_subject } : {}), ...(row.display_name ? { displayName: row.display_name } : {}), ...(row.accepted_by_user_id ? { acceptedByUserId: row.accepted_by_user_id } : {}), expiresAt: row.expires_at, ...(row.accepted_at ? { acceptedAt: row.accepted_at } : {}), ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}), createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapAgentToken(row: AgentTokenRow): AgentTokenRecord {
  return { agentTokenId: row.agent_token_id, workspaceId: row.workspace_id, workspaceType: row.workspace_type as WorkspaceType, ...(row.creator_user_id ? { creatorUserId: row.creator_user_id } : {}), ...(row.routing_rule_id ? { routingRuleId: row.routing_rule_id } : {}), ...(row.bound_recipient_user_id ? { boundRecipientUserId: row.bound_recipient_user_id } : {}), label: row.label, scopes: JSON.parse(row.scopes_json) as string[], ...(row.last_activity_at ? { lastActivityAt: row.last_activity_at } : {}), ...(row.last_check_in_at ? { lastCheckInAt: row.last_check_in_at } : {}), createdAt: row.created_at, ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}) };
}



function mapDevice(row: DeviceRow): DeviceRecord {
  return { deviceId: row.device_id, userId: row.user_id, name: row.name, ...(row.platform ? { platform: row.platform } : {}), ...(row.installation_id ? { installationId: row.installation_id } : {}), ...(row.expo_push_token ? { expoPushToken: row.expo_push_token } : {}), createdAt: row.created_at, updatedAt: row.updated_at, ...(row.unregistered_at ? { unregisteredAt: row.unregistered_at } : {}) };
}

function uniqueDevicesByPushToken(rows: DeviceRow[]): DeviceRecord[] {
  const seen = new Set<string>();
  const devices: DeviceRecord[] = [];
  for (const row of rows) {
    if (!row.expo_push_token || seen.has(row.expo_push_token)) continue;
    seen.add(row.expo_push_token);
    devices.push(mapDevice(row));
  }
  return devices;
}

function mapAvailability(row: AvailabilityRow): AvailabilityRecord {
  return { userId: row.user_id, workspaceId: row.workspace_id, state: row.state, ...(row.last_seen_at ? { lastSeenAt: row.last_seen_at } : {}), updatedAt: row.updated_at };
}

function mapMobileDiagnostic(row: MobileDiagnosticRow): MobileDiagnosticRecord {
  return { diagnosticId: row.diagnostic_id, workspaceId: row.workspace_id, userId: row.user_id, ...(row.device_id ? { deviceId: row.device_id } : {}), level: row.level, area: row.area, message: row.message, metadata: JSON.parse(row.metadata_json || '{}'), createdAt: row.created_at };
}

function mapAuditEvent(row: AuditRow): AuditEventRecord {
  return { eventId: Number(row.event_id), workspaceId: row.workspace_id, userId: row.user_id, eventType: row.event_type, targetId: row.target_id, payload: JSON.parse(row.payload_json || '{}'), createdAt: row.created_at };
}

function mapRequestRecipient(row: RequestRecipientRow): RequestRecipient {
  return { userId: row.user_id, hasActiveDevice: row.has_active_device, ...(row.responded_at ? { respondedAt: row.responded_at } : {}) };
}

function mapResponse(row: ResponseRow): ResponseRecord {
  return { responseId: row.response_id, requestId: row.request_id, userId: row.user_id, source: row.source, ...(row.choice_id ? { choiceId: row.choice_id } : {}), ...(row.message ? { message: row.message } : {}), ...(row.answers_json ? { answers: JSON.parse(row.answers_json) } : {}), final: row.final, createdAt: row.created_at };
}

function mapRequestWaiter(row: RequestWaiterRow): RequestWaiterRecord {
  return { waiterId: row.waiter_id, requestId: row.request_id, workspaceId: row.workspace_id, agentTokenId: row.agent_token_id, ...(row.client_run_id ? { clientRunId: row.client_run_id } : {}), transport: row.transport, state: row.state, lastSeenAt: row.last_seen_at, leaseExpiresAt: row.lease_expires_at, credentialExpiresAt: row.credential_expires_at, ...(row.stopped_at ? { stoppedAt: row.stopped_at } : {}), ...(row.stop_reason ? { stopReason: row.stop_reason } : {}), ...(row.error_code ? { errorCode: row.error_code } : {}), ...(row.error_message ? { errorMessage: row.error_message } : {}), createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapPersonalEntitlement(row: PersonalEntitlementRow): PersonalEntitlementRecord {
  return { userId: row.user_id, trialStartedAt: row.trial_started_at, ...(row.app_unlocked_at ? { appUnlockedAt: row.app_unlocked_at } : {}), ...(row.hosted_subscription_ends_at ? { hostedSubscriptionEndsAt: row.hosted_subscription_ends_at } : {}), ...(row.hosted_subscription_canceled_at ? { hostedSubscriptionCanceledAt: row.hosted_subscription_canceled_at } : {}), ...(row.hosted_data_deleted_at ? { hostedDataDeletedAt: row.hosted_data_deleted_at } : {}), createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapBillingProduct(row: BillingProductRow): BillingProductRecord {
  return { id: row.id, productKey: row.product_key, kind: row.kind, entitlementKey: row.entitlement_key, ...(row.apple_product_id ? { appleProductId: row.apple_product_id } : {}), ...(row.google_product_id ? { googleProductId: row.google_product_id } : {}), ...(row.google_base_plan_id ? { googleBasePlanId: row.google_base_plan_id } : {}), active: row.active, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapBillingAttempt(row: BillingAttemptRow): BillingPurchaseAttemptRecord {
  return { attemptId: row.id, userId: row.user_id, productKey: row.product_key, productGroup: row.product_group, platform: row.platform, provider: row.provider, status: row.status, ...(row.provider_user_id ? { providerUserId: row.provider_user_id } : {}), idempotencyKey: row.idempotency_key, expiresAt: row.expires_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

function billingTransactionReceiptKey(row: BillingTransactionRow): string | null {
  return row.provider_original_transaction_id ?? row.provider_purchase_token ?? row.provider_transaction_id ?? null;
}

function mapBillingTransaction(row: BillingTransactionRow): BillingTransactionRecord {
  return { transactionId: row.id, userId: row.user_id, provider: row.provider, environment: row.environment, productKey: row.product_key, entitlementKey: row.entitlement_key, platform: row.platform, ...(row.provider_transaction_id ? { providerTransactionId: row.provider_transaction_id } : {}), ...(row.provider_original_transaction_id ? { providerOriginalTransactionId: row.provider_original_transaction_id } : {}), ...(row.provider_purchase_token ? { providerPurchaseToken: row.provider_purchase_token } : {}), status: row.status, ...(row.purchased_at ? { purchasedAt: row.purchased_at } : {}), ...(row.expires_at ? { expiresAt: row.expires_at } : {}), ...(row.canceled_at ? { canceledAt: row.canceled_at } : {}), ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}), ...(row.raw_event_json ? { rawEventJSON: row.raw_event_json } : {}), createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapBillingReceiptOwner(row: BillingReceiptOwnerRow): BillingReceiptOwnerRecord {
  return { provider: row.provider, environment: row.environment, platform: row.platform, entitlementKey: row.entitlement_key, receiptKey: row.receipt_key, productKey: row.product_key, ownerUserId: row.owner_user_id, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at };
}

function mapBillingIdentityConflict(row: BillingIdentityConflictRow): BillingIdentityConflictRecord {
  return { conflictId: row.id, userId: row.user_id, provider: row.provider, environment: row.environment, platform: row.platform, productKey: row.product_key, entitlementKey: row.entitlement_key, receiptKey: row.receipt_key, code: row.code, createdAt: row.created_at, updatedAt: row.updated_at };
}

function defaultChoices(requestType: string, choices: Choice[] | undefined): Choice[] {
  if (choices?.length) return choices;
  if (requestType === 'steering') return [{ id: 'option_a', label: 'Option A', kind: 'approve' }, { id: 'option_b', label: 'Option B', kind: 'approve' }, { id: 'cancel', label: 'Cancel', kind: 'deny' }];
  return [{ id: 'approve', label: 'Approve', kind: 'approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }];
}

function assertValidWorkspaceMemberKind(role: WorkspaceRole | string, memberKind: WorkspaceMemberKind): void {
  if (memberKind === 'external_approver' && role !== 'member') throw new Error('External approvers must use the member role');
}

function assertValidRoutingRuleRecipients(memberships: HumanIdentityResult[], requiredResponseMode: string, requiredResponseCount: number): void {
  const externalApprovers = memberships.filter((membership) => membership.memberKind === 'external_approver');
  if (!externalApprovers.length) return;
  if (memberships.length !== 1) throw new Error('Routing Rules with External Approvers must have exactly one recipient');
  if (requiredResponseMode !== 'any_one' || requiredResponseCount !== 1) throw new Error('Routing Rules with External Approvers must require exactly one response');
}

function requiredCount(mode: string, requested: number, recipientCount: number): number {
  if (mode === 'all') return recipientCount;
  if (mode === 'any_one') return 1;
  return Math.min(Math.max(1, requested), recipientCount);
}

function unique(values: string[]): string[] { return [...new Set(values)]; }
function coalesceNullableInput(value: string | null | undefined, fallback: string | undefined): string | null { return value === undefined ? fallback ?? null : value; }
function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }
function id(prefix: string): string { return `${prefix}_${crypto.randomBytes(12).toString('base64url')}`; }
function hashSecret(secret: string): string { return crypto.createHash('sha256').update(secret).digest('base64url'); }
function addMs(value: string, ms: number): string { return new Date(Date.parse(value) + ms).toISOString(); }
function externalApproverInviteDeepLink(token: string, publicURL?: string): string { return `${publicURL?.replace(/\/$/, '') ?? 'agent-tick://external-approver-invite'}/external-approver-invites/${token}`; }

function groupBy<Row>(rows: Row[], keyFor: (row: Row) => string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

function clampLimit(value: number, max = 100): number { return Math.max(1, Math.min(Math.floor(value), max)); }
