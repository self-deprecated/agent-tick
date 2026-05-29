import { z } from 'zod';
import { ChoiceListSchema, QuestionSchema, ResponsePayloadSchema } from './requestPayloadSchemas.js';
import { SEMANTIC_STATUS_UPDATE_STATES } from './statusPolicy.js';

export { PERSONAL_TRIAL_DAYS, READ_ONLY_GRACE_DAYS, addDays, hostedPersonalStatus } from './billingPolicy.js';
export type { NativeTrialStatus } from './billingPolicy.js';
export { ChoiceFlagSchema, ChoiceListSchema, ChoiceSchema, QuestionOptionSchema, QuestionSchema, ResponsePayloadSchema } from './requestPayloadSchemas.js';
export type { Choice, ChoiceFlag, Question, QuestionOption, ResponsePayload } from './requestPayloadSchemas.js';
export { REDUNDANT_WAITING_STATUS_UPDATE_WINDOW_MS, deriveSessionSummaryTitle, isRedundantWaitingStatusUpdateAfterRequest, sessionMetadataTitle, suppressRedundantWaitingStatusUpdates } from './sessionActivityPolicy.js';
export { SEMANTIC_STATUS_UPDATE_STATES, semanticStatusUpdateState, statusUpdateStateBehavior } from './statusPolicy.js';
export type { SemanticStatusUpdateState, StatusUpdateStateBehavior } from './statusPolicy.js';

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
  version: z.string().min(1).optional(),
  time: z.string().datetime().optional()
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ReadyResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  time: z.string().datetime().optional(),
  dependencies: z.object({
    database: z.enum(['ok', 'error']).optional(),
    redis: z.enum(['ok', 'error']).optional()
  }).default({})
});
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;

export const MobileUpdatePolicySchema = z.object({
  minimumSupportedVersion: z.string().min(1).max(80).optional(),
  updateURL: z.string().url().optional(),
  message: z.string().min(1).max(500).optional()
});
export type MobileUpdatePolicy = z.infer<typeof MobileUpdatePolicySchema>;

export const AuthConfigSchema = z.object({
  mode: AgentTickModeSchema,
  authProvider: AuthProviderSchema,
  publicURL: z.string().optional(),
  clerkPublishableKey: z.string().optional(),
  testAuth: z.boolean().optional(),
  mobile: MobileUpdatePolicySchema.optional()
});
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

export const WorkspaceTypeSchema = z.enum(['personal', 'shared']);
export type WorkspaceType = z.infer<typeof WorkspaceTypeSchema>;

export const WorkspaceMemberKindSchema = z.enum(['internal', 'external_approver']);
export type WorkspaceMemberKind = z.infer<typeof WorkspaceMemberKindSchema>;

export const CreateMobileSessionSchema = z.object({ clerkToken: z.string().min(1) });
export type CreateMobileSession = z.input<typeof CreateMobileSessionSchema>;

export const MobileSessionResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
  userId: z.string(),
  workspaceId: z.string(),
  workspaceType: WorkspaceTypeSchema.default('personal'),
  role: z.string(),
  memberKind: WorkspaceMemberKindSchema.default('internal')
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

export const WorkspaceRoleSchema = z.enum(['owner', 'admin', 'member']);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export const WorkspaceMemberStatusSchema = z.enum(['active', 'removed']).or(z.string().min(1));
export type WorkspaceMemberStatus = z.infer<typeof WorkspaceMemberStatusSchema>;

export const WorkspaceRecordSchema = z.object({
  workspaceId: z.string(),
  type: WorkspaceTypeSchema,
  name: z.string(),
  clerkOrganizationId: z.string().optional(),
  responsesEntitledUntil: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional()
});
export type WorkspaceRecord = z.infer<typeof WorkspaceRecordSchema>;

export const WorkspaceMemberRecordSchema = WorkspaceRecordSchema.extend({
  userId: z.string(),
  role: WorkspaceRoleSchema.or(z.string()),
  status: WorkspaceMemberStatusSchema.default('active'),
  memberKind: WorkspaceMemberKindSchema.default('internal'),
  email: z.string().email().optional(),
  displayName: z.string().optional(),
  clerkMembershipId: z.string().optional(),
  availabilityState: z.string().optional(),
  lastSeenAt: z.string().optional()
});
export type WorkspaceMemberRecord = z.infer<typeof WorkspaceMemberRecordSchema>;

