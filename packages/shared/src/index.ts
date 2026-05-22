import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { z } from 'zod';

export const AgentTickModeSchema = z.enum(['single', 'clerk']);
export type AgentTickMode = z.infer<typeof AgentTickModeSchema>;

export const AuthProviderSchema = z.enum(['local', 'clerk']);
export type AuthProvider = z.infer<typeof AuthProviderSchema>;

export const ApiErrorCodeSchema = z.enum([
  'bad_request',
  'not_authenticated',
  'forbidden',
  'not_found',
  'conflict',
  'validation_failed',
  'rate_limited',
  'routing_required',
  'internal_error'
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema.or(z.string().min(1)),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional()
  })
});
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  time: z.string().datetime().optional()
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const AuthConfigSchema = z.object({
  mode: AgentTickModeSchema,
  authProvider: AuthProviderSchema,
  publicURL: z.string().optional(),
  clerkPublishableKey: z.string().optional(),
  testAuth: z.boolean().optional()
});
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

export const CreateMobileSessionSchema = z.object({ clerkToken: z.string().min(1) });
export type CreateMobileSession = z.input<typeof CreateMobileSessionSchema>;

export const MobileSessionResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
  userId: z.string(),
  workspaceId: z.string(),
  role: z.string()
});
export type MobileSessionResponse = z.infer<typeof MobileSessionResponseSchema>;

export const MobileDiagnosticLevelSchema = z.enum(['info', 'warn', 'error']);
export type MobileDiagnosticLevel = z.infer<typeof MobileDiagnosticLevelSchema>;

export const MobileDiagnosticEventSchema = z.object({
  level: MobileDiagnosticLevelSchema,
  area: z.string().min(1).max(80),
  message: z.string().min(1).max(200),
  at: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional()
});
export type MobileDiagnosticEvent = z.infer<typeof MobileDiagnosticEventSchema>;

export const CreateMobileDiagnosticsSchema = z.object({
  appVersion: z.string().max(80).optional(),
  platform: z.string().max(40).optional(),
  deviceModel: z.string().max(120).optional(),
  serverURL: z.string().max(500).optional(),
  authMode: z.string().max(40).optional(),
  connectionStatus: z.string().max(40).optional(),
  pushStatus: z.string().max(40).optional(),
  notificationStatus: z.string().max(40).optional(),
  currentScreen: z.string().max(40).optional(),
  lastErrorMessage: z.string().max(500).optional(),
  events: z.array(MobileDiagnosticEventSchema).max(1000).default([])
});
export type CreateMobileDiagnostics = z.input<typeof CreateMobileDiagnosticsSchema>;

export const MobileDiagnosticsResponseSchema = z.object({ accepted: z.number().int().min(0) });
export type MobileDiagnosticsResponse = z.infer<typeof MobileDiagnosticsResponseSchema>;

export const WorkspaceTypeSchema = z.enum(['personal', 'shared']);
export type WorkspaceType = z.infer<typeof WorkspaceTypeSchema>;

export const WorkspaceRoleSchema = z.enum(['owner', 'admin', 'member']);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export const WorkspaceMemberStatusSchema = z.enum(['active', 'removed']).or(z.string().min(1));
export type WorkspaceMemberStatus = z.infer<typeof WorkspaceMemberStatusSchema>;

export const WorkspaceRecordSchema = z.object({
  workspaceId: z.string(),
  type: WorkspaceTypeSchema,
  name: z.string(),
  clerkOrganizationId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional()
});
export type WorkspaceRecord = z.infer<typeof WorkspaceRecordSchema>;

export const WorkspaceMemberRecordSchema = WorkspaceRecordSchema.extend({
  userId: z.string(),
  role: WorkspaceRoleSchema.or(z.string()),
  status: WorkspaceMemberStatusSchema.default('active'),
  email: z.string().email().optional(),
  displayName: z.string().optional(),
  clerkMembershipId: z.string().optional()
});
export type WorkspaceMemberRecord = z.infer<typeof WorkspaceMemberRecordSchema>;

export const CreateSharedWorkspaceSchema = z.object({ name: z.string().min(1).max(120) });
export type CreateSharedWorkspace = z.input<typeof CreateSharedWorkspaceSchema>;

