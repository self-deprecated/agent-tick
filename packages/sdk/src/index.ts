import type { ZodType } from 'zod';
import {
  AgentCredentialSchema,
  AcceptInviteResponseSchema,
  AgentStatusUpdateSchema,
  AgentTokenRecordSchema,
  ApiErrorEnvelopeSchema,
  ApprovalRequestSchema,
  AuditEventRecordSchema,
  AuthConfigSchema,
  AvailabilityRecordSchema,
  BillingProductsResponseSchema,
  BillingPurchasePreflightRequestSchema,
  BillingPurchasePreflightResponseSchema,
  BillingStatusSchema,
  PersonalBillingStatusSchema,
  CreateAgentTokenSchema,
  CreateAgentStatusUpdateSchema,
  CreateApprovalRequestSchema,
  CreateMobileDiagnosticsSchema,
  CreateMobileSessionSchema,
  CreateApprovalResponseSchema,
  CreateOrganizationInviteSchema,
  CreateOrganizationSchema,
  CreateTeamSchema,
  DeviceCredentialSchema,
  DeviceRecordSchema,
  EventPollResponseSchema,
  EventTicketResponseSchema,
  HealthResponseSchema,
  HeartbeatRequestSchema,
  HeartbeatResponseSchema,
  InvitePreviewSchema,
  MeResponseSchema,
  MobileDiagnosticsResponseSchema,
  MobileSessionResponseSchema,
  OrganizationInviteEmailResultSchema,
  OrganizationInviteRecordSchema,
  OrganizationMembershipRequestRecordSchema,
  OrganizationMembershipSchema,
  OnboardingStatusSchema,
  PairDeviceRequestSchema,
  PairingTokenSchema,
  PolicyRecordSchema,
  ProjectRecordSchema,
  RegisterDeviceResponseSchema,
  RegisterDeviceSchema,
  RespondApprovalRequestSchema,
  CreateProjectSchema,
  SetAvailabilitySchema,
  CreatePolicySchema,
  TeamMembershipSchema,
  TeamRecordSchema,
  UpdateDevicePushTokenSchema,
  UpdatePolicySchema,
  UpsertTeamMemberSchema,
  WaitApprovalResponseSchema,
  type AcceptInviteResponse,
  type AgentCredential,
  type AgentTokenRecord,
  type AgentStatusUpdate,
  type ApiErrorEnvelope,
  type ApprovalRequest,
  type ApprovalWaiterCredential,
  type AuditEventRecord,
  type AuthConfig,
  type AvailabilityRecord,
  type BillingProductsResponse,
  type BillingPurchasePreflightRequest,
  type BillingPurchasePreflightResponse,
  type BillingStatus,
  type PersonalBillingStatus,
  type CreateAgentToken,
  type CreateAgentStatusUpdate,
  type CreateApprovalRequest,
  type CreateApprovalResponse,
  type CreateMobileDiagnostics,
  type CreateMobileSession,
  type CreateOrganization,
  type CreateOrganizationInvite,
  type CreatePolicy,
  type CreateProject,
  type CreateTeam,
  type DeviceCredential,
  type DeviceRecord,
  type EventPollEvent,
  type EventPollResponse,
  type EventTicketResponse,
  type HealthResponse,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type InviteEmailDelivery,
  type InvitePreview,
  type MeResponse,
  type MobileDiagnosticsResponse,
  type MobileSessionResponse,
  type OrganizationInviteEmailResult,
  type OrganizationInviteRecord,
  type OrganizationMembership,
  type OrganizationMembershipRequestRecord,
  type OnboardingStatus,
  type PairDeviceRequest,
  type PairingToken,
  type PolicyRecord,
  type ProjectRecord,
  type RegisterDevice,
  type RegisterDeviceResponse,
  type RespondApprovalRequest,
  type SetAvailability,
  type TeamMembership,
  type TeamRecord,
  type UpdateDevicePushToken,
  type UpdatePolicy,
  type UpsertTeamMember,
  type WaitApprovalResponse
} from '@agent-tick/shared';

export type TokenProvider = () => Promise<string | null | undefined> | string | null | undefined;
export type OrganizationIdProvider = () => Promise<string | null | undefined> | string | null | undefined;
export type EventSourceConstructor = new (url: string | URL, eventSourceInitDict?: EventSourceInit) => EventSource;

