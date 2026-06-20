import type {
  ActivityItem,
  AgentCredential,
  AgentTokenRecord,
  AudienceChannelRecord,
  AudienceSubscriptionRecord,
  AvailabilityRecord,
  BillingProduct,
  Choice,
  CreateAgentToken,
  CreateRequest,
  CreateRoutingRule,
  CreateStatusUpdate,
  CreateToolActivity,
  DeviceCredential,
  DevicePublicKeyRecord,
  DeviceRecord,
  ExternalApproverInviteCredential,
  ExternalApproverInviteRecord,
  ExternalApproverRecord,
  ExternalApproverStatus,
  RequiredResponseMode,
  RequestAgentWaiterSummary,
  RequestRecord,
  RequestRecipient,
  RequestWaiterCredential,
  ResponseRecord,
  RespondRequest,
  RoutingRuleRecord,
  SessionMetadata,
  StatusUpdateRecord,
  ToolActivityRecord,
  UpdateAgentToken,
  UpdateRoutingRule,
  UpdateWorkspace,
  WorkspaceMemberKind,
  WorkspaceMemberRecord,
  WorkspaceRecord,
  WorkspaceRole,
  WorkspaceType,
  PrivateRequestsPolicy
} from '@self-deprecated/agent-tick-shared';

export type {
  ActivityItem,
  AgentCredential,
  AgentTokenRecord,
  AudienceChannelRecord,
  AudienceSubscriptionRecord,
  AvailabilityRecord,
  BillingProduct,
  Choice,
  CreateAgentToken,
  CreateRequest,
  CreateRoutingRule,
  CreateStatusUpdate,
  CreateToolActivity,
  DeviceCredential,
  DevicePublicKeyRecord,
  DeviceRecord,
  ExternalApproverInviteCredential,
  ExternalApproverInviteRecord,
  ExternalApproverRecord,
  ExternalApproverStatus,
  RequiredResponseMode,
  RequestAgentWaiterSummary,
  RequestRecord,
  RequestRecipient,
  RequestWaiterCredential,
  ResponseRecord,
  RespondRequest,
  RoutingRuleRecord,
  SessionMetadata,
  StatusUpdateRecord,
  ToolActivityRecord,
  UpdateAgentToken,
  UpdateRoutingRule,
  UpdateWorkspace,
  WorkspaceMemberKind,
  WorkspaceMemberRecord,
  WorkspaceRecord,
  WorkspaceRole,
  WorkspaceType,
  PrivateRequestsPolicy
} from '@self-deprecated/agent-tick-shared';
export const DEFAULT_USER_ID = 'usr_default';
export const DEFAULT_WORKSPACE_ID = 'wsp_default';
export const DEFAULT_REQUEST_WAITER_LEASE_MS = 60_000;
// Waiter bearer credentials roll forward on each successful waiter renewal so
// integrations can wait overnight without exposing an indefinitely-valid token.
export const DEFAULT_REQUEST_WAITER_CREDENTIAL_TTL_MS = 65 * 60_000;

export interface PostgresPoolOptions {
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  statementTimeout?: number;
  queryTimeout?: number;
}

export interface OpenStoreOptions {
  databaseURL?: string;
  postgresPool?: PostgresPoolOptions;
}

export type Awaitable<T> = T | Promise<T>;

/**
 * Result of a read-only schema compatibility check.
 *
 * `ok: false` means the deployed schema is missing columns the running code
 * requires. The store must not mutate schema to repair this; callers surface it
 * as a `schema_mismatch` readiness/startup failure so operators can run
 * migrations or roll back.
 */
export interface SchemaCompatibilityMissingColumn {
  table: string;
  column: string;
}

export type SchemaCompatibilityResult =
  | { ok: true }
  | { ok: false; code: 'schema_mismatch'; missing: SchemaCompatibilityMissingColumn[] };

/**
 * Result of the synthetic Activity write-path canary. `ok: false` includes a
 * safe public code (`schema_mismatch` for drift, `write_failed` otherwise); the
 * server log keeps request ids and detail for correlation.
 */