export const UpdateWorkspaceSchema = z.object({ name: z.string().min(1).max(120) });
export type UpdateWorkspace = z.input<typeof UpdateWorkspaceSchema>;

export const AddWorkspaceMemberSchema = z.object({
  email: z.string().email(),
  role: WorkspaceRoleSchema.default('member')
});
export type AddWorkspaceMember = z.input<typeof AddWorkspaceMemberSchema>;

export const RequiredResponseModeSchema = z.enum(['any_one', 'all', 'exact']);
export type RequiredResponseMode = z.infer<typeof RequiredResponseModeSchema>;

export const RoutingRuleRecordSchema = z.object({
  routingRuleId: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  requiredResponseMode: RequiredResponseModeSchema,
  requiredResponseCount: z.number().int().min(1),
  recipientUserIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type RoutingRuleRecord = z.infer<typeof RoutingRuleRecordSchema>;

export const CreateRoutingRuleSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(120),
  recipientUserIds: z.array(z.string().min(1)).min(1),
  requiredResponseMode: RequiredResponseModeSchema.default('any_one'),
  requiredResponseCount: z.number().int().min(1).max(100).default(1)
});
export type CreateRoutingRule = z.input<typeof CreateRoutingRuleSchema>;

export const UpdateRoutingRuleSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  recipientUserIds: z.array(z.string().min(1)).min(1).optional(),
  requiredResponseMode: RequiredResponseModeSchema.optional(),
  requiredResponseCount: z.number().int().min(1).max(100).optional()
});
export type UpdateRoutingRule = z.input<typeof UpdateRoutingRuleSchema>;

export const AgentTokenRecordSchema = z.object({
  agentTokenId: z.string(),
  label: z.string(),
  scopes: z.array(z.string()),
  workspaceId: z.string(),
  workspaceType: WorkspaceTypeSchema.optional(),
  routingRuleId: z.string().optional(),
  creatorUserId: z.string().optional(),
  lastActivityAt: z.string().optional(),
  lastCheckInAt: z.string().optional(),
  createdAt: z.string(),
  revokedAt: z.string().optional()
});
export type AgentTokenRecord = z.infer<typeof AgentTokenRecordSchema>;

export const CreateAgentTokenSchema = z.object({
  label: z.string().min(1).max(120),
  scopes: z.array(z.string()).optional(),
  workspaceId: z.string().optional(),
  routingRuleId: z.string().nullable().optional()
});
export type CreateAgentToken = z.input<typeof CreateAgentTokenSchema>;

export const UpdateAgentTokenSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  routingRuleId: z.string().nullable().optional()
});
export type UpdateAgentToken = z.input<typeof UpdateAgentTokenSchema>;

export const AgentCredentialSchema = AgentTokenRecordSchema.extend({ token: z.string() });
export type AgentCredential = z.infer<typeof AgentCredentialSchema>;

export const RequesterSchema = z.object({
  name: z.string().min(1),
  agentTokenId: z.string().min(1).optional(),
  host: z.string().optional(),
  workingDirectory: z.string().optional(),
  clientName: z.string().optional()
});
export type Requester = z.infer<typeof RequesterSchema>;

export const ChoiceFlagSchema = z.enum([
  'favorite',
  'safest',
  'fastest',
  'thorough',
  'reversible',
  'experimental',
  'blocked',
  'needs_context',
  'destructive',
  'external_effect',
  'security_sensitive',
  'costly',
  'production',
  'time_sensitive',
  'audit_relevant'
]);
export type ChoiceFlag = z.infer<typeof ChoiceFlagSchema>;

export const ChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().max(2_000).optional(),
  kind: z.string().default('approve'),
  flags: z.array(ChoiceFlagSchema).max(8).optional(),
  tags: z.array(z.string().min(1).max(40)).max(8).optional()
});
export type Choice = z.infer<typeof ChoiceSchema>;

export const ChoiceListSchema = z.array(ChoiceSchema).transform((choices) => {
  const seen = new Map<string, number>();
  return choices.map((choice) => {
    const count = seen.get(choice.id) ?? 0;
    seen.set(choice.id, count + 1);
    if (count === 0) return choice;
    return { ...choice, id: `${choice.id}_${count + 1}` };
  });
});

