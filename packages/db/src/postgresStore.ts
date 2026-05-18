import crypto from 'node:crypto';
import { type QueryResultRow } from 'pg';
import {
  AgentStatusUpdateSchema,
  ApprovalRequestSchema,
  CreateAgentStatusUpdateSchema,
  CreateApprovalRequestSchema,
  RespondApprovalRequestSchema,
  type AgentStatusUpdate,
  type ApprovalPolicyProgress,
  type ApprovalRequest,
  type ApprovalVoteRecord,
  type Choice,
  type Question,
  type RespondApprovalRequest
} from '@agent-tick/shared';
import { PostgresStoreConnection, type PostgresStoreOptions } from './postgres.js';
import type {
  AgentCredential,
  AgentTokenAuth,
  AcceptInviteResult,
  AgentTokenRecord,
  AsyncAgentTickStore,
  ApprovalWaiterAuth,
  ApprovalWaiterTokenRecord,
  AuditEventRecord,
  CleanupExpiredSecretsResult,
  CleanupRetentionResult,
  ClerkIdentityProfile,
  CreateAgentStatusInput,
  CreateApprovalInput,
  CreateAgentTokenInput,
  DeviceCredential,
  DeviceRecord,
  DeviceRegistrationInput,
  DeleteOrganizationDataResult,
  DeviceTokenAuth,
  EventTicketAuth,
  EventTicketInput,
  EventTicketRecord,
  HumanIdentityResult,
  CreateOrganizationInviteInput,
  CreatePolicyInput,
  CreateProjectInput,
  CreateTeamInput,
  OrganizationMembershipRecord,
  MobileDiagnosticInput,
  InvitePreviewRecord,
  MembershipActivationLimits,
  MobileDiagnosticRecord,
  OrganizationInviteRecord,
  OrganizationMembershipRequestRecord,
  OrganizationSeatUsage,
  PairingTokenRecord,
  PolicyRecord,
  ProjectRecord,
  RemoveTeamMemberInput,
  RetentionPolicy,
  TeamMembershipRecord,
  TeamRecord,
  UpdatePolicyInput,
  UpsertTeamMemberInput,
  UserProfileRecord,
  AvailabilityRecord,
  BillingProductRecord,
  BillingPurchaseAttemptRecord,
  BillingTransactionRecord,
  CreateBillingPurchaseAttemptInput,
  PersonalEntitlementRecord,
  UpdatePersonalEntitlementInput,
  UpsertBillingProductInput,
  UpsertBillingTransactionInput,
  UpsertBillingTransactionResult
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

interface OrganizationInviteRow {
  invite_id: string;
  organization_id: string;
  label: string | null;
  role: string;
  approval_required: boolean;
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
  enabled: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface AgentTokenRow {
  agent_id: string;
  name: string;
  scopes_json: string;
  organization_id: string;
  owner_user_id: string | null;
  project_id: string | null;
  team_id: string | null;
  default_approval_policy: string | null;
  last_request_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface PersonalEntitlementRow {
  user_id: string;
  trial_started_at: string;
  app_unlocked_at: string | null;
  included_hosted_activated_at: string | null;
  hosted_subscription_ends_at: string | null;
  hosted_subscription_canceled_at: string | null;
  hosted_data_deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface BillingProductRow {
  id: string;
  product_key: string;
  kind: string;
  entitlement_key: string;
  apple_product_id: string | null;
  google_product_id: string | null;
  google_base_plan_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface BillingPurchaseAttemptRow {
  id: string;
  user_id: string;
  product_key: string;
  product_group: string;
  platform: string;
  provider: string;
  status: string;
  provider_user_id: string | null;
  idempotency_key: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

interface BillingTransactionRow {
  id: string;
  user_id: string;
  provider: string;
  environment: string;
  product_key: string;
  entitlement_key: string;
  platform: string;
  provider_transaction_id: string | null;
  provider_original_transaction_id: string | null;
  provider_purchase_token: string | null;
  status: string;
  purchased_at: string | null;
  expires_at: string | null;
  canceled_at: string | null;
  revoked_at: string | null;
  raw_event_json: string | null;
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
  encrypted_payload_json: string | null;
  choices_json: string;
  questions_json: string;
  default_choice: string | null;
  allow_freeform_reply: boolean;
  expires_at: string | null;
  risk: string | null;
  metadata_json: string;
  status: string;
  created_at: string;
  responded_at: string | null;
  response_json: string | null;
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
}

interface DeviceRow {
  device_id: string;
  user_id: string;
  name: string;
  platform: string | null;
  installation_id: string | null;
  expo_push_token: string | null;
  token_hash: string | null;
  created_at: string;
  updated_at: string;
  unregistered_at: string | null;
}

interface PairingCodeRow {
  token_hash: string;
  user_id: string;
  organization_id: string;
  expires_at: string;
}

interface EventTicketRow {
  source: string;
  organization_id: string;
  user_id: string | null;
  agent_id: string | null;
  expires_at: string;
}

interface ApprovalWaiterTokenRow {
  request_id: string;
  organization_id: string;
  agent_id: string;
  expires_at: string;
}

interface AvailabilityRow {
  user_id: string;
  organization_id: string;
  state: string;
  last_seen_at: string | null;
  updated_at: string;
}

interface AgentStatusRow {
  status_id: string;
  organization_id: string;
  agent_id: string;
  agent_name: string;
  thread_id: string;
  message: string;
  state: string;
  next_step: string | null;
  host: string | null;
  working_directory: string | null;
  project_name: string | null;
  metadata_json: string;
  created_at: string;
}

interface MobileDiagnosticRow {
  diagnostic_id: string;
  organization_id: string;
  user_id: string;
  device_id: string | null;
  level: string;
  area: string;
  message: string;
  metadata_json: string | null;
  created_at: string;
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

export class PostgresAgentTickStore extends PostgresStoreConnection implements AsyncAgentTickStore {
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
      let statusUpdates = 0;
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

      if (policy.statusUpdatesDays !== undefined) {
        const result = await query('DELETE FROM agent_status_updates WHERE created_at <= $1', [retentionCutoff(now, policy.statusUpdatesDays)]);
        statusUpdates = result.rowCount ?? 0;
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

      return { approvalRequests, statusUpdates, auditEvents, devices, organizationInviteTeams, organizationInvites };
    });
  }

  async loginOrCreateClerkIdentity(profile: ClerkIdentityProfile, now = new Date().toISOString()): Promise<HumanIdentityResult> {
    if (!profile.emailVerified || !profile.email.trim()) {
      throw httpError(403, 'forbidden', 'A verified primary email is required');
    }
    const email = profile.email.trim().toLowerCase();
    const existing = await this.one<{ user_id: string }>(
      'SELECT user_id FROM auth_identities WHERE provider = $1 AND issuer = $2 AND subject = $3',
      ['clerk', profile.issuer, profile.subject]
    );

    if (existing) {
      await this.transaction(async (query) => {
        await query(
          'UPDATE auth_identities SET email = $1, email_verified = $2, name = $3, auth_method = $4, last_seen_at = $5, updated_at = $6 WHERE provider = $7 AND issuer = $8 AND subject = $9',
          [email, profile.emailVerified, profile.name, profile.authMethod ?? null, now, now, 'clerk', profile.issuer, profile.subject]
        );
        await query('UPDATE users SET email = $1, email_verified = $2, name = $3, updated_at = $4 WHERE id = $5', [email, profile.emailVerified, profile.name, now, existing.user_id]);
      });
      const membership = await this.defaultMembershipForUser(existing.user_id);
      return { userId: existing.user_id, organizationId: membership.organizationId, role: membership.role };
    }

    const collision = await this.one<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    if (collision) {
      throw httpError(409, 'identity_link_required', 'A local user with this email already exists; explicit identity linking is required');
    }

    const userId = newID('usr');
    const organizationId = newID('org');
    await this.transaction(async (query) => {
      await query('INSERT INTO users(id, email, email_verified, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)', [userId, email, profile.emailVerified, profile.name, now, now]);
      await query(
        'INSERT INTO auth_identities(provider, issuer, subject, user_id, email, email_verified, name, auth_method, first_seen_at, last_seen_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
        ['clerk', profile.issuer, profile.subject, userId, email, profile.emailVerified, profile.name, profile.authMethod ?? null, now, now, now]
      );
      await query('INSERT INTO organizations(id, name, created_at, updated_at) VALUES ($1, $2, $3, $4)', [organizationId, `${profile.name || email}'s Organization`, now, now]);
      await query('INSERT INTO organization_memberships(organization_id, user_id, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)', [organizationId, userId, 'owner', now, now]);
    });
    return { userId, organizationId, role: 'owner' };
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

  async deleteOrganizationData(organizationId: string, now = new Date().toISOString()): Promise<DeleteOrganizationDataResult> {
    return this.transaction(async (query) => {
      const memberRows = await query<{ user_id: string }>('SELECT user_id FROM organization_memberships WHERE organization_id = $1', [organizationId]);
      const memberIds = memberRows.rows.map((row) => row.user_id);
      const agentTokens = await query('UPDATE agent_tokens SET revoked_at = $1 WHERE organization_id = $2 AND revoked_at IS NULL', [now, organizationId]);
      const devices = memberIds.length
        ? await query('UPDATE devices SET unregistered_at = $1, expo_push_token = NULL WHERE unregistered_at IS NULL AND user_id = ANY($2::text[])', [now, memberIds])
        : { rowCount: 0 };
      await query('DELETE FROM approval_votes WHERE request_id IN (SELECT id FROM approval_requests WHERE organization_id = $1)', [organizationId]);
      await query('DELETE FROM approval_recipients WHERE organization_id = $1 OR request_id IN (SELECT id FROM approval_requests WHERE organization_id = $1)', [organizationId]);
      await query('DELETE FROM approval_waiter_tokens WHERE organization_id = $1', [organizationId]);
      await query('DELETE FROM approval_requests WHERE organization_id = $1', [organizationId]);
      await query('DELETE FROM agent_status_updates WHERE organization_id = $1', [organizationId]);
      await query('DELETE FROM audit_events WHERE organization_id = $1', [organizationId]);
      await query('DELETE FROM event_tickets WHERE organization_id = $1', [organizationId]);
      await query('DELETE FROM pairing_codes WHERE organization_id = $1', [organizationId]);
      await query('DELETE FROM user_availability WHERE organization_id = $1', [organizationId]);
      await query('DELETE FROM mobile_diagnostics WHERE organization_id = $1', [organizationId]);
      await query('DELETE FROM organization_invite_acceptances WHERE organization_id = $1', [organizationId]);
      await query('DELETE FROM organization_invite_teams WHERE invite_id IN (SELECT invite_id FROM organization_invites WHERE organization_id = $1)', [organizationId]);
      await query('DELETE FROM organization_invites WHERE organization_id = $1', [organizationId]);
      await query('DELETE FROM team_memberships WHERE organization_id = $1', [organizationId]);
      await query('DELETE FROM policies WHERE organization_id = $1', [organizationId]);
      await query('DELETE FROM teams WHERE organization_id = $1', [organizationId]);
      await query('DELETE FROM projects WHERE organization_id = $1', [organizationId]);
      await query('DELETE FROM agent_tokens WHERE organization_id = $1', [organizationId]);
      await query('DELETE FROM organization_memberships WHERE organization_id = $1', [organizationId]);
      const organizations = await query('DELETE FROM organizations WHERE id = $1', [organizationId]);
      return { organizationId, agentTokensRevoked: agentTokens.rowCount ?? 0, devicesUnregistered: devices.rowCount ?? 0, deleted: (organizations.rowCount ?? 0) > 0 };
    });
  }

  async acceptInvite(token: string, userId: string, now = new Date().toISOString(), limits: MembershipActivationLimits = {}): Promise<AcceptInviteResult | null> {
    const invite = await this.findUsableInvite(token, now);
    if (!invite) return null;
    const user = await this.one<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
    const userEmail = user?.email?.trim().toLowerCase();
    const inviteEmail = invite.email?.trim().toLowerCase();
    if (inviteEmail && userEmail !== inviteEmail) throw httpError(403, 'forbidden', 'This invite is restricted to a different email address');
    const inviteDomain = invite.domain?.trim().toLowerCase();
    if (inviteDomain && domainFromEmail(userEmail) !== inviteDomain) throw httpError(403, 'forbidden', 'This invite is restricted to a different email domain');

    const existing = await this.organizationMembershipForUserAnyStatus(userId, invite.organization_id);
    if (existing?.status === 'active') return { status: 'already_member', membership: existing };
    if (existing?.status === 'pending_approval') return { status: 'pending_approval', membership: existing };

    const previousAcceptance = await this.one<{ status: string }>('SELECT status FROM organization_invite_acceptances WHERE invite_id = $1 AND user_id = $2', [invite.invite_id, userId]);
    if (previousAcceptance?.status === 'rejected') throw httpError(409, 'conflict', 'This invite request was rejected');

    const approvalRequired = Boolean(invite.approval_required);
    const teamIds = await this.listInviteTeamIds(invite.invite_id);
    const requestId = newID('mreq');
    const accepted = await this.transaction(async (query) => {
      const consumed = await query(
        `
          UPDATE organization_invites
          SET used_count = used_count + 1
          WHERE invite_id = $1
            AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > $2)
            AND (max_uses IS NULL OR used_count < max_uses)
        `,
        [invite.invite_id, now]
      );
      if (consumed.rowCount !== 1) return false;
      if (!approvalRequired) await this.assertSeatAvailableForActivation(invite.organization_id, limits.maxActiveMembers);
      await query(
        'INSERT INTO organization_invite_acceptances(request_id, invite_id, organization_id, user_id, requested_role, requested_team_ids_json, status, accepted_at, decided_by_user_id, decided_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [requestId, invite.invite_id, invite.organization_id, userId, invite.role, JSON.stringify(teamIds), approvalRequired ? 'pending_approval' : 'approved', now, approvalRequired ? null : userId, approvalRequired ? null : now]
      );
      if (existing) {
        await query("UPDATE organization_memberships SET role = $1, status = $2, updated_at = $3, approved_by_user_id = $4, approved_at = $5, rejected_by_user_id = NULL, rejected_at = NULL, invite_id = $6 WHERE organization_id = $7 AND user_id = $8", [invite.role, approvalRequired ? 'pending_approval' : 'active', now, approvalRequired ? null : userId, approvalRequired ? null : now, invite.invite_id, invite.organization_id, userId]);
      } else {
        await query('INSERT INTO organization_memberships(organization_id, user_id, role, status, created_at, updated_at, approved_by_user_id, approved_at, invite_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [invite.organization_id, userId, invite.role, approvalRequired ? 'pending_approval' : 'active', now, now, approvalRequired ? null : userId, approvalRequired ? null : now, invite.invite_id]);
      }
      if (!approvalRequired) {
        for (const teamId of teamIds) {
          if (await this.teamBelongsToOrganization(teamId, invite.organization_id)) {
            await query('INSERT INTO team_memberships(team_id, organization_id, user_id, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(team_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at', [teamId, invite.organization_id, userId, 'member', now, now]);
            await query('INSERT INTO audit_events(organization_id, user_id, event_type, target_id, payload_json, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [invite.organization_id, userId, 'team_member.upserted', teamId, JSON.stringify({ userId, role: 'member', source: 'organization_invite', inviteId: invite.invite_id }), now]);
          }
        }
      }
      return true;
    });
    if (!accepted) return null;
    await this.writeAuditEvent(invite.organization_id, userId, 'organization_invite.accepted', invite.invite_id, { role: invite.role, approvalRequired, teamIds }, now);
    await this.writeAuditEvent(invite.organization_id, userId, approvalRequired ? 'organization_membership.pending' : 'organization_membership.approved', requestId, approvalRequired ? { inviteId: invite.invite_id, role: invite.role, teamIds } : { inviteId: invite.invite_id, role: invite.role, teamIds, autoApproved: true }, now);
    const membership = (await this.organizationMembershipForUserAnyStatus(userId, invite.organization_id)) ?? missingOrganization(invite.organization_id);
    return { status: approvalRequired ? 'pending_approval' : 'joined', membership };
  }

  async listOrganizationMembershipRequests(organizationId: string, status = 'pending_approval'): Promise<OrganizationMembershipRequestRecord[]> {
    const rows = await this.membershipRequestRows('a.organization_id = $1 AND a.status = $2', [organizationId, status], 'a.accepted_at ASC');
    return rows.map(mapOrganizationMembershipRequestRow);
  }

  async listOrganizationMembershipRequestsForUser(userId: string): Promise<OrganizationMembershipRequestRecord[]> {
    const rows = await this.membershipRequestRows("a.user_id = $1 AND a.status IN ('pending_approval', 'rejected')", [userId], 'a.accepted_at DESC');
    return rows.map(mapOrganizationMembershipRequestRow);
  }

  async getOrganizationMembershipRequest(requestId: string, organizationId: string): Promise<OrganizationMembershipRequestRecord | null> {
    const rows = await this.membershipRequestRows('a.request_id = $1 AND a.organization_id = $2', [requestId, organizationId], 'a.accepted_at ASC');
    return rows[0] ? mapOrganizationMembershipRequestRow(rows[0]) : null;
  }

  async approveOrganizationMembershipRequest(requestId: string, organizationId: string, actorUserId: string, now = new Date().toISOString(), limits: MembershipActivationLimits = {}): Promise<OrganizationMembershipRequestRecord | null> {
    const existing = await this.getOrganizationMembershipRequest(requestId, organizationId);
    if (!existing || existing.status !== 'pending_approval') return null;
    const changed = await this.transaction(async (query) => {
      await this.assertSeatAvailableForActivation(organizationId, limits.maxActiveMembers);
      const acceptance = await query("UPDATE organization_invite_acceptances SET status = 'approved', decided_by_user_id = $1, decided_at = $2 WHERE request_id = $3 AND organization_id = $4 AND status = 'pending_approval'", [actorUserId, now, requestId, organizationId]);
      if (acceptance.rowCount !== 1) return false;
      const membership = await query("UPDATE organization_memberships SET role = $1, status = 'active', updated_at = $2, approved_by_user_id = $3, approved_at = $4, rejected_by_user_id = NULL, rejected_at = NULL WHERE organization_id = $5 AND user_id = $6 AND status = 'pending_approval'", [existing.requestedRole, now, actorUserId, now, organizationId, existing.userId]);
      if (membership.rowCount !== 1) throw new Error('pending membership was not updated');
      for (const teamId of existing.requestedTeamIds) {
        if (await this.teamBelongsToOrganization(teamId, organizationId)) {
          await query('INSERT INTO team_memberships(team_id, organization_id, user_id, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(team_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at', [teamId, organizationId, existing.userId, 'member', now, now]);
          await query('INSERT INTO audit_events(organization_id, user_id, event_type, target_id, payload_json, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [organizationId, actorUserId, 'team_member.upserted', teamId, JSON.stringify({ userId: existing.userId, role: 'member', source: 'organization_invite', inviteId: existing.inviteId }), now]);
        }
      }
      return true;
    });
    if (!changed) return null;
    await this.writeAuditEvent(organizationId, actorUserId, 'organization_membership.approved', requestId, { inviteId: existing.inviteId, userId: existing.userId, role: existing.requestedRole, teamIds: existing.requestedTeamIds }, now);
    return this.getOrganizationMembershipRequest(requestId, organizationId);
  }

  async rejectOrganizationMembershipRequest(requestId: string, organizationId: string, actorUserId: string, now = new Date().toISOString()): Promise<OrganizationMembershipRequestRecord | null> {
    const existing = await this.getOrganizationMembershipRequest(requestId, organizationId);
    if (!existing || existing.status !== 'pending_approval') return null;
    const changed = await this.transaction(async (query) => {
      const acceptance = await query("UPDATE organization_invite_acceptances SET status = 'rejected', decided_by_user_id = $1, decided_at = $2 WHERE request_id = $3 AND organization_id = $4 AND status = 'pending_approval'", [actorUserId, now, requestId, organizationId]);
      if (acceptance.rowCount !== 1) return false;
      const membership = await query("UPDATE organization_memberships SET status = 'rejected', updated_at = $1, rejected_by_user_id = $2, rejected_at = $3 WHERE organization_id = $4 AND user_id = $5 AND status = 'pending_approval'", [now, actorUserId, now, organizationId, existing.userId]);
      if (membership.rowCount !== 1) throw new Error('pending membership was not updated');
      return true;
    });
    if (!changed) return null;
    await this.writeAuditEvent(organizationId, actorUserId, 'organization_membership.rejected', requestId, { inviteId: existing.inviteId, userId: existing.userId, role: existing.requestedRole, teamIds: existing.requestedTeamIds }, now);
    return this.getOrganizationMembershipRequest(requestId, organizationId);
  }

  async listProjects(organizationId = DEFAULT_ORGANIZATION_ID): Promise<ProjectRecord[]> {
    const rows = await this.many<ProjectRow>(
      'SELECT * FROM projects WHERE organization_id = $1 ORDER BY archived_at IS NOT NULL, lower(name) ASC',
      [organizationId]
    );
    return rows.map(mapProjectRow);
  }

  async listOrganizationInvites(organizationId: string): Promise<OrganizationInviteRecord[]> {
    const rows = await this.many<OrganizationInviteRow>('SELECT * FROM organization_invites WHERE organization_id = $1 ORDER BY created_at DESC', [organizationId]);
    return Promise.all(rows.map(async (row) => mapOrganizationInviteRow(row, await this.listInviteTeamIds(row.invite_id))));
  }

  async createOrganizationInvite(input: CreateOrganizationInviteInput, now = new Date().toISOString()): Promise<OrganizationInviteRecord> {
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
      if (!(await this.teamBelongsToOrganization(teamId, input.organizationId))) throw httpError(400, 'bad_request', 'Team is not in the selected organization');
    }
    await this.transaction(async (query) => {
      await query(
        'INSERT INTO organization_invites(invite_id, organization_id, created_by_user_id, label, role, approval_required, token_hash, email, domain, expires_at, max_uses, used_count, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
        [inviteId, input.organizationId, input.userId, input.label?.trim() || null, role, approvalRequired, hashToken(token), email ?? null, domain ?? null, input.expiresAt ?? null, maxUses, 0, now]
      );
      for (const teamId of teamIds) await query('INSERT INTO organization_invite_teams(invite_id, team_id) VALUES ($1, $2)', [inviteId, teamId]);
      await query('INSERT INTO audit_events(organization_id, user_id, event_type, target_id, payload_json, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
        input.organizationId,
        input.userId,
        'organization_invite.created',
        inviteId,
        JSON.stringify({ role, approvalRequired, teamIds, email, domain }),
        now
      ]);
    });
    const invite = (await this.getOrganizationInvite(inviteId)) ?? missingInvite(inviteId);
    return { ...invite, token, ...(input.publicURL ? { url: `${input.publicURL.replace(/\/+$/, '')}/invite/${encodeURIComponent(token)}` } : {}) };
  }

  async getOrganizationInvite(inviteId: string): Promise<OrganizationInviteRecord | null> {
    const row = await this.one<OrganizationInviteRow>('SELECT * FROM organization_invites WHERE invite_id = $1', [inviteId]);
    return row ? mapOrganizationInviteRow(row, await this.listInviteTeamIds(inviteId)) : null;
  }

  async organizationName(organizationId: string): Promise<string | undefined> {
    const row = await this.one<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [organizationId]);
    return row?.name;
  }

  async rotateOrganizationInviteToken(inviteId: string, organizationId: string, userId: string, now = new Date().toISOString(), publicURL?: string): Promise<OrganizationInviteRecord | null> {
    const invite = await this.getOrganizationInvite(inviteId);
    if (!invite || invite.organizationId !== organizationId || invite.revokedAt) return null;
    if (invite.expiresAt && invite.expiresAt <= now) return null;
    if (invite.maxUses !== undefined && invite.usedCount >= invite.maxUses) return null;
    const token = `invite_${randomToken()}`;
    const changed = await this.pool.query('UPDATE organization_invites SET token_hash = $1 WHERE invite_id = $2 AND organization_id = $3 AND revoked_at IS NULL', [hashToken(token), inviteId, organizationId]);
    if (changed.rowCount !== 1) return null;
    await this.writeAuditEvent(organizationId, userId, 'organization_invite.token_rotated', inviteId, {}, now);
    const rotated = (await this.getOrganizationInvite(inviteId)) ?? missingInvite(inviteId);
    return { ...rotated, token, ...(publicURL ? { url: `${publicURL.replace(/\/+$/, '')}/invite/${encodeURIComponent(token)}` } : {}) };
  }

  async recordOrganizationInviteEmailDelivery(inviteId: string, organizationId: string, userId: string, status: string, errorMessage: string | undefined, now = new Date().toISOString()): Promise<OrganizationInviteRecord | null> {
    const changed = await this.pool.query('UPDATE organization_invites SET email_last_status = $1, email_last_sent_at = $2, email_last_error = $3 WHERE invite_id = $4 AND organization_id = $5', [status, status === 'sent' ? now : null, errorMessage ?? null, inviteId, organizationId]);
    if (changed.rowCount !== 1) return null;
    await this.writeAuditEvent(organizationId, userId, 'organization_invite.email_delivery', inviteId, { status, error: errorMessage }, now);
    return this.getOrganizationInvite(inviteId);
  }

  async revokeOrganizationInvite(inviteId: string, organizationId: string, userId: string, now = new Date().toISOString()): Promise<OrganizationInviteRecord | null> {
    const row = await this.one<OrganizationInviteRow>('SELECT * FROM organization_invites WHERE invite_id = $1 AND organization_id = $2', [inviteId, organizationId]);
    if (!row) return null;
    if (!row.revoked_at) {
      await this.pool.query('UPDATE organization_invites SET revoked_at = $1 WHERE invite_id = $2 AND organization_id = $3', [now, inviteId, organizationId]);
      row.revoked_at = now;
      await this.writeAuditEvent(organizationId, userId, 'organization_invite.revoked', inviteId, {}, now);
    }
    return mapOrganizationInviteRow(row, await this.listInviteTeamIds(inviteId));
  }

  async previewInvite(token: string, now = new Date().toISOString()): Promise<InvitePreviewRecord | null> {
    const row = await this.findUsableInvite(token, now);
    if (!row) return null;
    return { organizationName: row.organization_name, role: row.role, approvalRequired: Boolean(row.approval_required), expiresAt: row.expires_at ?? undefined };
  }

  private async listInviteTeamIds(inviteId: string): Promise<string[]> {
    const rows = await this.many<{ team_id: string }>('SELECT team_id FROM organization_invite_teams WHERE invite_id = $1 ORDER BY team_id ASC', [inviteId]);
    return rows.map((row) => row.team_id);
  }

  private async findUsableInvite(token: string, now: string): Promise<OrganizationInviteLookupRow | null> {
    if (!token.startsWith('invite_')) return null;
    return this.one<OrganizationInviteLookupRow>(
      `
        SELECT i.*, o.name AS organization_name
        FROM organization_invites i
        JOIN organizations o ON o.id = i.organization_id
        WHERE i.token_hash = $1
          AND i.revoked_at IS NULL
          AND (i.expires_at IS NULL OR i.expires_at > $2)
          AND (i.max_uses IS NULL OR i.used_count < i.max_uses)
      `,
      [hashToken(token), now]
    );
  }

  async createProject(input: CreateProjectInput, now = new Date().toISOString()): Promise<ProjectRecord> {
    const projectId = newID('prj');
    const cleanName = input.name.trim();
    const slug = await this.uniqueProjectSlug(input.organizationId, input.slug ?? cleanName);
    await this.pool.query(
      'INSERT INTO projects(project_id, organization_id, name, slug, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [projectId, input.organizationId, cleanName, slug, input.description?.trim() || null, now, now]
    );
    await this.writeAuditEvent(input.organizationId, input.userId, 'project.created', projectId, { name: cleanName, slug }, now);
    return (await this.getProject(projectId)) ?? missingProject(projectId);
  }

  async getProject(projectId: string): Promise<ProjectRecord | null> {
    const row = await this.one<ProjectRow>('SELECT * FROM projects WHERE project_id = $1', [projectId]);
    return row ? mapProjectRow(row) : null;
  }

  async listTeams(organizationId = DEFAULT_ORGANIZATION_ID): Promise<TeamRecord[]> {
    const rows = await this.many<TeamRow>(
      'SELECT * FROM teams WHERE organization_id = $1 ORDER BY archived_at IS NOT NULL, lower(name) ASC',
      [organizationId]
    );
    return rows.map(mapTeamRow);
  }

  async createTeam(input: CreateTeamInput, now = new Date().toISOString()): Promise<TeamMembershipRecord> {
    const teamId = newID('team');
    const cleanName = input.name.trim();
    const slug = await this.uniqueTeamSlug(input.organizationId, input.slug ?? cleanName);
    await this.transaction(async (query) => {
      await query(
        'INSERT INTO teams(team_id, organization_id, name, slug, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [teamId, input.organizationId, cleanName, slug, input.description?.trim() || null, now, now]
      );
      await query(
        'INSERT INTO team_memberships(team_id, organization_id, user_id, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [teamId, input.organizationId, input.userId, 'owner', now, now]
      );
      await query('INSERT INTO audit_events(organization_id, user_id, event_type, target_id, payload_json, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
        input.organizationId,
        input.userId,
        'team.created',
        teamId,
        JSON.stringify({ name: cleanName, slug }),
        now
      ]);
    });
    return (await this.listTeamMembers(teamId))[0] ?? missingTeam(teamId);
  }

  async listTeamMembers(teamId: string): Promise<TeamMembershipRecord[]> {
    const rows = await this.many<TeamMembershipRow>(
      `
        SELECT t.team_id, t.organization_id, t.name, t.slug, t.description, t.created_at, t.updated_at, t.archived_at, m.user_id, m.role
        FROM team_memberships m
        JOIN teams t ON t.team_id = m.team_id
        WHERE m.team_id = $1
        ORDER BY m.created_at ASC
      `,
      [teamId]
    );
    return rows.map(mapTeamMembershipRow);
  }

  async upsertTeamMember(input: UpsertTeamMemberInput, now = new Date().toISOString()): Promise<TeamMembershipRecord> {
    if (!(await this.teamBelongsToOrganization(input.teamId, input.organizationId))) {
      throw httpError(404, 'not_found', 'Team not found');
    }
    if (!(await this.organizationMembershipForUser(input.userId, input.organizationId))) {
      throw httpError(400, 'bad_request', 'User is not a member of the selected organization');
    }
    const role = input.role?.trim() || 'member';
    await this.pool.query(
      `
        INSERT INTO team_memberships(team_id, organization_id, user_id, role, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT(team_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at
      `,
      [input.teamId, input.organizationId, input.userId, role, now, now]
    );
    await this.writeAuditEvent(input.organizationId, input.actorUserId, 'team_member.upserted', input.teamId, { userId: input.userId, role }, now);
    return (await this.listTeamMembers(input.teamId)).find((member) => member.userId === input.userId) ?? missingTeam(input.teamId);
  }

  async removeTeamMember(input: RemoveTeamMemberInput, now = new Date().toISOString()): Promise<TeamMembershipRecord | null> {
    if (!(await this.teamBelongsToOrganization(input.teamId, input.organizationId))) {
      throw httpError(404, 'not_found', 'Team not found');
    }
    const members = await this.listTeamMembers(input.teamId);
    const member = members.find((entry) => entry.userId === input.userId);
    if (!member) return null;
    if (member.role === 'owner' && members.filter((entry) => entry.role === 'owner').length <= 1) {
      throw httpError(400, 'bad_request', 'Cannot remove the last team owner');
    }
    await this.pool.query('DELETE FROM team_memberships WHERE team_id = $1 AND organization_id = $2 AND user_id = $3', [input.teamId, input.organizationId, input.userId]);
    await this.writeAuditEvent(input.organizationId, input.actorUserId, 'team_member.removed', input.teamId, { userId: input.userId, role: member.role }, now);
    return member;
  }

  async listPolicies(organizationId = DEFAULT_ORGANIZATION_ID): Promise<PolicyRecord[]> {
    const rows = await this.many<PolicyRow>(
      'SELECT * FROM policies WHERE organization_id = $1 ORDER BY archived_at IS NOT NULL, lower(name) ASC',
      [organizationId]
    );
    return rows.map(mapPolicyRow);
  }

  async createPolicy(input: CreatePolicyInput, now = new Date().toISOString()): Promise<PolicyRecord> {
    if (input.projectId && !(await this.projectBelongsToOrganization(input.projectId, input.organizationId))) {
      throw httpError(400, 'bad_request', 'Project is not in the selected organization');
    }
    if (input.teamId && !(await this.teamBelongsToOrganization(input.teamId, input.organizationId))) {
      throw httpError(400, 'bad_request', 'Team is not in the selected organization');
    }
    const policyId = newID('pol');
    const cleanName = input.name.trim();
    const requiredApprovals = Math.min(Math.max(Math.trunc(input.requiredApprovals ?? 1), 1), 10);
    await this.pool.query(
      'INSERT INTO policies(policy_id, organization_id, name, description, project_id, team_id, required_approvals, enabled, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [policyId, input.organizationId, cleanName, input.description?.trim() || null, input.projectId ?? null, input.teamId ?? null, requiredApprovals, input.enabled !== false, now, now]
    );
    await this.writeAuditEvent(input.organizationId, input.userId, 'policy.created', policyId, { name: cleanName, requiredApprovals }, now);
    return (await this.getPolicy(policyId)) ?? missingPolicy(policyId);
  }

  async getPolicy(policyId: string): Promise<PolicyRecord | null> {
    const row = await this.one<PolicyRow>('SELECT * FROM policies WHERE policy_id = $1', [policyId]);
    return row ? mapPolicyRow(row) : null;
  }

  async updatePolicy(input: UpdatePolicyInput, now = new Date().toISOString()): Promise<PolicyRecord | null> {
    const existing = await this.one<PolicyRow>('SELECT * FROM policies WHERE policy_id = $1 AND organization_id = $2', [input.policyId, input.organizationId]);
    if (!existing) return null;
    if (input.projectId && !(await this.projectBelongsToOrganization(input.projectId, input.organizationId))) {
      throw httpError(400, 'bad_request', 'Project is not in the selected organization');
    }
    if (input.teamId && !(await this.teamBelongsToOrganization(input.teamId, input.organizationId))) {
      throw httpError(400, 'bad_request', 'Team is not in the selected organization');
    }
    const name = input.name?.trim() || existing.name;
    const description = input.description === undefined ? existing.description : input.description.trim() || null;
    const projectId = input.projectId === undefined ? existing.project_id : input.projectId || null;
    const teamId = input.teamId === undefined ? existing.team_id : input.teamId || null;
    const requiredApprovals = input.requiredApprovals === undefined ? existing.required_approvals : Math.min(Math.max(Math.trunc(input.requiredApprovals), 1), 10);
    const enabled = input.enabled === undefined ? existing.enabled : input.enabled;
    const archivedAt = input.archived === undefined ? existing.archived_at : input.archived ? (existing.archived_at ?? now) : null;
    await this.pool.query(
      'UPDATE policies SET name = $1, description = $2, project_id = $3, team_id = $4, required_approvals = $5, enabled = $6, archived_at = $7, updated_at = $8 WHERE policy_id = $9 AND organization_id = $10',
      [name, description, projectId, teamId, requiredApprovals, enabled, archivedAt, now, input.policyId, input.organizationId]
    );
    await this.writeAuditEvent(input.organizationId, input.userId, 'policy.updated', input.policyId, { name, requiredApprovals, projectId, teamId, enabled, archived: Boolean(archivedAt) }, now);
    return (await this.getPolicy(input.policyId)) ?? missingPolicy(input.policyId);
  }

  async projectBelongsToOrganization(projectId: string, organizationId: string): Promise<boolean> {
    return Boolean(await this.one('SELECT 1 FROM projects WHERE project_id = $1 AND organization_id = $2', [projectId, organizationId]));
  }

  async teamBelongsToOrganization(teamId: string, organizationId: string): Promise<boolean> {
    return Boolean(await this.one('SELECT 1 FROM teams WHERE team_id = $1 AND organization_id = $2', [teamId, organizationId]));
  }

  async policyBelongsToOrganization(policyId: string, organizationId: string): Promise<boolean> {
    return Boolean(await this.one('SELECT 1 FROM policies WHERE policy_id = $1 AND organization_id = $2', [policyId, organizationId]));
  }

  async createAgentToken(input: CreateAgentTokenInput, now = new Date().toISOString()): Promise<AgentCredential> {
    const agentId = newID('agt');
    const token = `agent_${randomToken()}`;
    const scopes = input.scopes?.length ? input.scopes : ['approval:create'];
    const organizationId = input.organizationId ?? DEFAULT_ORGANIZATION_ID;
    if (input.projectId && !(await this.projectBelongsToOrganization(input.projectId, organizationId))) {
      throw httpError(400, 'bad_request', 'Project is not in the selected organization');
    }
    if (input.teamId && !(await this.teamBelongsToOrganization(input.teamId, organizationId))) {
      throw httpError(400, 'bad_request', 'Team is not in the selected organization');
    }
    if (input.defaultApprovalPolicy && !(await this.policyBelongsToOrganization(input.defaultApprovalPolicy, organizationId))) {
      throw httpError(400, 'bad_request', 'Policy is not in the selected organization');
    }
    const name = input.name.trim();
    await this.pool.query(
      `INSERT INTO agent_tokens(
        agent_id, organization_id, owner_user_id, project_id, team_id, default_approval_policy, name, token_hash, scopes_json, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [agentId, organizationId, input.ownerUserId ?? null, input.projectId ?? null, input.teamId ?? null, input.defaultApprovalPolicy ?? null, name, hashToken(token), JSON.stringify(scopes), now]
    );
    await this.writeAuditEvent(organizationId, input.ownerUserId ?? agentId, 'agent_token.created', agentId, { name, scopes, projectId: input.projectId, teamId: input.teamId }, now);
    return {
      agentId,
      name,
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

  async listAgentTokens(organizationId = DEFAULT_ORGANIZATION_ID): Promise<AgentTokenRecord[]> {
    const rows = await this.many<AgentTokenRow>('SELECT * FROM agent_tokens WHERE organization_id = $1 ORDER BY created_at DESC', [organizationId]);
    return rows.map(mapAgentTokenRow);
  }

  async updateAgentTokenName(agentId: string, organizationId: string, name: string, now = new Date().toISOString()): Promise<AgentTokenRecord | null> {
    const cleanName = name.trim();
    if (!cleanName) throw httpError(400, 'bad_request', 'Agent connection name is required');
    await this.pool.query('UPDATE agent_tokens SET name = $1 WHERE agent_id = $2 AND organization_id = $3', [cleanName, agentId, organizationId]);
    const token = (await this.listAgentTokens(organizationId)).find((candidate) => candidate.agentId === agentId) ?? null;
    if (token) await this.writeAuditEvent(organizationId, token.ownerUserId ?? agentId, 'agent_token.updated', agentId, { name: cleanName }, now);
    return token;
  }

  async revokeAgentToken(agentId: string, organizationId = DEFAULT_ORGANIZATION_ID, now = new Date().toISOString()): Promise<AgentTokenRecord | null> {
    const row = await this.one<AgentTokenRow>('SELECT * FROM agent_tokens WHERE agent_id = $1 AND organization_id = $2', [agentId, organizationId]);
    if (!row) return null;
    if (!row.revoked_at) {
      await this.pool.query('UPDATE agent_tokens SET revoked_at = $1 WHERE agent_id = $2 AND organization_id = $3', [now, agentId, organizationId]);
      row.revoked_at = now;
      await this.writeAuditEvent(organizationId, row.owner_user_id ?? agentId, 'agent_token.revoked', agentId, { name: row.name }, now);
    }
    return mapAgentTokenRow(row);
  }

  async verifyAgentToken(token: string, now = new Date().toISOString()): Promise<AgentTokenAuth | null> {
    if (!token.startsWith('agent_')) return null;
    const row = await this.one<AgentTokenRow>('SELECT * FROM agent_tokens WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(token)]);
    if (!row) return null;
    await this.pool.query('UPDATE agent_tokens SET last_request_at = $1 WHERE agent_id = $2', [now, row.agent_id]);
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

  async getOrStartPersonalEntitlement(userId: string, now = new Date().toISOString()): Promise<PersonalEntitlementRecord> {
    const existing = await this.one<PersonalEntitlementRow>('SELECT * FROM personal_entitlements WHERE user_id = $1', [userId]);
    if (existing) return mapPersonalEntitlementRow(existing);
    await this.pool.query('INSERT INTO personal_entitlements(user_id, trial_started_at, created_at, updated_at) VALUES ($1, $2, $3, $4)', [userId, now, now, now]);
    return this.getOrStartPersonalEntitlement(userId, now);
  }

  async updatePersonalEntitlement(input: UpdatePersonalEntitlementInput, now = new Date().toISOString()): Promise<PersonalEntitlementRecord> {
    await this.getOrStartPersonalEntitlement(input.userId, now);
    const current = await this.one<PersonalEntitlementRow>('SELECT * FROM personal_entitlements WHERE user_id = $1', [input.userId]);
    await this.pool.query(`
      UPDATE personal_entitlements SET
        app_unlocked_at = $1,
        included_hosted_activated_at = $2,
        hosted_subscription_ends_at = $3,
        hosted_subscription_canceled_at = $4,
        hosted_data_deleted_at = $5,
        updated_at = $6
      WHERE user_id = $7
    `, [
      input.appUnlockedAt === undefined ? current?.app_unlocked_at ?? null : input.appUnlockedAt,
      input.includedHostedActivatedAt === undefined ? current?.included_hosted_activated_at ?? null : input.includedHostedActivatedAt,
      input.hostedSubscriptionEndsAt === undefined ? current?.hosted_subscription_ends_at ?? null : input.hostedSubscriptionEndsAt,
      input.hostedSubscriptionCanceledAt === undefined ? current?.hosted_subscription_canceled_at ?? null : input.hostedSubscriptionCanceledAt,
      input.hostedDataDeletedAt === undefined ? current?.hosted_data_deleted_at ?? null : input.hostedDataDeletedAt,
      now,
      input.userId
    ]);
    return this.getOrStartPersonalEntitlement(input.userId, now);
  }

  async upsertBillingProducts(products: UpsertBillingProductInput[], now = new Date().toISOString()): Promise<void> {
    await this.transaction(async (query) => {
      for (const product of products) {
        await query(`
          INSERT INTO billing_products(id, product_key, kind, entitlement_key, apple_product_id, google_product_id, google_base_plan_id, active, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (product_key) DO UPDATE SET
            kind = EXCLUDED.kind,
            entitlement_key = EXCLUDED.entitlement_key,
            apple_product_id = EXCLUDED.apple_product_id,
            google_product_id = EXCLUDED.google_product_id,
            google_base_plan_id = EXCLUDED.google_base_plan_id,
            active = EXCLUDED.active,
            updated_at = EXCLUDED.updated_at
        `, [
          `bprod_${product.productKey}`,
          product.productKey,
          product.kind,
          product.entitlementKey,
          product.appleProductId ?? null,
          product.googleProductId ?? null,
          product.googleBasePlanId ?? null,
          product.active === false ? false : true,
          now,
          now
        ]);
      }
    });
  }

  async listBillingProducts(activeOnly = false): Promise<BillingProductRecord[]> {
    const rows = await this.many<BillingProductRow>(`SELECT * FROM billing_products ${activeOnly ? 'WHERE active = true' : ''} ORDER BY product_key ASC`);
    return rows.map(mapBillingProductRow);
  }

  async createBillingPurchaseAttempt(input: CreateBillingPurchaseAttemptInput, now = new Date().toISOString()): Promise<BillingPurchaseAttemptRecord> {
    const attemptId = newID('bpa');
    await this.pool.query(`
      INSERT INTO billing_purchase_attempts(id, user_id, product_key, product_group, platform, provider, status, provider_user_id, idempotency_key, expires_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [attemptId, input.userId, input.productKey, input.productGroup, input.platform, input.provider, 'started', input.providerUserId ?? null, input.idempotencyKey, input.expiresAt, now, now]);
    const row = await this.one<BillingPurchaseAttemptRow>('SELECT * FROM billing_purchase_attempts WHERE id = $1', [attemptId]);
    if (!row) throw new Error('Created billing purchase attempt was not found');
    return mapBillingPurchaseAttemptRow(row);
  }

  async updateBillingPurchaseAttemptStatus(attemptId: string, status: string, now = new Date().toISOString()): Promise<BillingPurchaseAttemptRecord | null> {
    await this.pool.query('UPDATE billing_purchase_attempts SET status = $1, updated_at = $2 WHERE id = $3', [status, now, attemptId]);
    const row = await this.one<BillingPurchaseAttemptRow>('SELECT * FROM billing_purchase_attempts WHERE id = $1', [attemptId]);
    return row ? mapBillingPurchaseAttemptRow(row) : null;
  }

  async listActiveBillingPurchaseAttempts(userId: string, productGroup: string, now = new Date().toISOString()): Promise<BillingPurchaseAttemptRecord[]> {
    const rows = await this.many<BillingPurchaseAttemptRow>("SELECT * FROM billing_purchase_attempts WHERE user_id = $1 AND product_group = $2 AND status = 'started' AND expires_at > $3 ORDER BY created_at ASC", [userId, productGroup, now]);
    return rows.map(mapBillingPurchaseAttemptRow);
  }

  async upsertBillingTransaction(input: UpsertBillingTransactionInput, now = new Date().toISOString()): Promise<UpsertBillingTransactionResult> {
    const existing = await this.findBillingTransaction(input);
    if (existing) {
      await this.pool.query(`
        UPDATE billing_transactions SET
          user_id = $1,
          environment = $2,
          product_key = $3,
          entitlement_key = $4,
          platform = $5,
          provider_transaction_id = $6,
          provider_original_transaction_id = $7,
          provider_purchase_token = $8,
          status = $9,
          purchased_at = $10,
          expires_at = $11,
          canceled_at = $12,
          revoked_at = $13,
          raw_event_json = $14,
          updated_at = $15
        WHERE id = $16
      `, [
        input.userId,
        input.environment,
        input.productKey,
        input.entitlementKey,
        input.platform,
        input.providerTransactionId === undefined ? existing.provider_transaction_id : input.providerTransactionId,
        input.providerOriginalTransactionId === undefined ? existing.provider_original_transaction_id : input.providerOriginalTransactionId,
        input.providerPurchaseToken === undefined ? existing.provider_purchase_token : input.providerPurchaseToken,
        input.status,
        input.purchasedAt === undefined ? existing.purchased_at : input.purchasedAt,
        input.expiresAt === undefined ? existing.expires_at : input.expiresAt,
        input.canceledAt === undefined ? existing.canceled_at : input.canceledAt,
        input.revokedAt === undefined ? existing.revoked_at : input.revokedAt,
        input.rawEventJSON === undefined ? existing.raw_event_json : input.rawEventJSON,
        now,
        existing.id
      ]);
      const row = await this.one<BillingTransactionRow>('SELECT * FROM billing_transactions WHERE id = $1', [existing.id]);
      if (!row) throw new Error('Updated billing transaction was not found');
      return { record: mapBillingTransactionRow(row), created: false };
    }

    const transactionId = newID('btxn');
    await this.pool.query(`
      INSERT INTO billing_transactions(id, user_id, provider, environment, product_key, entitlement_key, platform, provider_transaction_id, provider_original_transaction_id, provider_purchase_token, status, purchased_at, expires_at, canceled_at, revoked_at, raw_event_json, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    `, [
      transactionId,
      input.userId,
      input.provider,
      input.environment,
      input.productKey,
      input.entitlementKey,
      input.platform,
      input.providerTransactionId ?? null,
      input.providerOriginalTransactionId ?? null,
      input.providerPurchaseToken ?? null,
      input.status,
      input.purchasedAt ?? null,
      input.expiresAt ?? null,
      input.canceledAt ?? null,
      input.revokedAt ?? null,
      input.rawEventJSON ?? null,
      now,
      now
    ]);
    const row = await this.one<BillingTransactionRow>('SELECT * FROM billing_transactions WHERE id = $1', [transactionId]);
    if (!row) throw new Error('Created billing transaction was not found');
    return { record: mapBillingTransactionRow(row), created: true };
  }

  async listBillingTransactionsForUser(userId: string): Promise<BillingTransactionRecord[]> {
    const rows = await this.many<BillingTransactionRow>('SELECT * FROM billing_transactions WHERE user_id = $1 ORDER BY created_at ASC, id ASC', [userId]);
    return rows.map(mapBillingTransactionRow);
  }

  private async findBillingTransaction(input: UpsertBillingTransactionInput): Promise<BillingTransactionRow | null> {
    if (input.providerTransactionId) {
      const row = await this.one<BillingTransactionRow>('SELECT * FROM billing_transactions WHERE provider = $1 AND provider_transaction_id = $2', [input.provider, input.providerTransactionId]);
      if (row) return row;
    }
    if (input.providerOriginalTransactionId) {
      const row = await this.one<BillingTransactionRow>('SELECT * FROM billing_transactions WHERE provider = $1 AND provider_original_transaction_id = $2 AND product_key = $3', [input.provider, input.providerOriginalTransactionId, input.productKey]);
      if (row) return row;
    }
    if (input.providerPurchaseToken) {
      const row = await this.one<BillingTransactionRow>('SELECT * FROM billing_transactions WHERE provider = $1 AND provider_purchase_token = $2', [input.provider, input.providerPurchaseToken]);
      if (row) return row;
    }
    return null;
  }

  async revokeAgentTokensForOwner(userId: string, now = new Date().toISOString()): Promise<number> {
    const result = await this.pool.query('UPDATE agent_tokens SET revoked_at = $1 WHERE owner_user_id = $2 AND revoked_at IS NULL', [now, userId]);
    return result.rowCount ?? 0;
  }

  async deleteHostedPersonalData(userId: string, organizationId: string, now = new Date().toISOString()): Promise<void> {
    await this.transaction(async (query) => {
      await query('UPDATE agent_tokens SET revoked_at = $1 WHERE owner_user_id = $2 AND revoked_at IS NULL', [now, userId]);
      await query('UPDATE devices SET unregistered_at = $1, expo_push_token = NULL WHERE user_id = $2 AND unregistered_at IS NULL', [now, userId]);
      await query('DELETE FROM approval_votes WHERE approver_user_id = $1', [userId]);
      await query('DELETE FROM approval_recipients WHERE user_id = $1', [userId]);
      await query('DELETE FROM agent_status_updates WHERE organization_id = $1', [organizationId]);
      await query('DELETE FROM approval_requests WHERE organization_id = $1 AND user_id = $2', [organizationId, userId]);
    });
    await this.updatePersonalEntitlement({ userId, hostedDataDeletedAt: now }, now);
  }

  async createApprovalRequest(input: CreateApprovalInput, now = new Date().toISOString()): Promise<ApprovalRequest> {
    const parsed = CreateApprovalRequestSchema.parse(input);
    const id = newID('req');
    const organizationId = input.organizationId ?? DEFAULT_ORGANIZATION_ID;
    const requesterAgentId = input.agentId ?? parsed.requester.agentId ?? 'agent_unknown';
    const choices = parsed.choices?.length ? parsed.choices : defaultChoices();
    const title = parsed.encryptedPayload ? 'Encrypted approval request' : parsed.title;
    const body = parsed.encryptedPayload ? 'Open Agent Tick to decrypt this request.' : parsed.body ?? null;
    const command = parsed.encryptedPayload ? null : parsed.command ?? null;
    const metadata = parsed.metadata ?? {};
    const policy = await this.approvalPolicyForMetadata(organizationId, metadata);
    const recipients = await this.resolveApprovalRecipients({ organizationId, ...(input.userId ? { requesterUserId: input.userId } : {}), policy });

    await this.transaction(async (query) => {
      await query(
        `INSERT INTO approval_requests(
          id, organization_id, user_id, requester_name, requester_agent_id, requester_host,
          requester_working_directory, requester_project_name, requester_project_id, request_type,
          title, body, command, encrypted_payload_json, choices_json, questions_json, default_choice, allow_freeform_reply, expires_at,
          risk, metadata_json, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
        [
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
          title,
          body,
          command,
          parsed.encryptedPayload ? JSON.stringify(parsed.encryptedPayload) : null,
          JSON.stringify(choices),
          JSON.stringify(parsed.questions ?? []),
          parsed.defaultChoice ?? null,
          Boolean(parsed.allowFreeformReply),
          parsed.expiresAt ?? null,
          parsed.risk ?? null,
          JSON.stringify(metadata),
          'pending',
          now
        ]
      );
      for (const recipient of recipients) {
        await query('INSERT INTO approval_recipients(request_id, user_id, organization_id, source, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
          id,
          recipient.userId,
          organizationId,
          recipient.source,
          'pending',
          now,
          now
        ]);
      }
      await query('INSERT INTO audit_events(organization_id, user_id, event_type, target_id, payload_json, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
        organizationId,
        input.userId ?? requesterAgentId,
        'approval.created',
        id,
        JSON.stringify(parsed.encryptedPayload ? { encrypted: true, algorithm: parsed.encryptedPayload.algorithm, keyId: parsed.encryptedPayload.keyId } : { title: parsed.title }),
        now
      ]);
    });
    return (await this.getApprovalRequest(id, input.userId, now)) ?? missingApproval(id);
  }

  async listApprovalRequests(organizationId = DEFAULT_ORGANIZATION_ID, currentUserId?: string, now = new Date().toISOString()): Promise<ApprovalRequest[]> {
    await this.expirePendingApprovals(organizationId, now);
    const rows = currentUserId
      ? await this.many<ApprovalRow>(
          `
            SELECT a.*
            FROM approval_requests a
            JOIN approval_recipients r ON r.request_id = a.id AND r.user_id = $1
            WHERE a.organization_id = $2
            ORDER BY a.created_at DESC
          `,
          [currentUserId, organizationId]
        )
      : await this.many<ApprovalRow>('SELECT * FROM approval_requests WHERE organization_id = $1 ORDER BY created_at DESC', [organizationId]);
    return Promise.all(rows.map((row) => this.mapApprovalWithProgress(row, currentUserId)));
  }

  async getApprovalRequest(id: string, currentUserId?: string, now = new Date().toISOString()): Promise<ApprovalRequest | null> {
    await this.expirePendingApproval(id, undefined, now);
    const row = await this.approvalRow(id);
    return row ? this.mapApprovalWithProgress(row, currentUserId) : null;
  }

  async getApprovalRequestForOrganization(id: string, organizationId: string, currentUserId?: string, now = new Date().toISOString()): Promise<ApprovalRequest | null> {
    await this.expirePendingApproval(id, organizationId, now);
    const row = await this.approvalRow(id, organizationId);
    if (!row) return null;
    if (currentUserId && !(await this.approvalRecipientExists(id, currentUserId))) return null;
    return this.mapApprovalWithProgress(row, currentUserId);
  }

  async respondToApprovalRequest(id: string, response: RespondApprovalRequest, responderUserId = DEFAULT_USER_ID, now = new Date().toISOString()): Promise<ApprovalRequest | null> {
    await this.expirePendingApproval(id, undefined, now);
    const row = await this.approvalRow(id);
    return row ? this.respondToApprovalRow(row, response, responderUserId, now) : null;
  }

  async respondToApprovalRequestForOrganization(id: string, organizationId: string, response: RespondApprovalRequest, responderUserId = DEFAULT_USER_ID, now = new Date().toISOString()): Promise<ApprovalRequest | null> {
    await this.expirePendingApproval(id, organizationId, now);
    const row = await this.approvalRow(id, organizationId);
    return row ? this.respondToApprovalRow(row, response, responderUserId, now) : null;
  }

  async abandonApprovalRequest(id: string, actorId: string, now = new Date().toISOString()): Promise<ApprovalRequest | null> {
    await this.expirePendingApproval(id, undefined, now);
    const row = await this.approvalRow(id);
    return row ? this.abandonApprovalRow(row, actorId, now) : null;
  }

  async abandonApprovalRequestForOrganization(id: string, organizationId: string, actorId: string, now = new Date().toISOString()): Promise<ApprovalRequest | null> {
    await this.expirePendingApproval(id, organizationId, now);
    const row = await this.approvalRow(id, organizationId);
    return row ? this.abandonApprovalRow(row, actorId, now) : null;
  }

  async registerDevice(input: DeviceRegistrationInput, now = new Date().toISOString()): Promise<DeviceRecord> {
    const existing = input.installationId
      ? await this.one<DeviceRow>('SELECT * FROM devices WHERE user_id = $1 AND installation_id = $2 AND unregistered_at IS NULL', [input.userId, input.installationId])
      : null;
    const deviceId = existing?.device_id ?? newID('dev');
    const expoPushToken = input.expoPushToken?.trim() || null;

    await this.transaction(async (query) => {
      if (expoPushToken) {
        await query('UPDATE devices SET expo_push_token = NULL, updated_at = $1 WHERE user_id = $2 AND expo_push_token = $3', [now, input.userId, expoPushToken]);
      }
      if (existing) {
        await query('UPDATE devices SET name = $1, platform = $2, expo_push_token = $3, updated_at = $4 WHERE device_id = $5', [input.deviceName.trim(), input.platform ?? null, expoPushToken, now, deviceId]);
      } else {
        await query('INSERT INTO devices(device_id, user_id, name, platform, installation_id, expo_push_token, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
          deviceId,
          input.userId,
          input.deviceName.trim(),
          input.platform ?? null,
          input.installationId ?? null,
          expoPushToken,
          now,
          now
        ]);
      }
    });
    const device = (await this.getDeviceForUser(deviceId, input.userId)) ?? missingDevice(deviceId);
    const membership = await this.defaultMembershipForUser(input.userId);
    await this.writeAuditEvent(membership.organizationId, input.userId, existing ? 'device.updated' : 'device.registered', deviceId, { name: input.deviceName.trim(), platform: input.platform }, now);
    return device;
  }

  async createPairingToken(userId: string, organizationId: string, now = new Date().toISOString(), ttlSeconds = 10 * 60): Promise<PairingTokenRecord> {
    const token = `pair_${randomToken()}`;
    const expiresAt = new Date(new Date(now).getTime() + ttlSeconds * 1000).toISOString();
    await this.pool.query('INSERT INTO pairing_codes(token_hash, user_id, organization_id, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)', [hashToken(token), userId, organizationId, expiresAt, now]);
    return { token, expiresAt };
  }

  async pairDeviceWithCode(pairingCode: string, deviceName: string, platform: string | undefined, now = new Date().toISOString()): Promise<DeviceCredential | null> {
    if (!pairingCode.startsWith('pair_')) return null;
    const row = await this.one<PairingCodeRow>('SELECT * FROM pairing_codes WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2', [hashToken(pairingCode), now]);
    if (!row) return null;
    const token = `device_${randomToken()}`;
    const deviceId = newID('dev');
    await this.transaction(async (query) => {
      await query('INSERT INTO devices(device_id, user_id, name, platform, token_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [deviceId, row.user_id, deviceName.trim(), platform ?? null, hashToken(token), now, now]);
      await query('UPDATE pairing_codes SET used_at = $1 WHERE token_hash = $2', [now, row.token_hash]);
    });
    await this.writeAuditEvent(row.organization_id, row.user_id, 'device.paired', deviceId, { name: deviceName.trim(), platform }, now);
    return { deviceId, token };
  }

  async verifyDeviceToken(token: string): Promise<DeviceTokenAuth | null> {
    if (!token.startsWith('device_')) return null;
    const row = await this.one<DeviceRow>('SELECT * FROM devices WHERE token_hash = $1 AND unregistered_at IS NULL', [hashToken(token)]);
    if (!row) return null;
    const membership = await this.defaultMembershipForUser(row.user_id);
    return {
      source: 'device',
      deviceId: row.device_id,
      userId: row.user_id,
      organizationId: membership.organizationId
    };
  }

  async listDevicesForUser(userId: string): Promise<DeviceRecord[]> {
    const rows = await this.many<DeviceRow>('SELECT * FROM devices WHERE user_id = $1 ORDER BY updated_at DESC', [userId]);
    return rows.map(mapDeviceRow);
  }

  async listPushDevicesForApprovalRecipients(requestId: string): Promise<DeviceRecord[]> {
    const rows = await this.many<DeviceRow>(
      `
        SELECT DISTINCT d.*
        FROM approval_recipients r
        JOIN devices d ON d.user_id = r.user_id
        WHERE r.request_id = $1
          AND r.source NOT LIKE 'unrouted_%'
          AND d.expo_push_token IS NOT NULL
          AND d.unregistered_at IS NULL
        ORDER BY d.updated_at DESC
      `,
      [requestId]
    );
    return rows.map(mapDeviceRow);
  }

  async listPushDevicesForUsers(userIds: string[]): Promise<DeviceRecord[]> {
    if (!userIds.length) return [];
    const placeholders = userIds.map((_, index) => `$${index + 1}`).join(', ');
    const rows = await this.many<DeviceRow>(`SELECT DISTINCT * FROM devices WHERE user_id IN (${placeholders}) AND expo_push_token IS NOT NULL AND unregistered_at IS NULL ORDER BY updated_at DESC`, userIds);
    return rows.map(mapDeviceRow);
  }

  async getDeviceForUser(deviceId: string, userId: string): Promise<DeviceRecord | null> {
    const row = await this.one<DeviceRow>('SELECT * FROM devices WHERE device_id = $1 AND user_id = $2', [deviceId, userId]);
    return row ? mapDeviceRow(row) : null;
  }

  async updateDeviceName(deviceId: string, userId: string, name: string, now = new Date().toISOString()): Promise<DeviceRecord | null> {
    const cleanName = name.trim();
    if (!cleanName) throw httpError(400, 'bad_request', 'Device name is required');
    await this.pool.query('UPDATE devices SET name = $1, updated_at = $2 WHERE device_id = $3 AND user_id = $4 AND unregistered_at IS NULL', [cleanName, now, deviceId, userId]);
    const device = await this.getDeviceForUser(deviceId, userId);
    if (device) {
      const membership = await this.defaultMembershipForUser(userId);
      await this.writeAuditEvent(membership.organizationId, userId, 'device.updated', deviceId, { name: cleanName }, now);
    }
    return device;
  }

  async updateDevicePushToken(deviceId: string, userId: string, expoPushToken: string, now = new Date().toISOString()): Promise<DeviceRecord | null> {
    const token = expoPushToken.trim();
    await this.transaction(async (query) => {
      if (token) await query('UPDATE devices SET expo_push_token = NULL, updated_at = $1 WHERE user_id = $2 AND expo_push_token = $3', [now, userId, token]);
      await query('UPDATE devices SET expo_push_token = $1, updated_at = $2 WHERE device_id = $3 AND user_id = $4 AND unregistered_at IS NULL', [token || null, now, deviceId, userId]);
    });
    const device = await this.getDeviceForUser(deviceId, userId);
    if (device) {
      const membership = await this.defaultMembershipForUser(userId);
      await this.writeAuditEvent(membership.organizationId, userId, 'device.push_token.updated', deviceId, {}, now);
    }
    return device;
  }

  async unregisterDevice(deviceId: string, userId: string, now = new Date().toISOString()): Promise<DeviceRecord | null> {
    await this.pool.query('UPDATE devices SET unregistered_at = $1, expo_push_token = NULL, updated_at = $2 WHERE device_id = $3 AND user_id = $4', [now, now, deviceId, userId]);
    const device = await this.getDeviceForUser(deviceId, userId);
    if (device) {
      const membership = await this.defaultMembershipForUser(userId);
      await this.writeAuditEvent(membership.organizationId, userId, 'device.unregistered', deviceId, {}, now);
    }
    return device;
  }

  async createEventTicket(input: EventTicketInput, now = new Date().toISOString()): Promise<EventTicketRecord> {
    const ticket = `evt_${randomToken()}`;
    const ttlSeconds = Math.min(Math.max(input.ttlSeconds ?? 60, 5), 300);
    const expiresAt = new Date(new Date(now).getTime() + ttlSeconds * 1000).toISOString();
    await this.pool.query(
      'INSERT INTO event_tickets(ticket_hash, source, organization_id, user_id, agent_id, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [hashToken(ticket), input.source, input.organizationId, input.userId ?? null, input.agentId ?? null, expiresAt, now]
    );
    return { ticket, expiresAt };
  }

  async verifyEventTicket(ticket: string, now = new Date().toISOString()): Promise<EventTicketAuth | null> {
    if (!ticket.startsWith('evt_')) return null;
    const tokenHash = hashToken(ticket);
    const row = await this.one<EventTicketRow>('SELECT * FROM event_tickets WHERE ticket_hash = $1 AND expires_at > $2', [tokenHash, now]);
    if (!row) return null;
    const used = await this.pool.query('UPDATE event_tickets SET last_used_at = $1 WHERE ticket_hash = $2 AND last_used_at IS NULL', [now, tokenHash]);
    if (used.rowCount === 0) return null;
    return {
      source: row.source,
      organizationId: row.organization_id,
      userId: row.user_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      expiresAt: row.expires_at
    };
  }

  async createApprovalWaiterToken(requestId: string, organizationId: string, agentId: string, requestExpiresAt: string | undefined, now = new Date().toISOString()): Promise<ApprovalWaiterTokenRecord> {
    const token = `wait_${randomToken()}`;
    const expiresAt = waiterExpiresAt(now, requestExpiresAt);
    await this.pool.query(
      'INSERT INTO approval_waiter_tokens(token_hash, request_id, organization_id, agent_id, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [hashToken(token), requestId, organizationId, agentId, expiresAt, now]
    );
    return { token, expiresAt };
  }

  async verifyApprovalWaiterToken(token: string, requestId: string, now = new Date().toISOString()): Promise<ApprovalWaiterAuth | null> {
    if (!token.startsWith('wait_')) return null;
    const tokenHash = hashToken(token);
    const row = await this.one<ApprovalWaiterTokenRow>('SELECT * FROM approval_waiter_tokens WHERE token_hash = $1 AND request_id = $2 AND expires_at > $3', [tokenHash, requestId, now]);
    if (!row) return null;
    await this.pool.query('UPDATE approval_waiter_tokens SET last_used_at = $1 WHERE token_hash = $2', [now, tokenHash]);
    return {
      requestId: row.request_id,
      organizationId: row.organization_id,
      agentId: row.agent_id,
      expiresAt: row.expires_at
    };
  }

  async recordHeartbeat(userId: string, organizationId: string, now = new Date().toISOString()): Promise<AvailabilityRecord> {
    await this.pool.query(
      `
        INSERT INTO user_availability(user_id, organization_id, state, last_seen_at, updated_at)
        VALUES ($1, $2, COALESCE((SELECT state FROM user_availability WHERE user_id = $3 AND organization_id = $4), 'available'), $5, $6)
        ON CONFLICT(user_id, organization_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
      `,
      [userId, organizationId, userId, organizationId, now, now]
    );
    return (await this.getAvailability(userId, organizationId)) ?? missingAvailability(userId);
  }

  async setAvailability(userId: string, organizationId: string, state: string, now = new Date().toISOString()): Promise<AvailabilityRecord> {
    await this.pool.query(
      `
        INSERT INTO user_availability(user_id, organization_id, state, last_seen_at, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT(user_id, organization_id) DO UPDATE SET state = excluded.state, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
      `,
      [userId, organizationId, state, now, now]
    );
    return (await this.getAvailability(userId, organizationId)) ?? missingAvailability(userId);
  }

  async getAvailability(userId: string, organizationId: string): Promise<AvailabilityRecord | null> {
    const row = await this.one<AvailabilityRow>('SELECT * FROM user_availability WHERE user_id = $1 AND organization_id = $2', [userId, organizationId]);
    return row ? mapAvailabilityRow(row) : null;
  }

  async createAgentStatusUpdate(input: CreateAgentStatusInput, now = new Date().toISOString()): Promise<AgentStatusUpdate> {
    const parsed = CreateAgentStatusUpdateSchema.parse(input);
    const statusId = newID('stat');
    await this.pool.query(
      `
        INSERT INTO agent_status_updates(
          status_id, organization_id, agent_id, agent_name, thread_id, message, state,
          next_step, host, working_directory, project_name, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        statusId,
        input.organizationId,
        input.agentId,
        input.agentName,
        parsed.threadId,
        parsed.message,
        parsed.state,
        parsed.nextStep ?? null,
        parsed.host ?? null,
        parsed.workingDirectory ?? null,
        parsed.projectName ?? null,
        JSON.stringify(parsed.metadata ?? {}),
        now
      ]
    );
    await this.writeAuditEvent(input.organizationId, input.userId ?? input.agentId, 'agent_status.updated', statusId, { threadId: parsed.threadId, state: parsed.state }, now);
    return (await this.getAgentStatusUpdate(statusId, input.organizationId)) ?? missingAgentStatus(statusId);
  }

  async getAgentStatusUpdate(statusId: string, organizationId: string): Promise<AgentStatusUpdate | null> {
    const row = await this.one<AgentStatusRow>('SELECT * FROM agent_status_updates WHERE status_id = $1 AND organization_id = $2', [statusId, organizationId]);
    return row ? mapAgentStatusRow(row) : null;
  }

  async listLatestAgentStatusUpdates(organizationId: string, limit = 20): Promise<AgentStatusUpdate[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const rows = await this.many<AgentStatusRow>(
      `
        SELECT s.*
        FROM agent_status_updates s
        JOIN (
          SELECT thread_id, MAX(created_at || status_id) AS latest_key
          FROM agent_status_updates
          WHERE organization_id = $1
          GROUP BY thread_id
        ) latest ON latest.thread_id = s.thread_id AND latest.latest_key = s.created_at || s.status_id
        WHERE s.organization_id = $2
        ORDER BY s.created_at DESC, s.status_id DESC
        LIMIT $3
      `,
      [organizationId, organizationId, safeLimit]
    );
    return rows.map(mapAgentStatusRow);
  }

  async recordMobileDiagnostics(events: MobileDiagnosticInput[]): Promise<number> {
    if (events.length === 0) return 0;
    return this.transaction(async (query) => {
      for (const event of events) {
        await query(
          `
            INSERT INTO mobile_diagnostics(diagnostic_id, organization_id, user_id, device_id, level, area, message, metadata_json, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [newID('diag'), event.organizationId, event.userId, event.deviceId ?? null, event.level, event.area, event.message, event.metadata === undefined ? null : JSON.stringify(event.metadata), event.createdAt]
        );
      }
      return events.length;
    });
  }

  async listMobileDiagnostics(organizationId: string, limit = 100): Promise<MobileDiagnosticRecord[]> {
    const rows = await this.many<MobileDiagnosticRow>(
      'SELECT * FROM mobile_diagnostics WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2',
      [organizationId, Math.min(Math.max(Math.trunc(limit), 1), 500)]
    );
    return rows.map(mapMobileDiagnosticRow);
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

  private async assertSeatAvailableForActivation(organizationId: string, maxActiveMembers: number | undefined): Promise<void> {
    if (maxActiveMembers === undefined) return;
    const limit = Math.trunc(maxActiveMembers);
    if (limit < 1) return;
    const activeMembers = (await this.organizationSeatUsage(organizationId)).activeMembers;
    if (activeMembers >= limit) throw httpError(409, 'conflict', 'Organization active member seat limit reached');
  }

  private async membershipRequestRows(where: string, params: unknown[], orderBy: string): Promise<OrganizationMembershipRequestRow[]> {
    return this.many<OrganizationMembershipRequestRow>(
      `
        SELECT a.request_id, a.invite_id, a.organization_id, o.name AS organization_name, a.user_id, u.email AS user_email, u.name AS user_name,
               i.label AS invite_label, i.revoked_at AS invite_revoked_at, a.requested_role, a.requested_team_ids_json, a.status, a.accepted_at, a.decided_by_user_id, a.decided_at
        FROM organization_invite_acceptances a
        JOIN organizations o ON o.id = a.organization_id
        JOIN users u ON u.id = a.user_id
        JOIN organization_invites i ON i.invite_id = a.invite_id
        WHERE ${where}
        ORDER BY ${orderBy}
      `,
      params
    );
  }

  private async expirePendingApprovals(organizationId: string, now: string): Promise<void> {
    const rows = await this.many<{ id: string; organization_id: string }>(
      'SELECT id, organization_id FROM approval_requests WHERE organization_id = $1 AND status = $2 AND expires_at IS NOT NULL AND expires_at <= $3',
      [organizationId, 'pending', now]
    );
    for (const row of rows) await this.markApprovalExpired(row.id, row.organization_id, now);
  }

  private async expirePendingApproval(id: string, organizationId: string | undefined, now: string): Promise<void> {
    const row = organizationId
      ? await this.one<{ id: string; organization_id: string }>('SELECT id, organization_id FROM approval_requests WHERE id = $1 AND organization_id = $2 AND status = $3 AND expires_at IS NOT NULL AND expires_at <= $4', [id, organizationId, 'pending', now])
      : await this.one<{ id: string; organization_id: string }>('SELECT id, organization_id FROM approval_requests WHERE id = $1 AND status = $2 AND expires_at IS NOT NULL AND expires_at <= $3', [id, 'pending', now]);
    if (row) await this.markApprovalExpired(row.id, row.organization_id, now);
  }

  private async markApprovalExpired(id: string, organizationId: string, now: string): Promise<void> {
    const result = await this.pool.query('UPDATE approval_requests SET status = $1, responded_at = $2, response_json = $3 WHERE id = $4 AND organization_id = $5 AND status = $6', [
      'expired',
      now,
      JSON.stringify({ message: 'expired' }),
      id,
      organizationId,
      'pending'
    ]);
    if ((result.rowCount ?? 0) > 0) await this.writeAuditEvent(organizationId, 'system', 'approval.expired', id, {}, now);
  }

  private async approvalRow(id: string, organizationId?: string): Promise<ApprovalRow | null> {
    return organizationId
      ? this.one<ApprovalRow>('SELECT * FROM approval_requests WHERE id = $1 AND organization_id = $2', [id, organizationId])
      : this.one<ApprovalRow>('SELECT * FROM approval_requests WHERE id = $1', [id]);
  }

  private async mapApprovalWithProgress(row: ApprovalRow, currentUserId?: string): Promise<ApprovalRequest> {
    return mapApprovalRow(row, await this.approvalPolicyProgress(row, currentUserId));
  }

  private async approvalPolicyProgress(row: ApprovalRow, currentUserId?: string): Promise<ApprovalPolicyProgress | undefined> {
    const policy = await this.approvalPolicyForRow(row);
    if (!policy) return undefined;
    const voteRows = await this.many<ApprovalVoteRow>('SELECT * FROM approval_votes WHERE request_id = $1 ORDER BY step ASC, created_at ASC', [row.id]);
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

  private async approvalPolicyForRow(row: ApprovalRow): Promise<PolicyRow | null> {
    const metadata = parseJSON<Record<string, string>>(row.metadata_json, {});
    return this.approvalPolicyForMetadata(row.organization_id, metadata);
  }

  private async approvalPolicyForMetadata(organizationId: string, metadata: Record<string, string>): Promise<PolicyRow | null> {
    const policyId = metadata.defaultApprovalPolicy || metadata.policyId;
    if (!policyId) return null;
    return this.one<PolicyRow>('SELECT * FROM policies WHERE policy_id = $1 AND organization_id = $2 AND enabled = true AND archived_at IS NULL', [policyId, organizationId]);
  }

  private async resolveApprovalRecipients(input: { organizationId: string; requesterUserId?: string; policy: PolicyRow | null }): Promise<Array<{ userId: string; source: string }>> {
    const recipients = new Map<string, string>();
    if (input.requesterUserId) recipients.set(input.requesterUserId, 'requester');
    if (input.policy?.team_id) {
      const rows = await this.many<{ user_id: string; role: string; organization_role: string; availability: string }>(
        `
          SELECT tm.user_id, tm.role, om.role AS organization_role, COALESCE(ua.state, 'available') AS availability
          FROM team_memberships tm
          JOIN organization_memberships om ON om.organization_id = tm.organization_id AND om.user_id = tm.user_id AND om.status = 'active'
          LEFT JOIN user_availability ua ON ua.organization_id = tm.organization_id AND ua.user_id = tm.user_id
          WHERE tm.organization_id = $1 AND tm.team_id = $2
          ORDER BY tm.created_at ASC
        `,
        [input.organizationId, input.policy.team_id]
      );
      const eligible = rows.filter((row) => approvalTeamRoleCanRespond(row.role) && approvalOrganizationRoleCanRespond(row.organization_role));
      for (const row of eligible) {
        if (row.availability === 'available') recipients.set(row.user_id, 'policy_team');
      }
      if (!recipients.size) {
        for (const row of eligible) recipients.set(row.user_id, 'unrouted_unavailable');
        for (const member of await this.listOrganizationMembers(input.organizationId)) {
          if (member.role === 'owner' || member.role === 'admin') recipients.set(member.userId, 'unrouted_admin');
        }
      }
    } else {
      const members = await this.listOrganizationMembers(input.organizationId);
      for (const member of members) {
        if (approvalOrganizationRoleCanRespond(member.role)) recipients.set(member.userId, input.policy ? 'policy_org' : 'organization');
      }
    }
    if (!recipients.size) recipients.set(input.requesterUserId ?? DEFAULT_USER_ID, 'fallback');
    return [...recipients.entries()].map(([userId, source]) => ({ userId, source }));
  }

  private async approvalRecipientExists(requestId: string, userId: string): Promise<boolean> {
    return Boolean(await this.one('SELECT 1 FROM approval_recipients WHERE request_id = $1 AND user_id = $2', [requestId, userId]));
  }

  private async markApprovalRecipientResponded(requestId: string, userId: string, now: string): Promise<void> {
    await this.pool.query("UPDATE approval_recipients SET status = 'responded', responded_at = $1, updated_at = $2 WHERE request_id = $3 AND user_id = $4", [now, now, requestId, userId]);
  }

  private async assertApprovalResponderEligible(row: ApprovalRow, responderUserId: string, policy: PolicyRow | null): Promise<void> {
    const membership = await this.organizationMembershipForUser(responderUserId, row.organization_id);
    if (!membership) throw httpError(403, 'forbidden', 'Responder is not an active member of this organization');
    if (!approvalOrganizationRoleCanRespond(membership.role)) throw httpError(403, 'forbidden', 'Responder role is not eligible to approve requests');
    if (policy?.team_id) {
      const teamRole = await this.teamMembershipRole(policy.team_id, row.organization_id, responderUserId);
      if (!teamRole || !approvalTeamRoleCanRespond(teamRole)) throw httpError(403, 'forbidden', 'Responder is not eligible for this team approval policy');
    }
    if (!(await this.approvalRecipientExists(row.id, responderUserId))) throw httpError(403, 'forbidden', 'Responder is not a recipient for this approval request');
  }

  private async teamMembershipRole(teamId: string, organizationId: string, userId: string): Promise<string | null> {
    const row = await this.one<{ role: string }>('SELECT role FROM team_memberships WHERE team_id = $1 AND organization_id = $2 AND user_id = $3', [teamId, organizationId, userId]);
    return row?.role ?? null;
  }

  private async respondToApprovalRow(row: ApprovalRow, response: RespondApprovalRequest, responderUserId: string, now: string): Promise<ApprovalRequest> {
    const parsed = RespondApprovalRequestSchema.parse(response);
    const current = await this.mapApprovalWithProgress(row, responderUserId);
    if (current.status !== 'pending') return current;
    if (parsed.choiceId && !current.choices.some((choice) => choice.id === parsed.choiceId)) throw httpError(400, 'bad_request', `unknown choiceId: ${parsed.choiceId}`);
    const choice = parsed.choiceId ? current.choices.find((candidate) => candidate.id === parsed.choiceId) : undefined;
    if (row.encrypted_payload_json && parsed.encryptedPayloadAcknowledged !== true && choice?.kind !== 'deny') throw httpError(400, 'bad_request', 'Encrypted approval requests must be decrypted before approving');
    const policy = await this.approvalPolicyForRow(row);
    await this.assertApprovalResponderEligible(row, responderUserId, policy);
    if (policy && policy.required_approvals > 1 && parsed.choiceId) {
      await this.recordApprovalVote(row.id, policy.policy_id, responderUserId, parsed, now);
      await this.markApprovalRecipientResponded(row.id, responderUserId, now);
      await this.writeAuditEvent(row.organization_id, responderUserId, 'approval.vote_recorded', row.id, { policyId: policy.policy_id, choiceId: parsed.choiceId }, now);
      if (parsed.choiceId === 'approve' && (await this.approvalVoteCount(row.id, 'approve')) < policy.required_approvals) {
        return (await this.getApprovalRequestForOrganization(row.id, row.organization_id, responderUserId)) ?? missingApproval(row.id);
      }
    }
    await this.pool.query('UPDATE approval_requests SET status = $1, response_json = $2, responded_at = $3 WHERE id = $4 AND organization_id = $5 AND status = $6', ['responded', JSON.stringify(parsed), now, row.id, row.organization_id, 'pending']);
    await this.markApprovalRecipientResponded(row.id, responderUserId, now);
    await this.writeAuditEvent(row.organization_id, responderUserId, 'approval.responded', row.id, parsed, now);
    return (await this.getApprovalRequestForOrganization(row.id, row.organization_id, responderUserId)) ?? missingApproval(row.id);
  }

  private async recordApprovalVote(requestId: string, policyId: string, responderUserId: string, response: RespondApprovalRequest, now: string): Promise<void> {
    const parsed = RespondApprovalRequestSchema.parse(response);
    await this.pool.query(
      `
        INSERT INTO approval_votes(vote_id, request_id, policy_id, step, approver_user_id, source, choice_id, message, answers_json, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT(request_id, approver_user_id, step) DO UPDATE SET
          choice_id = excluded.choice_id,
          message = excluded.message,
          answers_json = excluded.answers_json,
          updated_at = excluded.updated_at
      `,
      [newID('vote'), requestId, policyId, 1, responderUserId, 'human', parsed.choiceId ?? 'response', parsed.message ?? null, parsed.answers ? JSON.stringify(parsed.answers) : null, now, now]
    );
  }

  private async approvalVoteCount(requestId: string, choiceId: string): Promise<number> {
    const row = await this.one<{ count: string }>('SELECT COUNT(*) AS count FROM approval_votes WHERE request_id = $1 AND step = 1 AND choice_id = $2', [requestId, choiceId]);
    return Number(row?.count ?? 0);
  }

  private async abandonApprovalRow(row: ApprovalRow, actorId: string, now: string): Promise<ApprovalRequest> {
    const current = await this.mapApprovalWithProgress(row);
    if (current.status !== 'pending') return current;
    await this.pool.query('UPDATE approval_requests SET status = $1, responded_at = $2, response_json = $3 WHERE id = $4 AND organization_id = $5 AND status = $6', ['abandoned', now, JSON.stringify({ message: 'abandoned' }), row.id, row.organization_id, 'pending']);
    await this.writeAuditEvent(row.organization_id, actorId, 'approval.abandoned', row.id, {}, now);
    return (await this.getApprovalRequestForOrganization(row.id, row.organization_id)) ?? missingApproval(row.id);
  }

  private async uniqueProjectSlug(organizationId: string, input: string): Promise<string> {
    return this.uniqueSlug('projects', 'slug', organizationId, input);
  }

  private async uniqueTeamSlug(organizationId: string, input: string): Promise<string> {
    return this.uniqueSlug('teams', 'slug', organizationId, input);
  }

  private async uniqueSlug(table: 'projects' | 'teams', column: 'slug', organizationId: string, input: string): Promise<string> {
    const base = slugify(input);
    let candidate = base;
    let suffix = 2;
    while (await this.one(`SELECT 1 FROM ${table} WHERE organization_id = $1 AND ${column} = $2`, [organizationId, candidate])) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
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
    const auditOrganizations = new Set<string>();
    const query = async <R extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) => {
      const result = await client.query<R>(sql, params);
      if (/insert\s+into\s+audit_events/i.test(sql) && typeof params[0] === 'string') auditOrganizations.add(params[0]);
      return result;
    };
    try {
      await client.query('BEGIN');
      const result = await fn(query);
      await client.query('COMMIT');
      for (const organizationId of auditOrganizations) this.publishAuditWrite(organizationId);
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private publishAuditWrite(organizationId: string): void {
    (this as unknown as { __agentTickPublishAudit?: (organizationId: string) => void }).__agentTickPublishAudit?.(organizationId);
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
    encryptedPayload: parseJSON(row.encrypted_payload_json, undefined),
    choices: parseJSON<Choice[]>(row.choices_json, defaultChoices()),
    questions: parseJSON<Question[]>(row.questions_json, []),
    defaultChoice: row.default_choice ?? undefined,
    allowFreeformReply: Boolean(row.allow_freeform_reply),
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
    { id: 'reject', label: 'Reject', kind: 'deny' }
  ];
}

function mapDeviceRow(row: DeviceRow): DeviceRecord {
  return {
    deviceId: row.device_id,
    userId: row.user_id,
    name: row.name,
    platform: row.platform ?? undefined,
    installationId: row.installation_id ?? undefined,
    expoPushToken: row.expo_push_token ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    unregisteredAt: row.unregistered_at ?? undefined
  };
}

function mapPersonalEntitlementRow(row: PersonalEntitlementRow): PersonalEntitlementRecord {
  return {
    userId: row.user_id,
    trialStartedAt: row.trial_started_at,
    appUnlockedAt: row.app_unlocked_at ?? undefined,
    includedHostedActivatedAt: row.included_hosted_activated_at ?? undefined,
    hostedSubscriptionEndsAt: row.hosted_subscription_ends_at ?? undefined,
    hostedSubscriptionCanceledAt: row.hosted_subscription_canceled_at ?? undefined,
    hostedDataDeletedAt: row.hosted_data_deleted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapBillingProductRow(row: BillingProductRow): BillingProductRecord {
  return {
    id: row.id,
    productKey: row.product_key,
    kind: row.kind,
    entitlementKey: row.entitlement_key,
    appleProductId: row.apple_product_id ?? undefined,
    googleProductId: row.google_product_id ?? undefined,
    googleBasePlanId: row.google_base_plan_id ?? undefined,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapBillingPurchaseAttemptRow(row: BillingPurchaseAttemptRow): BillingPurchaseAttemptRecord {
  return {
    attemptId: row.id,
    userId: row.user_id,
    productKey: row.product_key,
    productGroup: row.product_group,
    platform: row.platform,
    provider: row.provider,
    status: row.status,
    providerUserId: row.provider_user_id ?? undefined,
    idempotencyKey: row.idempotency_key,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapBillingTransactionRow(row: BillingTransactionRow): BillingTransactionRecord {
  return {
    transactionId: row.id,
    userId: row.user_id,
    provider: row.provider,
    environment: row.environment,
    productKey: row.product_key,
    entitlementKey: row.entitlement_key,
    platform: row.platform,
    providerTransactionId: row.provider_transaction_id ?? undefined,
    providerOriginalTransactionId: row.provider_original_transaction_id ?? undefined,
    providerPurchaseToken: row.provider_purchase_token ?? undefined,
    status: row.status,
    purchasedAt: row.purchased_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    canceledAt: row.canceled_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    rawEventJSON: row.raw_event_json ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
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

function mapAgentStatusRow(row: AgentStatusRow): AgentStatusUpdate {
  return AgentStatusUpdateSchema.parse({
    statusId: row.status_id,
    organizationId: row.organization_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    threadId: row.thread_id,
    message: row.message,
    state: row.state,
    nextStep: row.next_step ?? undefined,
    host: row.host ?? undefined,
    workingDirectory: row.working_directory ?? undefined,
    projectName: row.project_name ?? undefined,
    metadata: parseJSON<Record<string, string>>(row.metadata_json, {}),
    createdAt: row.created_at
  });
}

function mapMobileDiagnosticRow(row: MobileDiagnosticRow): MobileDiagnosticRecord {
  return {
    diagnosticId: row.diagnostic_id,
    organizationId: row.organization_id,
    userId: row.user_id,
    ...(row.device_id ? { deviceId: row.device_id } : {}),
    level: row.level,
    area: row.area,
    message: row.message,
    ...(row.metadata_json ? { metadata: parseJSON<unknown>(row.metadata_json, undefined) } : {}),
    createdAt: row.created_at
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function domainFromEmail(email: string | undefined): string | undefined {
  const at = email?.lastIndexOf('@') ?? -1;
  return at > 0 ? email?.slice(at + 1).toLowerCase() : undefined;
}

function normalizeInviteDomain(value: string | undefined): string | undefined {
  const candidate = value?.trim().toLowerCase().replace(/^@+/, '');
  if (!candidate) return undefined;
  const labels = candidate.split('.');
  const valid = candidate.length <= 253 && labels.length >= 2 && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (!valid) throw httpError(400, 'bad_request', 'Invite domain must be a valid email domain');
  return candidate;
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

function httpError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function missingOrganization(organizationId: string): never {
  throw new Error(`organization ${organizationId} was not created`);
}

function missingInvite(inviteId: string): never {
  throw new Error(`invite ${inviteId} was not created`);
}

function missingProject(projectId: string): never {
  throw new Error(`project ${projectId} was not created`);
}

function missingTeam(teamId: string): never {
  throw new Error(`team ${teamId} was not created`);
}

function missingPolicy(policyId: string): never {
  throw new Error(`policy ${policyId} was not created`);
}

function missingApproval(id: string): never {
  throw new Error(`approval request ${id} was not created`);
}

function missingDevice(deviceId: string): never {
  throw new Error(`device ${deviceId} was not created`);
}

function missingAvailability(userId: string): never {
  throw new Error(`availability for ${userId} was not recorded`);
}

function missingAgentStatus(statusId: string): never {
  throw new Error(`agent status ${statusId} was not created`);
}

function approvalOrganizationRoleCanRespond(role: string): boolean {
  return ['owner', 'admin', 'approver', 'member'].includes(role);
}

function approvalTeamRoleCanRespond(role: string): boolean {
  return ['owner', 'lead', 'member'].includes(role);
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

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