export interface AgentTickClientOptions {
  baseUrl: string;
  tokenProvider?: TokenProvider;
  organizationIdProvider?: OrganizationIdProvider;
  fetch?: typeof fetch;
}

export class AgentTickApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly code: string | undefined;
  readonly requestId: string | undefined;

  constructor(message: string, status: number, body: unknown, code?: string, requestId?: string) {
    super(message);
    this.name = 'AgentTickApiError';
    this.status = status;
    this.body = body;
    this.code = code;
    this.requestId = requestId;
  }
}

export class AgentTickClient {
  readonly #baseUrl: string;
  readonly #tokenProvider: TokenProvider | undefined;
  readonly #organizationIdProvider: OrganizationIdProvider | undefined;
  readonly #fetch: typeof fetch;

  constructor(options: AgentTickClientOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#tokenProvider = options.tokenProvider;
    this.#organizationIdProvider = options.organizationIdProvider;
    this.#fetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!this.#fetch) {
      throw new Error('A fetch implementation is required');
    }
  }

  health(): Promise<HealthResponse> {
    return this.#request('GET', '/healthz', HealthResponseSchema);
  }

  getAuthConfig(): Promise<AuthConfig> {
    return this.#request('GET', '/v1/auth/config', AuthConfigSchema);
  }

  getMe(): Promise<MeResponse> {
    return this.#request('GET', '/v1/me', MeResponseSchema);
  }

  createMobileSession(input: CreateMobileSession): Promise<MobileSessionResponse> {
    return this.#request('POST', '/v1/auth/mobile-session', MobileSessionResponseSchema, {
      body: CreateMobileSessionSchema.parse(input),
      includeOrganization: false
    });
  }

  sendMobileDiagnostics(input: CreateMobileDiagnostics): Promise<MobileDiagnosticsResponse> {
    return this.#request('POST', '/v1/mobile-diagnostics', MobileDiagnosticsResponseSchema, {
      body: CreateMobileDiagnosticsSchema.parse(input)
    });
  }

  listAuditEvents(options: { limit?: number } = {}): Promise<AuditEventRecord[]> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    const suffix = params.size ? `?${params.toString()}` : '';
    return this.#request('GET', `/v1/audit-events${suffix}`, AuditEventRecordSchema.array());
  }

  getBillingStatus(): Promise<BillingStatus> {
    return this.#request('GET', '/v1/billing', BillingStatusSchema);
  }

  getBillingProducts(): Promise<BillingProductsResponse> {
    return this.#request('GET', '/v1/billing/products', BillingProductsResponseSchema, { includeOrganization: false });
  }

  getPersonalBillingStatus(): Promise<PersonalBillingStatus> {
    return this.#request('GET', '/v1/billing/personal', PersonalBillingStatusSchema, { includeOrganization: false });
  }

  preflightPurchase(input: BillingPurchasePreflightRequest): Promise<BillingPurchasePreflightResponse> {
    return this.#request('POST', '/v1/billing/purchases/preflight', BillingPurchasePreflightResponseSchema, {
      body: BillingPurchasePreflightRequestSchema.parse(input),
      includeOrganization: false
    });
  }

  activateIncludedHostedMonth(): Promise<PersonalBillingStatus> {
    return this.#request('POST', '/v1/billing/personal', PersonalBillingStatusSchema, {
      body: { event: 'activate_included_hosted_month' },
      includeOrganization: false
    });
  }

  getOnboardingStatus(): Promise<OnboardingStatus> {
    return this.#request('GET', '/v1/onboarding', OnboardingStatusSchema);
  }

  sendHeartbeat(input: HeartbeatRequest = {}): Promise<HeartbeatResponse> {
    return this.#request('POST', '/v1/heartbeat', HeartbeatResponseSchema, {
      body: HeartbeatRequestSchema.parse(input)
    });
  }

  createStatusUpdate(input: CreateAgentStatusUpdate): Promise<AgentStatusUpdate> {
    return this.#request('POST', '/v1/status-updates', AgentStatusUpdateSchema, {
      body: CreateAgentStatusUpdateSchema.parse(input)
    });
  }

  listStatusUpdates(options: { limit?: number } = {}): Promise<AgentStatusUpdate[]> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    const suffix = params.size ? `?${params.toString()}` : '';
    return this.#request('GET', `/v1/status-updates${suffix}`, AgentStatusUpdateSchema.array());
  }

  setAvailability(input: SetAvailability): Promise<AvailabilityRecord> {
    return this.#request('POST', '/v1/availability', AvailabilityRecordSchema, {
      body: SetAvailabilitySchema.parse(input)
    });
  }

  createApprovalRequest(input: CreateApprovalRequest): Promise<CreateApprovalResponse> {
    return this.#request('POST', '/v1/approval-requests', CreateApprovalResponseSchema, {
      body: CreateApprovalRequestSchema.parse(input)
    });
  }

  listApprovalRequests(): Promise<ApprovalRequest[]> {
    return this.#request('GET', '/v1/approval-requests', ApprovalRequestSchema.array());
  }

  respondToApproval(id: string, input: RespondApprovalRequest): Promise<ApprovalRequest> {
    return this.#request('POST', `/v1/approval-requests/${encodeURIComponent(id)}/responses`, ApprovalRequestSchema, {
      body: RespondApprovalRequestSchema.parse(input)
    });
  }

  abandonApproval(id: string): Promise<ApprovalRequest> {
    return this.#request('POST', `/v1/approval-requests/${encodeURIComponent(id)}/abandon`, ApprovalRequestSchema, { body: {} });
  }

  waitForApproval(id: string, options: { timeoutMs?: number } = {}): Promise<WaitApprovalResponse> {
    const params = new URLSearchParams();
    if (options.timeoutMs !== undefined) params.set('timeoutMs', String(options.timeoutMs));
    const suffix = params.size ? `?${params.toString()}` : '';
    return this.#request('GET', `/v1/approval-requests/${encodeURIComponent(id)}/wait${suffix}`, WaitApprovalResponseSchema);
  }

  listAgentTokens(): Promise<AgentTokenRecord[]> {
    return this.#request('GET', '/v1/agent-tokens', AgentTokenRecordSchema.array());
  }

  createAgentToken(input: CreateAgentToken): Promise<AgentCredential> {
    return this.#request('POST', '/v1/agent-tokens', AgentCredentialSchema, {
      body: CreateAgentTokenSchema.parse(input)
    });
  }

  revokeAgentToken(agentId: string): Promise<AgentTokenRecord> {
    return this.#request('POST', `/v1/agent-tokens/${encodeURIComponent(agentId)}/revoke`, AgentTokenRecordSchema, { body: {} });
  }

  listOrganizations(): Promise<OrganizationMembership[]> {
    return this.#request('GET', '/v1/organizations', OrganizationMembershipSchema.array());
  }

  createOrganization(input: CreateOrganization): Promise<OrganizationMembership> {
    return this.#request('POST', '/v1/organizations', OrganizationMembershipSchema, {
      body: CreateOrganizationSchema.parse(input)
    });
  }

  listOrganizationInvites(): Promise<OrganizationInviteRecord[]> {
    return this.#request('GET', '/v1/organization-invites', OrganizationInviteRecordSchema.array());
  }

  createOrganizationInvite(input: CreateOrganizationInvite): Promise<OrganizationInviteRecord> {
    return this.#request('POST', '/v1/organization-invites', OrganizationInviteRecordSchema, {
      body: CreateOrganizationInviteSchema.parse(input)
    });
  }

  revokeOrganizationInvite(inviteId: string): Promise<OrganizationInviteRecord> {
    return this.#request('POST', `/v1/organization-invites/${encodeURIComponent(inviteId)}/revoke`, OrganizationInviteRecordSchema, { body: {} });
  }

  resendOrganizationInvite(inviteId: string): Promise<OrganizationInviteEmailResult> {
    return this.#request('POST', `/v1/organization-invites/${encodeURIComponent(inviteId)}/resend`, OrganizationInviteEmailResultSchema, { body: {} });
  }

  listMyMembershipRequests(): Promise<OrganizationMembershipRequestRecord[]> {
    return this.#request('GET', '/v1/me/organization-membership-requests', OrganizationMembershipRequestRecordSchema.array(), { includeOrganization: false });
  }

  listMembershipRequests(): Promise<OrganizationMembershipRequestRecord[]> {
    return this.#request('GET', '/v1/organization-membership-requests', OrganizationMembershipRequestRecordSchema.array());
  }

  approveMembershipRequest(requestId: string): Promise<OrganizationMembershipRequestRecord> {
    return this.#request('POST', `/v1/organization-membership-requests/${encodeURIComponent(requestId)}/approve`, OrganizationMembershipRequestRecordSchema, { body: {} });
  }

  rejectMembershipRequest(requestId: string): Promise<OrganizationMembershipRequestRecord> {
    return this.#request('POST', `/v1/organization-membership-requests/${encodeURIComponent(requestId)}/reject`, OrganizationMembershipRequestRecordSchema, { body: {} });
  }

  previewInvite(token: string): Promise<InvitePreview> {
    return this.#request('GET', `/v1/invites/${encodeURIComponent(token)}`, InvitePreviewSchema, { includeOrganization: false });
  }

  acceptInvite(token: string): Promise<AcceptInviteResponse> {
    return this.#request('POST', `/v1/invites/${encodeURIComponent(token)}/accept`, AcceptInviteResponseSchema, { body: {}, includeOrganization: false });
  }

  listOrganizationMembers(organizationId: string): Promise<OrganizationMembership[]> {
    return this.#request('GET', `/v1/organizations/${encodeURIComponent(organizationId)}/members`, OrganizationMembershipSchema.array());
  }

  listProjects(): Promise<ProjectRecord[]> {
    return this.#request('GET', '/v1/projects', ProjectRecordSchema.array());
  }

  createProject(input: CreateProject): Promise<ProjectRecord> {
    return this.#request('POST', '/v1/projects', ProjectRecordSchema, {
      body: CreateProjectSchema.parse(input)
    });
  }

  listTeams(): Promise<TeamRecord[]> {
    return this.#request('GET', '/v1/teams', TeamRecordSchema.array());
  }

  createTeam(input: CreateTeam): Promise<TeamMembership> {
    return this.#request('POST', '/v1/teams', TeamMembershipSchema, {
      body: CreateTeamSchema.parse(input)
    });
  }

  listTeamMembers(teamId: string): Promise<TeamMembership[]> {
    return this.#request('GET', `/v1/teams/${encodeURIComponent(teamId)}/members`, TeamMembershipSchema.array());
  }

  upsertTeamMember(teamId: string, input: UpsertTeamMember): Promise<TeamMembership> {
    return this.#request('POST', `/v1/teams/${encodeURIComponent(teamId)}/members`, TeamMembershipSchema, {
      body: UpsertTeamMemberSchema.parse(input)
    });
  }

  removeTeamMember(teamId: string, userId: string): Promise<TeamMembership> {
    return this.#request('DELETE', `/v1/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`, TeamMembershipSchema);
  }

  listPolicies(): Promise<PolicyRecord[]> {
    return this.#request('GET', '/v1/policies', PolicyRecordSchema.array());
  }

  createPolicy(input: CreatePolicy): Promise<PolicyRecord> {
    return this.#request('POST', '/v1/policies', PolicyRecordSchema, {
      body: CreatePolicySchema.parse(input)
    });
  }

  updatePolicy(policyId: string, input: UpdatePolicy): Promise<PolicyRecord> {
    return this.#request('PATCH', `/v1/policies/${encodeURIComponent(policyId)}`, PolicyRecordSchema, {
      body: UpdatePolicySchema.parse(input)
    });
  }

  createEventTicket(): Promise<EventTicketResponse> {
    return this.#request('POST', '/v1/events/ticket', EventTicketResponseSchema, { body: {} });
  }

  pollEvents(options: { lastEventId?: number; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<EventPollResponse> {
    const params = new URLSearchParams();
    if (options.lastEventId !== undefined) params.set('lastEventId', String(Math.max(Math.trunc(options.lastEventId), 0)));
    if (options.timeoutMs !== undefined) params.set('timeoutMs', String(Math.max(Math.trunc(options.timeoutMs), 0)));
    const suffix = params.size ? `?${params.toString()}` : '';
    return this.#request('GET', `/v1/events/poll${suffix}`, EventPollResponseSchema, options.signal ? { signal: options.signal } : {});
  }

  async createEventStreamURL(options: { lastEventId?: number } = {}): Promise<string> {
    const ticket = await this.createEventTicket();
    const url = new URL('/v1/events', this.#baseUrl);
    url.searchParams.set('ticket', ticket.ticket);
    if (options.lastEventId !== undefined) url.searchParams.set('lastEventId', String(Math.max(Math.trunc(options.lastEventId), 0)));
    return url.toString();
  }

  async openEventStream(options: { lastEventId?: number; EventSource?: EventSourceConstructor } = {}): Promise<EventSource> {
    const EventSourceCtor = options.EventSource ?? globalThis.EventSource;
    if (!EventSourceCtor) throw new Error('EventSource is not available in this runtime');
    const url = await this.createEventStreamURL(options.lastEventId === undefined ? {} : { lastEventId: options.lastEventId });
    return new EventSourceCtor(url);
  }

  createPairingToken(): Promise<PairingToken> {
    return this.#request('POST', '/v1/pairing-tokens', PairingTokenSchema, { body: {} });
  }

  pairDevice(input: PairDeviceRequest): Promise<DeviceCredential> {
    return this.#request('POST', '/v1/devices/pair', DeviceCredentialSchema, {
      body: PairDeviceRequestSchema.parse(input)
    });
  }

  listDevices(): Promise<DeviceRecord[]> {
    return this.#request('GET', '/v1/devices', DeviceRecordSchema.array());
  }

  registerDevice(input: RegisterDevice): Promise<RegisterDeviceResponse> {
    return this.#request('POST', '/v1/devices/register', RegisterDeviceResponseSchema, {
      body: RegisterDeviceSchema.parse(input)
    });
  }

  updateDevicePushToken(id: string, input: UpdateDevicePushToken): Promise<DeviceRecord> {
    return this.#request('POST', `/v1/devices/${encodeURIComponent(id)}/push-token`, DeviceRecordSchema, {
      body: UpdateDevicePushTokenSchema.parse(input)
    });
  }

  unregisterDevice(id: string): Promise<DeviceRecord> {
    return this.#request('POST', `/v1/devices/${encodeURIComponent(id)}/unregister`, DeviceRecordSchema, { body: {} });
  }

  async #request<T>(method: string, path: string, schema: ZodType<T>, options: { body?: unknown; includeOrganization?: boolean; signal?: AbortSignal } = {}): Promise<T> {
    const headers = new Headers();
    headers.set('Accept', 'application/json');

    const token = (await this.#tokenProvider?.())?.trim();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const organizationId = options.includeOrganization === false ? '' : (await this.#organizationIdProvider?.())?.trim();
    if (organizationId) headers.set('X-Agent-Tick-Organization-ID', organizationId);

    const init: RequestInit = { method, headers };
    if (options.signal) init.signal = options.signal;
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(options.body);
    }

    const response = await this.#fetch(new URL(path, this.#baseUrl), init);
    const body = await readResponseBody(response);
    if (!response.ok) {
      const envelope = ApiErrorEnvelopeSchema.safeParse(body);
      const error = envelope.success ? envelope.data.error : undefined;
      throw new AgentTickApiError(
        error?.message ?? (response.statusText || 'Request failed'),
        response.status,
        body,
        error?.code,
        error?.requestId
      );
    }
    return schema.parse(body);
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) throw new Error('baseUrl is required');
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