export const CreateSharedWorkspaceSchema = z.object({ name: z.string().min(1).max(120) });
export type CreateSharedWorkspace = z.input<typeof CreateSharedWorkspaceSchema>;

export const UpdateWorkspaceSchema = z.object({ name: z.string().min(1).max(120) });
export type UpdateWorkspace = z.input<typeof UpdateWorkspaceSchema>;

export const AddWorkspaceMemberSchema = z.object({
  email: z.string().email(),
  role: WorkspaceRoleSchema.default('member'),
  memberKind: WorkspaceMemberKindSchema.default('internal')
}).refine((value) => value.memberKind === 'internal' || value.role === 'member', {
  path: ['memberKind'],
  message: 'external approvers must use the member role'
});
export type AddWorkspaceMember = z.input<typeof AddWorkspaceMemberSchema>;

export const CreateExternalApproverSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  externalSubject: z.string().min(1).max(200).optional()
});
export type CreateExternalApprover = z.input<typeof CreateExternalApproverSchema>;

export const ExternalApproverRecordSchema = z.object({
  externalApproverId: z.string(),
  workspaceId: z.string(),
  externalSubject: z.string().optional(),
  displayName: z.string().optional(),
  userId: z.string().optional(),
  routingRuleId: z.string().optional(),
  agentTokenId: z.string().optional(),
  createdByUserId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ExternalApproverRecord = z.infer<typeof ExternalApproverRecordSchema>;

export const ExternalApproverStatusSchema = ExternalApproverRecordSchema.extend({
  invitePending: z.boolean().default(false),
  connected: z.boolean().default(false),
  routeReady: z.boolean().default(false)
});
export type ExternalApproverStatus = z.infer<typeof ExternalApproverStatusSchema>;

export const CreateExternalApproverInviteSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  externalSubject: z.string().min(1).max(200).optional(),
  externalApproverId: z.string().min(1).optional(),
  expiresInMinutes: z.number().int().min(1).max(60 * 24 * 30).default(60)
});
export type CreateExternalApproverInvite = z.input<typeof CreateExternalApproverInviteSchema>;

