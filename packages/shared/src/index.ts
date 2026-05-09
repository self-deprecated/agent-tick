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

export const OrganizationRoleSchema = z.enum(['owner', 'admin', 'approver', 'member', 'viewer']);
export type OrganizationRole = z.infer<typeof OrganizationRoleSchema>;

export const OrganizationRecordSchema = z.object({
  organizationId: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().optional()
});
export type OrganizationRecord = z.infer<typeof OrganizationRecordSchema>;

export const OrganizationMembershipStatusSchema = z.enum(['active', 'pending_approval', 'rejected', 'removed']).or(z.string().min(1));
export type OrganizationMembershipStatus = z.infer<typeof OrganizationMembershipStatusSchema>;

export const OrganizationMembershipSchema = OrganizationRecordSchema.extend({
  userId: z.string(),
  role: OrganizationRoleSchema.or(z.string()),
  status: OrganizationMembershipStatusSchema.default('active')
});
export type OrganizationMembership = z.infer<typeof OrganizationMembershipSchema>;

export const CreateOrganizationSchema = z.object({
  name: z.string().min(1)
});
export type CreateOrganization = z.input<typeof CreateOrganizationSchema>;

export const InviteEmailDeliveryStatusSchema = z.enum(['sent', 'skipped', 'failed']);
export type InviteEmailDeliveryStatus = z.infer<typeof InviteEmailDeliveryStatusSchema>;

export const InviteEmailDeliverySchema = z.object({
  status: InviteEmailDeliveryStatusSchema,
  recipient: z.string().email().optional(),
  sentAt: z.string().optional(),
  message: z.string().optional()
});
export type InviteEmailDelivery = z.infer<typeof InviteEmailDeliverySchema>;

export const OrganizationInviteRecordSchema = z.object({
  inviteId: z.string(),
  organizationId: z.string(),
  label: z.string().optional(),
  role: OrganizationRoleSchema.or(z.string()),
  approvalRequired: z.boolean().default(true),
  teamIds: z.array(z.string()).optional(),
  email: z.string().email().optional(),
  domain: z.string().min(1).optional(),
  expiresAt: z.string().optional(),
  maxUses: z.number().int().positive().optional(),
  usedCount: z.number().int().min(0),
  emailLastStatus: InviteEmailDeliveryStatusSchema.or(z.string()).optional(),
  emailLastSentAt: z.string().optional(),
  emailLastError: z.string().optional(),
  emailDelivery: InviteEmailDeliverySchema.optional(),
  revokedAt: z.string().optional(),
  createdAt: z.string(),
  url: z.string().optional(),
  token: z.string().optional()
});
export type OrganizationInviteRecord = z.infer<typeof OrganizationInviteRecordSchema>;

export const OrganizationInviteEmailResultSchema = z.object({
  invite: OrganizationInviteRecordSchema,
  delivery: InviteEmailDeliverySchema
});
export type OrganizationInviteEmailResult = z.infer<typeof OrganizationInviteEmailResultSchema>;

export const CreateOrganizationInviteSchema = z.object({
  label: z.string().optional(),
  role: OrganizationRoleSchema.default('member'),
  approvalRequired: z.boolean().default(true),
  teamIds: z.array(z.string()).optional(),
  email: z.string().email().optional(),
  domain: z.string().min(1).optional(),
  expiresAt: z.string().optional(),
  maxUses: z.number().int().positive().max(100).default(1)
});
export type CreateOrganizationInvite = z.input<typeof CreateOrganizationInviteSchema>;

export const InvitePreviewSchema = z.object({
  organizationName: z.string(),
  role: OrganizationRoleSchema.or(z.string()),
  approvalRequired: z.boolean().default(true),
  expiresAt: z.string().optional()
});
export type InvitePreview = z.infer<typeof InvitePreviewSchema>;

export const AcceptInviteResponseSchema = z.object({
  status: z.enum(['joined', 'already_member', 'pending_approval']),
  membership: OrganizationMembershipSchema
});
export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponseSchema>;

