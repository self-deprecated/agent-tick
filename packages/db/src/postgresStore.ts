import crypto from 'node:crypto';
import { type QueryResultRow } from 'pg';
import { AgentStatusUpdateSchema, CreateAgentStatusUpdateSchema, type AgentStatusUpdate } from '@agent-tick/shared';
import { PostgresStoreConnection, type PostgresStoreOptions } from './postgres.js';
import type {
  AgentCredential,
  AgentTokenAuth,
  AgentTokenRecord,
  ApprovalWaiterAuth,
  ApprovalWaiterTokenRecord,
  AuditEventRecord,
  CleanupExpiredSecretsResult,
  CleanupRetentionResult,
  CreateAgentStatusInput,
  CreateAgentTokenInput,
  EventTicketAuth,
  EventTicketInput,
  EventTicketRecord,
  HumanIdentityResult,
  CreatePolicyInput,
  CreateProjectInput,
  CreateTeamInput,
  OrganizationMembershipRecord,
  MobileDiagnosticInput,
  MobileDiagnosticRecord,
  OrganizationSeatUsage,
  PolicyRecord,
  ProjectRecord,
  RemoveTeamMemberInput,
  RetentionPolicy,
  TeamMembershipRecord,
  TeamRecord,
  UpdatePolicyInput,
  UpsertTeamMemberInput,
  UserProfileRecord,
  AvailabilityRecord
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

  async listProjects(organizationId = DEFAULT_ORGANIZATION_ID): Promise<ProjectRecord[]> {
    const rows = await this.many<ProjectRow>(
      'SELECT * FROM projects WHERE organization_id = $1 ORDER BY archived_at IS NOT NULL, lower(name) ASC',
      [organizationId]
    );
    return rows.map(mapProjectRow);
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

function missingProject(projectId: string): never {
  throw new Error(`project ${projectId} was not created`);
}

function missingTeam(teamId: string): never {
  throw new Error(`team ${teamId} was not created`);
}

function missingPolicy(policyId: string): never {
  throw new Error(`policy ${policyId} was not created`);
}

function missingAvailability(userId: string): never {
  throw new Error(`availability for ${userId} was not recorded`);
}

function missingAgentStatus(statusId: string): never {
  throw new Error(`agent status ${statusId} was not created`);
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