export type ActivityWriteCanaryResult =
  | { ok: true }
  | { ok: false; code: 'schema_mismatch' | 'write_failed' };

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
  workspaceType: WorkspaceType;
  role: string;
  memberKind: WorkspaceMemberKind;
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
  boundRecipientUserId: string | undefined;
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

export interface CreateToolActivityInput extends CreateToolActivity {
  workspaceId: string;
  agentTokenId?: string;
  agentTokenLabel?: string;
  routingRuleId?: string;
  userId?: string;
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

export interface RegisterDevicePublicKeyInput {
  deviceId: string;
  userId: string;
  algorithm: 'p256-ecdh-hkdf-sha256';
  publicKey: string;
}

export interface PrivateRequestPrepareInput {
  workspaceId: string;
  agentTokenId?: string;
  routingRuleId?: string;
}

export type PrivateStatusUpdatePrepareInput = PrivateRequestPrepareInput;

export interface PrivateRequestPrepareRecord {
  contentMode: 'private';
  workspaceId: string;
  routingRuleId?: string;
  required: boolean;
  recipientVersion: string;
  recipientUserIds: string[];
  deviceKeys: DevicePublicKeyRecord[];
  unavailableRecipients: Array<{ userId: string; reason: string }>;
}

export type PrivateStatusUpdatePrepareRecord = PrivateRequestPrepareRecord;

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

export interface CreateExternalApproverInviteInput {
  workspaceId: string;
  createdByUserId: string;
  displayName?: string;
  externalSubject?: string;
  externalApproverId?: string;
  expiresInMinutes?: number;
  publicURL?: string;
}

export interface RequestWaiterAuth {
  requestId: string;
  workspaceId: string;
  agentTokenId: string;
  waiterId: string;
}

export interface RequestWaiterTokenRecord extends RequestWaiterCredential {}

export interface RequestWaiterRecord {
  waiterId: string;
  requestId: string;
  workspaceId: string;
  agentTokenId: string;
  clientRunId?: string;
  transport: string;
  state: string;
  lastSeenAt: string;
  leaseExpiresAt: string;
  credentialExpiresAt: string;
  stoppedAt?: string;
  stopReason?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

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
  hostedSubscriptionEndsAt?: string;
  hostedSubscriptionCanceledAt?: string;
  hostedDataDeletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdatePersonalEntitlementInput {
  userId: string;
  appUnlockedAt?: string | null;
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

export interface TransferAccountBoundBillingPurchasesInput {
  provider: string;
  environment?: string;
  platform?: string;
  fromUserIds: string[];
  toUserId: string;
  rawEventJSON?: string | null;
}

export interface TransferAccountBoundBillingPurchasesResult {
  transactions: BillingTransactionRecord[];
  receiptOwnersTransferred: number;
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

export interface BillingReceiptOwnerRecord {
  provider: string;
  environment: string;
  platform: string;
  entitlementKey: string;
  receiptKey: string;
  productKey: string;
  ownerUserId: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ClaimBillingReceiptOwnerInput {
  provider: string;
  environment: string;
  platform: string;
  entitlementKey: string;
  receiptKey: string;
  productKey: string;
  ownerUserId: string;
}

export interface ClaimBillingReceiptOwnerResult {
  owner: BillingReceiptOwnerRecord;
  created: boolean;
  ownedByCurrentUser: boolean;
}

export interface BillingIdentityConflictRecord {
  conflictId: string;
  userId: string;
  provider: string;
  environment: string;
  platform: string;
  productKey: string;
  entitlementKey: string;
  receiptKey: string;
  code: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertBillingIdentityConflictInput {
  userId: string;
  provider: string;
  environment: string;
  platform: string;
  productKey: string;
  entitlementKey: string;
  receiptKey: string;
  code: string;
}

export interface CleanupExpiredSecretsResult {
  eventTickets: number;
  pairingCodes: number;
  requestWaiterTokens: number;
}

export interface RetentionPolicy {
  requestsDays?: number;
  statusUpdatesDays?: number;
  toolActivitiesDays?: number;
  auditEventsDays?: number;
  unregisteredDevicesDays?: number;
}

export interface CleanupRetentionResult {
  requests: number;
  statusUpdates: number;
  toolActivities: number;
  auditEvents: number;
  devices: number;
}

export interface DeleteWorkspaceDataResult {
  workspaceId: string;
  agentTokensRevoked: number;
  devicesUnregistered: number;
  deleted: boolean;
}

export interface UpdateWorkspaceEntitlementInput {
  responsesEntitledUntil?: string | null;
}

export interface AsyncAgentTickStore {
  ping(): Awaitable<void>;
  /**
   * Read-only check that the deployed schema has every column the running code
   * requires. Does not mutate schema. Returns `{ ok: true }` when compatible
   * (for example, after the SQLite full-schema path runs).
   */
  verifySchemaCompatibility(): Awaitable<SchemaCompatibilityResult>;
  /**
   * Synthetic Activity write-path canary. Runs the real Status Update + Request
   * creation inside a rolled-back transaction with an ephemeral canary Workspace
   * so nothing persists or notifies. Returns a safe pass/fail classification.
   */
  runActivityWriteCanary(now?: string): Awaitable<ActivityWriteCanaryResult>;
  close(): Awaitable<void>;
  setPrivateRequestPolicy(policy: PrivateRequestsPolicy): Awaitable<void>;
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
  updateWorkspace(workspaceId: string, input: UpdateWorkspace | string, now?: string): Awaitable<WorkspaceRecord | null>;
  updateWorkspaceEntitlement(workspaceId: string, input: UpdateWorkspaceEntitlementInput, now?: string): Awaitable<WorkspaceRecord | null>;
  workspaceResponsesEntitled(workspaceId: string, now?: string): Awaitable<boolean>;
  addWorkspaceMemberByEmail(workspaceId: string, email: string, role?: WorkspaceRole | string, now?: string, memberKind?: WorkspaceMemberKind): Awaitable<WorkspaceMemberRecord>;
  createExternalApprover(workspaceId: string, input: unknown, createdByUserId: string, now?: string): Awaitable<ExternalApproverRecord>;
  getExternalApprover(externalApproverId: string, workspaceId: string): Awaitable<ExternalApproverRecord | null>;
  getExternalApproverStatus(externalApproverId: string, workspaceId: string): Awaitable<ExternalApproverStatus | null>;
  createExternalApproverAgentToken(externalApproverId: string, workspaceId: string, createdByUserId: string, now?: string): Awaitable<AgentCredential | null>;
  createExternalApproverInvite(input: CreateExternalApproverInviteInput, now?: string): Awaitable<ExternalApproverInviteCredential>;
  getExternalApproverInviteByToken(token: string, now?: string): Awaitable<ExternalApproverInviteRecord | null>;
  acceptExternalApproverInvite(token: string, userId: string, now?: string): Awaitable<WorkspaceMemberRecord | null>;
  revokeExternalApproverInvite(inviteId: string, workspaceId: string, now?: string): Awaitable<ExternalApproverInviteRecord | null>;
  removeWorkspaceMember(workspaceId: string, userId: string, now?: string): Awaitable<void>;
  workspaceSeatUsage(workspaceId: string): Awaitable<{ activeMembers: number; pendingMembers: number }>;
  deleteWorkspaceData(workspaceId: string, now?: string): Awaitable<DeleteWorkspaceDataResult>;
  createAudienceChannel(input: unknown, createdByUserId: string, now?: string): Awaitable<AudienceChannelRecord>;
  listAudienceChannels(workspaceId: string): Awaitable<AudienceChannelRecord[]>;
  getAudienceChannel(channelId: string): Awaitable<AudienceChannelRecord | null>;
  setAudienceSubscription(channelId: string, userId: string, status?: string, now?: string): Awaitable<AudienceSubscriptionRecord>;
  getAudienceSubscription(channelId: string, userId: string): Awaitable<AudienceSubscriptionRecord | null>;
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
  listRequestsForUser(userId: string, workspaceId?: string, now?: string, limit?: number): Awaitable<RequestRecord[]>;
  listAudienceRequestsForUser(userId: string, now?: string, limit?: number): Awaitable<RequestRecord[]>;
  getRequestForUser(id: string, userId: string, now?: string): Awaitable<RequestRecord | null>;
  getRequestForWorkspace(id: string, workspaceId: string, currentUserId?: string, now?: string): Awaitable<RequestRecord | null>;
  respondToRequestForWorkspace(id: string, workspaceId: string, response: RespondRequest, responderUserId: string, now?: string): Awaitable<RequestRecord | null>;
  respondToAudienceRequest(id: string, response: RespondRequest, responderUserId: string, now?: string): Awaitable<RequestRecord | null>;
  abandonRequestForWorkspace(id: string, workspaceId: string, actorId: string, now?: string): Awaitable<RequestRecord | null>;
  createRequestWaiterToken(requestId: string, workspaceId: string, agentTokenId: string, requestDeadline?: string, now?: string): Awaitable<RequestWaiterTokenRecord>;
  verifyRequestWaiterToken(token: string, requestId: string, now?: string): Awaitable<RequestWaiterAuth | null>;
  renewRequestWaiter(waiterId: string, leaseExpiresAt: string, now?: string): Awaitable<RequestWaiterRecord | null>;
  stopRequestWaiter(waiterId: string, reason: string, now?: string): Awaitable<RequestWaiterRecord | null>;
  markRequestWaiterError(waiterId: string, errorCode: string, errorMessage?: string, now?: string): Awaitable<RequestWaiterRecord | null>;
  createStatusUpdate(input: CreateStatusUpdateInput, now?: string): Awaitable<StatusUpdateRecord>;
  getStatusUpdate(statusId: string, workspaceId: string): Awaitable<StatusUpdateRecord | null>;
  listLatestStatusUpdates(workspaceId: string, limit?: number): Awaitable<StatusUpdateRecord[]>;
  createToolActivity(input: CreateToolActivityInput, now?: string): Awaitable<ToolActivityRecord>;
  getToolActivity(toolActivityId: string, workspaceId: string): Awaitable<ToolActivityRecord | null>;
  listLatestToolActivities(workspaceId: string, limit?: number): Awaitable<ToolActivityRecord[]>;
  listActivityForUser(userId: string, workspaceId?: string, limit?: number, now?: string): Awaitable<ActivityItem[]>;
  pendingRequestCountForUser(userId: string, workspaceId?: string, now?: string): Awaitable<number>;
  registerDevice(input: DeviceRegistrationInput, now?: string): Awaitable<DeviceRecord>;
  listDevicesForUser(userId: string): Awaitable<DeviceRecord[]>;
  registerDevicePublicKey(input: RegisterDevicePublicKeyInput, now?: string): Awaitable<DevicePublicKeyRecord>;
  listDevicePublicKeysForUser(userId: string): Awaitable<DevicePublicKeyRecord[]>;
  preparePrivateRequest(input: PrivateRequestPrepareInput, now?: string): Awaitable<PrivateRequestPrepareRecord>;
  preparePrivateStatusUpdate(input: PrivateStatusUpdatePrepareInput, now?: string): Awaitable<PrivateStatusUpdatePrepareRecord>;
  listPushDevicesForRequestRecipients(requestId: string): Awaitable<DeviceRecord[]>;
  listPushDevicesForAudienceChannel(channelId: string): Awaitable<DeviceRecord[]>;
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
  transferAccountBoundBillingPurchases(input: TransferAccountBoundBillingPurchasesInput, now?: string): Awaitable<TransferAccountBoundBillingPurchasesResult>;
  claimBillingReceiptOwner(input: ClaimBillingReceiptOwnerInput, now?: string): Awaitable<ClaimBillingReceiptOwnerResult>;
  upsertBillingIdentityConflict(input: UpsertBillingIdentityConflictInput, now?: string): Awaitable<BillingIdentityConflictRecord>;
  listBillingIdentityConflictsForUser(userId: string): Awaitable<BillingIdentityConflictRecord[]>;
  deleteHostedPersonalData(userId: string, workspaceId: string, now?: string): Awaitable<void>;
  deleteHostedAccountData(userId: string, personalWorkspaceId: string, now?: string): Awaitable<void>;
}