export const ExternalApproverInviteRecordSchema = z.object({
  inviteId: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string().optional(),
  externalSubject: z.string().optional(),
  displayName: z.string().optional(),
  externalApproverId: z.string().optional(),
  acceptedByUserId: z.string().optional(),
  expiresAt: z.string(),
  acceptedAt: z.string().optional(),
  revokedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ExternalApproverInviteRecord = z.infer<typeof ExternalApproverInviteRecordSchema>;

export const ExternalApproverInviteCredentialSchema = ExternalApproverInviteRecordSchema.extend({
  token: z.string(),
  deepLink: z.string(),
  qrPayload: z.string()
});
export type ExternalApproverInviteCredential = z.infer<typeof ExternalApproverInviteCredentialSchema>;

export const RequiredResponseModeSchema = z.enum(['any_one', 'all', 'exact']);
export type RequiredResponseMode = z.infer<typeof RequiredResponseModeSchema>;

export const AudienceChannelVisibilitySchema = z.enum(['public', 'invite_only']);
export type AudienceChannelVisibility = z.infer<typeof AudienceChannelVisibilitySchema>;

export const AudienceChannelStatusSchema = z.enum(['active', 'archived']).or(z.string().min(1));
export type AudienceChannelStatus = z.infer<typeof AudienceChannelStatusSchema>;

export const AudienceSubscriptionStatusSchema = z.enum(['active', 'muted', 'removed']).or(z.string().min(1));
export type AudienceSubscriptionStatus = z.infer<typeof AudienceSubscriptionStatusSchema>;

export const AudienceChannelRecordSchema = z.object({
  channelId: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  slug: z.string().optional(),
  visibility: AudienceChannelVisibilitySchema,
  status: AudienceChannelStatusSchema,
  createdByUserId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type AudienceChannelRecord = z.infer<typeof AudienceChannelRecordSchema>;

export const AudienceSubscriptionRecordSchema = z.object({
  channelId: z.string(),
  userId: z.string(),
  status: AudienceSubscriptionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});
export type AudienceSubscriptionRecord = z.infer<typeof AudienceSubscriptionRecordSchema>;

export const CreateAudienceChannelSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  visibility: AudienceChannelVisibilitySchema.default('invite_only')
});
export type CreateAudienceChannel = z.input<typeof CreateAudienceChannelSchema>;

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

export const DeleteRoutingRuleResponseSchema = z.object({
  status: z.literal('deleted'),
  routingRuleId: z.string()
});
export type DeleteRoutingRuleResponse = z.infer<typeof DeleteRoutingRuleResponseSchema>;

export const RoutingPreviewInputSchema = z.object({
  workspaceId: z.string().optional(),
  routingRuleId: z.string().optional(),
  agentTokenId: z.string().optional(),
  recipientUserIds: z.array(z.string()).optional(),
  requiredResponseMode: RequiredResponseModeSchema.default('any_one').optional(),
  requiredResponseCount: z.number().int().min(1).max(100).optional()
});
export type RoutingPreviewInput = z.input<typeof RoutingPreviewInputSchema>;

export const RoutingPreviewRecipientSchema = z.object({
  userId: z.string(),
  displayName: z.string().optional(),
  email: z.string().email().optional(),
  role: WorkspaceRoleSchema.or(z.string()),
  selected: z.boolean(),
  availabilityState: z.string().optional(),
  pushReady: z.boolean(),
  readiness: z.string()
});
export type RoutingPreviewRecipient = z.infer<typeof RoutingPreviewRecipientSchema>;

export const RoutingPreviewSchema = z.object({
  workspaceId: z.string(),
  routingRuleId: z.string().optional(),
  agentTokenId: z.string().optional(),
  status: z.enum(['healthy', 'unhealthy']),
  summary: z.string(),
  selectedRecipientCount: z.number().int().nonnegative(),
  pushReadyRecipientCount: z.number().int().nonnegative(),
  availableRecipientCount: z.number().int().nonnegative(),
  requiredResponseMode: RequiredResponseModeSchema.or(z.string()),
  requiredResponseCount: z.number().int().min(1),
  recipients: z.array(RoutingPreviewRecipientSchema),
  unhealthyReasons: z.array(z.string()),
  assignedAgentConnectionCount: z.number().int().nonnegative().default(0)
});
export type RoutingPreview = z.infer<typeof RoutingPreviewSchema>;

export const AgentTokenRecordSchema = z.object({
  agentTokenId: z.string(),
  label: z.string(),
  scopes: z.array(z.string()),
  workspaceId: z.string(),
  workspaceType: WorkspaceTypeSchema.optional(),
  routingRuleId: z.string().optional(),
  boundRecipientUserId: z.string().optional(),
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
  routingRuleId: z.string().nullable().optional(),
  boundRecipientUserId: z.string().min(1).nullable().optional()
});
export type CreateAgentToken = z.input<typeof CreateAgentTokenSchema>;

export const UpdateAgentTokenSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  routingRuleId: z.string().nullable().optional(),
  boundRecipientUserId: z.string().min(1).nullable().optional()
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

export const SessionMetadataSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  label: z.string().min(1).max(200).optional()
});
export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

export const RequestStatusSchema = z.enum(['pending', 'responded', 'expired', 'resolved', 'abandoned']).or(z.string().min(1));
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

export const RequestDeliveryKindSchema = z.enum(['routed_members', 'audience_channel']);
export type RequestDeliveryKind = z.infer<typeof RequestDeliveryKindSchema>;

export const RequestResponsePolicySchema = z.enum(['first_response', 'quorum', 'deadline_plurality']);
export type RequestResponsePolicy = z.infer<typeof RequestResponsePolicySchema>;

export const RequestTiePolicySchema = z.enum(['default_choice', 'agent_timeout', 'owner_breaks_tie']);
export type RequestTiePolicy = z.infer<typeof RequestTiePolicySchema>;

export const RequestTypeSchema = z.enum(['steering', 'sanction']).or(z.string().min(1));
export type RequestType = z.infer<typeof RequestTypeSchema>;

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

export const RequestAgentWaiterStateSchema = z.enum(['waiting', 'stale', 'expired', 'stopped', 'errored']);
export type RequestAgentWaiterState = z.infer<typeof RequestAgentWaiterStateSchema>;