export const OrganizationMembershipRequestRecordSchema = z.object({
  requestId: z.string(),
  inviteId: z.string(),
  organizationId: z.string(),
  organizationName: z.string().optional(),
  userId: z.string(),
  userEmail: z.string().email().optional(),
  userName: z.string().optional(),
  inviteLabel: z.string().optional(),
  inviteRevokedAt: z.string().optional(),
  requestedRole: OrganizationRoleSchema.or(z.string()),
  requestedTeamIds: z.array(z.string()).optional(),
  status: z.enum(['pending_approval', 'approved', 'rejected']).or(z.string()),
  acceptedAt: z.string(),
  decidedByUserId: z.string().optional(),
  decidedAt: z.string().optional()
});
export type OrganizationMembershipRequestRecord = z.infer<typeof OrganizationMembershipRequestRecordSchema>;

export const BillingLimitsSchema = z.object({
  seats: z.number().int().positive().optional()
});
export type BillingLimits = z.infer<typeof BillingLimitsSchema>;

export const BillingUsageSchema = z.object({
  activeMembers: z.number().int().min(0),
  pendingMembers: z.number().int().min(0)
});
export type BillingUsage = z.infer<typeof BillingUsageSchema>;

export const BillingStatusSchema = z.object({
  organizationId: z.string(),
  plan: z.string(),
  limits: BillingLimitsSchema,
  usage: BillingUsageSchema
});
export type BillingStatus = z.infer<typeof BillingStatusSchema>;

export const ProjectRecordSchema = z.object({
  projectId: z.string(),
  organizationId: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().optional()
});
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;

export const CreateProjectSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  description: z.string().optional()
});
export type CreateProject = z.input<typeof CreateProjectSchema>;

export const TeamRoleSchema = z.enum(['owner', 'lead', 'member', 'viewer']);
export type TeamRole = z.infer<typeof TeamRoleSchema>;

export const TeamRecordSchema = z.object({
  teamId: z.string(),
  organizationId: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().optional()
});
export type TeamRecord = z.infer<typeof TeamRecordSchema>;

export const TeamMembershipSchema = TeamRecordSchema.extend({
  userId: z.string(),
  role: TeamRoleSchema.or(z.string())
});
export type TeamMembership = z.infer<typeof TeamMembershipSchema>;

export const UpsertTeamMemberSchema = z.object({
  userId: z.string().min(1),
  role: TeamRoleSchema.default('member')
});
export type UpsertTeamMember = z.input<typeof UpsertTeamMemberSchema>;

export const CreateTeamSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  description: z.string().optional()
});
export type CreateTeam = z.input<typeof CreateTeamSchema>;

export const PolicyRecordSchema = z.object({
  policyId: z.string(),
  organizationId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  projectId: z.string().optional(),
  teamId: z.string().optional(),
  requiredApprovals: z.number().int().min(1),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().optional()
});
export type PolicyRecord = z.infer<typeof PolicyRecordSchema>;

export const CreatePolicySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  projectId: z.string().optional(),
  teamId: z.string().optional(),
  requiredApprovals: z.number().int().min(1).max(10).default(1)
});
export type CreatePolicy = z.input<typeof CreatePolicySchema>;

export const MeResponseSchema = z.object({
  userId: z.string(),
  email: z.string().email().optional(),
  name: z.string().optional(),
  authProvider: AuthProviderSchema,
  source: z.string(),
  organizationId: z.string().optional(),
  role: OrganizationRoleSchema.or(z.string()).optional(),
  memberships: z.array(OrganizationMembershipSchema).optional()
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const AuditEventRecordSchema = z.object({
  eventId: z.number(),
  organizationId: z.string(),
  userId: z.string(),
  eventType: z.string(),
  targetId: z.string(),
  payload: z.unknown(),
  createdAt: z.string()
});
export type AuditEventRecord = z.infer<typeof AuditEventRecordSchema>;

export const RequesterSchema = z.object({
  name: z.string().min(1),
  agentId: z.string().min(1),
  host: z.string().optional(),
  workingDirectory: z.string().optional(),
  projectName: z.string().optional(),
  projectId: z.string().optional()
});
export type Requester = z.infer<typeof RequesterSchema>;

export const ChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.string().default('approve')
});
export type Choice = z.infer<typeof ChoiceSchema>;

export const ResponsePayloadSchema = z.object({
  choiceId: z.string().optional(),
  message: z.string().optional(),
  answers: z.record(z.string(), z.array(z.string())).optional()
});
export type ResponsePayload = z.infer<typeof ResponsePayloadSchema>;

