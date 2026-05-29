import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { sqliteDialect } from './dialect.js';
import { SQLiteIdentityWorkspaceRepository } from './repositories/identityWorkspace.js';
import { SQLiteRoutingTokenRequestRepository } from './repositories/routingTokensRequests.js';
import { SQLiteStatusDeviceBillingRepository } from './repositories/statusDeviceBilling.js';
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
  SessionMetadataSchema,
  statusUpdateStateBehavior,
  StatusUpdateRecordSchema
} from '@self-deprecated/agent-tick-shared';
import {
  DEFAULT_REQUEST_WAITER_LEASE_MS,
  DEFAULT_USER_ID,
  DEFAULT_WORKSPACE_ID,
  type ActivityItem,
  type AgentCredential,
  type AgentTokenAuth,
  type AgentTokenRecord,
  type AsyncAgentTickStore,
  type AuditEventRecord,
  type AudienceChannelRecord,
  type AudienceSubscriptionRecord,
  type AvailabilityRecord,
  type BillingIdentityConflictRecord,
  type BillingProductRecord,
  type BillingPurchaseAttemptRecord,
  type BillingReceiptOwnerRecord,
  type BillingTransactionRecord,
  type Choice,
  type ClaimBillingReceiptOwnerInput,
  type ClaimBillingReceiptOwnerResult,
  type CleanupExpiredSecretsResult,
  type CleanupRetentionResult,
  type ClerkIdentityProfile,
  type CreateAgentTokenInput,
  type CreateBillingPurchaseAttemptInput,
  type CreateExternalApproverInviteInput,
  type CreateRequestInput,
  type CreateRoutingRule,
  type CreateStatusUpdateInput,
  type DeleteWorkspaceDataResult,
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
  type HumanIdentityResult,
  type MobileDiagnosticInput,
  type MobileDiagnosticRecord,
  type OpenStoreOptions,
  type PairingTokenRecord,
  type PersonalEntitlementRecord,
  type RequestAgentWaiterSummary,
  type RequestRecord,
  type RequestRecipient,
  type RequiredResponseMode,
  type RequestWaiterAuth,
  type RequestWaiterRecord,
  type RequestWaiterTokenRecord,
  type RespondRequest,
  type ResponseRecord,
  type RetentionPolicy,
  type RoutingRuleRecord,
  type SessionMetadata,
  type StatusUpdateRecord,
  type TransferAccountBoundBillingPurchasesInput,
  type TransferAccountBoundBillingPurchasesResult,
  type UpdateAgentToken,
  type UpdatePersonalEntitlementInput,
  type UpdateRoutingRule,
  type UpdateWorkspaceEntitlementInput,
  type UpsertBillingIdentityConflictInput,
  type UpsertBillingProductInput,
  type UpsertBillingTransactionInput,
  type UpsertBillingTransactionResult,
  type UserProfileRecord,
  type WorkspaceMemberKind,
  type WorkspaceMemberRecord,
  type WorkspaceRecord,
  type WorkspaceRole,
  type WorkspaceType
} from '../store/types.js';