export const RequestAgentWaiterSummarySchema = z.object({
  waiterId: z.string().optional(),
  state: RequestAgentWaiterStateSchema,
  lastSeenAt: z.string().datetime().optional(),
  leaseExpiresAt: z.string().datetime().optional(),
  credentialExpiresAt: z.string().datetime().optional(),
  stoppedAt: z.string().datetime().optional(),
  stopReason: z.string().min(1).optional(),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional()
});
export type RequestAgentWaiterSummary = z.infer<typeof RequestAgentWaiterSummarySchema>;

export const RequestRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  workspaceType: WorkspaceTypeSchema.optional(),
  workspaceResponsesEntitled: z.boolean().optional(),
  agentTokenId: z.string().optional(),
  routingRuleId: z.string().optional(),
  requester: RequesterSchema,
  sessionId: z.string().min(1).max(200).optional(),
  session: SessionMetadataSchema.optional(),
  requestType: RequestTypeSchema.default('sanction'),
  deliveryKind: RequestDeliveryKindSchema.default('routed_members'),
  responsePolicy: RequestResponsePolicySchema.default('quorum'),
  audienceChannelId: z.string().optional(),
  closesAt: z.string().optional(),
  tiePolicy: RequestTiePolicySchema.optional(),
  aggregateResult: z.record(z.string(), z.unknown()).optional(),
  title: z.string(),
  body: z.string().optional(),
  command: z.string().optional(),
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
  agentWaiter: RequestAgentWaiterSummarySchema.optional(),
  isTest: z.boolean().optional(),
  testLabel: z.string().optional()
});
export type RequestRecord = z.infer<typeof RequestRecordSchema>;

export const CreateRequestSchema = z.object({
  requester: RequesterSchema.partial({ agentTokenId: true }).extend({
    name: z.string().min(1),
    agentTokenId: z.string().min(1).optional()
  }),
  sessionId: z.string().min(1).max(200).optional(),
  session: SessionMetadataSchema.optional(),
  requestType: RequestTypeSchema.default('sanction'),
  deliveryKind: RequestDeliveryKindSchema.default('routed_members'),
  responsePolicy: RequestResponsePolicySchema.default('quorum'),
  audienceChannelId: z.string().min(1).optional(),
  closesAt: z.string().optional(),
  tiePolicy: RequestTiePolicySchema.optional(),
  title: z.string().min(1),
  body: z.string().optional(),
  command: z.string().optional(),
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
}).superRefine((value, context) => {
  if (value.deliveryKind !== 'audience_channel') return;
  if (value.requestType !== 'steering') context.addIssue({ code: 'custom', path: ['requestType'], message: 'audience Requests must be Steering' });
  if (!value.audienceChannelId) context.addIssue({ code: 'custom', path: ['audienceChannelId'], message: 'audience Requests require an Audience Channel' });
  if (!value.closesAt) context.addIssue({ code: 'custom', path: ['closesAt'], message: 'audience Requests require closesAt' });
  if (value.responsePolicy !== 'deadline_plurality') context.addIssue({ code: 'custom', path: ['responsePolicy'], message: 'audience Requests require deadline_plurality response policy' });
  if (value.command) context.addIssue({ code: 'custom', path: ['command'], message: 'audience Requests cannot include commands' });
});
export type CreateRequest = z.input<typeof CreateRequestSchema>;

export const RequestWaiterCredentialSchema = z.object({
  token: z.string(),
  waiterId: z.string(),
  expiresAt: z.string(),
  leaseExpiresAt: z.string()
});
export type RequestWaiterCredential = z.infer<typeof RequestWaiterCredentialSchema>;

export const RequestWaiterStopReasonSchema = z.enum(['responded', 'local_answer', 'agent_cancelled', 'shutdown', 'resolved']);
export type RequestWaiterStopReason = z.infer<typeof RequestWaiterStopReasonSchema>;

export const StopRequestWaiterSchema = z.object({ reason: RequestWaiterStopReasonSchema });
export type StopRequestWaiter = z.input<typeof StopRequestWaiterSchema>;

export const ReportRequestWaiterErrorSchema = z.object({
  code: z.string().min(1).max(80).regex(/^[a-z0-9_.-]+$/),
  message: z.string().min(1).max(500).optional()
});
export type ReportRequestWaiterError = z.input<typeof ReportRequestWaiterErrorSchema>;

