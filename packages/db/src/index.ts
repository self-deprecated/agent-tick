import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { isPostgresDatabaseURL } from './postgres.js';
export { isPostgresDatabaseURL, PostgresStoreConnection } from './postgres.js';
export { PostgresAgentTickStore } from './postgresStore.js';
import {
  CreateAgentTokenSchema,
  CreateRequestSchema,
  CreateRoutingRuleSchema,
  CreateStatusUpdateSchema,
  RequestRecordSchema,
  RespondRequestSchema,
  RoutingRuleRecordSchema,
  StatusUpdateRecordSchema,
  type ActivityItem,
  type AgentCredential,
  type AgentTokenRecord,
  type AvailabilityRecord,
  type BillingProduct,
  type Choice,
  type CreateAgentToken,
  type CreateRequest,
  type CreateRoutingRule,
  type CreateStatusUpdate,
  type DeviceCredential,
  type DeviceRecord,
  type RequiredResponseMode,
  type RequestRecord,
  type RequestRecipient,
  type RequestWaiterCredential,
  type ResponseRecord,
  type RespondRequest,
  type RoutingRuleRecord,
  type StatusUpdateRecord,
  type UpdateAgentToken,
  type UpdateRoutingRule,
  type WorkspaceMemberRecord,
  type WorkspaceRecord,
  type WorkspaceRole,
  type WorkspaceType
} from '@self-deprecated/agent-tick-shared';

export const DEFAULT_USER_ID = 'usr_default';
export const DEFAULT_WORKSPACE_ID = 'wsp_default';

export interface OpenStoreOptions {
  databaseURL?: string;
}

export type Awaitable<T> = T | Promise<T>;

export interface ClerkIdentityProfile {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  authMethod?: string;
}

export interface HumanIdentityResult {
  userId: string;
  workspaceId: string;
  role: string;
}

export interface UserProfileRecord {
  userId: string;
  email?: string;
  name?: string;
  signInMethod?: string;
}

export interface AgentTokenAuth {
  source: 'agent';
  agentTokenId: string;
  label: string;
  scopes: string[];
  workspaceId: string;
  workspaceType: WorkspaceType;
  routingRuleId: string | undefined;
  creatorUserId: string | undefined;
}

export interface CreateAgentTokenInput extends CreateAgentToken {
  creatorUserId?: string;
}

export interface CreateStatusUpdateInput extends CreateStatusUpdate {
  workspaceId: string;
  agentTokenId?: string;
  agentTokenLabel?: string;
  routingRuleId?: string;
  userId?: string;
  isTest?: boolean;
  testLabel?: string;
}

export interface CreateRequestInput extends CreateRequest {
  workspaceId?: string;
  agentTokenId?: string;
  routingRuleId?: string;
  userId?: string;
  isTest?: boolean;
  testLabel?: string;
}

export interface DeviceRegistrationInput {
  userId: string;
  deviceName: string;
  platform?: string;
  installationId?: string;
  expoPushToken?: string;
}

export interface DeviceTokenAuth {
  source: 'device';
  deviceId: string;
  userId: string;
  workspaceId: string;
}

export interface PairingTokenRecord {
  token: string;
  expiresAt: string;
}

export interface EventTicketInput {
  source: string;
  workspaceId: string;
  userId: string;
  ttlSeconds?: number;
}

export interface EventTicketRecord {
  ticket: string;
  expiresAt: string;
}

export interface EventTicketAuth {
  source: string;
  workspaceId: string;
  userId: string;
}

export interface RequestWaiterAuth {
  requestId: string;
  workspaceId: string;
  agentTokenId: string;
}

export interface RequestWaiterTokenRecord extends RequestWaiterCredential {}

export interface AuditEventRecord {
  eventId: number;
  workspaceId: string;
  userId: string;
  eventType: string;
  targetId: string;
  payload: unknown;
  createdAt: string;
}

export interface MobileDiagnosticInput {
  workspaceId: string;
  userId: string;
  deviceId?: string;
  level: string;
  area: string;
  message: string;
  metadata?: unknown;
  createdAt: string;
}

export interface MobileDiagnosticRecord extends MobileDiagnosticInput {
  diagnosticId: string;
}

export interface BillingProductRecord {
  id: string;
  productKey: string;
  kind: string;
  entitlementKey: string;
  appleProductId?: string;
  googleProductId?: string;
  googleBasePlanId?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertBillingProductInput {
  productKey: string;
  kind: string;
  entitlementKey: string;
  appleProductId?: string | null;
  googleProductId?: string | null;
  googleBasePlanId?: string | null;
  active?: boolean;
}

export interface PersonalEntitlementRecord {
  userId: string;
  trialStartedAt: string;
  appUnlockedAt?: string;
  includedHostedActivatedAt?: string;
  hostedSubscriptionEndsAt?: string;
  hostedSubscriptionCanceledAt?: string;
  hostedDataDeletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdatePersonalEntitlementInput {
  userId: string;
  appUnlockedAt?: string | null;
  includedHostedActivatedAt?: string | null;
  hostedSubscriptionEndsAt?: string | null;
  hostedSubscriptionCanceledAt?: string | null;
  hostedDataDeletedAt?: string | null;
}

export interface BillingPurchaseAttemptRecord {
  attemptId: string;
  userId: string;
  productKey: string;
  productGroup: string;
  platform: string;
  provider: string;
  status: string;
  providerUserId?: string;
  idempotencyKey: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBillingPurchaseAttemptInput {
  userId: string;
  productKey: string;
  productGroup: string;
  platform: string;
  provider: string;
  providerUserId?: string;
  idempotencyKey: string;
  expiresAt: string;
}

export interface BillingTransactionRecord {
  transactionId: string;
  userId: string;
  provider: string;
  environment: string;
  productKey: string;
  entitlementKey: string;
  platform: string;
  providerTransactionId?: string;
  providerOriginalTransactionId?: string;
  providerPurchaseToken?: string;
  status: string;
  purchasedAt?: string;
  expiresAt?: string;
  canceledAt?: string;
  revokedAt?: string;
  rawEventJSON?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertBillingTransactionInput {
  userId: string;
  provider: string;
  environment: string;
  productKey: string;
  entitlementKey: string;
  platform: string;
  providerTransactionId?: string | null;
  providerOriginalTransactionId?: string | null;
  providerPurchaseToken?: string | null;
  status: string;
  purchasedAt?: string | null;
  expiresAt?: string | null;
  canceledAt?: string | null;
  revokedAt?: string | null;
  rawEventJSON?: string | null;
}

export interface UpsertBillingTransactionResult {
  record: BillingTransactionRecord;
  created: boolean;
}

export interface CleanupExpiredSecretsResult {
  eventTickets: number;
  pairingCodes: number;
  requestWaiterTokens: number;
}

export interface RetentionPolicy {
  requestsDays?: number;
  statusUpdatesDays?: number;
  auditEventsDays?: number;
  unregisteredDevicesDays?: number;
}

export interface CleanupRetentionResult {
  requests: number;
  statusUpdates: number;
  auditEvents: number;
  devices: number;
}

export interface DeleteWorkspaceDataResult {
  workspaceId: string;
  agentTokensRevoked: number;
  devicesUnregistered: number;
  deleted: boolean;
}

export interface AsyncAgentTickStore {
  ping(): Awaitable<void>;
  close(): Awaitable<void>;
  migrate(now?: string): Awaitable<void>;
  ensureSingleTenantDefaults(now?: string): Awaitable<void>;
  cleanupExpiredSecrets(now?: string): Awaitable<CleanupExpiredSecretsResult>;
  cleanupRetention(policy?: RetentionPolicy, now?: string): Awaitable<CleanupRetentionResult>;
  loginOrCreateClerkIdentity(profile: ClerkIdentityProfile, now?: string): Awaitable<HumanIdentityResult>;
  upsertClerkUser(profile: ClerkIdentityProfile, now?: string): Awaitable<string>;
  userIdForClerkSubject(issuer: string, subject: string): Awaitable<string | null>;
  defaultMembershipForUser(userId: string): Awaitable<HumanIdentityResult>;
  userProfile(userId: string): Awaitable<UserProfileRecord | null>;
  listWorkspacesForUser(userId: string): Awaitable<WorkspaceMemberRecord[]>;
  listWorkspaceMembers(workspaceId: string): Awaitable<WorkspaceMemberRecord[]>;
  workspaceMembershipForUser(userId: string, workspaceId: string): Awaitable<HumanIdentityResult | null>;
  workspaceMembershipForUserAnyStatus(userId: string, workspaceId: string): Awaitable<WorkspaceMemberRecord | null>;
  createSharedWorkspaceForUser(userId: string, name: string, now?: string, clerkOrganizationId?: string): Awaitable<WorkspaceMemberRecord>;
  workspaceByClerkOrganizationId(clerkOrganizationId: string): Awaitable<WorkspaceRecord | null>;
  upsertClerkWorkspace(clerkOrganizationId: string, name: string, ownerUserId?: string, now?: string): Awaitable<WorkspaceRecord>;
  upsertClerkWorkspaceMember(clerkOrganizationId: string, clerkMembershipId: string | undefined, userId: string, role: WorkspaceRole | string, now?: string): Awaitable<WorkspaceMemberRecord>;
  removeClerkWorkspaceMember(clerkOrganizationId: string, userIdOrMembershipId: string, now?: string): Awaitable<void>;
  revokeUserAccess(userId: string, now?: string): Awaitable<void>;
  updateWorkspace(workspaceId: string, name: string, now?: string): Awaitable<WorkspaceRecord | null>;
  addWorkspaceMemberByEmail(workspaceId: string, email: string, role?: WorkspaceRole | string, now?: string): Awaitable<WorkspaceMemberRecord>;
  removeWorkspaceMember(workspaceId: string, userId: string, now?: string): Awaitable<void>;
  workspaceSeatUsage(workspaceId: string): Awaitable<{ activeMembers: number; pendingMembers: number }>;
  deleteWorkspaceData(workspaceId: string, now?: string): Awaitable<DeleteWorkspaceDataResult>;
  createRoutingRule(input: CreateRoutingRule, now?: string): Awaitable<RoutingRuleRecord>;
  listRoutingRules(workspaceId: string): Awaitable<RoutingRuleRecord[]>;
  getRoutingRule(routingRuleId: string): Awaitable<RoutingRuleRecord | null>;
  updateRoutingRule(routingRuleId: string, input: UpdateRoutingRule, now?: string): Awaitable<RoutingRuleRecord | null>;
  deleteRoutingRule(routingRuleId: string, workspaceId: string, now?: string): Awaitable<boolean>;
  createAgentToken(input: CreateAgentTokenInput, now?: string): Awaitable<AgentCredential>;
  listAgentTokens(workspaceId?: string): Awaitable<AgentTokenRecord[]>;
  updateAgentToken(agentTokenId: string, workspaceId: string, input: UpdateAgentToken, now?: string): Awaitable<AgentTokenRecord | null>;
  revokeAgentToken(agentTokenId: string, workspaceId?: string, now?: string): Awaitable<AgentTokenRecord | null>;
  revokeAgentTokensForOwner(userId: string, now?: string): Awaitable<number>;
  verifyAgentToken(token: string, now?: string): Awaitable<AgentTokenAuth | null>;
  createRequest(input: CreateRequestInput, now?: string): Awaitable<RequestRecord>;
  listRequestsForUser(userId: string, workspaceId?: string, now?: string): Awaitable<RequestRecord[]>;
  getRequestForUser(id: string, userId: string, now?: string): Awaitable<RequestRecord | null>;
  getRequestForWorkspace(id: string, workspaceId: string, currentUserId?: string, now?: string): Awaitable<RequestRecord | null>;
  respondToRequestForWorkspace(id: string, workspaceId: string, response: RespondRequest, responderUserId: string, now?: string): Awaitable<RequestRecord | null>;
  abandonRequestForWorkspace(id: string, workspaceId: string, actorId: string, now?: string): Awaitable<RequestRecord | null>;
  createRequestWaiterToken(requestId: string, workspaceId: string, agentTokenId: string, requestDeadline?: string, now?: string): Awaitable<RequestWaiterTokenRecord>;
  verifyRequestWaiterToken(token: string, requestId: string, now?: string): Awaitable<RequestWaiterAuth | null>;
  createStatusUpdate(input: CreateStatusUpdateInput, now?: string): Awaitable<StatusUpdateRecord>;
  getStatusUpdate(statusId: string, workspaceId: string): Awaitable<StatusUpdateRecord | null>;
  listLatestStatusUpdates(workspaceId: string, limit?: number): Awaitable<StatusUpdateRecord[]>;
  listActivityForUser(userId: string, workspaceId?: string, limit?: number, now?: string): Awaitable<ActivityItem[]>;
  pendingRequestCountForUser(userId: string, workspaceId?: string, now?: string): Awaitable<number>;
  registerDevice(input: DeviceRegistrationInput, now?: string): Awaitable<DeviceRecord>;
  listDevicesForUser(userId: string): Awaitable<DeviceRecord[]>;
  listPushDevicesForRequestRecipients(requestId: string): Awaitable<DeviceRecord[]>;
  listPushDevicesForUsers(userIds: string[]): Awaitable<DeviceRecord[]>;
  getDeviceForUser(deviceId: string, userId: string): Awaitable<DeviceRecord | null>;
  updateDeviceName(deviceId: string, userId: string, name: string, now?: string): Awaitable<DeviceRecord | null>;
  updateDevicePushToken(deviceId: string, userId: string, expoPushToken: string, now?: string): Awaitable<DeviceRecord | null>;
  unregisterDevice(deviceId: string, userId: string, now?: string): Awaitable<DeviceRecord | null>;
  createPairingToken(userId: string, workspaceId: string, now?: string, ttlSeconds?: number): Awaitable<PairingTokenRecord>;
  pairDeviceWithCode(pairingCode: string, deviceName: string, platform?: string, now?: string): Awaitable<DeviceCredential | null>;
  verifyDeviceToken(token: string): Awaitable<DeviceTokenAuth | null>;
  recordHeartbeat(userId: string, workspaceId: string, now?: string): Awaitable<AvailabilityRecord>;
  setAvailability(userId: string, workspaceId: string, state: string, now?: string): Awaitable<AvailabilityRecord>;
  getAvailability(userId: string, workspaceId: string): Awaitable<AvailabilityRecord | null>;
  createEventTicket(input: EventTicketInput, now?: string): Awaitable<EventTicketRecord>;
  verifyEventTicket(ticket: string, now?: string): Awaitable<EventTicketAuth | null>;
  recordMobileDiagnostics(events: MobileDiagnosticInput[]): Awaitable<number>;
  listMobileDiagnostics(workspaceId: string, limit?: number): Awaitable<MobileDiagnosticRecord[]>;
  listAuditEvents(workspaceId: string, limit?: number): Awaitable<AuditEventRecord[]>;
  listAuditEventsAfter(workspaceId: string, afterEventId?: number, limit?: number): Awaitable<AuditEventRecord[]>;
  writeAuditEvent(workspaceId: string, userId: string, eventType: string, targetId: string, payload: unknown, now?: string): Awaitable<void>;
  getOrStartPersonalEntitlement(userId: string, now?: string): Awaitable<PersonalEntitlementRecord>;
  updatePersonalEntitlement(input: UpdatePersonalEntitlementInput, now?: string): Awaitable<PersonalEntitlementRecord>;
  upsertBillingProducts(products: UpsertBillingProductInput[], now?: string): Awaitable<void>;
  listBillingProducts(activeOnly?: boolean): Awaitable<BillingProductRecord[]>;
  createBillingPurchaseAttempt(input: CreateBillingPurchaseAttemptInput, now?: string): Awaitable<BillingPurchaseAttemptRecord>;
  updateBillingPurchaseAttemptStatus(attemptId: string, status: string, now?: string): Awaitable<BillingPurchaseAttemptRecord | null>;
  listActiveBillingPurchaseAttempts(userId: string, productGroup: string, now?: string): Awaitable<BillingPurchaseAttemptRecord[]>;
  upsertBillingTransaction(input: UpsertBillingTransactionInput, now?: string): Awaitable<UpsertBillingTransactionResult>;
  listBillingTransactionsForUser(userId: string): Awaitable<BillingTransactionRecord[]>;
  deleteHostedPersonalData(userId: string, workspaceId: string, now?: string): Awaitable<void>;
}

export function openAgentTickStore(options: OpenStoreOptions = {}): AsyncAgentTickStore {
  const databaseURL = options.databaseURL;
  if (isPostgresDatabaseURL(databaseURL)) {
    const error = new Error('PostgreSQL database URLs are not supported by the Agent Tick store in this cutover. Use a SQLite file: URL until the Postgres repository is implemented.') as Error & { code?: string };
    error.code = 'postgres_store_unsupported';
    throw error;
  }
  return AgentTickStore.open(options);
}

export class AgentTickStore implements AsyncAgentTickStore {
  readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  static open(options: OpenStoreOptions = {}): AgentTickStore {
    return new AgentTickStore(new Database(databasePathFromURL(options.databaseURL ?? 'file:./agent-tick.db')));
  }