export const ApprovalStatusSchema = z.enum(['pending', 'responded', 'expired', 'abandoned']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalVoteRecordSchema = z.object({
  voteId: z.string(),
  requestId: z.string(),
  policyId: z.string().optional(),
  step: z.number().int().min(1),
  approverUserId: z.string(),
  source: z.string(),
  choiceId: z.string(),
  message: z.string().optional(),
  answers: z.record(z.string(), z.array(z.string())).optional(),
  createdAt: z.string()
});
export type ApprovalVoteRecord = z.infer<typeof ApprovalVoteRecordSchema>;

export const ApprovalPolicyProgressSchema = z.object({
  policyId: z.string().optional(),
  state: z.string(),
  currentStep: z.number().int().min(1),
  totalSteps: z.number().int().min(1),
  requiredApprovals: z.number().int().min(1),
  receivedApprovals: z.number().int().min(0),
  currentUserHasVoted: z.boolean(),
  currentUserEligible: z.boolean().optional(),
  currentUserVote: ApprovalVoteRecordSchema.optional(),
  waitingFor: z.number().int().min(0),
  eligibleApproverIds: z.array(z.string()).optional(),
  votes: z.array(ApprovalVoteRecordSchema).optional()
});
export type ApprovalPolicyProgress = z.infer<typeof ApprovalPolicyProgressSchema>;

export const ApprovalRequestSchema = z.object({
  id: z.string(),
  organizationId: z.string().optional(),
  userId: z.string().optional(),
  requester: RequesterSchema,
  requestType: z.string().default('approval'),
  title: z.string(),
  body: z.string().optional(),
  command: z.string().optional(),
  choices: z.array(ChoiceSchema),
  defaultChoice: z.string().optional(),
  allowFreeformReply: z.boolean().default(false),
  expiresAt: z.string().optional(),
  risk: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  status: ApprovalStatusSchema.or(z.string()),
  createdAt: z.string(),
  respondedAt: z.string().optional(),
  response: ResponsePayloadSchema.optional(),
  policyProgress: ApprovalPolicyProgressSchema.optional()
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const CreateApprovalRequestSchema = z.object({
  requester: RequesterSchema.partial({ agentId: true }).extend({
    name: z.string().min(1),
    agentId: z.string().min(1).optional()
  }),
  requestType: z.string().default('approval'),
  title: z.string().min(1),
  body: z.string().optional(),
  command: z.string().optional(),
  choices: z.array(ChoiceSchema).optional(),
  defaultChoice: z.string().optional(),
  allowFreeformReply: z.boolean().optional(),
  expiresAt: z.string().optional(),
  risk: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional()
});
export type CreateApprovalRequest = z.input<typeof CreateApprovalRequestSchema>;

export const ApprovalWaiterCredentialSchema = z.object({
  token: z.string(),
  expiresAt: z.string()
});
export type ApprovalWaiterCredential = z.infer<typeof ApprovalWaiterCredentialSchema>;

export const CreateApprovalResponseSchema = z.object({
  request: ApprovalRequestSchema,
  waiter: ApprovalWaiterCredentialSchema.optional()
});
export type CreateApprovalResponse = z.infer<typeof CreateApprovalResponseSchema>;

export const RespondApprovalRequestSchema = z.object({
  choiceId: z.string().optional(),
  message: z.string().optional(),
  answers: z.record(z.string(), z.array(z.string())).optional()
}).refine((value) => Boolean(value.choiceId || value.message || value.answers), {
  message: 'response must include a choiceId, message, or answers'
});
export type RespondApprovalRequest = z.input<typeof RespondApprovalRequestSchema>;

export const WaitApprovalResponseSchema = z.object({
  request: ApprovalRequestSchema,
  terminal: z.boolean()
});
export type WaitApprovalResponse = z.infer<typeof WaitApprovalResponseSchema>;

export const CreateAgentTokenSchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  projectId: z.string().optional(),
  teamId: z.string().optional(),
  defaultApprovalPolicy: z.string().optional()
});
export type CreateAgentToken = z.input<typeof CreateAgentTokenSchema>;

export const AgentTokenRecordSchema = z.object({
  agentId: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
  organizationId: z.string(),
  ownerUserId: z.string().optional(),
  projectId: z.string().optional(),
  teamId: z.string().optional(),
  defaultApprovalPolicy: z.string().optional(),
  lastRequestAt: z.string().optional(),
  createdAt: z.string(),
  revokedAt: z.string().optional()
});
export type AgentTokenRecord = z.infer<typeof AgentTokenRecordSchema>;

export const AgentCredentialSchema = AgentTokenRecordSchema.extend({
  token: z.string()
});
export type AgentCredential = z.infer<typeof AgentCredentialSchema>;

export const AbandonApprovalResponseSchema = ApprovalRequestSchema;
export type AbandonApprovalResponse = z.infer<typeof AbandonApprovalResponseSchema>;

export const PairingTokenSchema = z.object({
  token: z.string(),
  expiresAt: z.string()
});
export type PairingToken = z.infer<typeof PairingTokenSchema>;

export const PairDeviceRequestSchema = z.object({
  token: z.string().min(1),
  deviceName: z.string().min(1),
  platform: z.string().optional()
});
export type PairDeviceRequest = z.input<typeof PairDeviceRequestSchema>;

export const DeviceCredentialSchema = z.object({
  deviceId: z.string(),
  token: z.string()
});
export type DeviceCredential = z.infer<typeof DeviceCredentialSchema>;

export const RegisterDeviceSchema = z.object({
  deviceName: z.string().min(1),
  platform: z.string().optional(),
  installationId: z.string().optional(),
  expoPushToken: z.string().optional()
});
export type RegisterDevice = z.input<typeof RegisterDeviceSchema>;

export const RegisterDeviceResponseSchema = z.object({
  deviceId: z.string()
});
export type RegisterDeviceResponse = z.infer<typeof RegisterDeviceResponseSchema>;

export const DeviceRecordSchema = z.object({
  deviceId: z.string(),
  userId: z.string(),
  organizationId: z.string(),
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
}).refine((value) => Boolean(value.expoPushToken || value.token), { message: 'expoPushToken is required' });
export type UpdateDevicePushToken = z.input<typeof UpdateDevicePushTokenSchema>;

export const EventTicketResponseSchema = z.object({
  ticket: z.string(),
  expiresAt: z.string()
});
export type EventTicketResponse = z.infer<typeof EventTicketResponseSchema>;

export const HeartbeatRequestSchema = z.record(z.string(), z.unknown()).default({});
export type HeartbeatRequest = z.input<typeof HeartbeatRequestSchema>;

export const HeartbeatResponseSchema = z.object({
  status: z.literal('ok'),
  userId: z.string().optional(),
  organizationId: z.string().optional(),
  state: z.string().optional(),
  lastSeenAt: z.string().optional(),
  updatedAt: z.string().optional()
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

export const AvailabilityStateSchema = z.enum(['available', 'busy', 'do-not-disturb', 'off-call']).or(z.string().min(1));
export type AvailabilityState = z.infer<typeof AvailabilityStateSchema>;

export const SetAvailabilitySchema = z.object({
  state: AvailabilityStateSchema
});
export type SetAvailability = z.input<typeof SetAvailabilitySchema>;

export const AvailabilityRecordSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
  state: z.string(),
  lastSeenAt: z.string().optional(),
  updatedAt: z.string()
});
export type AvailabilityRecord = z.infer<typeof AvailabilityRecordSchema>;

export const OnboardingStageSchema = z.enum(['needs_agent_token', 'needs_cli_setup', 'needs_mobile_app', 'ready_for_first_request']);
export type OnboardingStage = z.infer<typeof OnboardingStageSchema>;

export const OnboardingStatusSchema = z.object({
  stage: OnboardingStageSchema,
  hasAgentToken: z.boolean(),
  hasCliHeartbeat: z.boolean(),
  hasMobileDevice: z.boolean(),
  canUseWebApprovals: z.boolean(),
  activeAgentTokenCount: z.number().int().min(0),
  connectedAgentCount: z.number().int().min(0),
  activeMobileDeviceCount: z.number().int().min(0)
});
export type OnboardingStatus = z.infer<typeof OnboardingStatusSchema>;