export const CreateRequestResponseSchema = z.object({
  request: RequestRecordSchema,
  waiter: RequestWaiterCredentialSchema.optional()
});
export type CreateRequestResponse = z.infer<typeof CreateRequestResponseSchema>;

export const RespondRequestSchema = z.object({
  choiceId: z.string().optional(),
  message: z.string().optional(),
  answers: z.record(z.string(), z.array(z.string())).optional()
}).refine((value) => Boolean(value.choiceId || value.message || value.answers), {
  message: 'response must include a choiceId, message, or answers'
});
export type RespondRequest = z.input<typeof RespondRequestSchema>;

export const WaitRequestResponseSchema = z.object({ request: RequestRecordSchema, terminal: z.boolean() });
export type WaitRequestResponse = z.infer<typeof WaitRequestResponseSchema>;

export const SemanticStatusUpdateStateSchema = z.enum(SEMANTIC_STATUS_UPDATE_STATES);
export const StatusUpdateStateSchema = SemanticStatusUpdateStateSchema.or(z.string().min(1).max(40));
export type StatusUpdateState = z.infer<typeof StatusUpdateStateSchema>;
export const StatusUpdateStateBehaviorSchema = z.enum(['semantic', 'display_only']);

export const StatusUpdateRecordSchema = z.object({
  statusId: z.string(),
  workspaceId: z.string(),
  agentTokenId: z.string().optional(),
  agentTokenLabel: z.string().optional(),
  routingRuleId: z.string().optional(),
  threadId: z.string().optional(),
  sessionId: z.string().optional(),
  session: SessionMetadataSchema.optional(),
  message: z.string(),
  state: StatusUpdateStateSchema,
  semanticState: SemanticStatusUpdateStateSchema.optional(),
  stateBehavior: StatusUpdateStateBehaviorSchema.optional(),
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
  sessionId: z.string().min(1).max(200).optional(),
  session: SessionMetadataSchema.optional(),
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

export const SessionStateSchema = z.enum(['needs-input', 'blocked', 'failed', 'active', 'waiting', 'complete', 'recent']).or(z.string().min(1));
export type SessionState = z.infer<typeof SessionStateSchema>;

export const SessionLatestActivitySchema = z.object({
  kind: z.enum(['request', 'status_update']),
  id: z.string(),
  createdAt: z.string(),
  preview: z.string(),
  state: z.string().optional(),
  requestStatus: z.string().optional(),
  agentWaiter: RequestAgentWaiterSummarySchema.optional()
});
export type SessionLatestActivity = z.infer<typeof SessionLatestActivitySchema>;

export const SessionPendingRequestSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  status: RequestStatusSchema,
  agentWaiter: RequestAgentWaiterSummarySchema.optional()
});
export type SessionPendingRequestSummary = z.infer<typeof SessionPendingRequestSummarySchema>;

export const SessionSummarySchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  state: SessionStateSchema,
  latestActivity: SessionLatestActivitySchema,
  pendingRequestCount: z.number().int().min(0),
  pendingRequests: z.array(SessionPendingRequestSummarySchema).optional(),
  sourceLabels: z.array(z.string()),
  startedAt: z.string(),
  updatedAt: z.string()
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionDetailSchema = z.object({
  summary: SessionSummarySchema,
  timeline: z.array(ActivityItemSchema)
});
export type SessionDetail = z.infer<typeof SessionDetailSchema>;

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

export const UpdateDeviceNameSchema = z.object({ name: z.string().min(1) });
export type UpdateDeviceName = z.input<typeof UpdateDeviceNameSchema>;

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

export const BillingEntitlementStatusSchema = z.object({
  responsesEnabled: z.boolean(),
  status: z.enum(['active', 'inactive']).or(z.string()),
  responsesEntitledUntil: z.string().optional()
});
export type BillingEntitlementStatus = z.infer<typeof BillingEntitlementStatusSchema>;

export const BillingStatusSchema = z.object({
  workspaceId: z.string(),
  workspaceType: WorkspaceTypeSchema.optional(),
  plan: z.string(),
  limits: BillingLimitsSchema,
  usage: BillingUsageSchema,
  entitlement: BillingEntitlementStatusSchema.optional()
});
export type BillingStatus = z.infer<typeof BillingStatusSchema>;

