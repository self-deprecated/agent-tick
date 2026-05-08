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
  clerkPublishableKey: z.string().optional()
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

export const OrganizationMembershipSchema = OrganizationRecordSchema.extend({
  userId: z.string(),
  role: OrganizationRoleSchema.or(z.string())
});
export type OrganizationMembership = z.infer<typeof OrganizationMembershipSchema>;

export const CreateOrganizationSchema = z.object({
  name: z.string().min(1)
});
export type CreateOrganization = z.input<typeof CreateOrganizationSchema>;

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

export const ApprovalRequestSchema = z.object({
  id: z.string(),
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
  response: ResponsePayloadSchema.optional()
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
  scopes: z.array(z.string()).optional()
});
export type CreateAgentToken = z.input<typeof CreateAgentTokenSchema>;

export const AgentTokenRecordSchema = z.object({
  agentId: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
  organizationId: z.string(),
  ownerUserId: z.string().optional(),
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

export const EventTicketResponseSchema = z.object({
  ticket: z.string(),
  expiresAt: z.string()
});
export type EventTicketResponse = z.infer<typeof EventTicketResponseSchema>;