export const QuestionOptionSchema = z.object({
  label: z.string().min(1),
  description: z.string().max(2_000).optional()
});
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;

export const QuestionSchema = z.object({
  header: z.string().optional(),
  question: z.string().min(1),
  options: z.array(QuestionOptionSchema).max(50).default([]),
  multiSelect: z.boolean().default(false)
});
export type Question = z.infer<typeof QuestionSchema>;

export const ResponsePayloadSchema = z.object({
  choiceId: z.string().optional(),
  message: z.string().optional(),
  answers: z.record(z.string(), z.array(z.string())).optional()
});
export type ResponsePayload = z.infer<typeof ResponsePayloadSchema>;

export const RequestStatusSchema = z.enum(['pending', 'responded', 'expired', 'resolved', 'abandoned']).or(z.string().min(1));
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

export const RequestTypeSchema = z.enum(['steering', 'sanction']).or(z.string().min(1));
export type RequestType = z.infer<typeof RequestTypeSchema>;

export const EncryptedRequestPlaintextSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  command: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional()
});
export type EncryptedRequestPlaintext = z.infer<typeof EncryptedRequestPlaintextSchema>;

export const EncryptedRequestPayloadSchema = z.object({
  version: z.number().int().positive().default(1),
  algorithm: z.string().min(1).max(80),
  keyId: z.string().min(1).max(200).optional(),
  nonce: z.string().min(1).max(500),
  ciphertext: z.string().min(1).max(200_000),
  aad: z.string().max(5_000).optional()
});
export type EncryptedRequestPayload = z.infer<typeof EncryptedRequestPayloadSchema>;

export const ResponseRecordSchema = z.object({
  responseId: z.string(),
  requestId: z.string(),
  userId: z.string(),
  source: z.string(),
  choiceId: z.string().optional(),
  message: z.string().optional(),
  answers: z.record(z.string(), z.array(z.string())).optional(),
  final: z.boolean().default(false),
  createdAt: z.string()
});
export type ResponseRecord = z.infer<typeof ResponseRecordSchema>;

export const RequestRecipientSchema = z.object({
  userId: z.string(),
  hasActiveDevice: z.boolean().default(false),
  respondedAt: z.string().optional()
});
export type RequestRecipient = z.infer<typeof RequestRecipientSchema>;

export const RequestQuorumSchema = z.object({
  requiredResponseCount: z.number().int().min(1),
  receivedResponseCount: z.number().int().min(0),
  waitingFor: z.number().int().min(0),
  currentUserEligible: z.boolean().optional(),
  currentUserResponded: z.boolean().optional(),
  recipients: z.array(RequestRecipientSchema),
  responses: z.array(ResponseRecordSchema)
});
export type RequestQuorum = z.infer<typeof RequestQuorumSchema>;

export const RequestRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  agentTokenId: z.string().optional(),
  routingRuleId: z.string().optional(),
  requester: RequesterSchema,
  requestType: RequestTypeSchema.default('sanction'),
  title: z.string(),
  body: z.string().optional(),
  command: z.string().optional(),
  encryptedPayload: EncryptedRequestPayloadSchema.optional(),
  choices: ChoiceListSchema,
  questions: z.array(QuestionSchema).max(20).optional(),
  defaultChoice: z.string().optional(),
  allowFreeformReply: z.boolean().default(false),
  deadline: z.string().optional(),
  risk: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  status: RequestStatusSchema,
  createdAt: z.string(),
  respondedAt: z.string().optional(),
  response: ResponsePayloadSchema.optional(),
  recipients: z.array(RequestRecipientSchema).optional(),
  responses: z.array(ResponseRecordSchema).optional(),
  quorum: RequestQuorumSchema.optional(),
  isTest: z.boolean().optional(),
  testLabel: z.string().optional()
});
export type RequestRecord = z.infer<typeof RequestRecordSchema>;