  ping(): void {
    this.db.prepare('SELECT 1').get();
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    this.db.exec(SQLITE_SCHEMA);
    this.dedupeDeviceInstallations();
  }

  ensureSingleTenantDefaults(now = new Date().toISOString()): void {
    this.db.prepare(`INSERT OR IGNORE INTO users(id, email, email_verified, name, created_at, updated_at) VALUES (?, '', 0, 'Local user', ?, ?)`).run(DEFAULT_USER_ID, now, now);
    this.db.prepare(`INSERT OR IGNORE INTO workspaces(workspace_id, type, name, created_at, updated_at) VALUES (?, 'personal', 'Personal', ?, ?)`).run(DEFAULT_WORKSPACE_ID, now, now);
    this.db.prepare(`INSERT OR IGNORE INTO workspace_members(workspace_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, 'owner', 'active', ?, ?)`).run(DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID, now, now);
    this.ensurePersonalEntitlementRow(DEFAULT_USER_ID, now);
  }

  cleanupExpiredSecrets(now = new Date().toISOString()): CleanupExpiredSecretsResult {
    const eventTickets = this.db.prepare('DELETE FROM event_tickets WHERE expires_at <= ? OR used_at IS NOT NULL').run(now).changes;
    const pairingCodes = this.db.prepare('DELETE FROM device_pairing_codes WHERE expires_at <= ? OR used_at IS NOT NULL').run(now).changes;
    const requestWaiterTokens = this.db.prepare('DELETE FROM request_waiter_tokens WHERE expires_at <= ?').run(now).changes;
    return { eventTickets, pairingCodes, requestWaiterTokens };
  }

  cleanupRetention(policy: RetentionPolicy = {}, now = new Date().toISOString()): CleanupRetentionResult {
    const requests = deleteOlderThan(this.db, 'requests', 'created_at', policy.requestsDays, now);
    const statusUpdates = deleteOlderThan(this.db, 'status_updates', 'created_at', policy.statusUpdatesDays, now);
    const auditEvents = deleteOlderThan(this.db, 'audit_events', 'created_at', policy.auditEventsDays, now);
    const devices = deleteOlderThan(this.db, 'approval_devices', 'unregistered_at', policy.unregisteredDevicesDays, now, 'unregistered_at IS NOT NULL');
    return { requests, statusUpdates, auditEvents, devices };
  }

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
      this.db.prepare('UPDATE users SET email = ?, email_verified = 1, name = ?, sign_in_method = ?, updated_at = ? WHERE id = ?').run(email, profile.name, profile.authMethod ?? null, now, existingIdentity.user_id);
      this.db.prepare('UPDATE auth_identities SET email = ?, email_verified = 1, name = ?, auth_method = ?, last_seen_at = ?, updated_at = ? WHERE provider = ? AND issuer = ? AND subject = ?').run(email, profile.name, profile.authMethod ?? null, now, now, 'clerk', profile.issuer, profile.subject);
      this.ensurePersonalWorkspaceForUser(existingIdentity.user_id, now);
      return existingIdentity.user_id;
    }

    const collision = this.db.prepare('SELECT id, email_verified FROM users WHERE lower(email) = lower(?) AND email <> ?').get(email, '') as { id: string; email_verified: number | boolean } | undefined;
    if (collision) {
      if (Boolean(collision.email_verified)) throw new Error('A local user with this verified email already exists; identity linking is required');
      this.db.prepare('UPDATE users SET email = ?, email_verified = 1, name = ?, sign_in_method = ?, updated_at = ? WHERE id = ?').run(email, profile.name, profile.authMethod ?? null, now, collision.id);
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
      SELECT wm.workspace_id, wm.role
      FROM workspace_members wm
      JOIN workspaces w ON w.workspace_id = wm.workspace_id
      WHERE wm.user_id = ? AND wm.status = 'active' AND w.type = 'personal'
      ORDER BY w.created_at ASC
      LIMIT 1
    `).get(userId) as { workspace_id: string; role: string } | undefined;
    if (!membership) throw new Error('Personal Workspace is missing for user');
    return { userId, workspaceId: membership.workspace_id, role: membership.role };
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
    const row = this.db.prepare('SELECT workspace_id, user_id, role FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND status = ?').get(workspaceId, userId, 'active') as { workspace_id: string; user_id: string; role: string } | undefined;
    return row ? { userId: row.user_id, workspaceId: row.workspace_id, role: row.role } : null;
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
    this.writeAuditEvent(workspaceId, userId, 'workspace.created', workspaceId, { name: name.trim(), type: 'shared', clerkOrganizationId }, now);
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
    this.writeAuditEvent(workspaceId, ownerUserId ?? 'system', 'workspace.clerk_synced', workspaceId, { clerkOrganizationId, name: name.trim() }, now);
    return mapWorkspace(this.workspaceRow(workspaceId)!);
  }

  upsertClerkWorkspaceMember(clerkOrganizationId: string, clerkMembershipId: string | undefined, userId: string, role: WorkspaceRole | string, now = new Date().toISOString()): WorkspaceMemberRecord {
    const workspace = this.workspaceByClerkOrganizationId(clerkOrganizationId);
    if (!workspace) throw new Error('Clerk-backed Shared Workspace not found');
    this.ensureUserExists(userId, now);
    this.db.prepare(`
      INSERT INTO workspace_members(workspace_id, user_id, role, status, clerk_membership_id, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?)
      ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role, status = 'active', clerk_membership_id = excluded.clerk_membership_id, updated_at = excluded.updated_at
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
    this.revokeAgentTokensForOwner(userId, now);
  }

  updateWorkspace(workspaceId: string, name: string, now = new Date().toISOString()): WorkspaceRecord | null {
    const workspace = this.workspaceRow(workspaceId);
    if (!workspace) return null;
    if (workspace.type === 'personal') throw new Error('Personal Workspace cannot be renamed');
    this.db.prepare('UPDATE workspaces SET name = ?, updated_at = ? WHERE workspace_id = ?').run(name.trim(), now, workspaceId);
    return mapWorkspace(this.workspaceRow(workspaceId)!);
  }