export class AgentTickStore implements AsyncAgentTickStore {
  readonly db: Database.Database;
  private readonly identityWorkspaces: SQLiteIdentityWorkspaceRepository;
  private readonly routingTokensRequests: SQLiteRoutingTokenRequestRepository;
  private readonly statusDeviceBilling: SQLiteStatusDeviceBillingRepository;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.identityWorkspaces = new SQLiteIdentityWorkspaceRepository(this.db, {
      writeAuditEvent: (workspaceId, userId, eventType, targetId, payload, now) => this.writeAuditEvent(workspaceId, userId, eventType, targetId, payload, now),
      revokeAgentTokensForOwner: (userId, now) => this.revokeAgentTokensForOwnerImpl(userId, now),
      deleteRoutingRule: (routingRuleId, workspaceId, now) => this.deleteRoutingRuleImpl(routingRuleId, workspaceId, now)
    });
    this.routingTokensRequests = new SQLiteRoutingTokenRequestRepository({
      createExternalApprover: (workspaceId, input, createdByUserId, now) => this.createExternalApproverImpl(workspaceId, input, createdByUserId, now),
      getExternalApprover: (externalApproverId, workspaceId) => this.getExternalApproverImpl(externalApproverId, workspaceId),
      getExternalApproverStatus: (externalApproverId, workspaceId) => this.getExternalApproverStatusImpl(externalApproverId, workspaceId),
      createExternalApproverAgentToken: (externalApproverId, workspaceId, createdByUserId, now) => this.createExternalApproverAgentTokenImpl(externalApproverId, workspaceId, createdByUserId, now),
      createExternalApproverInvite: (input, now) => this.createExternalApproverInviteImpl(input, now),
      getExternalApproverInviteByToken: (token, now) => this.getExternalApproverInviteByTokenImpl(token, now),
      acceptExternalApproverInvite: (token, userId, now) => this.acceptExternalApproverInviteImpl(token, userId, now),
      revokeExternalApproverInvite: (inviteId, workspaceId, now) => this.revokeExternalApproverInviteImpl(inviteId, workspaceId, now),
      createAudienceChannel: (input, createdByUserId, now) => this.createAudienceChannelImpl(input, createdByUserId, now),
      listAudienceChannels: (workspaceId) => this.listAudienceChannelsImpl(workspaceId),
      getAudienceChannel: (channelId) => this.getAudienceChannelImpl(channelId),
      setAudienceSubscription: (channelId, userId, status, now) => this.setAudienceSubscriptionImpl(channelId, userId, status, now),
      getAudienceSubscription: (channelId, userId) => this.getAudienceSubscriptionImpl(channelId, userId),
      createRoutingRule: (input, now) => this.createRoutingRuleImpl(input, now),
      listRoutingRules: (workspaceId) => this.listRoutingRulesImpl(workspaceId),
      getRoutingRule: (routingRuleId) => this.getRoutingRuleImpl(routingRuleId),
      updateRoutingRule: (routingRuleId, input, now) => this.updateRoutingRuleImpl(routingRuleId, input, now),
      deleteRoutingRule: (routingRuleId, workspaceId, now) => this.deleteRoutingRuleImpl(routingRuleId, workspaceId, now),
      createAgentToken: (input, now) => this.createAgentTokenImpl(input, now),
      listAgentTokens: (workspaceId) => this.listAgentTokensImpl(workspaceId),
      updateAgentToken: (agentTokenId, workspaceId, input, now) => this.updateAgentTokenImpl(agentTokenId, workspaceId, input, now),
      revokeAgentToken: (agentTokenId, workspaceId, now) => this.revokeAgentTokenImpl(agentTokenId, workspaceId, now),
      revokeAgentTokensForOwner: (userId, now) => this.revokeAgentTokensForOwnerImpl(userId, now),
      verifyAgentToken: (token, now) => this.verifyAgentTokenImpl(token, now),
      createRequest: (input, now) => this.createRequestImpl(input, now),
      listRequestsForUser: (userId, workspaceId, now, limit) => this.listRequestsForUserImpl(userId, workspaceId, now, limit),
      listAudienceRequestsForUser: (userId, now, limit) => this.listAudienceRequestsForUserImpl(userId, now, limit),
      getRequestForUser: (idValue, userId, now) => this.getRequestForUserImpl(idValue, userId, now),
      getRequestForWorkspace: (idValue, workspaceId, currentUserId, now) => this.getRequestForWorkspaceImpl(idValue, workspaceId, currentUserId, now),
      respondToRequestForWorkspace: (idValue, workspaceId, response, responderUserId, now) => this.respondToRequestForWorkspaceImpl(idValue, workspaceId, response, responderUserId, now),
      respondToAudienceRequest: (idValue, response, responderUserId, now) => this.respondToAudienceRequestImpl(idValue, response, responderUserId, now),
      abandonRequestForWorkspace: (idValue, workspaceId, actorId, now) => this.abandonRequestForWorkspaceImpl(idValue, workspaceId, actorId, now),
      createRequestWaiterToken: (requestId, workspaceId, agentTokenId, requestDeadline, now) => this.createRequestWaiterTokenImpl(requestId, workspaceId, agentTokenId, requestDeadline, now),
      verifyRequestWaiterToken: (token, requestId, now) => this.verifyRequestWaiterTokenImpl(token, requestId, now),
      renewRequestWaiter: (waiterId, leaseExpiresAt, now) => this.renewRequestWaiterImpl(waiterId, leaseExpiresAt, now),
      stopRequestWaiter: (waiterId, reason, now) => this.stopRequestWaiterImpl(waiterId, reason, now),
      markRequestWaiterError: (waiterId, errorCode, errorMessage, now) => this.markRequestWaiterErrorImpl(waiterId, errorCode, errorMessage, now)
    });
    this.statusDeviceBilling = new SQLiteStatusDeviceBillingRepository({
      ensureSingleTenantDefaults: (now) => this.ensureSingleTenantDefaultsImpl(now),
      cleanupExpiredSecrets: (now) => this.cleanupExpiredSecretsImpl(now),
      cleanupRetention: (policy, now) => this.cleanupRetentionImpl(policy, now),
      createStatusUpdate: (input, now) => this.createStatusUpdateImpl(input, now),
      getStatusUpdate: (statusId, workspaceId) => this.getStatusUpdateImpl(statusId, workspaceId),
      listLatestStatusUpdates: (workspaceId, limit) => this.listLatestStatusUpdatesImpl(workspaceId, limit),
      listActivityForUser: (userId, workspaceId, limit, now) => this.listActivityForUserImpl(userId, workspaceId, limit, now),
      pendingRequestCountForUser: (userId, workspaceId, now) => this.pendingRequestCountForUserImpl(userId, workspaceId, now),
      registerDevice: (input, now) => this.registerDeviceImpl(input, now),
      listDevicesForUser: (userId) => this.listDevicesForUserImpl(userId),
      listPushDevicesForRequestRecipients: (requestId) => this.listPushDevicesForRequestRecipientsImpl(requestId),
      listPushDevicesForAudienceChannel: (channelId) => this.listPushDevicesForAudienceChannelImpl(channelId),
      listPushDevicesForUsers: (userIds) => this.listPushDevicesForUsersImpl(userIds),
      getDeviceForUser: (deviceId, userId) => this.getDeviceForUserImpl(deviceId, userId),
      updateDeviceName: (deviceId, userId, name, now) => this.updateDeviceNameImpl(deviceId, userId, name, now),
      updateDevicePushToken: (deviceId, userId, expoPushToken, now) => this.updateDevicePushTokenImpl(deviceId, userId, expoPushToken, now),
      unregisterDevice: (deviceId, userId, now) => this.unregisterDeviceImpl(deviceId, userId, now),
      createPairingToken: (userId, workspaceId, now, ttlSeconds) => this.createPairingTokenImpl(userId, workspaceId, now, ttlSeconds),
      pairDeviceWithCode: (pairingCode, deviceName, platform, now) => this.pairDeviceWithCodeImpl(pairingCode, deviceName, platform, now),
      verifyDeviceToken: (token) => this.verifyDeviceTokenImpl(token),
      recordHeartbeat: (userId, workspaceId, now) => this.recordHeartbeatImpl(userId, workspaceId, now),
      setAvailability: (userId, workspaceId, state, now) => this.setAvailabilityImpl(userId, workspaceId, state, now),
      getAvailability: (userId, workspaceId) => this.getAvailabilityImpl(userId, workspaceId),
      createEventTicket: (input, now) => this.createEventTicketImpl(input, now),
      verifyEventTicket: (ticket, now) => this.verifyEventTicketImpl(ticket, now),
      recordMobileDiagnostics: (events) => this.recordMobileDiagnosticsImpl(events),
      listMobileDiagnostics: (workspaceId, limit) => this.listMobileDiagnosticsImpl(workspaceId, limit),
      listAuditEvents: (workspaceId, limit) => this.listAuditEventsImpl(workspaceId, limit),
      listAuditEventsAfter: (workspaceId, afterEventId, limit) => this.listAuditEventsAfterImpl(workspaceId, afterEventId, limit),
      writeAuditEvent: (workspaceId, userId, eventType, targetId, payload, now) => this.writeAuditEventImpl(workspaceId, userId, eventType, targetId, payload, now),
      getOrStartPersonalEntitlement: (userId, now) => this.getOrStartPersonalEntitlementImpl(userId, now),
      updatePersonalEntitlement: (input, now) => this.updatePersonalEntitlementImpl(input, now),
      upsertBillingProducts: (products, now) => this.upsertBillingProductsImpl(products, now),
      listBillingProducts: (activeOnly) => this.listBillingProductsImpl(activeOnly),
      createBillingPurchaseAttempt: (input, now) => this.createBillingPurchaseAttemptImpl(input, now),
      updateBillingPurchaseAttemptStatus: (attemptId, status, now) => this.updateBillingPurchaseAttemptStatusImpl(attemptId, status, now),
      listActiveBillingPurchaseAttempts: (userId, productGroup, now) => this.listActiveBillingPurchaseAttemptsImpl(userId, productGroup, now),
      upsertBillingTransaction: (input, now) => this.upsertBillingTransactionImpl(input, now),
      listBillingTransactionsForUser: (userId) => this.listBillingTransactionsForUserImpl(userId),
      transferAccountBoundBillingPurchases: (input, now) => this.transferAccountBoundBillingPurchasesImpl(input, now),
      claimBillingReceiptOwner: (input, now) => this.claimBillingReceiptOwnerImpl(input, now),
      upsertBillingIdentityConflict: (input, now) => this.upsertBillingIdentityConflictImpl(input, now),
      listBillingIdentityConflictsForUser: (userId) => this.listBillingIdentityConflictsForUserImpl(userId),
      deleteHostedPersonalData: (userId, workspaceId, now) => this.deleteHostedPersonalDataImpl(userId, workspaceId, now),
      deleteHostedAccountData: (userId, personalWorkspaceId, now) => this.deleteHostedAccountDataImpl(userId, personalWorkspaceId, now)
    });
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
  }

  ensureSingleTenantDefaults(now = new Date().toISOString()): void { this.statusDeviceBilling.invoke('ensureSingleTenantDefaults', now); }
  cleanupExpiredSecrets(now = new Date().toISOString()): CleanupExpiredSecretsResult { return this.statusDeviceBilling.invoke('cleanupExpiredSecrets', now) as CleanupExpiredSecretsResult; }
  cleanupRetention(policy: RetentionPolicy = {}, now = new Date().toISOString()): CleanupRetentionResult { return this.statusDeviceBilling.invoke('cleanupRetention', policy, now) as CleanupRetentionResult; }

  createStatusUpdate(input: CreateStatusUpdateInput, now = new Date().toISOString()): StatusUpdateRecord { return this.statusDeviceBilling.invoke('createStatusUpdate', input, now) as StatusUpdateRecord; }
  getStatusUpdate(statusId: string, workspaceId: string): StatusUpdateRecord | null { return this.statusDeviceBilling.invoke('getStatusUpdate', statusId, workspaceId) as StatusUpdateRecord | null; }
  listLatestStatusUpdates(workspaceId: string, limit = 20): StatusUpdateRecord[] { return this.statusDeviceBilling.invoke('listLatestStatusUpdates', workspaceId, limit) as StatusUpdateRecord[]; }
  listActivityForUser(userId: string, workspaceId?: string, limit = 50, now = new Date().toISOString()): ActivityItem[] { return this.statusDeviceBilling.invoke('listActivityForUser', userId, workspaceId, limit, now) as ActivityItem[]; }
  pendingRequestCountForUser(userId: string, workspaceId?: string, now = new Date().toISOString()): number { return this.statusDeviceBilling.invoke('pendingRequestCountForUser', userId, workspaceId, now) as number; }

  registerDevice(input: DeviceRegistrationInput, now = new Date().toISOString()): DeviceRecord { return this.statusDeviceBilling.invoke('registerDevice', input, now) as DeviceRecord; }
  listDevicesForUser(userId: string): DeviceRecord[] { return this.statusDeviceBilling.invoke('listDevicesForUser', userId) as DeviceRecord[]; }
  listPushDevicesForRequestRecipients(requestId: string): DeviceRecord[] { return this.statusDeviceBilling.invoke('listPushDevicesForRequestRecipients', requestId) as DeviceRecord[]; }
  listPushDevicesForAudienceChannel(channelId: string): DeviceRecord[] { return this.statusDeviceBilling.invoke('listPushDevicesForAudienceChannel', channelId) as DeviceRecord[]; }
  listPushDevicesForUsers(userIds: string[]): DeviceRecord[] { return this.statusDeviceBilling.invoke('listPushDevicesForUsers', userIds) as DeviceRecord[]; }
  getDeviceForUser(deviceId: string, userId: string): DeviceRecord | null { return this.statusDeviceBilling.invoke('getDeviceForUser', deviceId, userId) as DeviceRecord | null; }
  updateDeviceName(deviceId: string, userId: string, name: string, now = new Date().toISOString()): DeviceRecord | null { return this.statusDeviceBilling.invoke('updateDeviceName', deviceId, userId, name, now) as DeviceRecord | null; }
  updateDevicePushToken(deviceId: string, userId: string, expoPushToken: string, now = new Date().toISOString()): DeviceRecord | null { return this.statusDeviceBilling.invoke('updateDevicePushToken', deviceId, userId, expoPushToken, now) as DeviceRecord | null; }
  unregisterDevice(deviceId: string, userId: string, now = new Date().toISOString()): DeviceRecord | null { return this.statusDeviceBilling.invoke('unregisterDevice', deviceId, userId, now) as DeviceRecord | null; }
  createPairingToken(userId: string, workspaceId: string, now = new Date().toISOString(), ttlSeconds = 10 * 60): PairingTokenRecord { return this.statusDeviceBilling.invoke('createPairingToken', userId, workspaceId, now, ttlSeconds) as PairingTokenRecord; }
  pairDeviceWithCode(pairingCode: string, deviceName: string, platform?: string, now = new Date().toISOString()): DeviceCredential | null { return this.statusDeviceBilling.invoke('pairDeviceWithCode', pairingCode, deviceName, platform, now) as DeviceCredential | null; }
  verifyDeviceToken(token: string): DeviceTokenAuth | null { return this.statusDeviceBilling.invoke('verifyDeviceToken', token) as DeviceTokenAuth | null; }
  recordHeartbeat(userId: string, workspaceId: string, now = new Date().toISOString()): AvailabilityRecord { return this.statusDeviceBilling.invoke('recordHeartbeat', userId, workspaceId, now) as AvailabilityRecord; }
  setAvailability(userId: string, workspaceId: string, state: string, now = new Date().toISOString()): AvailabilityRecord { return this.statusDeviceBilling.invoke('setAvailability', userId, workspaceId, state, now) as AvailabilityRecord; }
  getAvailability(userId: string, workspaceId: string): AvailabilityRecord | null { return this.statusDeviceBilling.invoke('getAvailability', userId, workspaceId) as AvailabilityRecord | null; }
  createEventTicket(input: EventTicketInput, now = new Date().toISOString()): EventTicketRecord { return this.statusDeviceBilling.invoke('createEventTicket', input, now) as EventTicketRecord; }
  verifyEventTicket(ticket: string, now = new Date().toISOString()): EventTicketAuth | null { return this.statusDeviceBilling.invoke('verifyEventTicket', ticket, now) as EventTicketAuth | null; }
  recordMobileDiagnostics(events: MobileDiagnosticInput[]): number { return this.statusDeviceBilling.invoke('recordMobileDiagnostics', events) as number; }
  listMobileDiagnostics(workspaceId: string, limit = 100): MobileDiagnosticRecord[] { return this.statusDeviceBilling.invoke('listMobileDiagnostics', workspaceId, limit) as MobileDiagnosticRecord[]; }
  listAuditEvents(workspaceId: string, limit = 100): AuditEventRecord[] { return this.statusDeviceBilling.invoke('listAuditEvents', workspaceId, limit) as AuditEventRecord[]; }
  listAuditEventsAfter(workspaceId: string, afterEventId = 0, limit = 100): AuditEventRecord[] { return this.statusDeviceBilling.invoke('listAuditEventsAfter', workspaceId, afterEventId, limit) as AuditEventRecord[]; }
  writeAuditEvent(workspaceId: string, userId: string, eventType: string, targetId: string, payload: unknown, now = new Date().toISOString()): void { return this.statusDeviceBilling.invoke('writeAuditEvent', workspaceId, userId, eventType, targetId, payload, now) as void; }

  getOrStartPersonalEntitlement(userId: string, now = new Date().toISOString()): PersonalEntitlementRecord { return this.statusDeviceBilling.invoke('getOrStartPersonalEntitlement', userId, now) as PersonalEntitlementRecord; }
  updatePersonalEntitlement(input: UpdatePersonalEntitlementInput, now = new Date().toISOString()): PersonalEntitlementRecord { return this.statusDeviceBilling.invoke('updatePersonalEntitlement', input, now) as PersonalEntitlementRecord; }
  upsertBillingProducts(products: UpsertBillingProductInput[], now = new Date().toISOString()): void { return this.statusDeviceBilling.invoke('upsertBillingProducts', products, now) as void; }
  listBillingProducts(activeOnly = true): BillingProductRecord[] { return this.statusDeviceBilling.invoke('listBillingProducts', activeOnly) as BillingProductRecord[]; }
  createBillingPurchaseAttempt(input: CreateBillingPurchaseAttemptInput, now = new Date().toISOString()): BillingPurchaseAttemptRecord { return this.statusDeviceBilling.invoke('createBillingPurchaseAttempt', input, now) as BillingPurchaseAttemptRecord; }
  updateBillingPurchaseAttemptStatus(attemptId: string, status: string, now = new Date().toISOString()): BillingPurchaseAttemptRecord | null { return this.statusDeviceBilling.invoke('updateBillingPurchaseAttemptStatus', attemptId, status, now) as BillingPurchaseAttemptRecord | null; }
  listActiveBillingPurchaseAttempts(userId: string, productGroup: string, now = new Date().toISOString()): BillingPurchaseAttemptRecord[] { return this.statusDeviceBilling.invoke('listActiveBillingPurchaseAttempts', userId, productGroup, now) as BillingPurchaseAttemptRecord[]; }
  upsertBillingTransaction(input: UpsertBillingTransactionInput, now = new Date().toISOString()): UpsertBillingTransactionResult { return this.statusDeviceBilling.invoke('upsertBillingTransaction', input, now) as UpsertBillingTransactionResult; }
  listBillingTransactionsForUser(userId: string): BillingTransactionRecord[] { return this.statusDeviceBilling.invoke('listBillingTransactionsForUser', userId) as BillingTransactionRecord[]; }
  transferAccountBoundBillingPurchases(input: TransferAccountBoundBillingPurchasesInput, now = new Date().toISOString()): TransferAccountBoundBillingPurchasesResult { return this.statusDeviceBilling.invoke('transferAccountBoundBillingPurchases', input, now) as TransferAccountBoundBillingPurchasesResult; }
  claimBillingReceiptOwner(input: ClaimBillingReceiptOwnerInput, now = new Date().toISOString()): ClaimBillingReceiptOwnerResult { return this.statusDeviceBilling.invoke('claimBillingReceiptOwner', input, now) as ClaimBillingReceiptOwnerResult; }
  upsertBillingIdentityConflict(input: UpsertBillingIdentityConflictInput, now = new Date().toISOString()): BillingIdentityConflictRecord { return this.statusDeviceBilling.invoke('upsertBillingIdentityConflict', input, now) as BillingIdentityConflictRecord; }
  listBillingIdentityConflictsForUser(userId: string): BillingIdentityConflictRecord[] { return this.statusDeviceBilling.invoke('listBillingIdentityConflictsForUser', userId) as BillingIdentityConflictRecord[]; }
  deleteHostedPersonalData(userId: string, workspaceId: string, now = new Date().toISOString()): void { return this.statusDeviceBilling.invoke('deleteHostedPersonalData', userId, workspaceId, now) as void; }
  deleteHostedAccountData(userId: string, personalWorkspaceId: string, now = new Date().toISOString()): void { return this.statusDeviceBilling.invoke('deleteHostedAccountData', userId, personalWorkspaceId, now) as void; }

  ensureSingleTenantDefaultsImpl(now = new Date().toISOString()): void {
    const insert = sqliteDialect.insertInto;
    const ignore = sqliteDialect.onConflictDoNothing();
    this.db.prepare(`${insert('users', ['id', 'email', 'email_verified', 'name', 'created_at', 'updated_at'])} VALUES (?, '', ?, 'Local user', ?, ?) ${ignore}`).run(DEFAULT_USER_ID, sqliteDialect.encodeBoolean(false), now, now);
    this.db.prepare(`${insert('workspaces', ['workspace_id', 'type', 'name', 'created_at', 'updated_at'])} VALUES (?, 'personal', 'Personal', ?, ?) ${ignore}`).run(DEFAULT_WORKSPACE_ID, now, now);
    this.db.prepare(`${insert('workspace_members', ['workspace_id', 'user_id', 'role', 'status', 'created_at', 'updated_at'])} VALUES (?, ?, 'owner', 'active', ?, ?) ${ignore}`).run(DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID, now, now);
    this.ensurePersonalEntitlementRow(DEFAULT_USER_ID, now);
  }

  cleanupExpiredSecretsImpl(now = new Date().toISOString()): CleanupExpiredSecretsResult {
    const eventTickets = this.db.prepare('DELETE FROM event_tickets WHERE expires_at <= ? OR used_at IS NOT NULL').run(now).changes;
    const pairingCodes = this.db.prepare('DELETE FROM device_pairing_codes WHERE expires_at <= ? OR used_at IS NOT NULL').run(now).changes;
    const requestWaiterTokens = this.db.prepare('DELETE FROM request_waiter_tokens WHERE expires_at <= ?').run(now).changes;
    return { eventTickets, pairingCodes, requestWaiterTokens };
  }

  cleanupRetentionImpl(policy: RetentionPolicy = {}, now = new Date().toISOString()): CleanupRetentionResult {
    const requests = deleteOlderThan(this.db, 'requests', 'created_at', policy.requestsDays, now);
    const statusUpdates = deleteOlderThan(this.db, 'status_updates', 'created_at', policy.statusUpdatesDays, now);
    const auditEvents = deleteOlderThan(this.db, 'audit_events', 'created_at', policy.auditEventsDays, now);
    const devices = deleteOlderThan(this.db, 'approval_devices', 'unregistered_at', policy.unregisteredDevicesDays, now, 'unregistered_at IS NOT NULL');
    return { requests, statusUpdates, auditEvents, devices };
  }

  loginOrCreateClerkIdentity(profile: ClerkIdentityProfile, now = new Date().toISOString()): HumanIdentityResult {
    return this.identityWorkspaces.loginOrCreateClerkIdentity(profile, now);
  }

  upsertClerkUser(profile: ClerkIdentityProfile, now = new Date().toISOString()): string {
    return this.identityWorkspaces.upsertClerkUser(profile, now);
  }

  userIdForClerkSubject(issuer: string, subject: string): string | null {
    return this.identityWorkspaces.userIdForClerkSubject(issuer, subject);
  }

  defaultMembershipForUser(userId: string): HumanIdentityResult {
    return this.identityWorkspaces.defaultMembershipForUser(userId);
  }

  userProfile(userId: string): UserProfileRecord | null {
    return this.identityWorkspaces.userProfile(userId);
  }

  listWorkspacesForUser(userId: string): WorkspaceMemberRecord[] {
    return this.identityWorkspaces.listWorkspacesForUser(userId);
  }

  listWorkspaceMembers(workspaceId: string): WorkspaceMemberRecord[] {
    return this.identityWorkspaces.listWorkspaceMembers(workspaceId);
  }

  workspaceMembershipForUser(userId: string, workspaceId: string): HumanIdentityResult | null {
    return this.identityWorkspaces.workspaceMembershipForUser(userId, workspaceId);
  }

  workspaceMembershipForUserAnyStatus(userId: string, workspaceId: string): WorkspaceMemberRecord | null {
    return this.identityWorkspaces.workspaceMembershipForUserAnyStatus(userId, workspaceId);
  }

  createSharedWorkspaceForUser(userId: string, name: string, now = new Date().toISOString(), clerkOrganizationId?: string): WorkspaceMemberRecord {
    return this.identityWorkspaces.createSharedWorkspaceForUser(userId, name, now, clerkOrganizationId);
  }

  workspaceByClerkOrganizationId(clerkOrganizationId: string): WorkspaceRecord | null {
    return this.identityWorkspaces.workspaceByClerkOrganizationId(clerkOrganizationId);
  }

  upsertClerkWorkspace(clerkOrganizationId: string, name: string, ownerUserId?: string, now = new Date().toISOString()): WorkspaceRecord {
    return this.identityWorkspaces.upsertClerkWorkspace(clerkOrganizationId, name, ownerUserId, now);
  }

  upsertClerkWorkspaceMember(clerkOrganizationId: string, clerkMembershipId: string | undefined, userId: string, role: WorkspaceRole | string, now = new Date().toISOString()): WorkspaceMemberRecord {
    return this.identityWorkspaces.upsertClerkWorkspaceMember(clerkOrganizationId, clerkMembershipId, userId, role, now);
  }

  removeClerkWorkspaceMember(clerkOrganizationId: string, userIdOrMembershipId: string, now = new Date().toISOString()): void {
    this.identityWorkspaces.removeClerkWorkspaceMember(clerkOrganizationId, userIdOrMembershipId, now);
  }

  revokeUserAccess(userId: string, now = new Date().toISOString()): void {
    this.identityWorkspaces.revokeUserAccess(userId, now);
  }

  updateWorkspace(workspaceId: string, name: string, now = new Date().toISOString()): WorkspaceRecord | null {
    return this.identityWorkspaces.updateWorkspace(workspaceId, name, now);
  }

  updateWorkspaceEntitlement(workspaceId: string, input: UpdateWorkspaceEntitlementInput, now = new Date().toISOString()): WorkspaceRecord | null {
    return this.identityWorkspaces.updateWorkspaceEntitlement(workspaceId, input, now);
  }

  workspaceResponsesEntitled(workspaceId: string, now = new Date().toISOString()): boolean {
    return this.identityWorkspaces.workspaceResponsesEntitled(workspaceId, now);
  }

  addWorkspaceMemberByEmail(workspaceId: string, emailInput: string, role: WorkspaceRole | string = 'member', now = new Date().toISOString(), memberKind: WorkspaceMemberKind = 'internal'): WorkspaceMemberRecord {
    return this.identityWorkspaces.addWorkspaceMemberByEmail(workspaceId, emailInput, role, now, memberKind);
  }

  createExternalApprover(workspaceId: string, input: unknown, createdByUserId: string, now = new Date().toISOString()): ExternalApproverRecord { return this.routingTokensRequests.createExternalApprover(workspaceId, input, createdByUserId, now); }
  getExternalApprover(externalApproverId: string, workspaceId: string): ExternalApproverRecord | null { return this.routingTokensRequests.getExternalApprover(externalApproverId, workspaceId); }
  getExternalApproverStatus(externalApproverId: string, workspaceId: string): ExternalApproverStatus | null { return this.routingTokensRequests.getExternalApproverStatus(externalApproverId, workspaceId); }
  createExternalApproverAgentToken(externalApproverId: string, workspaceId: string, createdByUserId: string, now = new Date().toISOString()): AgentCredential | null { return this.routingTokensRequests.createExternalApproverAgentToken(externalApproverId, workspaceId, createdByUserId, now); }
  createExternalApproverInvite(input: CreateExternalApproverInviteInput, now = new Date().toISOString()): ExternalApproverInviteCredential { return this.routingTokensRequests.createExternalApproverInvite(input, now); }
  getExternalApproverInviteByToken(token: string, now = new Date().toISOString()): ExternalApproverInviteRecord | null { return this.routingTokensRequests.getExternalApproverInviteByToken(token, now); }
  acceptExternalApproverInvite(token: string, userId: string, now = new Date().toISOString()): WorkspaceMemberRecord | null { return this.routingTokensRequests.acceptExternalApproverInvite(token, userId, now); }
  revokeExternalApproverInvite(inviteId: string, workspaceId: string, now = new Date().toISOString()): ExternalApproverInviteRecord | null { return this.routingTokensRequests.revokeExternalApproverInvite(inviteId, workspaceId, now); }

  createAudienceChannel(input: unknown, createdByUserId: string, now = new Date().toISOString()): AudienceChannelRecord { return this.routingTokensRequests.createAudienceChannel(input, createdByUserId, now); }
  listAudienceChannels(workspaceId: string): AudienceChannelRecord[] { return this.routingTokensRequests.listAudienceChannels(workspaceId); }
  getAudienceChannel(channelId: string): AudienceChannelRecord | null { return this.routingTokensRequests.getAudienceChannel(channelId); }
  setAudienceSubscription(channelId: string, userId: string, status = 'active', now = new Date().toISOString()): AudienceSubscriptionRecord { return this.routingTokensRequests.setAudienceSubscription(channelId, userId, status, now); }
  getAudienceSubscription(channelId: string, userId: string): AudienceSubscriptionRecord | null { return this.routingTokensRequests.getAudienceSubscription(channelId, userId); }

  createRoutingRule(input: CreateRoutingRule, now = new Date().toISOString()): RoutingRuleRecord { return this.routingTokensRequests.createRoutingRule(input, now); }
  listRoutingRules(workspaceId: string): RoutingRuleRecord[] { return this.routingTokensRequests.listRoutingRules(workspaceId); }
  getRoutingRule(routingRuleId: string): RoutingRuleRecord | null { return this.routingTokensRequests.getRoutingRule(routingRuleId); }
  updateRoutingRule(routingRuleId: string, input: UpdateRoutingRule, now = new Date().toISOString()): RoutingRuleRecord | null { return this.routingTokensRequests.updateRoutingRule(routingRuleId, input, now); }
  deleteRoutingRule(routingRuleId: string, workspaceId: string, now = new Date().toISOString()): boolean { return this.routingTokensRequests.deleteRoutingRule(routingRuleId, workspaceId, now); }

  createAgentToken(input: CreateAgentTokenInput, now = new Date().toISOString()): AgentCredential { return this.routingTokensRequests.createAgentToken(input, now); }
  listAgentTokens(workspaceId?: string): AgentTokenRecord[] { return this.routingTokensRequests.listAgentTokens(workspaceId); }
  updateAgentToken(agentTokenId: string, workspaceId: string, input: UpdateAgentToken, now = new Date().toISOString()): AgentTokenRecord | null { return this.routingTokensRequests.updateAgentToken(agentTokenId, workspaceId, input, now); }
  revokeAgentToken(agentTokenId: string, workspaceId?: string, now = new Date().toISOString()): AgentTokenRecord | null { return this.routingTokensRequests.revokeAgentToken(agentTokenId, workspaceId, now); }
  revokeAgentTokensForOwner(userId: string, now = new Date().toISOString()): number { return this.routingTokensRequests.revokeAgentTokensForOwner(userId, now); }
  verifyAgentToken(token: string, now = new Date().toISOString()): AgentTokenAuth | null { return this.routingTokensRequests.verifyAgentToken(token, now); }

  createRequest(input: CreateRequestInput, now = new Date().toISOString()): RequestRecord { return this.routingTokensRequests.createRequest(input, now); }
  listRequestsForUser(userId: string, workspaceId?: string, now = new Date().toISOString(), limit?: number): RequestRecord[] { return this.routingTokensRequests.listRequestsForUser(userId, workspaceId, now, limit); }
  listAudienceRequestsForUser(userId: string, now = new Date().toISOString(), limit?: number): RequestRecord[] { return this.routingTokensRequests.listAudienceRequestsForUser(userId, now, limit); }
  getRequestForUser(idValue: string, userId: string, now = new Date().toISOString()): RequestRecord | null { return this.routingTokensRequests.getRequestForUser(idValue, userId, now); }
  getRequestForWorkspace(idValue: string, workspaceId: string, currentUserId?: string, now = new Date().toISOString()): RequestRecord | null { return this.routingTokensRequests.getRequestForWorkspace(idValue, workspaceId, currentUserId, now); }
  respondToRequestForWorkspace(idValue: string, workspaceId: string, response: RespondRequest, responderUserId: string, now = new Date().toISOString()): RequestRecord | null { return this.routingTokensRequests.respondToRequestForWorkspace(idValue, workspaceId, response, responderUserId, now); }
  respondToAudienceRequest(idValue: string, response: RespondRequest, responderUserId: string, now = new Date().toISOString()): RequestRecord | null { return this.routingTokensRequests.respondToAudienceRequest(idValue, response, responderUserId, now); }
  abandonRequestForWorkspace(idValue: string, workspaceId: string, actorId: string, now = new Date().toISOString()): RequestRecord | null { return this.routingTokensRequests.abandonRequestForWorkspace(idValue, workspaceId, actorId, now); }

  createRequestWaiterToken(requestId: string, workspaceId: string, agentTokenId: string, requestDeadline?: string, now = new Date().toISOString()): RequestWaiterTokenRecord { return this.routingTokensRequests.createRequestWaiterToken(requestId, workspaceId, agentTokenId, requestDeadline, now); }
  verifyRequestWaiterToken(token: string, requestId: string, now = new Date().toISOString()): RequestWaiterAuth | null { return this.routingTokensRequests.verifyRequestWaiterToken(token, requestId, now); }
  renewRequestWaiter(waiterId: string, leaseExpiresAt: string, now = new Date().toISOString()): RequestWaiterRecord | null { return this.routingTokensRequests.renewRequestWaiter(waiterId, leaseExpiresAt, now); }
  stopRequestWaiter(waiterId: string, reason: string, now = new Date().toISOString()): RequestWaiterRecord | null { return this.routingTokensRequests.stopRequestWaiter(waiterId, reason, now); }
  markRequestWaiterError(waiterId: string, errorCode: string, errorMessage?: string, now = new Date().toISOString()): RequestWaiterRecord | null { return this.routingTokensRequests.markRequestWaiterError(waiterId, errorCode, errorMessage, now); }

  createExternalApproverImpl(workspaceId: string, input: unknown, createdByUserId: string, now = new Date().toISOString()): ExternalApproverRecord {
    const parsed = CreateExternalApproverSchema.parse(input);
    const workspace = this.workspaceRow(workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    if (workspace.type !== 'shared') throw new Error('External Approvers require a Shared Workspace');
    if (!this.workspaceMembershipForUser(createdByUserId, workspaceId)) throw new Error('External Approver creator must be a Workspace Member');
    const externalApproverId = id('xapp');
    this.db.prepare(`
      INSERT INTO external_approvers(external_approver_id, workspace_id, external_subject, display_name, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(externalApproverId, workspaceId, parsed.externalSubject ?? null, parsed.displayName ?? null, createdByUserId, now, now);
    this.writeAuditEvent(workspaceId, createdByUserId, 'external_approver.created', externalApproverId, { externalSubject: parsed.externalSubject, displayName: parsed.displayName }, now);
    return this.externalApproverOrThrow(externalApproverId);
  }

  getExternalApproverImpl(externalApproverId: string, workspaceId: string): ExternalApproverRecord | null {
    const row = this.db.prepare(EXTERNAL_APPROVER_SELECT + ' WHERE external_approver_id = ? AND workspace_id = ?').get(externalApproverId, workspaceId) as ExternalApproverRow | undefined;
    return row ? mapExternalApprover(row) : null;
  }

  getExternalApproverStatusImpl(externalApproverId: string, workspaceId: string): ExternalApproverStatus | null {
    const approver = this.getExternalApprover(externalApproverId, workspaceId);
    if (!approver) return null;
    const invitePending = (this.db.prepare(`SELECT COUNT(*) AS count FROM external_approver_invites WHERE external_approver_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`).get(externalApproverId, new Date().toISOString()) as CountRow).count > 0;
    return { ...approver, invitePending, connected: Boolean(approver.userId), routeReady: Boolean(approver.routingRuleId && approver.agentTokenId) };
  }

  createExternalApproverAgentTokenImpl(externalApproverId: string, workspaceId: string, createdByUserId: string, now = new Date().toISOString()): AgentCredential | null {
    const approver = this.getExternalApprover(externalApproverId, workspaceId);
    if (!approver || !approver.userId) return null;
    const routingRuleId = approver.routingRuleId ?? this.createRoutingRule({ workspaceId, name: `${approver.displayName ?? approver.externalSubject ?? approver.userId} approvals`, recipientUserIds: [approver.userId], requiredResponseMode: 'any_one', requiredResponseCount: 1 }, now).routingRuleId;
    const credential = this.createAgentToken({ workspaceId, creatorUserId: createdByUserId, label: `${approver.displayName ?? approver.externalSubject ?? 'External Approver'} agent`, routingRuleId, boundRecipientUserId: approver.userId }, now);
    this.db.prepare('UPDATE external_approvers SET routing_rule_id = ?, agent_token_id = ?, updated_at = ? WHERE external_approver_id = ? AND workspace_id = ?').run(routingRuleId, credential.agentTokenId, now, externalApproverId, workspaceId);
    this.writeAuditEvent(workspaceId, createdByUserId, 'external_approver.agent_token_created', externalApproverId, { agentTokenId: credential.agentTokenId, routingRuleId }, now);
    return credential;
  }

  createExternalApproverInviteImpl(input: CreateExternalApproverInviteInput, now = new Date().toISOString()): ExternalApproverInviteCredential {
    const parsed = CreateExternalApproverInviteSchema.parse(input);
    const workspace = this.workspaceRow(input.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    if (workspace.type !== 'shared') throw new Error('External Approver invites require a Shared Workspace');
    if (!this.workspaceMembershipForUser(input.createdByUserId, input.workspaceId)) throw new Error('Invite creator must be a Workspace Member');
    const externalApprover = parsed.externalApproverId ? this.getExternalApprover(parsed.externalApproverId, input.workspaceId) : null;
    if (parsed.externalApproverId && !externalApprover) throw new Error('External Approver not found in Workspace');
    const token = `xinv_${crypto.randomBytes(24).toString('base64url')}`;
    const inviteId = id('xinv');
    const expiresAt = addMs(now, parsed.expiresInMinutes * 60_000);
    this.db.prepare(`
      INSERT INTO external_approver_invites(invite_id, workspace_id, external_approver_id, external_subject, display_name, token_hash, created_by_user_id, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(inviteId, input.workspaceId, parsed.externalApproverId ?? null, parsed.externalSubject ?? externalApprover?.externalSubject ?? null, parsed.displayName ?? externalApprover?.displayName ?? null, hashSecret(token), input.createdByUserId, expiresAt, now, now);
    this.writeAuditEvent(input.workspaceId, input.createdByUserId, 'external_approver_invite.created', inviteId, { externalSubject: parsed.externalSubject, displayName: parsed.displayName }, now);
    const record = this.externalApproverInviteOrThrow(inviteId);
    const deepLink = externalApproverInviteDeepLink(token, input.publicURL);
    return { ...record, token, deepLink, qrPayload: deepLink };
  }

  getExternalApproverInviteByTokenImpl(token: string, now = new Date().toISOString()): ExternalApproverInviteRecord | null {
    const row = this.db.prepare(EXTERNAL_APPROVER_INVITE_SELECT + ` WHERE eai.token_hash = ? AND eai.expires_at > ? AND eai.revoked_at IS NULL`).get(hashSecret(token), now) as ExternalApproverInviteRow | undefined;
    return row ? mapExternalApproverInvite(row) : null;
  }

  acceptExternalApproverInviteImpl(token: string, userId: string, now = new Date().toISOString()): WorkspaceMemberRecord | null {
    const row = this.db.prepare(EXTERNAL_APPROVER_INVITE_SELECT + ` WHERE eai.token_hash = ? AND eai.expires_at > ? AND eai.revoked_at IS NULL AND eai.accepted_at IS NULL`).get(hashSecret(token), now) as ExternalApproverInviteRow | undefined;
    if (!row) return null;
    this.ensureUserExists(userId, now);
    this.db.prepare(`
      INSERT INTO workspace_members(workspace_id, user_id, role, member_kind, status, created_at, updated_at)
      VALUES (?, ?, 'member', 'external_approver', 'active', ?, ?)
      ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = 'member', member_kind = 'external_approver', status = 'active', updated_at = excluded.updated_at
    `).run(row.workspace_id, userId, now, now);
    this.db.prepare('UPDATE external_approver_invites SET accepted_by_user_id = ?, accepted_at = ?, updated_at = ? WHERE invite_id = ?').run(userId, now, now, row.invite_id);
    if (row.external_approver_id) this.db.prepare('UPDATE external_approvers SET user_id = ?, display_name = COALESCE(display_name, ?), external_subject = COALESCE(external_subject, ?), updated_at = ? WHERE external_approver_id = ? AND workspace_id = ?').run(userId, row.display_name, row.external_subject, now, row.external_approver_id, row.workspace_id);
    this.writeAuditEvent(row.workspace_id, userId, 'external_approver_invite.accepted', row.invite_id, { externalSubject: row.external_subject, externalApproverId: row.external_approver_id }, now);
    return this.workspaceMemberOrThrow(userId, row.workspace_id);
  }

  revokeExternalApproverInviteImpl(inviteId: string, workspaceId: string, now = new Date().toISOString()): ExternalApproverInviteRecord | null {
    const existing = this.db.prepare(EXTERNAL_APPROVER_INVITE_SELECT + ` WHERE eai.invite_id = ? AND eai.workspace_id = ?`).get(inviteId, workspaceId) as ExternalApproverInviteRow | undefined;
    if (!existing) return null;
    this.db.prepare('UPDATE external_approver_invites SET revoked_at = COALESCE(revoked_at, ?), updated_at = ? WHERE invite_id = ?').run(now, now, inviteId);
    return this.externalApproverInviteOrThrow(inviteId);
  }

  removeWorkspaceMember(workspaceId: string, userId: string, now = new Date().toISOString()): void {
    this.identityWorkspaces.removeWorkspaceMember(workspaceId, userId, now);
  }

  workspaceSeatUsage(workspaceId: string): { activeMembers: number; pendingMembers: number } {
    return this.identityWorkspaces.workspaceSeatUsage(workspaceId);
  }

  deleteWorkspaceData(workspaceId: string, now = new Date().toISOString()): DeleteWorkspaceDataResult {
    return this.identityWorkspaces.deleteWorkspaceData(workspaceId, now);
  }

  createAudienceChannelImpl(input: unknown, createdByUserId: string, now = new Date().toISOString()): AudienceChannelRecord {
    const parsed = CreateAudienceChannelSchema.parse(input);
    const workspace = this.workspaceRow(parsed.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    if (workspace.type !== 'shared') throw new Error('Audience Channels require a Shared Workspace');
    const creator = this.workspaceMembershipForUser(createdByUserId, parsed.workspaceId);
    if (!creator || creator.memberKind === 'external_approver') throw new Error('Internal Workspace member required');
    const channelId = id('aud');
    this.db.prepare(`
      INSERT INTO audience_channels(channel_id, workspace_id, name, slug, visibility, status, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(channelId, parsed.workspaceId, parsed.name.trim(), parsed.slug ?? null, parsed.visibility, createdByUserId, now, now);
    this.writeAuditEvent(parsed.workspaceId, createdByUserId, 'audience_channel.created', channelId, { name: parsed.name.trim(), visibility: parsed.visibility }, now);
    return this.getAudienceChannel(channelId)!;
  }

  listAudienceChannelsImpl(workspaceId: string): AudienceChannelRecord[] {
    return (this.db.prepare('SELECT * FROM audience_channels WHERE workspace_id = ? ORDER BY lower(name)').all(workspaceId) as AudienceChannelRow[]).map(mapAudienceChannel);
  }

  getAudienceChannelImpl(channelId: string): AudienceChannelRecord | null {
    const row = this.db.prepare('SELECT * FROM audience_channels WHERE channel_id = ?').get(channelId) as AudienceChannelRow | undefined;
    return row ? mapAudienceChannel(row) : null;
  }

  setAudienceSubscriptionImpl(channelId: string, userId: string, status = 'active', now = new Date().toISOString()): AudienceSubscriptionRecord {
    const channel = this.getAudienceChannel(channelId);
    if (!channel || channel.status !== 'active') throw new Error('Audience Channel not found');
    this.ensureUserExists(userId, now);
    this.db.prepare(`
      INSERT INTO audience_subscriptions(channel_id, user_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(channel_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
    `).run(channelId, userId, status, now, now);
    return this.getAudienceSubscription(channelId, userId)!;
  }

  getAudienceSubscriptionImpl(channelId: string, userId: string): AudienceSubscriptionRecord | null {
    const row = this.db.prepare('SELECT * FROM audience_subscriptions WHERE channel_id = ? AND user_id = ?').get(channelId, userId) as AudienceSubscriptionRow | undefined;
    return row ? mapAudienceSubscription(row) : null;
  }

  createRoutingRuleImpl(input: CreateRoutingRule, now = new Date().toISOString()): RoutingRuleRecord {
    const parsed = CreateRoutingRuleSchema.parse(input);
    const workspace = this.workspaceRow(parsed.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    if (workspace.type === 'personal') throw new Error('Personal Workspace advanced routing is reserved for later');
    const recipients = unique(parsed.recipientUserIds);
    const memberships = recipients.map((userId) => {
      const membership = this.workspaceMembershipForUser(userId, parsed.workspaceId);
      if (!membership) throw new Error(`Routing Rule recipient is not an active Workspace Member: ${userId}`);
      return membership;
    });
    assertValidRoutingRuleRecipients(memberships, parsed.requiredResponseMode, parsed.requiredResponseCount);
    const routingRuleId = id('rul');
    this.db.prepare('INSERT INTO routing_rules(routing_rule_id, workspace_id, name, required_response_mode, required_response_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(routingRuleId, parsed.workspaceId, parsed.name.trim(), parsed.requiredResponseMode, parsed.requiredResponseCount, now, now);
    const insertRecipient = this.db.prepare('INSERT INTO routing_rule_recipients(routing_rule_id, user_id, created_at) VALUES (?, ?, ?)');
    for (const userId of recipients) insertRecipient.run(routingRuleId, userId, now);
    this.writeAuditEvent(parsed.workspaceId, DEFAULT_USER_ID, 'routing_rule.created', routingRuleId, { name: parsed.name.trim() }, now);
    return this.getRoutingRule(routingRuleId)!;
  }

  listRoutingRulesImpl(workspaceId: string): RoutingRuleRecord[] {
    return (this.db.prepare('SELECT * FROM routing_rules WHERE workspace_id = ? ORDER BY lower(name)').all(workspaceId) as RoutingRuleRow[]).map((row) => this.mapRoutingRule(row));
  }

  getRoutingRuleImpl(routingRuleId: string): RoutingRuleRecord | null {
    const row = this.db.prepare('SELECT * FROM routing_rules WHERE routing_rule_id = ?').get(routingRuleId) as RoutingRuleRow | undefined;
    return row ? this.mapRoutingRule(row) : null;
  }

  updateRoutingRuleImpl(routingRuleId: string, input: UpdateRoutingRule, now = new Date().toISOString()): RoutingRuleRecord | null {
    const existing = this.getRoutingRule(routingRuleId);
    if (!existing) return null;
    const name = input.name?.trim() ?? existing.name;
    const mode = input.requiredResponseMode ?? existing.requiredResponseMode;
    const count = input.requiredResponseCount ?? existing.requiredResponseCount;
    const recipients = input.recipientUserIds ? unique(input.recipientUserIds) : existing.recipientUserIds;
    if (!recipients.length) throw new Error('Routing Rules must have at least one recipient');
    const memberships = recipients.map((userId) => {
      const membership = this.workspaceMembershipForUser(userId, existing.workspaceId);
      if (!membership) throw new Error(`Routing Rule recipient is not an active Workspace Member: ${userId}`);
      return membership;
    });
    assertValidRoutingRuleRecipients(memberships, mode, count);
    this.db.prepare('UPDATE routing_rules SET name = ?, required_response_mode = ?, required_response_count = ?, updated_at = ? WHERE routing_rule_id = ?').run(name, mode, count, now, routingRuleId);
    if (input.recipientUserIds) {
      this.db.prepare('DELETE FROM routing_rule_recipients WHERE routing_rule_id = ?').run(routingRuleId);
      const insertRecipient = this.db.prepare('INSERT INTO routing_rule_recipients(routing_rule_id, user_id, created_at) VALUES (?, ?, ?)');
      for (const userId of recipients) insertRecipient.run(routingRuleId, userId, now);
    }
    return this.getRoutingRule(routingRuleId);
  }

  deleteRoutingRuleImpl(routingRuleId: string, workspaceId: string, now = new Date().toISOString()): boolean {
    const existing = this.getRoutingRule(routingRuleId);
    if (!existing || existing.workspaceId !== workspaceId) return false;
    this.db.prepare('UPDATE agent_tokens SET routing_rule_id = NULL WHERE workspace_id = ? AND routing_rule_id = ?').run(workspaceId, routingRuleId);
    this.db.prepare('DELETE FROM routing_rules WHERE routing_rule_id = ?').run(routingRuleId);
    this.writeAuditEvent(workspaceId, DEFAULT_USER_ID, 'routing_rule.deleted', routingRuleId, {}, now);
    return true;
  }

  createAgentTokenImpl(input: CreateAgentTokenInput, now = new Date().toISOString()): AgentCredential {
    const parsed = CreateAgentTokenSchema.parse(input);
    const workspaceId = parsed.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const workspace = this.workspaceRow(workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    const boundRecipientUserId = parsed.boundRecipientUserId ?? null;
    if (boundRecipientUserId) this.assertActiveWorkspaceMember(boundRecipientUserId, workspaceId);
    if (parsed.routingRuleId) {
      this.assertRuleInWorkspace(parsed.routingRuleId, workspaceId);
      if (boundRecipientUserId) this.assertRoutingRuleTargetsBoundRecipient(parsed.routingRuleId, boundRecipientUserId);
    }
    const token = `agent_${crypto.randomBytes(24).toString('base64url')}`;
    const agentTokenId = id('agt');
    const scopes = parsed.scopes?.length ? parsed.scopes : ['activity:create'];
    this.db.prepare(`
      INSERT INTO agent_tokens(agent_token_id, workspace_id, creator_user_id, routing_rule_id, bound_recipient_user_id, label, token_hash, scopes_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(agentTokenId, workspaceId, input.creatorUserId ?? null, parsed.routingRuleId ?? null, boundRecipientUserId, parsed.label.trim(), hashSecret(token), JSON.stringify(scopes), now);
    this.writeAuditEvent(workspaceId, input.creatorUserId ?? DEFAULT_USER_ID, 'agent_token.created', agentTokenId, { label: parsed.label.trim() }, now);
    return { ...this.agentTokenOrThrow(agentTokenId), token };
  }

  listAgentTokensImpl(workspaceId?: string): AgentTokenRecord[] {
    const rows = workspaceId
      ? this.db.prepare(AGENT_TOKEN_SELECT + ' WHERE at.workspace_id = ? ORDER BY at.created_at DESC').all(workspaceId)
      : this.db.prepare(AGENT_TOKEN_SELECT + ' ORDER BY at.created_at DESC').all();
    return (rows as AgentTokenRow[]).map(mapAgentToken);
  }

  updateAgentTokenImpl(agentTokenId: string, workspaceId: string, input: UpdateAgentToken, now = new Date().toISOString()): AgentTokenRecord | null {
    const existing = this.agentTokenRow(agentTokenId, workspaceId);
    if (!existing) return null;
    const label = input.label?.trim() ?? existing.label;
    const routingRuleId = Object.prototype.hasOwnProperty.call(input, 'routingRuleId') ? input.routingRuleId ?? null : existing.routing_rule_id;
    const boundRecipientUserId = Object.prototype.hasOwnProperty.call(input, 'boundRecipientUserId') ? input.boundRecipientUserId ?? null : existing.bound_recipient_user_id;
    if (boundRecipientUserId) this.assertActiveWorkspaceMember(boundRecipientUserId, workspaceId);
    if (routingRuleId) {
      this.assertRuleInWorkspace(routingRuleId, workspaceId);
      if (boundRecipientUserId) this.assertRoutingRuleTargetsBoundRecipient(routingRuleId, boundRecipientUserId);
    }
    this.db.prepare('UPDATE agent_tokens SET label = ?, routing_rule_id = ?, bound_recipient_user_id = ? WHERE agent_token_id = ? AND workspace_id = ?').run(label, routingRuleId, boundRecipientUserId, agentTokenId, workspaceId);
    return this.agentTokenRow(agentTokenId, workspaceId) ? mapAgentToken(this.agentTokenRow(agentTokenId, workspaceId)!) : null;
  }

  revokeAgentTokenImpl(agentTokenId: string, workspaceId?: string, now = new Date().toISOString()): AgentTokenRecord | null {
    const row = workspaceId ? this.agentTokenRow(agentTokenId, workspaceId) : this.agentTokenRowById(agentTokenId);
    if (!row) return null;
    this.db.prepare('UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE agent_token_id = ?').run(now, agentTokenId);
    const updated = this.agentTokenRowById(agentTokenId)!;
    this.writeAuditEvent(updated.workspace_id, DEFAULT_USER_ID, 'agent_token.revoked', agentTokenId, {}, now);
    return mapAgentToken(updated);
  }

  revokeAgentTokensForOwnerImpl(userId: string, now = new Date().toISOString()): number {
    return this.db.prepare('UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE creator_user_id = ?').run(now, userId).changes;
  }

  verifyAgentTokenImpl(token: string, now = new Date().toISOString()): AgentTokenAuth | null {
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
      boundRecipientUserId: row.bound_recipient_user_id ?? undefined,
      creatorUserId: row.creator_user_id ?? undefined
    };
  }

  createRequestImpl(input: CreateRequestInput, now = new Date().toISOString()): RequestRecord {
    const parsed = CreateRequestSchema.parse(input);
    const workspaceId = input.workspaceId ?? this.agentTokenRowById(input.agentTokenId ?? '')?.workspace_id ?? DEFAULT_WORKSPACE_ID;
    const route = parsed.deliveryKind === 'audience_channel'
      ? this.routeForAudienceRequest(workspaceId, parsed.audienceChannelId)
      : this.routeForActivity(workspaceId, input.agentTokenId, input.routingRuleId);
    const requestId = id('req');
    const choices = defaultChoices(parsed.requestType, parsed.choices);
    const requester = {
      ...parsed.requester,
      ...(input.agentTokenId ? { agentTokenId: input.agentTokenId } : {})
    };
    this.db.prepare(`
      INSERT INTO requests(id, workspace_id, agent_token_id, routing_rule_id, session_id, session_metadata_json, requester_json, request_type, delivery_kind, response_policy, audience_channel_id, closes_at, tie_policy, title, body, command, choices_json, questions_json, default_choice, allow_freeform_reply, deadline, risk, metadata_json, status, required_response_count, aggregate_result_json, created_at, is_test, test_label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `).run(
      requestId,
      workspaceId,
      input.agentTokenId ?? null,
      route.routingRuleId ?? null,
      parsed.sessionId ?? null,
      JSON.stringify(parsed.session ?? {}),
      JSON.stringify(requester),
      parsed.requestType,
      parsed.deliveryKind,
      parsed.responsePolicy,
      parsed.audienceChannelId ?? null,
      parsed.closesAt ?? null,
      parsed.tiePolicy ?? null,
      parsed.title,
      parsed.body ?? null,
      parsed.command ?? null,
      JSON.stringify(choices),
      JSON.stringify(parsed.questions ?? []),
      parsed.defaultChoice ?? null,
      parsed.allowFreeformReply ? 1 : 0,
      parsed.deadline ?? null,
      parsed.risk ?? null,
      JSON.stringify(parsed.metadata ?? {}),
      route.requiredResponseCount,
      null,
      now,
      input.isTest ? 1 : 0,
      input.testLabel ?? null
    );
    this.insertRequestRecipients(requestId, route.recipientUserIds, now);
    if (input.agentTokenId) this.db.prepare('UPDATE agent_tokens SET last_activity_at = ? WHERE agent_token_id = ?').run(now, input.agentTokenId);
    this.writeAuditEvent(workspaceId, input.userId ?? input.agentTokenId ?? DEFAULT_USER_ID, input.isTest ? 'request.test_created' : 'request.created', requestId, { title: parsed.title }, now);
    return this.requestOrThrow(requestId, input.userId, now);
  }

  listRequestsForUserImpl(userId: string, workspaceId?: string, now = new Date().toISOString(), limit?: number): RequestRecord[] {
    this.expirePendingRequests(now);
    const limitClause = limit === undefined ? '' : ' LIMIT ?';
    const rows = workspaceId
      ? this.db.prepare(REQUEST_SELECT + ` JOIN request_recipients rr ON rr.request_id = r.id WHERE rr.user_id = ? AND r.workspace_id = ? ORDER BY r.created_at DESC${limitClause}`).all(...(limit === undefined ? [userId, workspaceId] : [userId, workspaceId, clampLimit(limit, 1000)]))
      : this.db.prepare(REQUEST_SELECT + ` JOIN request_recipients rr ON rr.request_id = r.id WHERE rr.user_id = ? ORDER BY r.created_at DESC${limitClause}`).all(...(limit === undefined ? [userId] : [userId, clampLimit(limit, 1000)]));
    return (rows as RequestRow[]).map((row) => this.mapRequest(row, userId, now));
  }

  listAudienceRequestsForUserImpl(userId: string, now = new Date().toISOString(), limit?: number): RequestRecord[] {
    this.expirePendingRequests(now);
    const limitClause = limit === undefined ? '' : ' LIMIT ?';
    const rows = this.db.prepare(REQUEST_SELECT + ` JOIN audience_subscriptions aus ON aus.channel_id = r.audience_channel_id WHERE aus.user_id = ? AND aus.status = 'active' AND r.delivery_kind = 'audience_channel' ORDER BY r.created_at DESC${limitClause}`).all(...(limit === undefined ? [userId] : [userId, clampLimit(limit, 1000)])) as RequestRow[];
    return rows.map((row) => this.mapRequest(row, userId, now));
  }

  getRequestForUserImpl(idValue: string, userId: string, now = new Date().toISOString()): RequestRecord | null {
    this.expirePendingRequests(now);
    const row = this.db.prepare(REQUEST_SELECT + ` JOIN request_recipients rr ON rr.request_id = r.id WHERE r.id = ? AND rr.user_id = ?`).get(idValue, userId) as RequestRow | undefined;
    return row ? this.mapRequest(row, userId, now) : null;
  }

  getRequestForWorkspaceImpl(idValue: string, workspaceId: string, currentUserId?: string, now = new Date().toISOString()): RequestRecord | null {
    this.expirePendingRequests(now);
    const row = this.db.prepare(REQUEST_SELECT + ' WHERE r.id = ? AND r.workspace_id = ?').get(idValue, workspaceId) as RequestRow | undefined;
    return row ? this.mapRequest(row, currentUserId, now) : null;
  }

  respondToRequestForWorkspaceImpl(idValue: string, workspaceId: string, response: RespondRequest, responderUserId: string, now = new Date().toISOString()): RequestRecord | null {
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
    if (oldResponse) return this.mapRequest(this.requestRow(idValue)!, responderUserId, now);
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
    return this.mapRequest(this.requestRow(idValue)!, responderUserId, now);
  }

  respondToAudienceRequestImpl(idValue: string, response: RespondRequest, responderUserId: string, now = new Date().toISOString()): RequestRecord | null {
    const parsed = RespondRequestSchema.parse(response);
    if (!parsed.choiceId) throw new Error('Audience Responses must include a choiceId');
    this.finalizeDueAudienceRequests(now);
    const existing = this.getRequestForWorkspace(idValue, (this.requestRow(idValue) as RequestRow | undefined)?.workspace_id ?? '', responderUserId, now);
    if (!existing) return null;
    if (existing.deliveryKind !== 'audience_channel' || !existing.audienceChannelId) return null;
    if (existing.status !== 'pending') return existing;
    if (existing.closesAt && Date.parse(existing.closesAt) <= Date.parse(now)) {
      this.finalizeDueAudienceRequests(now);
      return this.getRequestForWorkspace(idValue, existing.workspaceId, responderUserId, now);
    }
    const subscription = this.getAudienceSubscription(existing.audienceChannelId, responderUserId);
    if (!subscription || subscription.status !== 'active') {
      const error = new Error('User is not subscribed to this Audience Channel') as Error & { code?: string; statusCode?: number };
      error.code = 'not_audience_subscriber';
      error.statusCode = 403;
      throw error;
    }
    if (!existing.choices.some((choice) => choice.id === parsed.choiceId)) throw new Error('Audience Response choice is not valid for this Request');
    const oldResponse = this.db.prepare('SELECT * FROM responses WHERE request_id = ? AND user_id = ?').get(idValue, responderUserId) as ResponseRow | undefined;
    if (oldResponse) return this.mapRequest(this.requestRow(idValue)!, responderUserId, now);
    const responseId = id('rsp');
    this.db.prepare(`
      INSERT INTO responses(response_id, request_id, user_id, source, choice_id, message, answers_json, final, created_at, updated_at)
      VALUES (?, ?, ?, 'audience', ?, NULL, NULL, 0, ?, ?)
    `).run(responseId, idValue, responderUserId, parsed.choiceId, now, now);
    return this.mapRequest(this.requestRow(idValue)!, responderUserId, now);
  }

  abandonRequestForWorkspaceImpl(idValue: string, workspaceId: string, actorId: string, now = new Date().toISOString()): RequestRecord | null {
    const existing = this.getRequestForWorkspace(idValue, workspaceId, undefined, now);
    if (!existing) return null;
    if (existing.status === 'pending') {
      this.db.prepare('UPDATE requests SET status = ?, responded_at = ?, response_json = ? WHERE id = ? AND workspace_id = ?').run('resolved', now, JSON.stringify({ message: 'resolved' }), idValue, workspaceId);
      this.writeAuditEvent(workspaceId, actorId, 'request.resolved', idValue, {}, now);
    }
    return this.getRequestForWorkspace(idValue, workspaceId, undefined, now);
  }

  createRequestWaiterTokenImpl(requestId: string, workspaceId: string, agentTokenId: string, requestDeadline?: string, now = new Date().toISOString()): RequestWaiterTokenRecord {
    const token = `wait_${crypto.randomBytes(24).toString('base64url')}`;
    const waiterId = id('waiter');
    const expiresAt = addMs(requestDeadline && Date.parse(requestDeadline) > Date.parse(now) ? requestDeadline : now, 65 * 60_000);
    const leaseExpiresAt = addMs(now, DEFAULT_REQUEST_WAITER_LEASE_MS);
    this.db.prepare(`
      INSERT INTO request_waiters(waiter_id, request_id, workspace_id, agent_token_id, transport, state, last_seen_at, lease_expires_at, credential_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'long_poll', 'waiting', ?, ?, ?, ?, ?)
    `).run(waiterId, requestId, workspaceId, agentTokenId, now, leaseExpiresAt, expiresAt, now, now);
    this.db.prepare('INSERT INTO request_waiter_tokens(token_hash, waiter_id, request_id, workspace_id, agent_token_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(hashSecret(token), waiterId, requestId, workspaceId, agentTokenId, expiresAt, now);
    return { token, waiterId, expiresAt, leaseExpiresAt };
  }

  verifyRequestWaiterTokenImpl(token: string, requestId: string, now = new Date().toISOString()): RequestWaiterAuth | null {
    const tokenHash = hashSecret(token);
    const row = this.db.prepare('SELECT * FROM request_waiter_tokens WHERE token_hash = ? AND request_id = ? AND expires_at > ?').get(tokenHash, requestId, now) as WaiterTokenRow | undefined;
    if (!row) return null;
    if (!this.requestWaiterById(row.waiter_id)) return null;
    this.db.prepare('UPDATE request_waiter_tokens SET last_used_at = ? WHERE token_hash = ?').run(now, tokenHash);
    return { requestId: row.request_id, workspaceId: row.workspace_id, agentTokenId: row.agent_token_id, waiterId: row.waiter_id };
  }

  renewRequestWaiterImpl(waiterId: string, leaseExpiresAt: string, now = new Date().toISOString()): RequestWaiterRecord | null {
    this.db.prepare(`
      UPDATE request_waiters
      SET state = CASE WHEN state IN ('stopped', 'errored') THEN state ELSE 'waiting' END,
          last_seen_at = CASE WHEN state IN ('stopped', 'errored') THEN last_seen_at ELSE ? END,
          lease_expires_at = CASE WHEN state IN ('stopped', 'errored') THEN lease_expires_at ELSE ? END,
          updated_at = ?
      WHERE waiter_id = ?
    `).run(now, leaseExpiresAt, now, waiterId);
    return this.requestWaiterById(waiterId);
  }

  stopRequestWaiterImpl(waiterId: string, reason: string, now = new Date().toISOString()): RequestWaiterRecord | null {
    this.db.prepare(`
      UPDATE request_waiters
      SET state = CASE WHEN state = 'errored' THEN state ELSE 'stopped' END,
          stopped_at = COALESCE(stopped_at, ?),
          stop_reason = COALESCE(stop_reason, ?),
          updated_at = ?
      WHERE waiter_id = ?
    `).run(now, reason, now, waiterId);
    return this.requestWaiterById(waiterId);
  }

  markRequestWaiterErrorImpl(waiterId: string, errorCode: string, errorMessage?: string, now = new Date().toISOString()): RequestWaiterRecord | null {
    this.db.prepare(`
      UPDATE request_waiters
      SET state = CASE WHEN state = 'stopped' THEN state ELSE 'errored' END,
          error_code = COALESCE(error_code, ?),
          error_message = COALESCE(error_message, ?),
          updated_at = ?
      WHERE waiter_id = ?
    `).run(errorCode, errorMessage ?? null, now, waiterId);
    return this.requestWaiterById(waiterId);
  }

  createStatusUpdateImpl(input: CreateStatusUpdateInput, now = new Date().toISOString()): StatusUpdateRecord {
    const parsed = CreateStatusUpdateSchema.parse(input);
    const route = this.routeForActivity(input.workspaceId, input.agentTokenId, input.routingRuleId);
    const statusId = id('stat');
    const sessionId = parsed.sessionId ?? parsed.threadId;
    this.db.prepare(`
      INSERT INTO status_updates(status_id, workspace_id, agent_token_id, routing_rule_id, thread_id, session_id, session_metadata_json, message, state, next_step, host, working_directory, client_name, metadata_json, created_at, is_test, test_label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(statusId, input.workspaceId, input.agentTokenId ?? null, route.routingRuleId ?? null, parsed.threadId ?? null, sessionId ?? null, JSON.stringify(parsed.session ?? {}), parsed.message, parsed.state, parsed.nextStep ?? null, parsed.host ?? null, parsed.workingDirectory ?? null, parsed.clientName ?? null, JSON.stringify(parsed.metadata ?? {}), now, input.isTest ? 1 : 0, input.testLabel ?? null);
    const insertRecipient = this.db.prepare('INSERT INTO status_update_recipients(status_id, user_id, created_at) VALUES (?, ?, ?)');
    for (const userId of route.recipientUserIds) insertRecipient.run(statusId, userId, now);
    if (input.agentTokenId) this.db.prepare('UPDATE agent_tokens SET last_activity_at = ? WHERE agent_token_id = ?').run(now, input.agentTokenId);
    this.writeAuditEvent(input.workspaceId, input.userId ?? input.agentTokenId ?? DEFAULT_USER_ID, input.isTest ? 'status_update.test_created' : 'status_update.created', statusId, { state: parsed.state }, now);
    return this.statusUpdateOrThrow(statusId);
  }

  getStatusUpdateImpl(statusId: string, workspaceId: string): StatusUpdateRecord | null {
    const row = this.db.prepare(STATUS_UPDATE_SELECT + ' WHERE su.status_id = ? AND su.workspace_id = ?').get(statusId, workspaceId) as StatusUpdateRow | undefined;
    return row ? this.mapStatusUpdate(row) : null;
  }

  listLatestStatusUpdatesImpl(workspaceId: string, limit = 20): StatusUpdateRecord[] {
    return (this.db.prepare(STATUS_UPDATE_SELECT + ' WHERE su.workspace_id = ? ORDER BY su.created_at DESC LIMIT ?').all(workspaceId, clampLimit(limit)) as StatusUpdateRow[]).map((row) => this.mapStatusUpdate(row));
  }

  listActivityForUserImpl(userId: string, workspaceId?: string, limit = 50, now = new Date().toISOString()): ActivityItem[] {
    this.expirePendingRequests(now);
    const requestRows = workspaceId
      ? this.db.prepare(REQUEST_SELECT + ` JOIN request_recipients rr ON rr.request_id = r.id WHERE rr.user_id = ? AND r.workspace_id = ?`).all(userId, workspaceId)
      : this.db.prepare(REQUEST_SELECT + ` JOIN request_recipients rr ON rr.request_id = r.id WHERE rr.user_id = ?`).all(userId);
    const statusRows = workspaceId
      ? this.db.prepare(STATUS_UPDATE_SELECT + ` JOIN status_update_recipients sur ON sur.status_id = su.status_id WHERE sur.user_id = ? AND su.workspace_id = ?`).all(userId, workspaceId)
      : this.db.prepare(STATUS_UPDATE_SELECT + ` JOIN status_update_recipients sur ON sur.status_id = su.status_id WHERE sur.user_id = ?`).all(userId);
    return [
      ...(requestRows as RequestRow[]).map((row) => ({ kind: 'request' as const, id: row.id, workspaceId: row.workspace_id, createdAt: row.created_at, request: this.mapRequest(row, userId, now) })),
      ...(statusRows as StatusUpdateRow[]).map((row) => ({ kind: 'status_update' as const, id: row.status_id, workspaceId: row.workspace_id, createdAt: row.created_at, statusUpdate: this.mapStatusUpdate(row) }))
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, clampLimit(limit));
  }

  pendingRequestCountForUserImpl(userId: string, workspaceId?: string, now = new Date().toISOString()): number {
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

  registerDeviceImpl(input: DeviceRegistrationInput, now = new Date().toISOString()): DeviceRecord {
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

  listDevicesForUserImpl(userId: string): DeviceRecord[] {
    return (this.db.prepare('SELECT * FROM approval_devices WHERE user_id = ? AND unregistered_at IS NULL ORDER BY created_at DESC').all(userId) as DeviceRow[]).map(mapDevice);
  }

  listPushDevicesForRequestRecipientsImpl(requestId: string): DeviceRecord[] {
    return uniqueDevicesByPushToken(this.db.prepare(`
      SELECT d.* FROM approval_devices d
      JOIN request_recipients rr ON rr.user_id = d.user_id
      WHERE rr.request_id = ? AND d.unregistered_at IS NULL AND d.expo_push_token IS NOT NULL AND d.expo_push_token <> ''
      ORDER BY d.updated_at DESC, d.created_at DESC
    `).all(requestId) as DeviceRow[]);
  }

  listPushDevicesForAudienceChannelImpl(channelId: string): DeviceRecord[] {
    return uniqueDevicesByPushToken(this.db.prepare(`
      SELECT d.* FROM approval_devices d
      JOIN audience_subscriptions aus ON aus.user_id = d.user_id
      WHERE aus.channel_id = ? AND aus.status = 'active' AND d.unregistered_at IS NULL AND d.expo_push_token IS NOT NULL AND d.expo_push_token <> ''
      ORDER BY d.updated_at DESC, d.created_at DESC
    `).all(channelId) as DeviceRow[]);
  }

  listPushDevicesForUsersImpl(userIds: string[]): DeviceRecord[] {
    if (!userIds.length) return [];
    const placeholders = userIds.map(() => '?').join(',');
    return uniqueDevicesByPushToken(this.db.prepare(`SELECT * FROM approval_devices WHERE user_id IN (${placeholders}) AND unregistered_at IS NULL AND expo_push_token IS NOT NULL AND expo_push_token <> '' ORDER BY updated_at DESC, created_at DESC`).all(...userIds) as DeviceRow[]);
  }

  getDeviceForUserImpl(deviceId: string, userId: string): DeviceRecord | null {
    const row = this.db.prepare('SELECT * FROM approval_devices WHERE device_id = ? AND user_id = ?').get(deviceId, userId) as DeviceRow | undefined;
    return row ? mapDevice(row) : null;
  }

  updateDeviceNameImpl(deviceId: string, userId: string, name: string, now = new Date().toISOString()): DeviceRecord | null {
    this.db.prepare('UPDATE approval_devices SET name = ?, updated_at = ? WHERE device_id = ? AND user_id = ?').run(name.trim(), now, deviceId, userId);
    return this.getDeviceForUser(deviceId, userId);
  }

  updateDevicePushTokenImpl(deviceId: string, userId: string, expoPushToken: string, now = new Date().toISOString()): DeviceRecord | null {
    this.db.prepare(`UPDATE approval_devices SET expo_push_token = ?, unregistered_at = CASE WHEN ? <> '' THEN NULL ELSE unregistered_at END, updated_at = ? WHERE device_id = ? AND user_id = ?`).run(expoPushToken, expoPushToken, now, deviceId, userId);
    return this.getDeviceForUser(deviceId, userId);
  }

  unregisterDeviceImpl(deviceId: string, userId: string, now = new Date().toISOString()): DeviceRecord | null {
    this.db.prepare('UPDATE approval_devices SET unregistered_at = COALESCE(unregistered_at, ?), expo_push_token = NULL, token_hash = NULL, updated_at = ? WHERE device_id = ? AND user_id = ?').run(now, now, deviceId, userId);
    return this.getDeviceForUser(deviceId, userId);
  }

  createPairingTokenImpl(userId: string, workspaceId: string, now = new Date().toISOString(), ttlSeconds = 10 * 60): PairingTokenRecord {
    const token = `pair_${crypto.randomBytes(20).toString('base64url')}`;
    const expiresAt = addMs(now, ttlSeconds * 1000);
    this.db.prepare('INSERT INTO device_pairing_codes(token_hash, user_id, workspace_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(hashSecret(token), userId, workspaceId, expiresAt, now);
    return { token, expiresAt };
  }

  pairDeviceWithCodeImpl(pairingCode: string, deviceName: string, platform?: string, now = new Date().toISOString()): DeviceCredential | null {
    const row = this.db.prepare('SELECT * FROM device_pairing_codes WHERE token_hash = ? AND expires_at > ? AND used_at IS NULL').get(hashSecret(pairingCode), now) as PairingRow | undefined;
    if (!row) return null;
    const token = `device_${crypto.randomBytes(24).toString('base64url')}`;
    const device = this.registerDevice({ userId: row.user_id, deviceName, ...(platform ? { platform } : {}) }, now);
    this.db.prepare('UPDATE approval_devices SET token_hash = ?, updated_at = ? WHERE device_id = ?').run(hashSecret(token), now, device.deviceId);
    this.db.prepare('UPDATE device_pairing_codes SET used_at = ? WHERE token_hash = ?').run(now, hashSecret(pairingCode));
    return { deviceId: device.deviceId, token };
  }

  verifyDeviceTokenImpl(token: string): DeviceTokenAuth | null {
    const row = this.db.prepare('SELECT * FROM approval_devices WHERE token_hash = ? AND unregistered_at IS NULL').get(hashSecret(token)) as DeviceRow | undefined;
    if (!row) return null;
    return { source: 'device', deviceId: row.device_id, userId: row.user_id, workspaceId: this.defaultMembershipForUser(row.user_id).workspaceId };
  }

  recordHeartbeatImpl(userId: string, workspaceId: string, now = new Date().toISOString()): AvailabilityRecord {
    return this.setAvailabilityImpl(userId, workspaceId, 'available', now, true);
  }

  setAvailabilityImpl(userId: string, workspaceId: string, state: string, now = new Date().toISOString(), heartbeat = false): AvailabilityRecord {
    this.db.prepare(`
      INSERT INTO availability(user_id, workspace_id, state, last_seen_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, workspace_id) DO UPDATE SET state = excluded.state, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
    `).run(userId, workspaceId, state, heartbeat ? now : null, now);
    return this.getAvailability(userId, workspaceId)!;
  }

  getAvailabilityImpl(userId: string, workspaceId: string): AvailabilityRecord | null {
    const row = this.db.prepare('SELECT * FROM availability WHERE user_id = ? AND workspace_id = ?').get(userId, workspaceId) as AvailabilityRow | undefined;
    return row ? mapAvailability(row) : null;
  }

  createEventTicketImpl(input: EventTicketInput, now = new Date().toISOString()): EventTicketRecord {
    const ticket = `evt_${crypto.randomBytes(20).toString('base64url')}`;
    const expiresAt = addMs(now, (input.ttlSeconds ?? 30) * 1000);
    this.db.prepare('INSERT INTO event_tickets(token_hash, source, workspace_id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(hashSecret(ticket), input.source, input.workspaceId, input.userId, expiresAt, now);
    return { ticket, expiresAt };
  }

  verifyEventTicketImpl(ticket: string, now = new Date().toISOString()): EventTicketAuth | null {
    const row = this.db.prepare('SELECT * FROM event_tickets WHERE token_hash = ? AND expires_at > ? AND used_at IS NULL').get(hashSecret(ticket), now) as EventTicketRow | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE event_tickets SET used_at = ? WHERE token_hash = ?').run(now, hashSecret(ticket));
    return { source: row.source, workspaceId: row.workspace_id, userId: row.user_id };
  }

  recordMobileDiagnosticsImpl(events: MobileDiagnosticInput[]): number {
    if (!events.length) return 0;
    const insert = this.db.prepare('INSERT INTO mobile_diagnostics(diagnostic_id, workspace_id, user_id, device_id, level, area, message, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const tx = this.db.transaction((items: MobileDiagnosticInput[]) => {
      for (const event of items) insert.run(id('diag'), event.workspaceId, event.userId, event.deviceId ?? null, event.level, event.area, event.message, event.metadata ? JSON.stringify(event.metadata) : '{}', event.createdAt);
    });
    tx(events);
    return events.length;
  }

  listMobileDiagnosticsImpl(workspaceId: string, limit = 100): MobileDiagnosticRecord[] {
    return (this.db.prepare('SELECT * FROM mobile_diagnostics WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, clampLimit(limit, 1000)) as MobileDiagnosticRow[]).map(mapMobileDiagnostic);
  }

  listAuditEventsImpl(workspaceId: string, limit = 100): AuditEventRecord[] {
    return (this.db.prepare('SELECT * FROM audit_events WHERE workspace_id = ? ORDER BY event_id DESC LIMIT ?').all(workspaceId, clampLimit(limit, 1000)) as AuditRow[]).map(mapAuditEvent);
  }

  listAuditEventsAfterImpl(workspaceId: string, afterEventId = 0, limit = 100): AuditEventRecord[] {
    return (this.db.prepare('SELECT * FROM audit_events WHERE workspace_id = ? AND event_id > ? ORDER BY event_id ASC LIMIT ?').all(workspaceId, afterEventId, clampLimit(limit, 1000)) as AuditRow[]).map(mapAuditEvent);
  }

  writeAuditEventImpl(workspaceId: string, userId: string, eventType: string, targetId: string, payload: unknown, now = new Date().toISOString()): void {
    this.db.prepare('INSERT INTO audit_events(workspace_id, user_id, event_type, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(workspaceId, userId, eventType, targetId, JSON.stringify(payload ?? {}), now);
  }

  getOrStartPersonalEntitlementImpl(userId: string, now = new Date().toISOString()): PersonalEntitlementRecord {
    this.ensurePersonalEntitlementRow(userId, now);
    return this.personalEntitlementOrThrow(userId);
  }

  updatePersonalEntitlementImpl(input: UpdatePersonalEntitlementInput, now = new Date().toISOString()): PersonalEntitlementRecord {
    this.ensurePersonalEntitlementRow(input.userId, now);
    const existing = this.personalEntitlementOrThrow(input.userId);
    this.db.prepare(`
      UPDATE personal_entitlements
      SET app_unlocked_at = ?, hosted_subscription_ends_at = ?, hosted_subscription_canceled_at = ?, hosted_data_deleted_at = ?, updated_at = ?
      WHERE user_id = ?
    `).run(
      coalesceNullableInput(input.appUnlockedAt, existing.appUnlockedAt),
      coalesceNullableInput(input.hostedSubscriptionEndsAt, existing.hostedSubscriptionEndsAt),
      coalesceNullableInput(input.hostedSubscriptionCanceledAt, existing.hostedSubscriptionCanceledAt),
      coalesceNullableInput(input.hostedDataDeletedAt, existing.hostedDataDeletedAt),
      now,
      input.userId
    );
    return this.personalEntitlementOrThrow(input.userId);
  }

  upsertBillingProductsImpl(products: UpsertBillingProductInput[], now = new Date().toISOString()): void {
    const stmt = this.db.prepare(`
      INSERT INTO billing_products(id, product_key, kind, entitlement_key, apple_product_id, google_product_id, google_base_plan_id, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product_key) DO UPDATE SET kind = excluded.kind, entitlement_key = excluded.entitlement_key, apple_product_id = excluded.apple_product_id, google_product_id = excluded.google_product_id, google_base_plan_id = excluded.google_base_plan_id, active = excluded.active, updated_at = excluded.updated_at
    `);
    for (const product of products) stmt.run(id('prod'), product.productKey, product.kind, product.entitlementKey, product.appleProductId ?? null, product.googleProductId ?? null, product.googleBasePlanId ?? null, product.active === false ? 0 : 1, now, now);
  }

  listBillingProductsImpl(activeOnly = false): BillingProductRecord[] {
    const rows = activeOnly ? this.db.prepare('SELECT * FROM billing_products WHERE active = 1 ORDER BY product_key').all() : this.db.prepare('SELECT * FROM billing_products ORDER BY product_key').all();
    return (rows as BillingProductRow[]).map(mapBillingProduct);
  }

  createBillingPurchaseAttemptImpl(input: CreateBillingPurchaseAttemptInput, now = new Date().toISOString()): BillingPurchaseAttemptRecord {
    const attemptId = id('attempt');
    this.db.prepare('INSERT INTO billing_purchase_attempts(id, user_id, product_key, product_group, platform, provider, status, provider_user_id, idempotency_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(attemptId, input.userId, input.productKey, input.productGroup, input.platform, input.provider, 'pending', input.providerUserId ?? null, input.idempotencyKey, input.expiresAt, now, now);
    return this.billingAttemptOrThrow(attemptId);
  }

  updateBillingPurchaseAttemptStatusImpl(attemptId: string, status: string, now = new Date().toISOString()): BillingPurchaseAttemptRecord | null {
    this.db.prepare('UPDATE billing_purchase_attempts SET status = ?, updated_at = ? WHERE id = ?').run(status, now, attemptId);
    const row = this.db.prepare('SELECT * FROM billing_purchase_attempts WHERE id = ?').get(attemptId) as BillingAttemptRow | undefined;
    return row ? mapBillingAttempt(row) : null;
  }

  listActiveBillingPurchaseAttemptsImpl(userId: string, productGroup: string, now = new Date().toISOString()): BillingPurchaseAttemptRecord[] {
    return (this.db.prepare(`SELECT * FROM billing_purchase_attempts WHERE user_id = ? AND product_group = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC`).all(userId, productGroup, now) as BillingAttemptRow[]).map(mapBillingAttempt);
  }

  upsertBillingTransactionImpl(input: UpsertBillingTransactionInput, now = new Date().toISOString()): UpsertBillingTransactionResult {
    const existing = this.findBillingTransaction(input);
    const transactionId = existing?.id ?? id('txn');
    this.db.prepare(`
      INSERT INTO billing_transactions(id, user_id, provider, environment, product_key, entitlement_key, platform, provider_transaction_id, provider_original_transaction_id, provider_purchase_token, status, purchased_at, expires_at, canceled_at, revoked_at, raw_event_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, expires_at = excluded.expires_at, canceled_at = excluded.canceled_at, revoked_at = excluded.revoked_at, raw_event_json = excluded.raw_event_json, updated_at = excluded.updated_at
    `).run(transactionId, input.userId, input.provider, input.environment, input.productKey, input.entitlementKey, input.platform, input.providerTransactionId ?? null, input.providerOriginalTransactionId ?? null, input.providerPurchaseToken ?? null, input.status, input.purchasedAt ?? null, input.expiresAt ?? null, input.canceledAt ?? null, input.revokedAt ?? null, input.rawEventJSON ?? null, existing?.created_at ?? now, now);
    return { record: mapBillingTransaction(this.billingTransactionOrThrow(transactionId)), created: !existing };
  }

  listBillingTransactionsForUserImpl(userId: string): BillingTransactionRecord[] {
    return (this.db.prepare('SELECT * FROM billing_transactions WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as BillingTransactionRow[]).map(mapBillingTransaction);
  }

  transferAccountBoundBillingPurchasesImpl(input: TransferAccountBoundBillingPurchasesInput, now = new Date().toISOString()): TransferAccountBoundBillingPurchasesResult {
    const fromUserIds = [...new Set(input.fromUserIds.map((userId) => userId.trim()).filter((userId) => userId && userId !== input.toUserId))];
    if (fromUserIds.length === 0 || !input.toUserId.trim()) return { transactions: [], receiptOwnersTransferred: 0 };
    const sourcePlaceholders = fromUserIds.map(() => '?').join(', ');
    const filters: string[] = [
      `provider = ?`,
      `user_id IN (${sourcePlaceholders})`,
      `entitlement_key IN ('hosted_personal', 'native_app_trial')`,
    ];
    const values: unknown[] = [input.provider, ...fromUserIds];
    if (input.environment) {
      filters.push('environment = ?');
      values.push(input.environment);
    }
    if (input.platform) {
      filters.push('platform = ?');
      values.push(input.platform);
    }
    const rows = this.db.prepare(`
      SELECT * FROM billing_transactions
      WHERE ${filters.join(' AND ')}
      ORDER BY updated_at DESC, created_at DESC
    `).all(...values) as BillingTransactionRow[];
    if (rows.length === 0) return { transactions: [], receiptOwnersTransferred: 0 };

    const transactionIds = rows.map((row) => row.id);
    const transactionPlaceholders = transactionIds.map(() => '?').join(', ');
    const receiptTransfers = new Map<string, BillingTransactionRow>();
    for (const row of rows) {
      const receiptKey = billingTransactionReceiptKey(row);
      if (!receiptKey) continue;
      const key = [row.provider, row.environment, row.platform, row.entitlement_key, receiptKey].join('\u0000');
      const existing = receiptTransfers.get(key);
      if (!existing || new Date(row.updated_at).getTime() > new Date(existing.updated_at).getTime()) receiptTransfers.set(key, row);
    }

    const rawEventJSON = input.rawEventJSON ?? null;
    const update = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE billing_transactions
        SET user_id = ?, raw_event_json = COALESCE(?, raw_event_json), updated_at = ?
        WHERE id IN (${transactionPlaceholders})
      `).run(input.toUserId, rawEventJSON, now, ...transactionIds);

      for (const row of receiptTransfers.values()) {
        const receiptKey = billingTransactionReceiptKey(row);
        if (!receiptKey) continue;
        const existing = this.db.prepare(`
          SELECT * FROM billing_receipt_owners
          WHERE provider = ? AND environment = ? AND platform = ? AND entitlement_key = ? AND receipt_key = ?
        `).get(row.provider, row.environment, row.platform, row.entitlement_key, receiptKey) as BillingReceiptOwnerRow | undefined;
        if (existing) {
          this.db.prepare(`
            UPDATE billing_receipt_owners
            SET product_key = ?, owner_user_id = ?, last_seen_at = ?
            WHERE provider = ? AND environment = ? AND platform = ? AND entitlement_key = ? AND receipt_key = ?
          `).run(row.product_key, input.toUserId, now, row.provider, row.environment, row.platform, row.entitlement_key, receiptKey);
        } else {
          this.db.prepare(`
            INSERT INTO billing_receipt_owners(provider, environment, platform, entitlement_key, receipt_key, product_key, owner_user_id, first_seen_at, last_seen_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(row.provider, row.environment, row.platform, row.entitlement_key, receiptKey, row.product_key, input.toUserId, now, now);
        }
      }
    });
    update();

    const transferredRows = this.db.prepare(`SELECT * FROM billing_transactions WHERE id IN (${transactionPlaceholders}) ORDER BY updated_at DESC`).all(...transactionIds) as BillingTransactionRow[];
    return {
      transactions: transferredRows.map(mapBillingTransaction),
      receiptOwnersTransferred: receiptTransfers.size,
    };
  }

  claimBillingReceiptOwnerImpl(input: ClaimBillingReceiptOwnerInput, now = new Date().toISOString()): ClaimBillingReceiptOwnerResult {
    const existing = this.db.prepare(`
      SELECT * FROM billing_receipt_owners
      WHERE provider = ? AND environment = ? AND platform = ? AND entitlement_key = ? AND receipt_key = ?
    `).get(input.provider, input.environment, input.platform, input.entitlementKey, input.receiptKey) as BillingReceiptOwnerRow | undefined;
    if (existing) {
      this.db.prepare(`
        UPDATE billing_receipt_owners
        SET product_key = ?, last_seen_at = ?
        WHERE provider = ? AND environment = ? AND platform = ? AND entitlement_key = ? AND receipt_key = ?
      `).run(input.productKey, now, input.provider, input.environment, input.platform, input.entitlementKey, input.receiptKey);
      const owner = this.billingReceiptOwnerOrThrow(input.provider, input.environment, input.platform, input.entitlementKey, input.receiptKey);
      return { owner, created: false, ownedByCurrentUser: owner.ownerUserId === input.ownerUserId };
    }
    this.db.prepare(`
      INSERT INTO billing_receipt_owners(provider, environment, platform, entitlement_key, receipt_key, product_key, owner_user_id, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.provider, input.environment, input.platform, input.entitlementKey, input.receiptKey, input.productKey, input.ownerUserId, now, now);
    return { owner: this.billingReceiptOwnerOrThrow(input.provider, input.environment, input.platform, input.entitlementKey, input.receiptKey), created: true, ownedByCurrentUser: true };
  }

  upsertBillingIdentityConflictImpl(input: UpsertBillingIdentityConflictInput, now = new Date().toISOString()): BillingIdentityConflictRecord {
    const existing = this.db.prepare(`
      SELECT * FROM billing_identity_conflicts
      WHERE user_id = ? AND provider = ? AND environment = ? AND platform = ? AND entitlement_key = ? AND receipt_key = ? AND code = ?
    `).get(input.userId, input.provider, input.environment, input.platform, input.entitlementKey, input.receiptKey, input.code) as BillingIdentityConflictRow | undefined;
    const conflictId = existing?.id ?? id('bic');
    this.db.prepare(`
      INSERT INTO billing_identity_conflicts(id, user_id, provider, environment, platform, product_key, entitlement_key, receipt_key, code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET product_key = excluded.product_key, updated_at = excluded.updated_at
    `).run(conflictId, input.userId, input.provider, input.environment, input.platform, input.productKey, input.entitlementKey, input.receiptKey, input.code, existing?.created_at ?? now, now);
    return mapBillingIdentityConflict(this.billingIdentityConflictOrThrow(conflictId));
  }

  listBillingIdentityConflictsForUserImpl(userId: string): BillingIdentityConflictRecord[] {
    return (this.db.prepare('SELECT * FROM billing_identity_conflicts WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as BillingIdentityConflictRow[]).map(mapBillingIdentityConflict);
  }

  deleteHostedPersonalDataImpl(userId: string, workspaceId: string, now = new Date().toISOString()): void {
    const workspace = this.workspaceRow(workspaceId);
    if (!workspace || workspace.type !== 'personal') throw new Error('Personal Workspace is required for hosted data deletion');
    const tokenRows = this.db.prepare('SELECT agent_token_id FROM agent_tokens WHERE workspace_id = ?').all(workspaceId) as { agent_token_id: string }[];
    for (const row of tokenRows) this.revokeAgentToken(row.agent_token_id, workspaceId, now);
    this.db.prepare('UPDATE approval_devices SET expo_push_token = NULL, unregistered_at = COALESCE(unregistered_at, ?), updated_at = ? WHERE user_id = ?').run(now, now, userId);
    this.db.prepare('DELETE FROM mobile_diagnostics WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM availability WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM status_update_recipients WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM request_recipients WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM routing_rule_recipients WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM responses WHERE user_id = ?').run(userId);
    this.updatePersonalEntitlement({ userId, hostedDataDeletedAt: now }, now);
  }

  deleteHostedAccountDataImpl(userId: string, personalWorkspaceId: string, now = new Date().toISOString()): void {
    const tx = this.db.transaction(() => {
      const workspace = this.workspaceRow(personalWorkspaceId);
      if (workspace && workspace.type !== 'personal') throw new Error('Personal Workspace is required for hosted account deletion');
      const ownerMembership = this.db.prepare(`
        SELECT 1 FROM workspace_members
        WHERE workspace_id = ? AND user_id = ? AND role = 'owner'
      `).get(personalWorkspaceId, userId);
      if (workspace && !ownerMembership) throw new Error('Personal Workspace owner membership is required for hosted account deletion');

      this.db.prepare('UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE creator_user_id = ?').run(now, userId);
      this.db.prepare('UPDATE approval_devices SET expo_push_token = NULL, token_hash = NULL, unregistered_at = COALESCE(unregistered_at, ?), updated_at = ? WHERE user_id = ?').run(now, now, userId);
      this.db.prepare('DELETE FROM mobile_diagnostics WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM availability WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM status_update_recipients WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM request_recipients WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM responses WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM routing_rule_recipients WHERE user_id = ?').run(userId);
      this.db.prepare(`
        DELETE FROM routing_rules
        WHERE workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = ? AND workspace_id <> ?)
          AND NOT EXISTS (SELECT 1 FROM routing_rule_recipients WHERE routing_rule_recipients.routing_rule_id = routing_rules.routing_rule_id)
      `).run(userId, personalWorkspaceId);
      this.db.prepare('DELETE FROM workspace_members WHERE user_id = ? AND workspace_id <> ?').run(userId, personalWorkspaceId);
      this.db.prepare('DELETE FROM auth_identities WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM billing_receipt_owners WHERE owner_user_id = ?').run(userId);
      this.db.prepare(`
        INSERT OR IGNORE INTO personal_entitlements(user_id, trial_started_at, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(userId, now, now, now);
      this.db.prepare('UPDATE personal_entitlements SET hosted_data_deleted_at = ?, updated_at = ? WHERE user_id = ?').run(now, now, userId);
      if (workspace) this.db.prepare("DELETE FROM workspaces WHERE workspace_id = ? AND type = 'personal'").run(personalWorkspaceId);
      this.db.prepare(`
        UPDATE users
        SET email = '', email_verified = 0, name = '', sign_in_method = NULL, revoked_at = COALESCE(revoked_at, ?), updated_at = ?
        WHERE id = ?
      `).run(now, now, userId);
    });
    tx();
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

  private assertActiveWorkspaceMember(userId: string, workspaceId: string): void {
    if (!this.workspaceMembershipForUser(userId, workspaceId)) throw new Error(`Bound recipient is not an active Workspace Member: ${userId}`);
  }

  private assertRoutingRuleTargetsBoundRecipient(routingRuleId: string, boundRecipientUserId: string): void {
    const rule = this.getRoutingRule(routingRuleId);
    if (!rule || rule.recipientUserIds.length !== 1 || rule.recipientUserIds[0] !== boundRecipientUserId || rule.requiredResponseCount !== 1) {
      throw new Error('Bound Agent Token Routing Rule must target exactly the bound recipient');
    }
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

  private externalApproverOrThrow(externalApproverId: string): ExternalApproverRecord {
    const row = this.db.prepare(EXTERNAL_APPROVER_SELECT + ' WHERE external_approver_id = ?').get(externalApproverId) as ExternalApproverRow | undefined;
    if (!row) throw new Error('External Approver not found');
    return mapExternalApprover(row);
  }

  private externalApproverInviteOrThrow(inviteId: string): ExternalApproverInviteRecord {
    const row = this.db.prepare(EXTERNAL_APPROVER_INVITE_SELECT + ` WHERE eai.invite_id = ?`).get(inviteId) as ExternalApproverInviteRow | undefined;
    if (!row) throw new Error('External Approver invite not found');
    return mapExternalApproverInvite(row);
  }

  private routeForAudienceRequest(workspaceId: string, audienceChannelId: string | undefined): { routingRuleId?: string; recipientUserIds: string[]; requiredResponseCount: number } {
    if (!audienceChannelId) throw new Error('Audience Channel is required');
    const channel = this.getAudienceChannel(audienceChannelId);
    if (!channel || channel.workspaceId !== workspaceId || channel.status !== 'active') throw new Error('Audience Channel not found in Workspace');
    return { recipientUserIds: [], requiredResponseCount: 1 };
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
    const agentToken = agentTokenId ? this.agentTokenRowById(agentTokenId) : undefined;
    const selectedRuleId = routingRuleId ?? agentToken?.routing_rule_id ?? undefined;
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
    if (agentToken?.bound_recipient_user_id) this.assertRoutingRuleTargetsBoundRecipient(rule.routingRuleId, agentToken.bound_recipient_user_id);
    return { routingRuleId: rule.routingRuleId, recipientUserIds: rule.recipientUserIds, requiredResponseCount: rule.requiredResponseCount };
  }

  private insertRequestRecipients(requestId: string, recipientUserIds: string[], now: string): void {
    const insert = this.db.prepare('INSERT INTO request_recipients(request_id, user_id, has_active_device, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    for (const userId of recipientUserIds) insert.run(requestId, userId, this.hasActiveDevice(userId) ? 1 : 0, now, now);
  }

  private hasActiveDevice(userId: string): boolean {
    return (this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM approval_devices
      WHERE user_id = ? AND unregistered_at IS NULL AND expo_push_token IS NOT NULL AND expo_push_token <> ''
    `).get(userId) as CountRow).count > 0;
  }

  private finalizeDueAudienceRequests(now: string): void {
    const rows = this.db.prepare(`SELECT * FROM requests WHERE status = 'pending' AND delivery_kind = 'audience_channel' AND closes_at IS NOT NULL AND closes_at <= ?`).all(now) as RequestRow[];
    for (const row of rows) {
      const counts = (this.db.prepare(`SELECT choice_id, COUNT(*) AS count FROM responses WHERE request_id = ? AND choice_id IS NOT NULL GROUP BY choice_id`).all(row.id) as Array<{ choice_id: string; count: number }>);
      const aggregate = Object.fromEntries(counts.map((count) => [count.choice_id, count.count]));
      const max = Math.max(0, ...counts.map((count) => count.count));
      const winners = counts.filter((count) => count.count === max && max > 0).map((count) => count.choice_id);
      const winner = winners.length === 1 ? winners[0] : row.default_choice ?? undefined;
      if (winner) {
        this.db.prepare('UPDATE requests SET status = ?, responded_at = ?, response_json = ?, final_choice_id = ?, aggregate_result_json = ? WHERE id = ?').run('responded', now, JSON.stringify({ choiceId: winner }), winner, JSON.stringify({ choices: aggregate }), row.id);
        this.writeAuditEvent(row.workspace_id, 'system', 'request.audience_responded', row.id, { choiceId: winner, aggregate }, now);
      } else {
        this.db.prepare('UPDATE requests SET status = ?, responded_at = ?, response_json = ?, aggregate_result_json = ? WHERE id = ?').run('expired', now, JSON.stringify({ message: 'expired' }), JSON.stringify({ choices: aggregate }), row.id);
        this.writeAuditEvent(row.workspace_id, 'system', 'request.audience_expired', row.id, { aggregate }, now);
      }
    }
  }

  private expirePendingRequests(now: string): void {
    this.finalizeDueAudienceRequests(now);
    const rows = this.db.prepare(`SELECT id, workspace_id FROM requests WHERE status = 'pending' AND deadline IS NOT NULL AND deadline <= ?`).all(now) as { id: string; workspace_id: string }[];
    for (const row of rows) {
      this.db.prepare('UPDATE requests SET status = ?, responded_at = ?, response_json = ? WHERE id = ?').run('expired', now, JSON.stringify({ message: 'expired' }), row.id);
      this.writeAuditEvent(row.workspace_id, 'system', 'request.expired', row.id, {}, now);
    }
  }

  private requestWaiterById(waiterId: string): RequestWaiterRecord | null {
    const row = this.db.prepare('SELECT * FROM request_waiters WHERE waiter_id = ?').get(waiterId) as RequestWaiterRow | undefined;
    return row ? mapRequestWaiter(row) : null;
  }

  private latestRequestWaiterRow(requestId: string): RequestWaiterRow | undefined {
    return this.db.prepare(`
      SELECT * FROM request_waiters
      WHERE request_id = ?
      ORDER BY CASE state WHEN 'waiting' THEN 0 WHEN 'errored' THEN 1 WHEN 'stopped' THEN 2 ELSE 3 END ASC, updated_at DESC, created_at DESC
      LIMIT 1
    `).get(requestId) as RequestWaiterRow | undefined;
  }

  private agentWaiterSummaryForRequest(requestId: string, now = new Date().toISOString()): RequestAgentWaiterSummary | undefined {
    const row = this.latestRequestWaiterRow(requestId);
    if (!row) return undefined;
    const state = derivedRequestWaiterState(row, now);
    return {
      waiterId: row.waiter_id,
      state,
      lastSeenAt: row.last_seen_at,
      leaseExpiresAt: row.lease_expires_at,
      credentialExpiresAt: row.credential_expires_at,
      ...(row.stopped_at ? { stoppedAt: row.stopped_at } : {}),
      ...(row.stop_reason ? { stopReason: row.stop_reason } : {}),
      ...(row.error_code ? { errorCode: row.error_code } : {}),
      ...(row.error_message ? { errorMessage: row.error_message } : {})
    };
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
      workspaceType: row.workspace_type as WorkspaceType,
      workspaceResponsesEntitled: workspaceResponsesEntitledFromRow(row, _now),
      ...(row.agent_token_id ? { agentTokenId: row.agent_token_id } : {}),
      ...(row.routing_rule_id ? { routingRuleId: row.routing_rule_id } : {}),
      ...(row.session_id ? { sessionId: row.session_id } : {}),
      ...(sessionMetadataFromJSON(row.session_metadata_json) ? { session: sessionMetadataFromJSON(row.session_metadata_json) } : {}),
      requester: parseJSON(row.requester_json, { name: 'Agent' }),
      requestType: row.request_type,
      deliveryKind: row.delivery_kind,
      responsePolicy: row.response_policy,
      ...(row.audience_channel_id ? { audienceChannelId: row.audience_channel_id } : {}),
      ...(row.closes_at ? { closesAt: row.closes_at } : {}),
      ...(row.tie_policy ? { tiePolicy: row.tie_policy } : {}),
      ...(row.aggregate_result_json ? { aggregateResult: parseJSON<Record<string, unknown>>(row.aggregate_result_json, {}) } : {}),
      title: row.title,
      ...(row.body ? { body: row.body } : {}),
      ...(row.command ? { command: row.command } : {}),
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
      ...(this.agentWaiterSummaryForRequest(row.id, _now) ? { agentWaiter: this.agentWaiterSummaryForRequest(row.id, _now) } : {}),
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
      ...(row.session_id ?? row.thread_id ? { sessionId: row.session_id ?? row.thread_id ?? undefined } : {}),
      ...(sessionMetadataFromJSON(row.session_metadata_json) ? { session: sessionMetadataFromJSON(row.session_metadata_json) } : {}),
      message: row.message,
      state: row.state,
      ...(semanticStatusUpdateState(row.state) ? { semanticState: semanticStatusUpdateState(row.state) } : {}),
      stateBehavior: statusUpdateStateBehavior(row.state),
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

  private billingReceiptOwnerOrThrow(provider: string, environment: string, platform: string, entitlementKey: string, receiptKey: string): BillingReceiptOwnerRecord {
    const row = this.db.prepare(`
      SELECT * FROM billing_receipt_owners
      WHERE provider = ? AND environment = ? AND platform = ? AND entitlement_key = ? AND receipt_key = ?
    `).get(provider, environment, platform, entitlementKey, receiptKey) as BillingReceiptOwnerRow | undefined;
    if (!row) throw new Error('Billing receipt owner not found');
    return mapBillingReceiptOwner(row);
  }

  private billingIdentityConflictOrThrow(conflictId: string): BillingIdentityConflictRow {
    const row = this.db.prepare('SELECT * FROM billing_identity_conflicts WHERE id = ?').get(conflictId) as BillingIdentityConflictRow | undefined;
    if (!row) throw new Error('Billing identity conflict not found');
    return row;
  }
}

function assertValidWorkspaceMemberKind(role: WorkspaceRole | string, memberKind: WorkspaceMemberKind): void {
  if (memberKind === 'external_approver' && role !== 'member') throw new Error('External approvers must use the member role');
}

function assertValidRoutingRuleRecipients(memberships: HumanIdentityResult[], requiredResponseMode: RequiredResponseMode, requiredResponseCount: number): void {
  const externalApprovers = memberships.filter((membership) => membership.memberKind === 'external_approver');
  if (!externalApprovers.length) return;
  if (memberships.length !== 1) throw new Error('Routing Rules with External Approvers must have exactly one recipient');
  if (requiredResponseMode !== 'any_one' || requiredResponseCount !== 1) throw new Error('Routing Rules with External Approvers must require exactly one response');
}

interface CountRow { count: number }
interface UserRow { id: string; email: string | null; email_verified: number; name: string | null; sign_in_method: string | null }
interface WorkspaceRow { workspace_id: string; type: string; name: string; clerk_organization_id: string | null; responses_entitled_until: string | null; created_at: string; updated_at: string }
interface WorkspaceMemberRow extends WorkspaceRow { user_id: string; role: string; status: string; member_kind: string; email: string | null; display_name: string | null; clerk_membership_id: string | null }
interface AudienceChannelRow { channel_id: string; workspace_id: string; name: string; slug: string | null; visibility: string; status: string; created_by_user_id: string; created_at: string; updated_at: string }
interface AudienceSubscriptionRow { channel_id: string; user_id: string; status: string; created_at: string; updated_at: string }
interface RoutingRuleRow { routing_rule_id: string; workspace_id: string; name: string; required_response_mode: string; required_response_count: number; created_at: string; updated_at: string }
interface AgentTokenRow { agent_token_id: string; workspace_id: string; workspace_type: string; creator_user_id: string | null; routing_rule_id: string | null; bound_recipient_user_id: string | null; label: string; scopes_json: string; last_activity_at: string | null; last_check_in_at: string | null; created_at: string; revoked_at: string | null }
interface RequestRow { id: string; workspace_id: string; workspace_type: string; workspace_responses_entitled_until: string | null; agent_token_id: string | null; routing_rule_id: string | null; session_id: string | null; session_metadata_json: string; requester_json: string; request_type: string; delivery_kind: string; response_policy: string; audience_channel_id: string | null; closes_at: string | null; tie_policy: string | null; aggregate_result_json: string | null; title: string; body: string | null; command: string | null; choices_json: string; questions_json: string; default_choice: string | null; allow_freeform_reply: number; deadline: string | null; risk: string | null; metadata_json: string; status: string; required_response_count: number; created_at: string; responded_at: string | null; response_json: string | null; final_choice_id: string | null; is_test: number; test_label: string | null }
interface RequestRecipientRow { request_id: string; user_id: string; has_active_device: number; responded_at: string | null; created_at: string; updated_at: string }
interface ResponseRow { response_id: string; request_id: string; user_id: string; source: string; choice_id: string | null; message: string | null; answers_json: string | null; final: number; created_at: string }
interface StatusUpdateRow { status_id: string; workspace_id: string; agent_token_id: string | null; agent_token_label: string | null; routing_rule_id: string | null; thread_id: string | null; session_id: string | null; session_metadata_json: string; message: string; state: string; next_step: string | null; host: string | null; working_directory: string | null; client_name: string | null; metadata_json: string; created_at: string; is_test: number; test_label: string | null }
interface DeviceRow { device_id: string; user_id: string; name: string; platform: string | null; installation_id: string | null; expo_push_token: string | null; created_at: string; updated_at: string; unregistered_at: string | null }
interface PairingRow { user_id: string; workspace_id: string }
interface EventTicketRow { source: string; workspace_id: string; user_id: string }
interface ExternalApproverRow { external_approver_id: string; workspace_id: string; external_subject: string | null; display_name: string | null; user_id: string | null; routing_rule_id: string | null; agent_token_id: string | null; created_by_user_id: string; created_at: string; updated_at: string }
interface ExternalApproverInviteRow { invite_id: string; workspace_id: string; workspace_name: string | null; external_approver_id: string | null; external_subject: string | null; display_name: string | null; created_by_user_id: string; accepted_by_user_id: string | null; expires_at: string; accepted_at: string | null; revoked_at: string | null; created_at: string; updated_at: string }
interface RequestWaiterRow { waiter_id: string; request_id: string; workspace_id: string; agent_token_id: string; client_run_id: string | null; transport: string; state: string; last_seen_at: string; lease_expires_at: string; credential_expires_at: string; stopped_at: string | null; stop_reason: string | null; error_code: string | null; error_message: string | null; created_at: string; updated_at: string }
interface WaiterTokenRow { token_hash: string; waiter_id: string; request_id: string; workspace_id: string; agent_token_id: string; expires_at: string; created_at: string; last_used_at: string | null }
interface AvailabilityRow { user_id: string; workspace_id: string; state: string; last_seen_at: string | null; updated_at: string }
interface MobileDiagnosticRow { diagnostic_id: string; workspace_id: string; user_id: string; device_id: string | null; level: string; area: string; message: string; metadata_json: string; created_at: string }
interface AuditRow { event_id: number; workspace_id: string; user_id: string; event_type: string; target_id: string; payload_json: string; created_at: string }
interface PersonalEntitlementRow { user_id: string; trial_started_at: string; app_unlocked_at: string | null; hosted_subscription_ends_at: string | null; hosted_subscription_canceled_at: string | null; hosted_data_deleted_at: string | null; created_at: string; updated_at: string }
interface BillingProductRow { id: string; product_key: string; kind: string; entitlement_key: string; apple_product_id: string | null; google_product_id: string | null; google_base_plan_id: string | null; active: number; created_at: string; updated_at: string }
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

const AGENT_TOKEN_SELECT = `
  SELECT at.agent_token_id, at.workspace_id, w.type AS workspace_type, at.creator_user_id, at.routing_rule_id, at.bound_recipient_user_id, at.label, at.scopes_json, at.last_activity_at, at.last_check_in_at, at.created_at, at.revoked_at
  FROM agent_tokens at
  JOIN workspaces w ON w.workspace_id = at.workspace_id
`;

const EXTERNAL_APPROVER_SELECT = `SELECT * FROM external_approvers`;

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

function workspaceResponsesEntitledFromRow(row: Pick<RequestRow, 'workspace_type' | 'workspace_responses_entitled_until'>, now = new Date().toISOString()): boolean {
  return row.workspace_type === 'shared' && Boolean(row.workspace_responses_entitled_until && new Date(row.workspace_responses_entitled_until).getTime() > new Date(now).getTime());
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

function mapAudienceChannel(row: AudienceChannelRow): AudienceChannelRecord {
  return {
    channelId: row.channel_id,
    workspaceId: row.workspace_id,
    name: row.name,
    ...(row.slug ? { slug: row.slug } : {}),
    visibility: row.visibility as AudienceChannelRecord['visibility'],
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAudienceSubscription(row: AudienceSubscriptionRow): AudienceSubscriptionRecord {
  return {
    channelId: row.channel_id,
    userId: row.user_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapExternalApprover(row: ExternalApproverRow): ExternalApproverRecord {
  return {
    externalApproverId: row.external_approver_id,
    workspaceId: row.workspace_id,
    ...(row.external_subject ? { externalSubject: row.external_subject } : {}),
    ...(row.display_name ? { displayName: row.display_name } : {}),
    ...(row.user_id ? { userId: row.user_id } : {}),
    ...(row.routing_rule_id ? { routingRuleId: row.routing_rule_id } : {}),
    ...(row.agent_token_id ? { agentTokenId: row.agent_token_id } : {}),
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapExternalApproverInvite(row: ExternalApproverInviteRow): ExternalApproverInviteRecord {
  return {
    inviteId: row.invite_id,
    workspaceId: row.workspace_id,
    ...(row.workspace_name ? { workspaceName: row.workspace_name } : {}),
    ...(row.external_approver_id ? { externalApproverId: row.external_approver_id } : {}),
    ...(row.external_subject ? { externalSubject: row.external_subject } : {}),
    ...(row.display_name ? { displayName: row.display_name } : {}),
    ...(row.accepted_by_user_id ? { acceptedByUserId: row.accepted_by_user_id } : {}),
    expiresAt: row.expires_at,
    ...(row.accepted_at ? { acceptedAt: row.accepted_at } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
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
    ...(row.bound_recipient_user_id ? { boundRecipientUserId: row.bound_recipient_user_id } : {}),
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

function mapRequestWaiter(row: RequestWaiterRow): RequestWaiterRecord {
  return {
    waiterId: row.waiter_id,
    requestId: row.request_id,
    workspaceId: row.workspace_id,
    agentTokenId: row.agent_token_id,
    ...(row.client_run_id ? { clientRunId: row.client_run_id } : {}),
    transport: row.transport,
    state: row.state,
    lastSeenAt: row.last_seen_at,
    leaseExpiresAt: row.lease_expires_at,
    credentialExpiresAt: row.credential_expires_at,
    ...(row.stopped_at ? { stoppedAt: row.stopped_at } : {}),
    ...(row.stop_reason ? { stopReason: row.stop_reason } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function derivedRequestWaiterState(row: RequestWaiterRow, now: string): RequestAgentWaiterSummary['state'] {
  if (row.state === 'stopped') return 'stopped';
  if (row.state === 'errored') return 'errored';
  const nowMs = Date.parse(now);
  if (Number.isFinite(nowMs) && Date.parse(row.credential_expires_at) <= nowMs) return 'expired';
  if (Number.isFinite(nowMs) && Date.parse(row.lease_expires_at) <= nowMs) return 'stale';
  return 'waiting';
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

function billingTransactionReceiptKey(row: BillingTransactionRow): string | null {
  return row.provider_original_transaction_id ?? row.provider_purchase_token ?? row.provider_transaction_id ?? null;
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

function mapBillingReceiptOwner(row: BillingReceiptOwnerRow): BillingReceiptOwnerRecord {
  return {
    provider: row.provider,
    environment: row.environment,
    platform: row.platform,
    entitlementKey: row.entitlement_key,
    receiptKey: row.receipt_key,
    productKey: row.product_key,
    ownerUserId: row.owner_user_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

function mapBillingIdentityConflict(row: BillingIdentityConflictRow): BillingIdentityConflictRecord {
  return {
    conflictId: row.id,
    userId: row.user_id,
    provider: row.provider,
    environment: row.environment,
    platform: row.platform,
    productKey: row.product_key,
    entitlementKey: row.entitlement_key,
    receiptKey: row.receipt_key,
    code: row.code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

function sessionMetadataFromJSON(value: string | null | undefined): SessionMetadata | undefined {
  const parsed = SessionMetadataSchema.safeParse(parseJSON(value, {}));
  if (!parsed.success || (!parsed.data.title && !parsed.data.label)) return undefined;
  return parsed.data;
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

function externalApproverInviteDeepLink(token: string, publicURL?: string): string {
  const encoded = encodeURIComponent(token);
  const base = publicURL?.trim().replace(/\/+$/, '');
  return base ? `${base}/external-approver-invites/${encoded}` : `agenttick://join-external-approver?token=${encoded}`;
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
  responses_entitled_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  member_kind TEXT NOT NULL DEFAULT 'internal',
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
  bound_recipient_user_id TEXT REFERENCES users(id),
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
  session_id TEXT,
  session_metadata_json TEXT NOT NULL DEFAULT '{}',
  requester_json TEXT NOT NULL,
  request_type TEXT NOT NULL,
  delivery_kind TEXT NOT NULL DEFAULT 'routed_members',
  response_policy TEXT NOT NULL DEFAULT 'quorum',
  audience_channel_id TEXT,
  closes_at TEXT,
  tie_policy TEXT,
  aggregate_result_json TEXT,
  title TEXT NOT NULL,
  body TEXT,
  command TEXT,
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
CREATE INDEX IF NOT EXISTS requests_pending_deadline_idx ON requests(deadline) WHERE status = 'pending' AND deadline IS NOT NULL;
CREATE INDEX IF NOT EXISTS requests_audience_finalize_idx ON requests(closes_at) WHERE status = 'pending' AND delivery_kind = 'audience_channel' AND closes_at IS NOT NULL;

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
CREATE INDEX IF NOT EXISTS request_recipients_pending_count_idx ON request_recipients(user_id, request_id, responded_at);

CREATE TABLE IF NOT EXISTS audience_channels (
  channel_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT,
  visibility TEXT NOT NULL DEFAULT 'invite_only',
  status TEXT NOT NULL DEFAULT 'active',
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, slug)
);
CREATE INDEX IF NOT EXISTS audience_channels_workspace_idx ON audience_channels(workspace_id, status, name);

CREATE TABLE IF NOT EXISTS audience_subscriptions (
  channel_id TEXT NOT NULL REFERENCES audience_channels(channel_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS audience_subscriptions_user_idx ON audience_subscriptions(user_id, status);

CREATE TABLE IF NOT EXISTS external_approvers (
  external_approver_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  external_subject TEXT,
  display_name TEXT,
  user_id TEXT REFERENCES users(id),
  routing_rule_id TEXT REFERENCES routing_rules(routing_rule_id) ON DELETE SET NULL,
  agent_token_id TEXT REFERENCES agent_tokens(agent_token_id) ON DELETE SET NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS external_approvers_workspace_subject_idx ON external_approvers(workspace_id, external_subject) WHERE external_subject IS NOT NULL;
CREATE INDEX IF NOT EXISTS external_approvers_workspace_idx ON external_approvers(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS external_approver_invites (
  invite_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  external_approver_id TEXT REFERENCES external_approvers(external_approver_id) ON DELETE SET NULL,
  external_subject TEXT,
  display_name TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  accepted_by_user_id TEXT REFERENCES users(id),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS external_approver_invites_workspace_idx ON external_approver_invites(workspace_id, created_at DESC);

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
  session_id TEXT,
  session_metadata_json TEXT NOT NULL DEFAULT '{}',
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
CREATE INDEX IF NOT EXISTS device_pairing_codes_cleanup_idx ON device_pairing_codes(expires_at, used_at);

CREATE TABLE IF NOT EXISTS event_tickets (
  token_hash TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS event_tickets_cleanup_idx ON event_tickets(expires_at, used_at);

CREATE TABLE IF NOT EXISTS request_waiters (
  waiter_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  agent_token_id TEXT NOT NULL,
  client_run_id TEXT,
  transport TEXT NOT NULL DEFAULT 'long_poll',
  state TEXT NOT NULL DEFAULT 'waiting',
  last_seen_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  credential_expires_at TEXT NOT NULL,
  stopped_at TEXT,
  stop_reason TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS request_waiters_request_idx ON request_waiters(request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS request_waiters_workspace_idx ON request_waiters(workspace_id, state, lease_expires_at);

CREATE TABLE IF NOT EXISTS request_waiter_tokens (
  token_hash TEXT PRIMARY KEY,
  waiter_id TEXT NOT NULL REFERENCES request_waiters(waiter_id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  agent_token_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS request_waiter_tokens_cleanup_idx ON request_waiter_tokens(expires_at);

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

CREATE TABLE IF NOT EXISTS billing_receipt_owners (
  provider TEXT NOT NULL,
  environment TEXT NOT NULL,
  platform TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  receipt_key TEXT NOT NULL,
  product_key TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY(provider, environment, platform, entitlement_key, receipt_key)
);
CREATE INDEX IF NOT EXISTS billing_receipt_owners_user_idx ON billing_receipt_owners(owner_user_id, entitlement_key);

CREATE TABLE IF NOT EXISTS billing_identity_conflicts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL,
  platform TEXT NOT NULL,
  product_key TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  receipt_key TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, provider, environment, platform, entitlement_key, receipt_key, code)
);
CREATE INDEX IF NOT EXISTS billing_identity_conflicts_user_idx ON billing_identity_conflicts(user_id, updated_at DESC);
`;