export const CreateRequestSchema = z.object({
  requester: RequesterSchema.partial({ agentTokenId: true }).extend({
    name: z.string().min(1),
    agentTokenId: z.string().min(1).optional()
  }),
  requestType: RequestTypeSchema.default('sanction'),
  title: z.string().min(1),
  body: z.string().optional(),
  command: z.string().optional(),
  encryptedPayload: EncryptedRequestPayloadSchema.optional(),
  choices: ChoiceListSchema.optional(),
  questions: z.array(QuestionSchema).max(20).optional(),
  defaultChoice: z.string().optional(),
  allowFreeformReply: z.boolean().optional(),
  deadline: z.string().optional(),
  risk: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional()
}).refine((value) => !value.choices?.length || value.choices.some((choice) => choice.kind === 'deny'), {
  path: ['choices'],
  message: 'custom request choices must include at least one choice with kind "deny"'
});
export type CreateRequest = z.input<typeof CreateRequestSchema>;

export const RequestWaiterCredentialSchema = z.object({ token: z.string(), expiresAt: z.string() });
export type RequestWaiterCredential = z.infer<typeof RequestWaiterCredentialSchema>;

export const CreateRequestResponseSchema = z.object({
  request: RequestRecordSchema,
  waiter: RequestWaiterCredentialSchema.optional()
});
export type CreateRequestResponse = z.infer<typeof CreateRequestResponseSchema>;

export const RespondRequestSchema = z.object({
  choiceId: z.string().optional(),
  message: z.string().optional(),
  answers: z.record(z.string(), z.array(z.string())).optional(),
  encryptedPayloadAcknowledged: z.boolean().optional()
}).refine((value) => Boolean(value.choiceId || value.message || value.answers), {
  message: 'response must include a choiceId, message, or answers'
});
export type RespondRequest = z.input<typeof RespondRequestSchema>;

export const WaitRequestResponseSchema = z.object({ request: RequestRecordSchema, terminal: z.boolean() });
export type WaitRequestResponse = z.infer<typeof WaitRequestResponseSchema>;

export const StatusUpdateStateSchema = z.enum(['working', 'waiting', 'blocked', 'done', 'failed']).or(z.string().min(1).max(40));
export type StatusUpdateState = z.infer<typeof StatusUpdateStateSchema>;

export const StatusUpdateRecordSchema = z.object({
  statusId: z.string(),
  workspaceId: z.string(),
  agentTokenId: z.string().optional(),
  agentTokenLabel: z.string().optional(),
  routingRuleId: z.string().optional(),
  threadId: z.string().optional(),
  message: z.string(),
  state: StatusUpdateStateSchema,
  nextStep: z.string().optional(),
  host: z.string().optional(),
  workingDirectory: z.string().optional(),
  clientName: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  recipientUserIds: z.array(z.string()).optional(),
  createdAt: z.string(),
  isTest: z.boolean().optional(),
  testLabel: z.string().optional()
});
export type StatusUpdateRecord = z.infer<typeof StatusUpdateRecordSchema>;

export const CreateStatusUpdateSchema = z.object({
  threadId: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(500),
  state: StatusUpdateStateSchema.default('working'),
  nextStep: z.string().max(500).optional(),
  host: z.string().max(200).optional(),
  workingDirectory: z.string().max(500).optional(),
  clientName: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.string()).optional()
});
export type CreateStatusUpdate = z.input<typeof CreateStatusUpdateSchema>;

export const ActivityItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status_update'), id: z.string(), workspaceId: z.string(), createdAt: z.string(), statusUpdate: StatusUpdateRecordSchema }),
  z.object({ kind: z.literal('request'), id: z.string(), workspaceId: z.string(), createdAt: z.string(), request: RequestRecordSchema })
]);
export type ActivityItem = z.infer<typeof ActivityItemSchema>;

export const PendingActivityCountSchema = z.object({ pendingRequests: z.number().int().min(0) });
export type PendingActivityCount = z.infer<typeof PendingActivityCountSchema>;

export const TestActivityKindSchema = z.enum(['status', 'steering', 'sanction']);
export type TestActivityKind = z.infer<typeof TestActivityKindSchema>;