  addWorkspaceMemberByEmail(workspaceId: string, emailInput: string, role: WorkspaceRole | string = 'member', now = new Date().toISOString()): WorkspaceMemberRecord {
    const workspace = this.workspaceRow(workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    if (workspace.type === 'personal') throw new Error('Personal Workspace cannot add members');
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
      INSERT INTO workspace_members(workspace_id, user_id, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?)
      ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role, status = 'active', updated_at = excluded.updated_at
    `).run(workspaceId, user.id, role, now, now);
    this.writeAuditEvent(workspaceId, user.id, 'workspace_member.added', user.id, { role, email }, now);
    return this.workspaceMemberOrThrow(user.id, workspaceId);
  }

  removeWorkspaceMember(workspaceId: string, userId: string, now = new Date().toISOString()): void {
    this.db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').run(workspaceId, userId);
    this.db.prepare('DELETE FROM routing_rule_recipients WHERE user_id = ? AND routing_rule_id IN (SELECT routing_rule_id FROM routing_rules WHERE workspace_id = ?)').run(userId, workspaceId);
    const emptyRules = this.db.prepare(`
      SELECT rr.routing_rule_id FROM routing_rules rr
      LEFT JOIN routing_rule_recipients rrr ON rrr.routing_rule_id = rr.routing_rule_id
      WHERE rr.workspace_id = ?
      GROUP BY rr.routing_rule_id
      HAVING COUNT(rrr.user_id) = 0
    `).all(workspaceId) as { routing_rule_id: string }[];
    for (const rule of emptyRules) this.deleteRoutingRule(rule.routing_rule_id, workspaceId, now);
    this.writeAuditEvent(workspaceId, userId, 'workspace_member.removed', userId, {}, now);
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

  createRoutingRule(input: CreateRoutingRule, now = new Date().toISOString()): RoutingRuleRecord {
    const parsed = CreateRoutingRuleSchema.parse(input);
    const workspace = this.workspaceRow(parsed.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    if (workspace.type === 'personal') throw new Error('Personal Workspace advanced routing is reserved for later');
    const recipients = unique(parsed.recipientUserIds);
    for (const userId of recipients) {
      if (!this.workspaceMembershipForUser(userId, parsed.workspaceId)) throw new Error(`Routing Rule recipient is not an active Workspace Member: ${userId}`);
    }
    const routingRuleId = id('rul');
    this.db.prepare('INSERT INTO routing_rules(routing_rule_id, workspace_id, name, required_response_mode, required_response_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(routingRuleId, parsed.workspaceId, parsed.name.trim(), parsed.requiredResponseMode, parsed.requiredResponseCount, now, now);
    const insertRecipient = this.db.prepare('INSERT INTO routing_rule_recipients(routing_rule_id, user_id, created_at) VALUES (?, ?, ?)');
    for (const userId of recipients) insertRecipient.run(routingRuleId, userId, now);
    this.writeAuditEvent(parsed.workspaceId, DEFAULT_USER_ID, 'routing_rule.created', routingRuleId, { name: parsed.name.trim() }, now);
    return this.getRoutingRule(routingRuleId)!;
  }

  listRoutingRules(workspaceId: string): RoutingRuleRecord[] {
    return (this.db.prepare('SELECT * FROM routing_rules WHERE workspace_id = ? ORDER BY lower(name)').all(workspaceId) as RoutingRuleRow[]).map((row) => this.mapRoutingRule(row));
  }

  getRoutingRule(routingRuleId: string): RoutingRuleRecord | null {
    const row = this.db.prepare('SELECT * FROM routing_rules WHERE routing_rule_id = ?').get(routingRuleId) as RoutingRuleRow | undefined;
    return row ? this.mapRoutingRule(row) : null;
  }

  updateRoutingRule(routingRuleId: string, input: UpdateRoutingRule, now = new Date().toISOString()): RoutingRuleRecord | null {
    const existing = this.getRoutingRule(routingRuleId);
    if (!existing) return null;
    const name = input.name?.trim() ?? existing.name;
    const mode = input.requiredResponseMode ?? existing.requiredResponseMode;
    const count = input.requiredResponseCount ?? existing.requiredResponseCount;
    const recipients = input.recipientUserIds ? unique(input.recipientUserIds) : existing.recipientUserIds;
    if (!recipients.length) throw new Error('Routing Rules must have at least one recipient');
    for (const userId of recipients) {
      if (!this.workspaceMembershipForUser(userId, existing.workspaceId)) throw new Error(`Routing Rule recipient is not an active Workspace Member: ${userId}`);
    }
    this.db.prepare('UPDATE routing_rules SET name = ?, required_response_mode = ?, required_response_count = ?, updated_at = ? WHERE routing_rule_id = ?').run(name, mode, count, now, routingRuleId);
    if (input.recipientUserIds) {
      this.db.prepare('DELETE FROM routing_rule_recipients WHERE routing_rule_id = ?').run(routingRuleId);
      const insertRecipient = this.db.prepare('INSERT INTO routing_rule_recipients(routing_rule_id, user_id, created_at) VALUES (?, ?, ?)');
      for (const userId of recipients) insertRecipient.run(routingRuleId, userId, now);
    }
    return this.getRoutingRule(routingRuleId);
  }

  deleteRoutingRule(routingRuleId: string, workspaceId: string, now = new Date().toISOString()): boolean {
    const existing = this.getRoutingRule(routingRuleId);
    if (!existing || existing.workspaceId !== workspaceId) return false;
    this.db.prepare('UPDATE agent_tokens SET routing_rule_id = NULL WHERE workspace_id = ? AND routing_rule_id = ?').run(workspaceId, routingRuleId);
    this.db.prepare('DELETE FROM routing_rules WHERE routing_rule_id = ?').run(routingRuleId);
    this.writeAuditEvent(workspaceId, DEFAULT_USER_ID, 'routing_rule.deleted', routingRuleId, {}, now);
    return true;
  }

  createAgentToken(input: CreateAgentTokenInput, now = new Date().toISOString()): AgentCredential {
    const parsed = CreateAgentTokenSchema.parse(input);
    const workspaceId = parsed.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const workspace = this.workspaceRow(workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    if (parsed.routingRuleId) this.assertRuleInWorkspace(parsed.routingRuleId, workspaceId);
    const token = `agent_${crypto.randomBytes(24).toString('base64url')}`;
    const agentTokenId = id('agt');
    const scopes = parsed.scopes?.length ? parsed.scopes : ['activity:create'];
    this.db.prepare(`
      INSERT INTO agent_tokens(agent_token_id, workspace_id, creator_user_id, routing_rule_id, label, token_hash, scopes_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(agentTokenId, workspaceId, input.creatorUserId ?? null, parsed.routingRuleId ?? null, parsed.label.trim(), hashSecret(token), JSON.stringify(scopes), now);
    this.writeAuditEvent(workspaceId, input.creatorUserId ?? DEFAULT_USER_ID, 'agent_token.created', agentTokenId, { label: parsed.label.trim() }, now);
    return { ...this.agentTokenOrThrow(agentTokenId), token };
  }

  listAgentTokens(workspaceId?: string): AgentTokenRecord[] {
    const rows = workspaceId
      ? this.db.prepare(AGENT_TOKEN_SELECT + ' WHERE at.workspace_id = ? ORDER BY at.created_at DESC').all(workspaceId)
      : this.db.prepare(AGENT_TOKEN_SELECT + ' ORDER BY at.created_at DESC').all();
    return (rows as AgentTokenRow[]).map(mapAgentToken);
  }

  updateAgentToken(agentTokenId: string, workspaceId: string, input: UpdateAgentToken, now = new Date().toISOString()): AgentTokenRecord | null {
    const existing = this.agentTokenRow(agentTokenId, workspaceId);
    if (!existing) return null;
    const label = input.label?.trim() ?? existing.label;
    const routingRuleId = Object.prototype.hasOwnProperty.call(input, 'routingRuleId') ? input.routingRuleId ?? null : existing.routing_rule_id;
    if (routingRuleId) this.assertRuleInWorkspace(routingRuleId, workspaceId);
    this.db.prepare('UPDATE agent_tokens SET label = ?, routing_rule_id = ? WHERE agent_token_id = ? AND workspace_id = ?').run(label, routingRuleId, agentTokenId, workspaceId);
    return this.agentTokenRow(agentTokenId, workspaceId) ? mapAgentToken(this.agentTokenRow(agentTokenId, workspaceId)!) : null;
  }

  revokeAgentToken(agentTokenId: string, workspaceId?: string, now = new Date().toISOString()): AgentTokenRecord | null {
    const row = workspaceId ? this.agentTokenRow(agentTokenId, workspaceId) : this.agentTokenRowById(agentTokenId);
    if (!row) return null;
    this.db.prepare('UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE agent_token_id = ?').run(now, agentTokenId);
    const updated = this.agentTokenRowById(agentTokenId)!;
    this.writeAuditEvent(updated.workspace_id, DEFAULT_USER_ID, 'agent_token.revoked', agentTokenId, {}, now);
    return mapAgentToken(updated);
  }

  revokeAgentTokensForOwner(userId: string, now = new Date().toISOString()): number {
    return this.db.prepare('UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE creator_user_id = ?').run(now, userId).changes;
  }

  verifyAgentToken(token: string, now = new Date().toISOString()): AgentTokenAuth | null {
    const row = this.db.prepare(AGENT_TOKEN_SELECT + ' WHERE at.token_hash = ? AND at.revoked_at IS NULL').get(hashSecret(token)) as AgentTokenRow | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE agent_tokens SET last_check_in_at = ? WHERE agent_token_id = ?').run(now, row.agent_token_id);
    return {
      source: 'agent',
      agentTokenId: row.agent_token_id,
      label: row.label,
      scopes: parseJSON<string[]>(row.scopes_json, []),
      workspaceId: row.workspace_id,
      workspaceType: row.workspace_type as WorkspaceType,
      routingRuleId: row.routing_rule_id ?? undefined,
      creatorUserId: row.creator_user_id ?? undefined
    };
  }

  createRequest(input: CreateRequestInput, now = new Date().toISOString()): RequestRecord {
    const parsed = CreateRequestSchema.parse(input);
    const workspaceId = input.workspaceId ?? this.agentTokenRowById(input.agentTokenId ?? '')?.workspace_id ?? DEFAULT_WORKSPACE_ID;
    const route = this.routeForActivity(workspaceId, input.agentTokenId, input.routingRuleId);
    const requestId = id('req');
    const encrypted = parsed.encryptedPayload;
    const choices = defaultChoices(parsed.requestType, parsed.choices);
    const requester = {
      ...parsed.requester,
      ...(input.agentTokenId ? { agentTokenId: input.agentTokenId } : {})
    };
    const title = encrypted ? 'Encrypted request' : parsed.title;
    const body = encrypted ? 'Open Agent Tick to decrypt this request.' : parsed.body;
    const command = encrypted ? undefined : parsed.command;
    this.db.prepare(`
      INSERT INTO requests(id, workspace_id, agent_token_id, routing_rule_id, requester_json, request_type, title, body, command, encrypted_payload_json, choices_json, questions_json, default_choice, allow_freeform_reply, deadline, risk, metadata_json, status, required_response_count, created_at, is_test, test_label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `).run(
      requestId,
      workspaceId,
      input.agentTokenId ?? null,
      route.routingRuleId ?? null,
      JSON.stringify(requester),
      parsed.requestType,
      title,
      body ?? null,
      command ?? null,
      encrypted ? JSON.stringify(encrypted) : null,
      JSON.stringify(choices),
      JSON.stringify(parsed.questions ?? []),
      parsed.defaultChoice ?? null,
      parsed.allowFreeformReply ? 1 : 0,
      parsed.deadline ?? null,
      parsed.risk ?? null,
      JSON.stringify(parsed.metadata ?? {}),
      route.requiredResponseCount,
      now,
      input.isTest ? 1 : 0,
      input.testLabel ?? null
    );
    this.insertRequestRecipients(requestId, route.recipientUserIds, now);
    if (input.agentTokenId) this.db.prepare('UPDATE agent_tokens SET last_activity_at = ? WHERE agent_token_id = ?').run(now, input.agentTokenId);
    this.writeAuditEvent(workspaceId, input.userId ?? input.agentTokenId ?? DEFAULT_USER_ID, input.isTest ? 'request.test_created' : 'request.created', requestId, encrypted ? { encrypted: true, algorithm: encrypted.algorithm, keyId: encrypted.keyId } : { title }, now);
    return this.requestOrThrow(requestId, input.userId, now);
  }

  listRequestsForUser(userId: string, workspaceId?: string, now = new Date().toISOString()): RequestRecord[] {
    this.expirePendingRequests(now);
    const rows = workspaceId
      ? this.db.prepare(REQUEST_SELECT + ` JOIN request_recipients rr ON rr.request_id = r.id WHERE rr.user_id = ? AND r.workspace_id = ? ORDER BY r.created_at DESC`).all(userId, workspaceId)
      : this.db.prepare(REQUEST_SELECT + ` JOIN request_recipients rr ON rr.request_id = r.id WHERE rr.user_id = ? ORDER BY r.created_at DESC`).all(userId);
    return (rows as RequestRow[]).map((row) => this.mapRequest(row, userId));
  }

  getRequestForUser(idValue: string, userId: string, now = new Date().toISOString()): RequestRecord | null {
    this.expirePendingRequests(now);
    const row = this.db.prepare(REQUEST_SELECT + ` JOIN request_recipients rr ON rr.request_id = r.id WHERE r.id = ? AND rr.user_id = ?`).get(idValue, userId) as RequestRow | undefined;
    return row ? this.mapRequest(row, userId) : null;
  }

  getRequestForWorkspace(idValue: string, workspaceId: string, currentUserId?: string, now = new Date().toISOString()): RequestRecord | null {
    this.expirePendingRequests(now);
    const row = this.db.prepare(REQUEST_SELECT + ' WHERE r.id = ? AND r.workspace_id = ?').get(idValue, workspaceId) as RequestRow | undefined;
    return row ? this.mapRequest(row, currentUserId) : null;
  }

  respondToRequestForWorkspace(idValue: string, workspaceId: string, response: RespondRequest, responderUserId: string, now = new Date().toISOString()): RequestRecord | null {
    const parsed = RespondRequestSchema.parse(response);
    const existing = this.getRequestForWorkspace(idValue, workspaceId, responderUserId, now);
    if (!existing) return null;
    if (existing.status !== 'pending') return existing;
    const recipient = this.db.prepare('SELECT * FROM request_recipients WHERE request_id = ? AND user_id = ?').get(idValue, responderUserId) as RequestRecipientRow | undefined;
    if (!recipient) {
      const error = new Error('User is not a routed recipient for this Request') as Error & { code?: string; statusCode?: number };
      error.code = 'not_routed_recipient';
      error.statusCode = 403;
      throw error;
    }
    const oldResponse = this.db.prepare('SELECT * FROM responses WHERE request_id = ? AND user_id = ?').get(idValue, responderUserId) as ResponseRow | undefined;
    if (oldResponse) return this.mapRequest(this.requestRow(idValue)!, responderUserId);
    const choice = existing.choices.find((candidate) => candidate.id === parsed.choiceId);
    if (existing.encryptedPayload && choice?.kind !== 'deny' && !parsed.encryptedPayloadAcknowledged) throw new Error('Encrypted request content must be decrypted before responding');
    const responseId = id('rsp');
    this.db.prepare(`
      INSERT INTO responses(response_id, request_id, user_id, source, choice_id, message, answers_json, final, created_at, updated_at)
      VALUES (?, ?, ?, 'remote', ?, ?, ?, 0, ?, ?)
    `).run(responseId, idValue, responderUserId, parsed.choiceId ?? null, parsed.message ?? null, parsed.answers ? JSON.stringify(parsed.answers) : null, now, now);
    this.db.prepare('UPDATE request_recipients SET responded_at = ?, updated_at = ? WHERE request_id = ? AND user_id = ?').run(now, now, idValue, responderUserId);

    const key = parsed.choiceId ?? parsed.message ?? JSON.stringify(parsed.answers ?? {});
    const received = (this.db.prepare('SELECT COUNT(*) AS count FROM responses WHERE request_id = ? AND COALESCE(choice_id, message, answers_json, ?) = ?').get(idValue, key, key) as CountRow).count;
    if (received >= existing.quorum!.requiredResponseCount) {
      const finalPayload = { ...(parsed.choiceId ? { choiceId: parsed.choiceId } : {}), ...(parsed.message ? { message: parsed.message } : {}), ...(parsed.answers ? { answers: parsed.answers } : {}) };
      this.db.prepare('UPDATE responses SET final = 1 WHERE response_id = ?').run(responseId);
      this.db.prepare('UPDATE requests SET status = ?, responded_at = ?, response_json = ?, final_choice_id = ? WHERE id = ?').run('responded', now, JSON.stringify(finalPayload), parsed.choiceId ?? null, idValue);
      this.writeAuditEvent(workspaceId, responderUserId, 'request.responded', idValue, { choiceId: parsed.choiceId }, now);
    }
    return this.mapRequest(this.requestRow(idValue)!, responderUserId);
  }

  abandonRequestForWorkspace(idValue: string, workspaceId: string, actorId: string, now = new Date().toISOString()): RequestRecord | null {
    const existing = this.getRequestForWorkspace(idValue, workspaceId, undefined, now);
    if (!existing) return null;
    if (existing.status === 'pending') {
      this.db.prepare('UPDATE requests SET status = ?, responded_at = ?, response_json = ? WHERE id = ? AND workspace_id = ?').run('resolved', now, JSON.stringify({ message: 'resolved' }), idValue, workspaceId);
      this.writeAuditEvent(workspaceId, actorId, 'request.resolved', idValue, {}, now);
    }
    return this.getRequestForWorkspace(idValue, workspaceId, undefined, now);
  }

  createRequestWaiterToken(requestId: string, workspaceId: string, agentTokenId: string, requestDeadline?: string, now = new Date().toISOString()): RequestWaiterTokenRecord {
    const token = `wait_${crypto.randomBytes(24).toString('base64url')}`;
    const expiresAt = addMs(requestDeadline && Date.parse(requestDeadline) > Date.parse(now) ? requestDeadline : now, 65 * 60_000);
    this.db.prepare('INSERT INTO request_waiter_tokens(token_hash, request_id, workspace_id, agent_token_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(hashSecret(token), requestId, workspaceId, agentTokenId, expiresAt, now);
    return { token, expiresAt };
  }

  verifyRequestWaiterToken(token: string, requestId: string, now = new Date().toISOString()): RequestWaiterAuth | null {
    const row = this.db.prepare('SELECT * FROM request_waiter_tokens WHERE token_hash = ? AND request_id = ? AND expires_at > ?').get(hashSecret(token), requestId, now) as WaiterRow | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE request_waiter_tokens SET last_used_at = ? WHERE token_hash = ?').run(now, hashSecret(token));
    return { requestId: row.request_id, workspaceId: row.workspace_id, agentTokenId: row.agent_token_id };
  }

  createStatusUpdate(input: CreateStatusUpdateInput, now = new Date().toISOString()): StatusUpdateRecord {
    const parsed = CreateStatusUpdateSchema.parse(input);
    const route = this.routeForActivity(input.workspaceId, input.agentTokenId, input.routingRuleId);
    const statusId = id('stat');
    this.db.prepare(`
      INSERT INTO status_updates(status_id, workspace_id, agent_token_id, routing_rule_id, thread_id, message, state, next_step, host, working_directory, client_name, metadata_json, created_at, is_test, test_label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(statusId, input.workspaceId, input.agentTokenId ?? null, route.routingRuleId ?? null, parsed.threadId ?? null, parsed.message, parsed.state, parsed.nextStep ?? null, parsed.host ?? null, parsed.workingDirectory ?? null, parsed.clientName ?? null, JSON.stringify(parsed.metadata ?? {}), now, input.isTest ? 1 : 0, input.testLabel ?? null);
    const insertRecipient = this.db.prepare('INSERT INTO status_update_recipients(status_id, user_id, created_at) VALUES (?, ?, ?)');
    for (const userId of route.recipientUserIds) insertRecipient.run(statusId, userId, now);
    if (input.agentTokenId) this.db.prepare('UPDATE agent_tokens SET last_activity_at = ? WHERE agent_token_id = ?').run(now, input.agentTokenId);
    this.writeAuditEvent(input.workspaceId, input.userId ?? input.agentTokenId ?? DEFAULT_USER_ID, input.isTest ? 'status_update.test_created' : 'status_update.created', statusId, { state: parsed.state }, now);
    return this.statusUpdateOrThrow(statusId);
  }

  getStatusUpdate(statusId: string, workspaceId: string): StatusUpdateRecord | null {
    const row = this.db.prepare(STATUS_UPDATE_SELECT + ' WHERE su.status_id = ? AND su.workspace_id = ?').get(statusId, workspaceId) as StatusUpdateRow | undefined;
    return row ? this.mapStatusUpdate(row) : null;
  }

  listLatestStatusUpdates(workspaceId: string, limit = 20): StatusUpdateRecord[] {
    return (this.db.prepare(STATUS_UPDATE_SELECT + ' WHERE su.workspace_id = ? ORDER BY su.created_at DESC LIMIT ?').all(workspaceId, clampLimit(limit)) as StatusUpdateRow[]).map((row) => this.mapStatusUpdate(row));
  }

  listActivityForUser(userId: string, workspaceId?: string, limit = 50, now = new Date().toISOString()): ActivityItem[] {
    this.expirePendingRequests(now);
    const requestRows = workspaceId
      ? this.db.prepare(REQUEST_SELECT + ` JOIN request_recipients rr ON rr.request_id = r.id WHERE rr.user_id = ? AND r.workspace_id = ?`).all(userId, workspaceId)
      : this.db.prepare(REQUEST_SELECT + ` JOIN request_recipients rr ON rr.request_id = r.id WHERE rr.user_id = ?`).all(userId);
    const statusRows = workspaceId
      ? this.db.prepare(STATUS_UPDATE_SELECT + ` JOIN status_update_recipients sur ON sur.status_id = su.status_id WHERE sur.user_id = ? AND su.workspace_id = ?`).all(userId, workspaceId)
      : this.db.prepare(STATUS_UPDATE_SELECT + ` JOIN status_update_recipients sur ON sur.status_id = su.status_id WHERE sur.user_id = ?`).all(userId);
    return [
      ...(requestRows as RequestRow[]).map((row) => ({ kind: 'request' as const, id: row.id, workspaceId: row.workspace_id, createdAt: row.created_at, request: this.mapRequest(row, userId) })),
      ...(statusRows as StatusUpdateRow[]).map((row) => ({ kind: 'status_update' as const, id: row.status_id, workspaceId: row.workspace_id, createdAt: row.created_at, statusUpdate: this.mapStatusUpdate(row) }))
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, clampLimit(limit));
  }

  pendingRequestCountForUser(userId: string, workspaceId?: string, now = new Date().toISOString()): number {
    this.expirePendingRequests(now);
    const params = workspaceId ? [userId, workspaceId] : [userId];
    const sql = `
      SELECT COUNT(*) AS count
      FROM requests r
      JOIN request_recipients rr ON rr.request_id = r.id AND rr.user_id = ?
      LEFT JOIN responses rsp ON rsp.request_id = r.id AND rsp.user_id = rr.user_id
      WHERE r.status = 'pending' AND rsp.response_id IS NULL${workspaceId ? ' AND r.workspace_id = ?' : ''}
    `;
    return (this.db.prepare(sql).get(...params) as CountRow).count;
  }

  registerDevice(input: DeviceRegistrationInput, now = new Date().toISOString()): DeviceRecord {
    this.ensureUserExists(input.userId, now);
    const name = input.deviceName.trim();
    const platform = input.platform?.trim() || null;
    const installationId = input.installationId?.trim() || null;
    const expoPushToken = input.expoPushToken ?? null;

    if (installationId) {
      const existing = this.db.prepare(`
        SELECT * FROM approval_devices
        WHERE user_id = ? AND installation_id = ?
        ORDER BY CASE WHEN unregistered_at IS NULL THEN 0 ELSE 1 END ASC, updated_at DESC, created_at DESC, device_id DESC
        LIMIT 1
      `).get(input.userId, installationId) as DeviceRow | undefined;
      if (existing) {
        this.db.prepare('UPDATE approval_devices SET name = ?, platform = ?, expo_push_token = ?, unregistered_at = NULL, updated_at = ? WHERE device_id = ? AND user_id = ?')
          .run(name, platform ?? existing.platform, expoPushToken ?? existing.expo_push_token, now, existing.device_id, input.userId);
        this.retireDuplicateDevicesForInstallation(input.userId, installationId, existing.device_id, now);
        this.writeAuditEvent(this.defaultMembershipForUser(input.userId).workspaceId, input.userId, 'approval_device.registered', existing.device_id, { name, platform }, now);
        return this.deviceOrThrow(existing.device_id, input.userId);
      }
    }

    const deviceId = id('dev');
    this.db.prepare('INSERT INTO approval_devices(device_id, user_id, name, platform, installation_id, expo_push_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(deviceId, input.userId, name, platform, installationId, expoPushToken, now, now);
    this.writeAuditEvent(this.defaultMembershipForUser(input.userId).workspaceId, input.userId, 'approval_device.registered', deviceId, { name, platform }, now);
    return this.deviceOrThrow(deviceId, input.userId);
  }

  listDevicesForUser(userId: string): DeviceRecord[] {
    return (this.db.prepare('SELECT * FROM approval_devices WHERE user_id = ? AND unregistered_at IS NULL ORDER BY created_at DESC').all(userId) as DeviceRow[]).map(mapDevice);
  }

  listPushDevicesForRequestRecipients(requestId: string): DeviceRecord[] {
    return uniqueDevicesByPushToken(this.db.prepare(`
      SELECT d.* FROM approval_devices d
      JOIN request_recipients rr ON rr.user_id = d.user_id
      WHERE rr.request_id = ? AND d.unregistered_at IS NULL AND d.expo_push_token IS NOT NULL AND d.expo_push_token <> ''
      ORDER BY d.updated_at DESC, d.created_at DESC
    `).all(requestId) as DeviceRow[]);
  }

  listPushDevicesForUsers(userIds: string[]): DeviceRecord[] {
    if (!userIds.length) return [];
    const placeholders = userIds.map(() => '?').join(',');
    return uniqueDevicesByPushToken(this.db.prepare(`SELECT * FROM approval_devices WHERE user_id IN (${placeholders}) AND unregistered_at IS NULL AND expo_push_token IS NOT NULL AND expo_push_token <> '' ORDER BY updated_at DESC, created_at DESC`).all(...userIds) as DeviceRow[]);
  }

  getDeviceForUser(deviceId: string, userId: string): DeviceRecord | null {
    const row = this.db.prepare('SELECT * FROM approval_devices WHERE device_id = ? AND user_id = ?').get(deviceId, userId) as DeviceRow | undefined;
    return row ? mapDevice(row) : null;
  }

  updateDeviceName(deviceId: string, userId: string, name: string, now = new Date().toISOString()): DeviceRecord | null {
    this.db.prepare('UPDATE approval_devices SET name = ?, updated_at = ? WHERE device_id = ? AND user_id = ?').run(name.trim(), now, deviceId, userId);
    return this.getDeviceForUser(deviceId, userId);
  }

  updateDevicePushToken(deviceId: string, userId: string, expoPushToken: string, now = new Date().toISOString()): DeviceRecord | null {
    this.db.prepare(`UPDATE approval_devices SET expo_push_token = ?, unregistered_at = CASE WHEN ? <> '' THEN NULL ELSE unregistered_at END, updated_at = ? WHERE device_id = ? AND user_id = ?`).run(expoPushToken, expoPushToken, now, deviceId, userId);
    return this.getDeviceForUser(deviceId, userId);
  }

  unregisterDevice(deviceId: string, userId: string, now = new Date().toISOString()): DeviceRecord | null {
    this.db.prepare('UPDATE approval_devices SET unregistered_at = COALESCE(unregistered_at, ?), updated_at = ? WHERE device_id = ? AND user_id = ?').run(now, now, deviceId, userId);
    return this.getDeviceForUser(deviceId, userId);
  }

  createPairingToken(userId: string, workspaceId: string, now = new Date().toISOString(), ttlSeconds = 10 * 60): PairingTokenRecord {
    const token = `pair_${crypto.randomBytes(20).toString('base64url')}`;
    const expiresAt = addMs(now, ttlSeconds * 1000);
    this.db.prepare('INSERT INTO device_pairing_codes(token_hash, user_id, workspace_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(hashSecret(token), userId, workspaceId, expiresAt, now);
    return { token, expiresAt };
  }

  pairDeviceWithCode(pairingCode: string, deviceName: string, platform?: string, now = new Date().toISOString()): DeviceCredential | null {
    const row = this.db.prepare('SELECT * FROM device_pairing_codes WHERE token_hash = ? AND expires_at > ? AND used_at IS NULL').get(hashSecret(pairingCode), now) as PairingRow | undefined;
    if (!row) return null;
    const token = `device_${crypto.randomBytes(24).toString('base64url')}`;
    const device = this.registerDevice({ userId: row.user_id, deviceName, ...(platform ? { platform } : {}) }, now);
    this.db.prepare('UPDATE approval_devices SET token_hash = ?, updated_at = ? WHERE device_id = ?').run(hashSecret(token), now, device.deviceId);
    this.db.prepare('UPDATE device_pairing_codes SET used_at = ? WHERE token_hash = ?').run(now, hashSecret(pairingCode));
    return { deviceId: device.deviceId, token };
  }

  verifyDeviceToken(token: string): DeviceTokenAuth | null {
    const row = this.db.prepare('SELECT * FROM approval_devices WHERE token_hash = ? AND unregistered_at IS NULL').get(hashSecret(token)) as DeviceRow | undefined;
    if (!row) return null;
    return { source: 'device', deviceId: row.device_id, userId: row.user_id, workspaceId: this.defaultMembershipForUser(row.user_id).workspaceId };
  }

  recordHeartbeat(userId: string, workspaceId: string, now = new Date().toISOString()): AvailabilityRecord {
    return this.setAvailability(userId, workspaceId, 'available', now, true);
  }

  setAvailability(userId: string, workspaceId: string, state: string, now = new Date().toISOString(), heartbeat = false): AvailabilityRecord {
    this.db.prepare(`
      INSERT INTO availability(user_id, workspace_id, state, last_seen_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, workspace_id) DO UPDATE SET state = excluded.state, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
    `).run(userId, workspaceId, state, heartbeat ? now : null, now);
    return this.getAvailability(userId, workspaceId)!;
  }

  getAvailability(userId: string, workspaceId: string): AvailabilityRecord | null {
    const row = this.db.prepare('SELECT * FROM availability WHERE user_id = ? AND workspace_id = ?').get(userId, workspaceId) as AvailabilityRow | undefined;
    return row ? mapAvailability(row) : null;
  }

  createEventTicket(input: EventTicketInput, now = new Date().toISOString()): EventTicketRecord {
    const ticket = `evt_${crypto.randomBytes(20).toString('base64url')}`;
    const expiresAt = addMs(now, (input.ttlSeconds ?? 30) * 1000);
    this.db.prepare('INSERT INTO event_tickets(token_hash, source, workspace_id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(hashSecret(ticket), input.source, input.workspaceId, input.userId, expiresAt, now);
    return { ticket, expiresAt };
  }

  verifyEventTicket(ticket: string, now = new Date().toISOString()): EventTicketAuth | null {
    const row = this.db.prepare('SELECT * FROM event_tickets WHERE token_hash = ? AND expires_at > ? AND used_at IS NULL').get(hashSecret(ticket), now) as EventTicketRow | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE event_tickets SET used_at = ? WHERE token_hash = ?').run(now, hashSecret(ticket));
    return { source: row.source, workspaceId: row.workspace_id, userId: row.user_id };
  }

  recordMobileDiagnostics(events: MobileDiagnosticInput[]): number {
    if (!events.length) return 0;
    const insert = this.db.prepare('INSERT INTO mobile_diagnostics(diagnostic_id, workspace_id, user_id, device_id, level, area, message, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const tx = this.db.transaction((items: MobileDiagnosticInput[]) => {
      for (const event of items) insert.run(id('diag'), event.workspaceId, event.userId, event.deviceId ?? null, event.level, event.area, event.message, event.metadata ? JSON.stringify(event.metadata) : '{}', event.createdAt);
    });
    tx(events);
    return events.length;
  }

  listMobileDiagnostics(workspaceId: string, limit = 100): MobileDiagnosticRecord[] {
    return (this.db.prepare('SELECT * FROM mobile_diagnostics WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, clampLimit(limit, 1000)) as MobileDiagnosticRow[]).map(mapMobileDiagnostic);
  }

  listAuditEvents(workspaceId: string, limit = 100): AuditEventRecord[] {
    return (this.db.prepare('SELECT * FROM audit_events WHERE workspace_id = ? ORDER BY event_id DESC LIMIT ?').all(workspaceId, clampLimit(limit, 1000)) as AuditRow[]).map(mapAuditEvent);
  }

  listAuditEventsAfter(workspaceId: string, afterEventId = 0, limit = 100): AuditEventRecord[] {
    return (this.db.prepare('SELECT * FROM audit_events WHERE workspace_id = ? AND event_id > ? ORDER BY event_id ASC LIMIT ?').all(workspaceId, afterEventId, clampLimit(limit, 1000)) as AuditRow[]).map(mapAuditEvent);
  }

  writeAuditEvent(workspaceId: string, userId: string, eventType: string, targetId: string, payload: unknown, now = new Date().toISOString()): void {
    this.db.prepare('INSERT INTO audit_events(workspace_id, user_id, event_type, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(workspaceId, userId, eventType, targetId, JSON.stringify(payload ?? {}), now);
  }

  getOrStartPersonalEntitlement(userId: string, now = new Date().toISOString()): PersonalEntitlementRecord {
    this.ensurePersonalEntitlementRow(userId, now);
    return this.personalEntitlementOrThrow(userId);
  }

  updatePersonalEntitlement(input: UpdatePersonalEntitlementInput, now = new Date().toISOString()): PersonalEntitlementRecord {
    this.ensurePersonalEntitlementRow(input.userId, now);
    const existing = this.personalEntitlementOrThrow(input.userId);
    this.db.prepare(`
      UPDATE personal_entitlements
      SET app_unlocked_at = ?, included_hosted_activated_at = ?, hosted_subscription_ends_at = ?, hosted_subscription_canceled_at = ?, hosted_data_deleted_at = ?, updated_at = ?
      WHERE user_id = ?
    `).run(
      coalesceNullableInput(input.appUnlockedAt, existing.appUnlockedAt),
      coalesceNullableInput(input.includedHostedActivatedAt, existing.includedHostedActivatedAt),
      coalesceNullableInput(input.hostedSubscriptionEndsAt, existing.hostedSubscriptionEndsAt),
      coalesceNullableInput(input.hostedSubscriptionCanceledAt, existing.hostedSubscriptionCanceledAt),
      coalesceNullableInput(input.hostedDataDeletedAt, existing.hostedDataDeletedAt),
      now,
      input.userId
    );
    return this.personalEntitlementOrThrow(input.userId);
  }

  upsertBillingProducts(products: UpsertBillingProductInput[], now = new Date().toISOString()): void {
    const stmt = this.db.prepare(`
      INSERT INTO billing_products(id, product_key, kind, entitlement_key, apple_product_id, google_product_id, google_base_plan_id, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product_key) DO UPDATE SET kind = excluded.kind, entitlement_key = excluded.entitlement_key, apple_product_id = excluded.apple_product_id, google_product_id = excluded.google_product_id, google_base_plan_id = excluded.google_base_plan_id, active = excluded.active, updated_at = excluded.updated_at
    `);
    for (const product of products) stmt.run(id('prod'), product.productKey, product.kind, product.entitlementKey, product.appleProductId ?? null, product.googleProductId ?? null, product.googleBasePlanId ?? null, product.active === false ? 0 : 1, now, now);
  }

  listBillingProducts(activeOnly = false): BillingProductRecord[] {
    const rows = activeOnly ? this.db.prepare('SELECT * FROM billing_products WHERE active = 1 ORDER BY product_key').all() : this.db.prepare('SELECT * FROM billing_products ORDER BY product_key').all();
    return (rows as BillingProductRow[]).map(mapBillingProduct);
  }

  createBillingPurchaseAttempt(input: CreateBillingPurchaseAttemptInput, now = new Date().toISOString()): BillingPurchaseAttemptRecord {
    const attemptId = id('attempt');
    this.db.prepare('INSERT INTO billing_purchase_attempts(id, user_id, product_key, product_group, platform, provider, status, provider_user_id, idempotency_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(attemptId, input.userId, input.productKey, input.productGroup, input.platform, input.provider, 'pending', input.providerUserId ?? null, input.idempotencyKey, input.expiresAt, now, now);
    return this.billingAttemptOrThrow(attemptId);
  }

  updateBillingPurchaseAttemptStatus(attemptId: string, status: string, now = new Date().toISOString()): BillingPurchaseAttemptRecord | null {
    this.db.prepare('UPDATE billing_purchase_attempts SET status = ?, updated_at = ? WHERE id = ?').run(status, now, attemptId);
    const row = this.db.prepare('SELECT * FROM billing_purchase_attempts WHERE id = ?').get(attemptId) as BillingAttemptRow | undefined;
    return row ? mapBillingAttempt(row) : null;
  }

  listActiveBillingPurchaseAttempts(userId: string, productGroup: string, now = new Date().toISOString()): BillingPurchaseAttemptRecord[] {
    return (this.db.prepare(`SELECT * FROM billing_purchase_attempts WHERE user_id = ? AND product_group = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC`).all(userId, productGroup, now) as BillingAttemptRow[]).map(mapBillingAttempt);
  }

  upsertBillingTransaction(input: UpsertBillingTransactionInput, now = new Date().toISOString()): UpsertBillingTransactionResult {
    const existing = this.findBillingTransaction(input);
    const transactionId = existing?.id ?? id('txn');
    this.db.prepare(`
      INSERT INTO billing_transactions(id, user_id, provider, environment, product_key, entitlement_key, platform, provider_transaction_id, provider_original_transaction_id, provider_purchase_token, status, purchased_at, expires_at, canceled_at, revoked_at, raw_event_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, expires_at = excluded.expires_at, canceled_at = excluded.canceled_at, revoked_at = excluded.revoked_at, raw_event_json = excluded.raw_event_json, updated_at = excluded.updated_at
    `).run(transactionId, input.userId, input.provider, input.environment, input.productKey, input.entitlementKey, input.platform, input.providerTransactionId ?? null, input.providerOriginalTransactionId ?? null, input.providerPurchaseToken ?? null, input.status, input.purchasedAt ?? null, input.expiresAt ?? null, input.canceledAt ?? null, input.revokedAt ?? null, input.rawEventJSON ?? null, existing?.created_at ?? now, now);
    return { record: mapBillingTransaction(this.billingTransactionOrThrow(transactionId)), created: !existing };
  }

  listBillingTransactionsForUser(userId: string): BillingTransactionRecord[] {
    return (this.db.prepare('SELECT * FROM billing_transactions WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as BillingTransactionRow[]).map(mapBillingTransaction);
  }

  deleteHostedPersonalData(userId: string, workspaceId: string, now = new Date().toISOString()): void {
    const tokenRows = this.db.prepare('SELECT agent_token_id FROM agent_tokens WHERE workspace_id = ?').all(workspaceId) as { agent_token_id: string }[];
    for (const row of tokenRows) this.revokeAgentToken(row.agent_token_id, workspaceId, now);
    this.db.prepare('UPDATE approval_devices SET unregistered_at = COALESCE(unregistered_at, ?), updated_at = ? WHERE user_id = ?').run(now, now, userId);
    this.updatePersonalEntitlement({ userId, hostedDataDeletedAt: now }, now);
  }


  private ensurePersonalWorkspaceForUser(userId: string, now: string): void {
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

  private ensureUserExists(userId: string, now: string): void {
    this.db.prepare(`INSERT OR IGNORE INTO users(id, email, email_verified, name, created_at, updated_at) VALUES (?, '', 0, ?, ?, ?)`).run(userId, userId, now, now);
    this.ensurePersonalWorkspaceForUser(userId, now);
  }

  private workspaceMemberOrThrow(userId: string, workspaceId: string): WorkspaceMemberRecord {
    const row = this.workspaceMembershipForUserAnyStatus(userId, workspaceId);
    if (!row) throw new Error('Workspace Member not found');
    return row;
  }

  private workspaceRow(workspaceId: string): WorkspaceRow | undefined {
    return this.db.prepare('SELECT * FROM workspaces WHERE workspace_id = ?').get(workspaceId) as WorkspaceRow | undefined;
  }

  private mapRoutingRule(row: RoutingRuleRow): RoutingRuleRecord {
    const recipientUserIds = (this.db.prepare('SELECT user_id FROM routing_rule_recipients WHERE routing_rule_id = ? ORDER BY created_at ASC').all(row.routing_rule_id) as { user_id: string }[]).map((recipient) => recipient.user_id);
    return RoutingRuleRecordSchema.parse({
      routingRuleId: row.routing_rule_id,
      workspaceId: row.workspace_id,
      name: row.name,
      requiredResponseMode: row.required_response_mode,
      requiredResponseCount: requiredCount(row.required_response_mode as RequiredResponseMode, row.required_response_count, recipientUserIds.length),
      recipientUserIds,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  private assertRuleInWorkspace(routingRuleId: string, workspaceId: string): void {
    const rule = this.getRoutingRule(routingRuleId);
    if (!rule || rule.workspaceId !== workspaceId) throw new Error('Routing Rule not found in Workspace');
  }

  private agentTokenRowById(agentTokenId: string): AgentTokenRow | undefined {
    return this.db.prepare(AGENT_TOKEN_SELECT + ' WHERE at.agent_token_id = ?').get(agentTokenId) as AgentTokenRow | undefined;
  }

  private agentTokenRow(agentTokenId: string, workspaceId: string): AgentTokenRow | undefined {
    return this.db.prepare(AGENT_TOKEN_SELECT + ' WHERE at.agent_token_id = ? AND at.workspace_id = ?').get(agentTokenId, workspaceId) as AgentTokenRow | undefined;
  }

  private agentTokenOrThrow(agentTokenId: string): AgentTokenRecord {
    const row = this.agentTokenRowById(agentTokenId);
    if (!row) throw new Error('Agent Token not found');
    return mapAgentToken(row);
  }

  private routeForActivity(workspaceId: string, agentTokenId?: string, routingRuleId?: string): { routingRuleId?: string; recipientUserIds: string[]; requiredResponseCount: number } {
    const workspace = this.workspaceRow(workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    if (workspace.type === 'personal') {
      const memberRows = this.db.prepare(`SELECT user_id FROM workspace_members WHERE workspace_id = ? AND status = 'active' ORDER BY created_at ASC LIMIT 1`).all(workspaceId) as { user_id: string }[];
      const recipientUserIds = memberRows.map((row) => row.user_id);
      if (!recipientUserIds.length) throw new Error('Personal Workspace has no active member');
      return { recipientUserIds, requiredResponseCount: 1 };
    }
    const selectedRuleId = routingRuleId ?? (agentTokenId ? this.agentTokenRowById(agentTokenId)?.routing_rule_id ?? undefined : undefined);
    if (!selectedRuleId) {
      const error = new Error('Connected Shared Workspace Agent Token requires a Routing Rule assignment before activity can route') as Error & { code?: string; statusCode?: number };
      error.code = 'routing_required';
      error.statusCode = 409;
      throw error;
    }
    const rule = this.getRoutingRule(selectedRuleId);
    if (!rule || rule.workspaceId !== workspaceId || !rule.recipientUserIds.length) {
      const error = new Error('Assign a Routing Rule with at least one Workspace Member before activity can route') as Error & { code?: string; statusCode?: number };
      error.code = 'routing_required';
      error.statusCode = 409;
      throw error;
    }
    return { routingRuleId: rule.routingRuleId, recipientUserIds: rule.recipientUserIds, requiredResponseCount: rule.requiredResponseCount };
  }

  private insertRequestRecipients(requestId: string, recipientUserIds: string[], now: string): void {
    const insert = this.db.prepare('INSERT INTO request_recipients(request_id, user_id, has_active_device, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    for (const userId of recipientUserIds) insert.run(requestId, userId, this.hasActiveDevice(userId) ? 1 : 0, now, now);
  }

  private hasActiveDevice(userId: string): boolean {
    return (this.db.prepare('SELECT COUNT(*) AS count FROM approval_devices WHERE user_id = ? AND unregistered_at IS NULL').get(userId) as CountRow).count > 0;
  }

  private expirePendingRequests(now: string): void {
    const rows = this.db.prepare(`SELECT id, workspace_id FROM requests WHERE status = 'pending' AND deadline IS NOT NULL AND deadline <= ?`).all(now) as { id: string; workspace_id: string }[];
    for (const row of rows) {
      this.db.prepare('UPDATE requests SET status = ?, responded_at = ?, response_json = ? WHERE id = ?').run('expired', now, JSON.stringify({ message: 'expired' }), row.id);
      this.writeAuditEvent(row.workspace_id, 'system', 'request.expired', row.id, {}, now);
    }
  }

  private requestRow(requestId: string): RequestRow | undefined {
    return this.db.prepare(REQUEST_SELECT + ' WHERE r.id = ?').get(requestId) as RequestRow | undefined;
  }

  private requestOrThrow(requestId: string, currentUserId?: string, now?: string): RequestRecord {
    const row = this.requestRow(requestId);
    if (!row) throw new Error('Request not found');
    return this.mapRequest(row, currentUserId, now);
  }

  private mapRequest(row: RequestRow, currentUserId?: string, _now?: string): RequestRecord {
    const recipients = (this.db.prepare('SELECT * FROM request_recipients WHERE request_id = ? ORDER BY created_at ASC').all(row.id) as RequestRecipientRow[]).map(mapRequestRecipient);
    const responses = (this.db.prepare('SELECT * FROM responses WHERE request_id = ? ORDER BY created_at ASC').all(row.id) as ResponseRow[]).map(mapResponse);
    const currentUserResponse = currentUserId ? responses.find((response) => response.userId === currentUserId) : undefined;
    const requiredResponseCount = Math.max(Math.min(row.required_response_count, recipients.length || 1), 1);
    const receivedResponseCount = responses.filter((response) => response.choiceId === row.final_choice_id || (!row.final_choice_id && response.final)).length || responses.length;
    const request = {
      id: row.id,
      workspaceId: row.workspace_id,
      ...(row.agent_token_id ? { agentTokenId: row.agent_token_id } : {}),
      ...(row.routing_rule_id ? { routingRuleId: row.routing_rule_id } : {}),
      requester: parseJSON(row.requester_json, { name: 'Agent' }),
      requestType: row.request_type,
      title: row.title,
      ...(row.body ? { body: row.body } : {}),
      ...(row.command ? { command: row.command } : {}),
      ...(row.encrypted_payload_json ? { encryptedPayload: parseJSON(row.encrypted_payload_json, undefined) } : {}),
      choices: parseJSON<Choice[]>(row.choices_json, []),
      questions: parseJSON(row.questions_json, []),
      ...(row.default_choice ? { defaultChoice: row.default_choice } : {}),
      allowFreeformReply: Boolean(row.allow_freeform_reply),
      ...(row.deadline ? { deadline: row.deadline } : {}),
      ...(row.risk ? { risk: row.risk } : {}),
      metadata: parseJSON(row.metadata_json, {}),
      status: row.status,
      createdAt: row.created_at,
      ...(row.responded_at ? { respondedAt: row.responded_at } : {}),
      ...(row.response_json ? { response: parseJSON(row.response_json, undefined) } : {}),
      recipients,
      responses,
      quorum: {
        requiredResponseCount,
        receivedResponseCount: responses.length,
        waitingFor: Math.max(requiredResponseCount - responses.length, 0),
        ...(currentUserId ? { currentUserEligible: recipients.some((recipient) => recipient.userId === currentUserId), currentUserResponded: Boolean(currentUserResponse) } : {}),
        recipients,
        responses
      },
      ...(row.is_test ? { isTest: true } : {}),
      ...(row.test_label ? { testLabel: row.test_label } : {})
    };
    return RequestRecordSchema.parse(request);
  }

  private statusUpdateOrThrow(statusId: string): StatusUpdateRecord {
    const row = this.db.prepare(STATUS_UPDATE_SELECT + ' WHERE su.status_id = ?').get(statusId) as StatusUpdateRow | undefined;
    if (!row) throw new Error('Status Update not found');
    return this.mapStatusUpdate(row);
  }

  private mapStatusUpdate(row: StatusUpdateRow): StatusUpdateRecord {
    const recipientUserIds = (this.db.prepare('SELECT user_id FROM status_update_recipients WHERE status_id = ? ORDER BY created_at ASC').all(row.status_id) as { user_id: string }[]).map((entry) => entry.user_id);
    return StatusUpdateRecordSchema.parse({
      statusId: row.status_id,
      workspaceId: row.workspace_id,
      ...(row.agent_token_id ? { agentTokenId: row.agent_token_id } : {}),
      ...(row.agent_token_label ? { agentTokenLabel: row.agent_token_label } : {}),
      ...(row.routing_rule_id ? { routingRuleId: row.routing_rule_id } : {}),
      ...(row.thread_id ? { threadId: row.thread_id } : {}),
      message: row.message,
      state: row.state,
      ...(row.next_step ? { nextStep: row.next_step } : {}),
      ...(row.host ? { host: row.host } : {}),
      ...(row.working_directory ? { workingDirectory: row.working_directory } : {}),
      ...(row.client_name ? { clientName: row.client_name } : {}),
      metadata: parseJSON(row.metadata_json, {}),
      recipientUserIds,
      createdAt: row.created_at,
      ...(row.is_test ? { isTest: true } : {}),
      ...(row.test_label ? { testLabel: row.test_label } : {})
    });
  }

  private deviceOrThrow(deviceId: string, userId: string): DeviceRecord {
    const device = this.getDeviceForUser(deviceId, userId);
    if (!device) throw new Error('Approval Device not found');
    return device;
  }

  private dedupeDeviceInstallations(now = new Date().toISOString()): number {
    const groups = this.db.prepare(`
      SELECT user_id, installation_id
      FROM approval_devices
      WHERE installation_id IS NOT NULL AND installation_id <> ''
      GROUP BY user_id, installation_id
      HAVING COUNT(*) > 1
    `).all() as { user_id: string; installation_id: string }[];
    let retired = 0;
    for (const group of groups) {
      const keep = this.db.prepare(`
        SELECT device_id FROM approval_devices
        WHERE user_id = ? AND installation_id = ?
        ORDER BY CASE WHEN unregistered_at IS NULL THEN 0 ELSE 1 END ASC, updated_at DESC, created_at DESC, device_id DESC
        LIMIT 1
      `).get(group.user_id, group.installation_id) as { device_id: string } | undefined;
      if (keep) retired += this.retireDuplicateDevicesForInstallation(group.user_id, group.installation_id, keep.device_id, now);
    }
    return retired;
  }

  private retireDuplicateDevicesForInstallation(userId: string, installationId: string, keepDeviceId: string, now: string): number {
    return this.db.prepare(`
      UPDATE approval_devices
      SET expo_push_token = NULL, unregistered_at = COALESCE(unregistered_at, ?), updated_at = ?
      WHERE user_id = ? AND installation_id = ? AND device_id <> ?
    `).run(now, now, userId, installationId, keepDeviceId).changes;
  }

  private ensurePersonalEntitlementRow(userId: string, now: string): void {
    this.db.prepare(`INSERT OR IGNORE INTO personal_entitlements(user_id, trial_started_at, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(userId, now, now, now);
  }

  private personalEntitlementOrThrow(userId: string): PersonalEntitlementRecord {
    const row = this.db.prepare('SELECT * FROM personal_entitlements WHERE user_id = ?').get(userId) as PersonalEntitlementRow | undefined;
    if (!row) throw new Error('Personal entitlement not found');
    return mapPersonalEntitlement(row);
  }

  private billingAttemptOrThrow(attemptId: string): BillingPurchaseAttemptRecord {
    const row = this.db.prepare('SELECT * FROM billing_purchase_attempts WHERE id = ?').get(attemptId) as BillingAttemptRow | undefined;
    if (!row) throw new Error('Billing purchase attempt not found');
    return mapBillingAttempt(row);
  }

  private findBillingTransaction(input: UpsertBillingTransactionInput): BillingTransactionRow | undefined {
    if (input.providerTransactionId) return this.db.prepare('SELECT * FROM billing_transactions WHERE provider = ? AND provider_transaction_id = ?').get(input.provider, input.providerTransactionId) as BillingTransactionRow | undefined;
    if (input.providerPurchaseToken) return this.db.prepare('SELECT * FROM billing_transactions WHERE provider = ? AND provider_purchase_token = ?').get(input.provider, input.providerPurchaseToken) as BillingTransactionRow | undefined;
    return undefined;
  }

  private billingTransactionOrThrow(transactionId: string): BillingTransactionRow {
    const row = this.db.prepare('SELECT * FROM billing_transactions WHERE id = ?').get(transactionId) as BillingTransactionRow | undefined;
    if (!row) throw new Error('Billing transaction not found');
    return row;
  }
}

interface CountRow { count: number }
interface UserRow { id: string; email: string | null; email_verified: number; name: string | null; sign_in_method: string | null }
interface WorkspaceRow { workspace_id: string; type: string; name: string; clerk_organization_id: string | null; created_at: string; updated_at: string }
interface WorkspaceMemberRow extends WorkspaceRow { user_id: string; role: string; status: string; email: string | null; display_name: string | null; clerk_membership_id: string | null }
interface RoutingRuleRow { routing_rule_id: string; workspace_id: string; name: string; required_response_mode: string; required_response_count: number; created_at: string; updated_at: string }
interface AgentTokenRow { agent_token_id: string; workspace_id: string; workspace_type: string; creator_user_id: string | null; routing_rule_id: string | null; label: string; scopes_json: string; last_activity_at: string | null; last_check_in_at: string | null; created_at: string; revoked_at: string | null }
interface RequestRow { id: string; workspace_id: string; agent_token_id: string | null; routing_rule_id: string | null; requester_json: string; request_type: string; title: string; body: string | null; command: string | null; encrypted_payload_json: string | null; choices_json: string; questions_json: string; default_choice: string | null; allow_freeform_reply: number; deadline: string | null; risk: string | null; metadata_json: string; status: string; required_response_count: number; created_at: string; responded_at: string | null; response_json: string | null; final_choice_id: string | null; is_test: number; test_label: string | null }
interface RequestRecipientRow { request_id: string; user_id: string; has_active_device: number; responded_at: string | null; created_at: string; updated_at: string }
interface ResponseRow { response_id: string; request_id: string; user_id: string; source: string; choice_id: string | null; message: string | null; answers_json: string | null; final: number; created_at: string }
interface StatusUpdateRow { status_id: string; workspace_id: string; agent_token_id: string | null; agent_token_label: string | null; routing_rule_id: string | null; thread_id: string | null; message: string; state: string; next_step: string | null; host: string | null; working_directory: string | null; client_name: string | null; metadata_json: string; created_at: string; is_test: number; test_label: string | null }
interface DeviceRow { device_id: string; user_id: string; name: string; platform: string | null; installation_id: string | null; expo_push_token: string | null; created_at: string; updated_at: string; unregistered_at: string | null }
interface PairingRow { user_id: string; workspace_id: string }
interface EventTicketRow { source: string; workspace_id: string; user_id: string }
interface WaiterRow { request_id: string; workspace_id: string; agent_token_id: string }
interface AvailabilityRow { user_id: string; workspace_id: string; state: string; last_seen_at: string | null; updated_at: string }
interface MobileDiagnosticRow { diagnostic_id: string; workspace_id: string; user_id: string; device_id: string | null; level: string; area: string; message: string; metadata_json: string; created_at: string }
interface AuditRow { event_id: number; workspace_id: string; user_id: string; event_type: string; target_id: string; payload_json: string; created_at: string }
interface PersonalEntitlementRow { user_id: string; trial_started_at: string; app_unlocked_at: string | null; included_hosted_activated_at: string | null; hosted_subscription_ends_at: string | null; hosted_subscription_canceled_at: string | null; hosted_data_deleted_at: string | null; created_at: string; updated_at: string }
interface BillingProductRow { id: string; product_key: string; kind: string; entitlement_key: string; apple_product_id: string | null; google_product_id: string | null; google_base_plan_id: string | null; active: number; created_at: string; updated_at: string }
interface BillingAttemptRow { id: string; user_id: string; product_key: string; product_group: string; platform: string; provider: string; status: string; provider_user_id: string | null; idempotency_key: string; expires_at: string; created_at: string; updated_at: string }
interface BillingTransactionRow { id: string; user_id: string; provider: string; environment: string; product_key: string; entitlement_key: string; platform: string; provider_transaction_id: string | null; provider_original_transaction_id: string | null; provider_purchase_token: string | null; status: string; purchased_at: string | null; expires_at: string | null; canceled_at: string | null; revoked_at: string | null; raw_event_json: string | null; created_at: string; updated_at: string }

const WORKSPACE_MEMBER_SELECT = `
  SELECT w.workspace_id, w.type, w.name, w.clerk_organization_id, w.created_at, w.updated_at,
         wm.user_id, wm.role, wm.status, wm.clerk_membership_id,
         u.email, u.name AS display_name
  FROM workspace_members wm
  JOIN workspaces w ON w.workspace_id = wm.workspace_id
  JOIN users u ON u.id = wm.user_id
`;

const AGENT_TOKEN_SELECT = `
  SELECT at.agent_token_id, at.workspace_id, w.type AS workspace_type, at.creator_user_id, at.routing_rule_id, at.label, at.scopes_json, at.last_activity_at, at.last_check_in_at, at.created_at, at.revoked_at
  FROM agent_tokens at
  JOIN workspaces w ON w.workspace_id = at.workspace_id
`;

const REQUEST_SELECT = `SELECT r.* FROM requests r`;

const STATUS_UPDATE_SELECT = `
  SELECT su.*, at.label AS agent_token_label
  FROM status_updates su
  LEFT JOIN agent_tokens at ON at.agent_token_id = su.agent_token_id
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
    ...(row.email ? { email: row.email } : {}),
    ...(row.display_name ? { displayName: row.display_name } : {}),
    ...(row.clerk_membership_id ? { clerkMembershipId: row.clerk_membership_id } : {})
  };
}

function mapAgentToken(row: AgentTokenRow): AgentTokenRecord {
  return {
    agentTokenId: row.agent_token_id,
    label: row.label,
    scopes: parseJSON(row.scopes_json, []),
    workspaceId: row.workspace_id,
    workspaceType: row.workspace_type as WorkspaceType,
    ...(row.routing_rule_id ? { routingRuleId: row.routing_rule_id } : {}),
    ...(row.creator_user_id ? { creatorUserId: row.creator_user_id } : {}),
    ...(row.last_activity_at ? { lastActivityAt: row.last_activity_at } : {}),
    ...(row.last_check_in_at ? { lastCheckInAt: row.last_check_in_at } : {}),
    createdAt: row.created_at,
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {})
  };
}

function mapRequestRecipient(row: RequestRecipientRow): RequestRecipient {
  return {
    userId: row.user_id,
    hasActiveDevice: Boolean(row.has_active_device),
    ...(row.responded_at ? { respondedAt: row.responded_at } : {})
  };
}

function mapResponse(row: ResponseRow): ResponseRecord {
  return {
    responseId: row.response_id,
    requestId: row.request_id,
    userId: row.user_id,
    source: row.source,
    ...(row.choice_id ? { choiceId: row.choice_id } : {}),
    ...(row.message ? { message: row.message } : {}),
    ...(row.answers_json ? { answers: parseJSON(row.answers_json, undefined) } : {}),
    final: Boolean(row.final),
    createdAt: row.created_at
  };
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

function mapDevice(row: DeviceRow): DeviceRecord {
  return {
    deviceId: row.device_id,
    userId: row.user_id,
    name: row.name,
    ...(row.platform ? { platform: row.platform } : {}),
    ...(row.installation_id ? { installationId: row.installation_id } : {}),
    ...(row.expo_push_token ? { expoPushToken: row.expo_push_token } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.unregistered_at ? { unregisteredAt: row.unregistered_at } : {})
  };
}

function mapAvailability(row: AvailabilityRow): AvailabilityRecord {
  return {
    userId: row.user_id,
    workspaceId: row.workspace_id,
    state: row.state,
    ...(row.last_seen_at ? { lastSeenAt: row.last_seen_at } : {}),
    updatedAt: row.updated_at
  };
}

function mapMobileDiagnostic(row: MobileDiagnosticRow): MobileDiagnosticRecord {
  return {
    diagnosticId: row.diagnostic_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    ...(row.device_id ? { deviceId: row.device_id } : {}),
    level: row.level,
    area: row.area,
    message: row.message,
    metadata: parseJSON(row.metadata_json, {}),
    createdAt: row.created_at
  };
}

function mapAuditEvent(row: AuditRow): AuditEventRecord {
  return { eventId: row.event_id, workspaceId: row.workspace_id, userId: row.user_id, eventType: row.event_type, targetId: row.target_id, payload: parseJSON(row.payload_json, {}), createdAt: row.created_at };
}

function mapPersonalEntitlement(row: PersonalEntitlementRow): PersonalEntitlementRecord {
  return {
    userId: row.user_id,
    trialStartedAt: row.trial_started_at,
    ...(row.app_unlocked_at ? { appUnlockedAt: row.app_unlocked_at } : {}),
    ...(row.included_hosted_activated_at ? { includedHostedActivatedAt: row.included_hosted_activated_at } : {}),
    ...(row.hosted_subscription_ends_at ? { hostedSubscriptionEndsAt: row.hosted_subscription_ends_at } : {}),
    ...(row.hosted_subscription_canceled_at ? { hostedSubscriptionCanceledAt: row.hosted_subscription_canceled_at } : {}),
    ...(row.hosted_data_deleted_at ? { hostedDataDeletedAt: row.hosted_data_deleted_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapBillingProduct(row: BillingProductRow): BillingProductRecord {
  return {
    id: row.id,
    productKey: row.product_key,
    kind: row.kind,
    entitlementKey: row.entitlement_key,
    ...(row.apple_product_id ? { appleProductId: row.apple_product_id } : {}),
    ...(row.google_product_id ? { googleProductId: row.google_product_id } : {}),
    ...(row.google_base_plan_id ? { googleBasePlanId: row.google_base_plan_id } : {}),
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapBillingAttempt(row: BillingAttemptRow): BillingPurchaseAttemptRecord {
  return {
    attemptId: row.id,
    userId: row.user_id,
    productKey: row.product_key,
    productGroup: row.product_group,
    platform: row.platform,
    provider: row.provider,
    status: row.status,
    ...(row.provider_user_id ? { providerUserId: row.provider_user_id } : {}),
    idempotencyKey: row.idempotency_key,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapBillingTransaction(row: BillingTransactionRow): BillingTransactionRecord {
  return {
    transactionId: row.id,
    userId: row.user_id,
    provider: row.provider,
    environment: row.environment,
    productKey: row.product_key,
    entitlementKey: row.entitlement_key,
    platform: row.platform,
    ...(row.provider_transaction_id ? { providerTransactionId: row.provider_transaction_id } : {}),
    ...(row.provider_original_transaction_id ? { providerOriginalTransactionId: row.provider_original_transaction_id } : {}),
    ...(row.provider_purchase_token ? { providerPurchaseToken: row.provider_purchase_token } : {}),
    status: row.status,
    ...(row.purchased_at ? { purchasedAt: row.purchased_at } : {}),
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...(row.canceled_at ? { canceledAt: row.canceled_at } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    ...(row.raw_event_json ? { rawEventJSON: row.raw_event_json } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function defaultChoices(requestType: string, choices: Choice[] | undefined): Choice[] {
  if (choices?.length) return choices;
  if (requestType === 'steering') return [{ id: 'option_a', label: 'Option A', kind: 'approve' }, { id: 'option_b', label: 'Option B', kind: 'approve' }, { id: 'cancel', label: 'Cancel', kind: 'deny' }];
  return [{ id: 'approve', label: 'Approve', kind: 'approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }];
}

function requiredCount(mode: RequiredResponseMode, count: number, recipientCount: number): number {
  if (mode === 'all') return Math.max(recipientCount, 1);
  if (mode === 'exact') return Math.max(Math.min(count, Math.max(recipientCount, 1)), 1);
  return 1;
}

function coalesceNullableInput(value: string | null | undefined, fallback: string | undefined): string | null {
  if (value === undefined) return fallback ?? null;
  return value;
}

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;
}

function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('base64url');
}

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function clampLimit(limit: number, max = 100): number {
  return Math.min(Math.max(Math.trunc(limit), 1), max);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function deleteOlderThan(db: Database.Database, table: string, column: string, days: number | undefined, now: string, extraWhere = '1 = 1'): number {
  if (days === undefined) return 0;
  const cutoff = new Date(Date.parse(now) - days * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(`DELETE FROM ${table} WHERE ${extraWhere} AND ${column} IS NOT NULL AND ${column} < ?`).run(cutoff).changes;
}

function databasePathFromURL(databaseURL: string): string {
  if (databaseURL === ':memory:') return databaseURL;
  if (databaseURL.startsWith('file:')) return databaseURL.slice('file:'.length);
  return databaseURL;
}

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  email_verified INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  sign_in_method TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users(lower(email)) WHERE email <> '';

CREATE TABLE IF NOT EXISTS auth_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  issuer TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL DEFAULT '',
  email_verified INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  auth_method TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, issuer, subject)
);
CREATE INDEX IF NOT EXISTS auth_identities_user_idx ON auth_identities(user_id);

CREATE TABLE IF NOT EXISTS workspaces (
  workspace_id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('personal', 'shared')),
  name TEXT NOT NULL,
  clerk_organization_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  clerk_membership_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members(user_id, status);
CREATE INDEX IF NOT EXISTS workspace_members_workspace_status_idx ON workspace_members(workspace_id, status);

CREATE TABLE IF NOT EXISTS routing_rules (
  routing_rule_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  required_response_mode TEXT NOT NULL DEFAULT 'any_one',
  required_response_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS routing_rules_workspace_idx ON routing_rules(workspace_id, name);

CREATE TABLE IF NOT EXISTS routing_rule_recipients (
  routing_rule_id TEXT NOT NULL REFERENCES routing_rules(routing_rule_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(routing_rule_id, user_id)
);

CREATE TABLE IF NOT EXISTS agent_tokens (
  agent_token_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  creator_user_id TEXT REFERENCES users(id),
  routing_rule_id TEXT REFERENCES routing_rules(routing_rule_id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  last_activity_at TEXT,
  last_check_in_at TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS agent_tokens_workspace_idx ON agent_tokens(workspace_id, revoked_at, created_at);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  agent_token_id TEXT REFERENCES agent_tokens(agent_token_id) ON DELETE SET NULL,
  routing_rule_id TEXT REFERENCES routing_rules(routing_rule_id) ON DELETE SET NULL,
  requester_json TEXT NOT NULL,
  request_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  command TEXT,
  encrypted_payload_json TEXT,
  choices_json TEXT NOT NULL,
  questions_json TEXT NOT NULL DEFAULT '[]',
  default_choice TEXT,
  allow_freeform_reply INTEGER NOT NULL DEFAULT 0,
  deadline TEXT,
  risk TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  required_response_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  responded_at TEXT,
  response_json TEXT,
  final_choice_id TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,
  test_label TEXT
);
CREATE INDEX IF NOT EXISTS requests_workspace_status_idx ON requests(workspace_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS request_recipients (
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  has_active_device INTEGER NOT NULL DEFAULT 0,
  responded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(request_id, user_id)
);
CREATE INDEX IF NOT EXISTS request_recipients_user_idx ON request_recipients(user_id, request_id);

CREATE TABLE IF NOT EXISTS responses (
  response_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  choice_id TEXT,
  message TEXT,
  answers_json TEXT,
  final INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(request_id, user_id)
);
CREATE INDEX IF NOT EXISTS responses_request_idx ON responses(request_id, created_at);

CREATE TABLE IF NOT EXISTS status_updates (
  status_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  agent_token_id TEXT REFERENCES agent_tokens(agent_token_id) ON DELETE SET NULL,
  routing_rule_id TEXT REFERENCES routing_rules(routing_rule_id) ON DELETE SET NULL,
  thread_id TEXT,
  message TEXT NOT NULL,
  state TEXT NOT NULL,
  next_step TEXT,
  host TEXT,
  working_directory TEXT,
  client_name TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  is_test INTEGER NOT NULL DEFAULT 0,
  test_label TEXT
);
CREATE INDEX IF NOT EXISTS status_updates_workspace_idx ON status_updates(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS status_update_recipients (
  status_id TEXT NOT NULL REFERENCES status_updates(status_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(status_id, user_id)
);
CREATE INDEX IF NOT EXISTS status_update_recipients_user_idx ON status_update_recipients(user_id, status_id);

CREATE TABLE IF NOT EXISTS approval_devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT,
  installation_id TEXT,
  expo_push_token TEXT,
  token_hash TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  unregistered_at TEXT
);
CREATE INDEX IF NOT EXISTS approval_devices_user_idx ON approval_devices(user_id, unregistered_at);
CREATE INDEX IF NOT EXISTS approval_devices_installation_idx ON approval_devices(user_id, installation_id);

CREATE TABLE IF NOT EXISTS device_pairing_codes (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS event_tickets (
  token_hash TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS request_waiter_tokens (
  token_hash TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  agent_token_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS availability (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  last_seen_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS mobile_diagnostics (
  diagnostic_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT,
  level TEXT NOT NULL,
  area TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mobile_diagnostics_workspace_idx ON mobile_diagnostics(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_workspace_idx ON audit_events(workspace_id, event_id DESC);

CREATE TABLE IF NOT EXISTS personal_entitlements (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  trial_started_at TEXT NOT NULL,
  app_unlocked_at TEXT,
  included_hosted_activated_at TEXT,
  hosted_subscription_ends_at TEXT,
  hosted_subscription_canceled_at TEXT,
  hosted_data_deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_products (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  apple_product_id TEXT,
  google_product_id TEXT,
  google_base_plan_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_purchase_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_key TEXT NOT NULL,
  product_group TEXT NOT NULL,
  platform TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_user_id TEXT,
  idempotency_key TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, idempotency_key)
);
CREATE INDEX IF NOT EXISTS billing_purchase_attempts_user_idx ON billing_purchase_attempts(user_id, product_group, status, expires_at);

CREATE TABLE IF NOT EXISTS billing_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL,
  product_key TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  provider_transaction_id TEXT,
  provider_original_transaction_id TEXT,
  provider_purchase_token TEXT,
  status TEXT NOT NULL,
  purchased_at TEXT,
  expires_at TEXT,
  canceled_at TEXT,
  revoked_at TEXT,
  raw_event_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_transactions_provider_tx_idx ON billing_transactions(provider, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS billing_transactions_provider_token_idx ON billing_transactions(provider, provider_purchase_token) WHERE provider_purchase_token IS NOT NULL;
`;