export const BillingProductKeySchema = z.enum(['trial_7_day', 'lifetime_unlock', 'hosted_personal_monthly', 'hosted_personal_yearly']);
export type BillingProductKey = z.infer<typeof BillingProductKeySchema>;

export const BillingPlatformSchema = z.enum(['ios', 'android']);
export type BillingPlatform = z.infer<typeof BillingPlatformSchema>;

export const BillingProductSchema = z.object({
  id: z.string().optional(),
  productKey: BillingProductKeySchema,
  kind: z.enum(['non_consumable', 'subscription']).or(z.string()),
  entitlementKey: z.enum(['native_app_trial', 'lifetime_app_unlock', 'hosted_personal']).or(z.string()),
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
  hostedSubscriptionEndsAt: z.string().optional(),
  hostedSubscriptionCanceledAt: z.string().optional(),
  hostedDataDeletedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type PersonalEntitlement = z.infer<typeof PersonalEntitlementSchema>;

export const HostedPersonalStatusSchema = z.object({
  lifecycle: z.enum(['fresh', 'active', 'read_only_grace', 'expired', 'deleted']).or(z.string()),
  trialEndsAt: z.string(),
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

export const BillingIdentityConflictSchema = z.object({
  code: z.literal('receipt_owned_by_another_account'),
  productKey: BillingProductKeySchema,
  entitlementKey: z.enum(['native_app_trial', 'hosted_personal']).or(z.string()),
  platform: z.enum(['ios', 'android', 'unknown']).or(z.string()),
  createdAt: z.string().optional()
});
export type BillingIdentityConflict = z.infer<typeof BillingIdentityConflictSchema>;

export const PersonalBillingStatusSchema = z.object({
  entitlement: PersonalEntitlementSchema,
  hostedPersonal: HostedPersonalStatusSchema,
  products: z.array(BillingProductSchema),
  activeEntitlements: z.object({ trial7Day: BillingActiveEntitlementSchema, lifetimeUnlock: BillingActiveEntitlementSchema, hostedPersonal: BillingActiveEntitlementSchema }),
  purchaseAvailability: z.record(BillingProductKeySchema, BillingPurchaseAvailabilitySchema),
  billingConflicts: z.array(BillingIdentityConflictSchema).default([])
});
export type PersonalBillingStatus = z.infer<typeof PersonalBillingStatusSchema>;

export const PersonalBillingUpdateEventSchema = z.enum([
  'app_purchase',
  'subscribe_monthly',
  'subscribe_yearly',
  'cancel_subscription',
  'delete_account_data'
]);
export type PersonalBillingUpdateEvent = z.infer<typeof PersonalBillingUpdateEventSchema>;

export const PersonalBillingUpdateSchema = z.object({ event: PersonalBillingUpdateEventSchema });
export type PersonalBillingUpdate = z.input<typeof PersonalBillingUpdateSchema>;

export const BillingPurchasePreflightRequestSchema = z.object({ productKey: BillingProductKeySchema, platform: BillingPlatformSchema });
export type BillingPurchasePreflightRequest = z.input<typeof BillingPurchasePreflightRequestSchema>;

export const BillingPurchasePreflightResponseSchema = z.object({
  purchaseAttemptId: z.string().optional(),
  providerUserId: z.string(),
  allowed: z.boolean(),
  reason: z.string().optional()
});
export type BillingPurchasePreflightResponse = z.infer<typeof BillingPurchasePreflightResponseSchema>;

export const BillingPurchaseAttemptCancelRequestSchema = z.object({ purchaseAttemptId: z.string(), productKey: BillingProductKeySchema });
export type BillingPurchaseAttemptCancelRequest = z.input<typeof BillingPurchaseAttemptCancelRequestSchema>;

export const BillingPurchaseAttemptCancelResponseSchema = z.object({ canceled: z.boolean() });
export type BillingPurchaseAttemptCancelResponse = z.infer<typeof BillingPurchaseAttemptCancelResponseSchema>;

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

export const DeleteMeResponseSchema = z.object({
  status: z.literal('deleted'),
  userId: z.string(),
  clerkUserDeleted: z.boolean()
});
export type DeleteMeResponse = z.infer<typeof DeleteMeResponseSchema>;