export const SendTestActivitySchema = z.object({
  kind: TestActivityKindSchema,
  context: z.enum(['setup', 'routing_rule', 'agent_token']).default('setup'),
  workspaceId: z.string().optional(),
  routingRuleId: z.string().optional(),
  agentTokenId: z.string().optional()
});
export type SendTestActivity = z.input<typeof SendTestActivitySchema>;

export const SendTestActivityResponseSchema = z.object({
  status: z.literal('sent'),
  kind: TestActivityKindSchema,
  id: z.string()
});
export type SendTestActivityResponse = z.infer<typeof SendTestActivityResponseSchema>;

export const PairingTokenSchema = z.object({ token: z.string(), expiresAt: z.string() });
export type PairingToken = z.infer<typeof PairingTokenSchema>;

export const PairDeviceRequestSchema = z.object({
  token: z.string().min(1),
  deviceName: z.string().min(1),
  platform: z.string().optional()
});
export type PairDeviceRequest = z.input<typeof PairDeviceRequestSchema>;

export const DeviceCredentialSchema = z.object({ deviceId: z.string(), token: z.string() });
export type DeviceCredential = z.infer<typeof DeviceCredentialSchema>;

export const RegisterDeviceSchema = z.object({
  deviceName: z.string().min(1),
  platform: z.string().optional(),
  installationId: z.string().optional(),
  expoPushToken: z.string().optional()
});
export type RegisterDevice = z.input<typeof RegisterDeviceSchema>;

export const RegisterDeviceResponseSchema = z.object({ deviceId: z.string() });
export type RegisterDeviceResponse = z.infer<typeof RegisterDeviceResponseSchema>;

export const DeviceRecordSchema = z.object({
  deviceId: z.string(),
  userId: z.string(),
  name: z.string(),
  platform: z.string().optional(),
  installationId: z.string().optional(),
  expoPushToken: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  unregisteredAt: z.string().optional()
});
export type DeviceRecord = z.infer<typeof DeviceRecordSchema>;

export const UpdateDevicePushTokenSchema = z.object({
  expoPushToken: z.string().optional(),
  token: z.string().optional()
}).refine((value) => Object.prototype.hasOwnProperty.call(value, 'expoPushToken') || Object.prototype.hasOwnProperty.call(value, 'token'), { message: 'expoPushToken is required' });
export type UpdateDevicePushToken = z.input<typeof UpdateDevicePushTokenSchema>;

export const EventTicketResponseSchema = z.object({ ticket: z.string(), expiresAt: z.string() });
export type EventTicketResponse = z.infer<typeof EventTicketResponseSchema>;

export const EventPollEventSchema = z.object({
  eventId: z.number().int().min(0),
  type: z.string().min(1),
  targetId: z.string().min(1),
  createdAt: z.string()
});
export type EventPollEvent = z.infer<typeof EventPollEventSchema>;

export const EventPollResponseSchema = z.object({ events: z.array(EventPollEventSchema), nextEventId: z.number().int().min(0) });
export type EventPollResponse = z.infer<typeof EventPollResponseSchema>;

export const HeartbeatRequestSchema = z.record(z.string(), z.unknown()).default({});
export type HeartbeatRequest = z.input<typeof HeartbeatRequestSchema>;