export type {
  AcceptInviteResponse,
  AgentCredential,
  AgentTokenRecord,
  AgentStatusUpdate,
  ApiErrorEnvelope,
  ApprovalRequest,
  ApprovalWaiterCredential,
  AuditEventRecord,
  AuthConfig,
  AvailabilityRecord,
  BillingProductsResponse,
  BillingPurchasePreflightRequest,
  BillingPurchasePreflightResponse,
  BillingStatus,
  PersonalBillingStatus,
  CreateAgentToken,
  CreateAgentStatusUpdate,
  CreateApprovalRequest,
  CreateApprovalResponse,
  CreateMobileDiagnostics,
  CreateMobileSession,
  CreateOrganization,
  CreateOrganizationInvite,
  CreatePolicy,
  CreateProject,
  CreateTeam,
  DeviceCredential,
  DeviceRecord,
  EventPollEvent,
  EventPollResponse,
  EventTicketResponse,
  HealthResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  InviteEmailDelivery,
  InvitePreview,
  MeResponse,
  MobileDiagnosticsResponse,
  MobileSessionResponse,
  OrganizationInviteEmailResult,
  OrganizationInviteRecord,
  OrganizationMembership,
  OrganizationMembershipRequestRecord,
  OnboardingStatus,
  PairDeviceRequest,
  PairingToken,
  PolicyRecord,
  ProjectRecord,
  RegisterDevice,
  RegisterDeviceResponse,
  RespondApprovalRequest,
  SetAvailability,
  TeamMembership,
  TeamRecord,
  UpdateDevicePushToken,
  UpdatePolicy,
  UpsertTeamMember,
  WaitApprovalResponse
};