export const HeartbeatResponseSchema = z.object({
  status: z.literal('ok'),
  userId: z.string().optional(),
  workspaceId: z.string().optional(),
  state: z.string().optional(),
  lastSeenAt: z.string().optional(),
  updatedAt: z.string().optional()
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

export const AvailabilityStateSchema = z.enum(['available', 'busy', 'do-not-disturb', 'off-call']).or(z.string().min(1));
export type AvailabilityState = z.infer<typeof AvailabilityStateSchema>;

export const SetAvailabilitySchema = z.object({ state: AvailabilityStateSchema });
export type SetAvailability = z.input<typeof SetAvailabilitySchema>;

export const AvailabilityRecordSchema = z.object({
  userId: z.string(),
  workspaceId: z.string(),
  state: z.string(),
  lastSeenAt: z.string().optional(),
  updatedAt: z.string()
});
export type AvailabilityRecord = z.infer<typeof AvailabilityRecordSchema>;

export const OnboardingStageSchema = z.enum(['needs_agent_token', 'needs_agent_check_in', 'needs_mobile_app', 'ready']);
export type OnboardingStage = z.infer<typeof OnboardingStageSchema>;

export const OnboardingStatusSchema = z.object({
  stage: OnboardingStageSchema,
  hasAgentToken: z.boolean(),
  hasAgentCheckIn: z.boolean(),
  hasMobileDevice: z.boolean(),
  activeAgentTokenCount: z.number().int().min(0),
  connectedAgentCount: z.number().int().min(0),
  activeMobileDeviceCount: z.number().int().min(0)
});
export type OnboardingStatus = z.infer<typeof OnboardingStatusSchema>;

export const AuditEventRecordSchema = z.object({
  eventId: z.number(),
  workspaceId: z.string(),
  userId: z.string(),
  eventType: z.string(),
  targetId: z.string(),
  payload: z.unknown(),
  createdAt: z.string()
});
export type AuditEventRecord = z.infer<typeof AuditEventRecordSchema>;

export const BillingLimitsSchema = z.object({ seats: z.number().int().positive().optional() });
export type BillingLimits = z.infer<typeof BillingLimitsSchema>;

export const BillingUsageSchema = z.object({ activeMembers: z.number().int().min(0), pendingMembers: z.number().int().min(0) });
export type BillingUsage = z.infer<typeof BillingUsageSchema>;

export const BillingStatusSchema = z.object({ workspaceId: z.string(), plan: z.string(), limits: BillingLimitsSchema, usage: BillingUsageSchema });
export type BillingStatus = z.infer<typeof BillingStatusSchema>;

export const BillingProductKeySchema = z.enum(['lifetime_unlock', 'hosted_personal_monthly', 'hosted_personal_yearly']);
export type BillingProductKey = z.infer<typeof BillingProductKeySchema>;

export const BillingPlatformSchema = z.enum(['ios', 'android']);
export type BillingPlatform = z.infer<typeof BillingPlatformSchema>;

export const BillingProductSchema = z.object({
  id: z.string().optional(),
  productKey: BillingProductKeySchema,
  kind: z.enum(['non_consumable', 'subscription']).or(z.string()),
  entitlementKey: z.enum(['lifetime_app_unlock', 'hosted_personal']).or(z.string()),
  appleProductId: z.string().optional(),
  googleProductId: z.string().optional(),
  googleBasePlanId: z.string().optional(),
  active: z.boolean().default(true),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
export type BillingProduct = z.infer<typeof BillingProductSchema>;

export const BillingProductsResponseSchema = z.object({ products: z.array(BillingProductSchema) });
export type BillingProductsResponse = z.infer<typeof BillingProductsResponseSchema>;

export const PersonalEntitlementSchema = z.object({
  userId: z.string(),
  trialStartedAt: z.string(),
  appUnlockedAt: z.string().optional(),
  includedHostedActivatedAt: z.string().optional(),
  hostedSubscriptionEndsAt: z.string().optional(),
  hostedSubscriptionCanceledAt: z.string().optional(),
  hostedDataDeletedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type PersonalEntitlement = z.infer<typeof PersonalEntitlementSchema>;

export const HostedPersonalStatusSchema = z.object({
  lifecycle: z.enum(['active', 'read_only_grace', 'expired', 'deleted']).or(z.string()),
  trialEndsAt: z.string(),
  includedHostedEndsAt: z.string().optional(),
  hostedSubscriptionEndsAt: z.string().optional(),
  readOnlyGraceEndsAt: z.string().optional(),
  responsesEnabled: z.boolean(),
  routingEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  historyRetentionDays: z.number().int().min(0)
});
export type HostedPersonalStatus = z.infer<typeof HostedPersonalStatusSchema>;

export const BillingActiveEntitlementSchema = z.object({
  active: z.boolean(),
  originProvider: z.string().optional(),
  originPlatform: z.enum(['ios', 'android', 'unknown']).or(z.string()).optional(),
  purchasedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  willRenew: z.boolean().optional()
});
export type BillingActiveEntitlement = z.infer<typeof BillingActiveEntitlementSchema>;

export const BillingPurchaseAvailabilitySchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
  originProvider: z.string().optional(),
  originPlatform: z.enum(['ios', 'android', 'unknown']).or(z.string()).optional()
});
export type BillingPurchaseAvailability = z.infer<typeof BillingPurchaseAvailabilitySchema>;

export const PersonalBillingStatusSchema = z.object({
  entitlement: PersonalEntitlementSchema,
  hostedPersonal: HostedPersonalStatusSchema,
  products: z.array(BillingProductSchema),
  activeEntitlements: z.object({ lifetimeUnlock: BillingActiveEntitlementSchema, hostedPersonal: BillingActiveEntitlementSchema }),
  purchaseAvailability: z.record(BillingProductKeySchema, BillingPurchaseAvailabilitySchema)
});
export type PersonalBillingStatus = z.infer<typeof PersonalBillingStatusSchema>;

export const BillingPurchasePreflightRequestSchema = z.object({ productKey: BillingProductKeySchema, platform: BillingPlatformSchema });
export type BillingPurchasePreflightRequest = z.input<typeof BillingPurchasePreflightRequestSchema>;

export const BillingPurchasePreflightResponseSchema = z.object({
  purchaseAttemptId: z.string().optional(),
  providerUserId: z.string(),
  allowed: z.boolean(),
  reason: z.string().optional()
});
export type BillingPurchasePreflightResponse = z.infer<typeof BillingPurchasePreflightResponseSchema>;

export const MeResponseSchema = z.object({
  userId: z.string(),
  email: z.string().email().optional(),
  name: z.string().optional(),
  signInMethod: z.string().optional(),
  authProvider: AuthProviderSchema,
  source: z.string(),
  workspaceId: z.string().optional(),
  role: WorkspaceRoleSchema.or(z.string()).optional(),
  memberships: z.array(WorkspaceMemberRecordSchema).optional()
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export function generateRequestEncryptionKey(): string {
  return encodeBase64URL(randomBytes(32));
}

export function createEncryptedRequestPayload(input: EncryptedRequestPlaintext, key: string, options: { keyId?: string; aad?: string; nonce?: Uint8Array } = {}): EncryptedRequestPayload {
  const plaintext = new TextEncoder().encode(JSON.stringify(EncryptedRequestPlaintextSchema.parse(input)));
  const keyBytes = decodeEncryptionKey(key);
  const nonce = options.nonce ?? randomBytes(12);
  const ciphertext = gcm(keyBytes, nonce).encrypt(plaintext);
  return EncryptedRequestPayloadSchema.parse({
    version: 1,
    algorithm: 'agent-tick-aes-256-gcm-v1',
    keyId: options.keyId,
    nonce: encodeBase64URL(nonce),
    ciphertext: encodeBase64URL(ciphertext),
    aad: options.aad
  });
}

export function decryptRequestPayload(payload: EncryptedRequestPayload, key: string): EncryptedRequestPlaintext {
  const parsed = EncryptedRequestPayloadSchema.parse(payload);
  if (parsed.algorithm !== 'agent-tick-aes-256-gcm-v1') throw new Error(`Unsupported encrypted request algorithm: ${parsed.algorithm}`);
  const plaintext = gcm(decodeEncryptionKey(key), decodeBase64URL(parsed.nonce)).decrypt(decodeBase64URL(parsed.ciphertext));
  return EncryptedRequestPlaintextSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
}

function decodeEncryptionKey(key: string): Uint8Array {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('Request encryption key or passphrase is required');
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    try {
      const bytes = decodeBase64URL(trimmed);
      if (bytes.length === 32) return bytes;
    } catch {
      // Fall through to passphrase derivation.
    }
  }
  return sha256(new TextEncoder().encode(`agent-tick-e2ee-passphrase-v1:${trimmed}`));
}

function encodeBase64URL(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : (globalThis as unknown as { Buffer: { from(input: Uint8Array): { toString(encoding: string): string } } }).Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64URL(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = typeof atob === 'function'
    ? atob(base64)
    : (globalThis as unknown as { Buffer: { from(input: string, encoding: string): Uint8Array } }).Buffer.from(base64, 'base64');
  return typeof binary === 'string' ? Uint8Array.from(binary, (char) => char.charCodeAt(0)) : new Uint8Array(binary);
}
