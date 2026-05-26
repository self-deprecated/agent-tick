import type { ZodType } from 'zod';
import {
  ActivityItemSchema,
  AddWorkspaceMemberSchema,
  AgentCredentialSchema,
  AgentTokenRecordSchema,
  ApiErrorEnvelopeSchema,
  AuditEventRecordSchema,
  AuthConfigSchema,
  AvailabilityRecordSchema,
  BillingProductsResponseSchema,
  BillingPurchasePreflightRequestSchema,
  BillingPurchasePreflightResponseSchema,
  BillingStatusSchema,
  CreateAgentTokenSchema,
  CreateMobileDiagnosticsSchema,
  CreateMobileSessionSchema,
  CreateRequestResponseSchema,
  CreateRequestSchema,
  CreateRoutingRuleSchema,
  CreateSharedWorkspaceSchema,
  CreateStatusUpdateSchema,
  DeleteRoutingRuleResponseSchema,
  DeviceCredentialSchema,
  DeviceRecordSchema,
  EventPollResponseSchema,
  EventTicketResponseSchema,
  HealthResponseSchema,
  HeartbeatRequestSchema,
  HeartbeatResponseSchema,
  MeResponseSchema,
  MobileDiagnosticsResponseSchema,
  MobileSessionResponseSchema,
  OnboardingStatusSchema,
  PairDeviceRequestSchema,
  PairingTokenSchema,
  PendingActivityCountSchema,
  PersonalBillingStatusSchema,
  PersonalBillingUpdateSchema,
  RegisterDeviceResponseSchema,
  RegisterDeviceSchema,
  ReadyResponseSchema,
  RequestRecordSchema,
  RespondRequestSchema,
  RoutingRuleRecordSchema,
  SendTestActivityResponseSchema,
  SendTestActivitySchema,
  SetAvailabilitySchema,
  StatusUpdateRecordSchema,
  UpdateAgentTokenSchema,
  UpdateDeviceNameSchema,
  UpdateDevicePushTokenSchema,
  UpdateRoutingRuleSchema,
  UpdateWorkspaceSchema,
  WaitRequestResponseSchema,
  WorkspaceMemberRecordSchema,
  WorkspaceRecordSchema,
  type ActivityItem,
  type AddWorkspaceMember,
  type AgentCredential,
  type AgentTokenRecord,
  type ApiErrorEnvelope,
  type AuditEventRecord,
  type AuthConfig,
  type AvailabilityRecord,
  type BillingProductsResponse,
  type BillingPurchasePreflightRequest,
  type BillingPurchasePreflightResponse,
  type BillingStatus,
  type CreateAgentToken,
  type CreateMobileDiagnostics,
  type CreateMobileSession,
  type CreateRequest,
  type CreateRequestResponse,
  type CreateRoutingRule,
  type CreateSharedWorkspace,
  type CreateStatusUpdate,
  type DeleteRoutingRuleResponse,
  type DeviceCredential,
  type DeviceRecord,
  type EventPollEvent,
  type EventPollResponse,
  type EventTicketResponse,
  type HealthResponse,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type MeResponse,
  type MobileDiagnosticsResponse,
  type MobileSessionResponse,
  type OnboardingStatus,
  type PairDeviceRequest,
  type PairingToken,
  type PendingActivityCount,
  type PersonalBillingStatus,
  type PersonalBillingUpdate,
  type RegisterDevice,
  type RegisterDeviceResponse,
  type ReadyResponse,
  type RequestRecord,
  type RespondRequest,
  type RoutingRuleRecord,
  type SendTestActivity,
  type SendTestActivityResponse,
  type SetAvailability,
  type StatusUpdateRecord,
  type UpdateAgentToken,
  type UpdateDeviceName,
  type UpdateDevicePushToken,
  type UpdateRoutingRule,
  type UpdateWorkspace,
  type WaitRequestResponse,
  type WorkspaceMemberRecord,
  type WorkspaceRecord
} from '@agent-tick/shared';

export type TokenProvider = () => Promise<string | null | undefined> | string | null | undefined;
export type WorkspaceIdProvider = () => Promise<string | null | undefined> | string | null | undefined;
export type EventSourceConstructor = new (url: string | URL, eventSourceInitDict?: EventSourceInit) => EventSource;

export interface AgentTickClientOptions {
  baseUrl: string;
  tokenProvider?: TokenProvider;
  workspaceIdProvider?: WorkspaceIdProvider;
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
  readonly #workspaceIdProvider: WorkspaceIdProvider | undefined;
  readonly #fetch: typeof fetch;

  constructor(options: AgentTickClientOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#tokenProvider = options.tokenProvider;
    this.#workspaceIdProvider = options.workspaceIdProvider;
    this.#fetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!this.#fetch) throw new Error('A fetch implementation is required');
  }

  health(): Promise<HealthResponse> { return this.#request('GET', '/healthz', HealthResponseSchema); }
  ready(): Promise<ReadyResponse> { return this.#request('GET', '/readyz', ReadyResponseSchema); }
  getAuthConfig(): Promise<AuthConfig> { return this.#request('GET', '/v1/auth/config', AuthConfigSchema); }
  getMe(): Promise<MeResponse> { return this.#request('GET', '/v1/me', MeResponseSchema); }

  createMobileSession(input: CreateMobileSession): Promise<MobileSessionResponse> {
    return this.#request('POST', '/v1/auth/mobile-session', MobileSessionResponseSchema, { body: CreateMobileSessionSchema.parse(input), includeWorkspace: false });
  }

  sendMobileDiagnostics(input: CreateMobileDiagnostics): Promise<MobileDiagnosticsResponse> {
    return this.#request('POST', '/v1/mobile-diagnostics', MobileDiagnosticsResponseSchema, { body: CreateMobileDiagnosticsSchema.parse(input) });
  }

  listAuditEvents(options: { limit?: number } = {}): Promise<AuditEventRecord[]> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    return this.#request('GET', `/v1/audit-events${querySuffix(params)}`, AuditEventRecordSchema.array());
  }

  getBillingStatus(): Promise<BillingStatus> { return this.#request('GET', '/v1/billing', BillingStatusSchema); }
  getBillingProducts(): Promise<BillingProductsResponse> { return this.#request('GET', '/v1/billing/products', BillingProductsResponseSchema, { includeWorkspace: false }); }
  getPersonalBillingStatus(): Promise<PersonalBillingStatus> { return this.#request('GET', '/v1/billing/personal', PersonalBillingStatusSchema, { includeWorkspace: false }); }
  updatePersonalBilling(input: PersonalBillingUpdate): Promise<PersonalBillingStatus> {
    return this.#request('POST', '/v1/billing/personal', PersonalBillingStatusSchema, { body: PersonalBillingUpdateSchema.parse(input), includeWorkspace: false });
  }
  preflightPurchase(input: BillingPurchasePreflightRequest): Promise<BillingPurchasePreflightResponse> {
    return this.#request('POST', '/v1/billing/purchases/preflight', BillingPurchasePreflightResponseSchema, { body: BillingPurchasePreflightRequestSchema.parse(input), includeWorkspace: false });
  }
  activateIncludedHostedMonth(): Promise<PersonalBillingStatus> { return this.updatePersonalBilling({ event: 'activate_included_hosted_month' }); }

  getOnboardingStatus(): Promise<OnboardingStatus> { return this.#request('GET', '/v1/onboarding', OnboardingStatusSchema); }
  sendHeartbeat(input: HeartbeatRequest = {}): Promise<HeartbeatResponse> { return this.#request('POST', '/v1/heartbeat', HeartbeatResponseSchema, { body: HeartbeatRequestSchema.parse(input) }); }
  setAvailability(input: SetAvailability): Promise<AvailabilityRecord> { return this.#request('POST', '/v1/availability', AvailabilityRecordSchema, { body: SetAvailabilitySchema.parse(input) }); }

  createStatusUpdate(input: CreateStatusUpdate): Promise<StatusUpdateRecord> {
    return this.#request('POST', '/v1/status-updates', StatusUpdateRecordSchema, { body: CreateStatusUpdateSchema.parse(input) });
  }
  listStatusUpdates(options: { limit?: number } = {}): Promise<StatusUpdateRecord[]> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    return this.#request('GET', `/v1/status-updates${querySuffix(params)}`, StatusUpdateRecordSchema.array());
  }

  createRequest(input: CreateRequest): Promise<CreateRequestResponse> { return this.#request('POST', '/v1/requests', CreateRequestResponseSchema, { body: CreateRequestSchema.parse(input) }); }
  listRequests(options: { workspaceId?: string } = {}): Promise<RequestRecord[]> {
    const params = new URLSearchParams();
    if (options.workspaceId) params.set('workspaceId', options.workspaceId);
    return this.#request('GET', `/v1/requests${querySuffix(params)}`, RequestRecordSchema.array());
  }
  getRequest(id: string): Promise<RequestRecord> { return this.#request('GET', `/v1/requests/${encodeURIComponent(id)}`, RequestRecordSchema); }
  respondToRequest(id: string, input: RespondRequest): Promise<RequestRecord> { return this.#request('POST', `/v1/requests/${encodeURIComponent(id)}/responses`, RequestRecordSchema, { body: RespondRequestSchema.parse(input) }); }
  abandonRequest(id: string): Promise<RequestRecord> { return this.#request('POST', `/v1/requests/${encodeURIComponent(id)}/abandon`, RequestRecordSchema, { body: {} }); }
  waitForRequest(id: string, options: { timeoutMs?: number; waiterToken?: string; signal?: AbortSignal } = {}): Promise<WaitRequestResponse> {
    const params = new URLSearchParams();
    if (options.timeoutMs !== undefined) params.set('timeoutMs', String(options.timeoutMs));
    return this.#request('GET', `/v1/requests/${encodeURIComponent(id)}/wait${querySuffix(params)}`, WaitRequestResponseSchema, {
      ...(options.waiterToken ? { bearerToken: options.waiterToken } : {}),
      ...(options.signal ? { signal: options.signal } : {})
    });
  }
  waitForCreatedRequest(created: CreateRequestResponse, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<WaitRequestResponse> {
    return this.waitForRequest(created.request.id, {
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(created.waiter ? { waiterToken: created.waiter.token } : {})
    });
  }

  listActivity(options: { workspaceId?: string; limit?: number } = {}): Promise<ActivityItem[]> {
    const params = new URLSearchParams();
    if (options.workspaceId) params.set('workspaceId', options.workspaceId);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    return this.#request('GET', `/v1/activity${querySuffix(params)}`, ActivityItemSchema.array());
  }
  listActivityHistory(options: { workspaceId?: string; limit?: number } = {}): Promise<ActivityItem[]> {
    const params = new URLSearchParams();
    if (options.workspaceId) params.set('workspaceId', options.workspaceId);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    return this.#request('GET', `/v1/activity/history${querySuffix(params)}`, ActivityItemSchema.array());
  }
  getPendingRequestCount(options: { workspaceId?: string } = {}): Promise<PendingActivityCount> {
    const params = new URLSearchParams();
    if (options.workspaceId) params.set('workspaceId', options.workspaceId);
    return this.#request('GET', `/v1/activity/pending-count${querySuffix(params)}`, PendingActivityCountSchema);
  }

  listWorkspaces(): Promise<WorkspaceMemberRecord[]> { return this.#request('GET', '/v1/workspaces', WorkspaceMemberRecordSchema.array()); }
  createSharedWorkspace(input: CreateSharedWorkspace): Promise<WorkspaceMemberRecord> { return this.#request('POST', '/v1/workspaces', WorkspaceMemberRecordSchema, { body: CreateSharedWorkspaceSchema.parse(input) }); }
  updateWorkspace(id: string, input: UpdateWorkspace): Promise<WorkspaceRecord> { return this.#request('PATCH', `/v1/workspaces/${encodeURIComponent(id)}`, WorkspaceRecordSchema, { body: UpdateWorkspaceSchema.parse(input) }); }
  listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberRecord[]> { return this.#request('GET', `/v1/workspaces/${encodeURIComponent(workspaceId)}/members`, WorkspaceMemberRecordSchema.array()); }
  addWorkspaceMember(workspaceId: string, input: AddWorkspaceMember): Promise<WorkspaceMemberRecord> {
    return this.#request('POST', `/v1/workspaces/${encodeURIComponent(workspaceId)}/members`, WorkspaceMemberRecordSchema, { body: AddWorkspaceMemberSchema.parse(input) });
  }

  listAgentTokens(): Promise<AgentTokenRecord[]> { return this.#request('GET', '/v1/agent-tokens', AgentTokenRecordSchema.array()); }
  createAgentToken(input: CreateAgentToken): Promise<AgentCredential> { return this.#request('POST', '/v1/agent-tokens', AgentCredentialSchema, { body: CreateAgentTokenSchema.parse(input) }); }
  updateAgentToken(agentTokenId: string, input: UpdateAgentToken): Promise<AgentTokenRecord> { return this.#request('PATCH', `/v1/agent-tokens/${encodeURIComponent(agentTokenId)}`, AgentTokenRecordSchema, { body: UpdateAgentTokenSchema.parse(input) }); }
  revokeAgentToken(agentTokenId: string): Promise<AgentTokenRecord> { return this.#request('POST', `/v1/agent-tokens/${encodeURIComponent(agentTokenId)}/revoke`, AgentTokenRecordSchema, { body: {} }); }

  listRoutingRules(options: { workspaceId?: string } = {}): Promise<RoutingRuleRecord[]> {
    const params = new URLSearchParams();
    if (options.workspaceId) params.set('workspaceId', options.workspaceId);
    return this.#request('GET', `/v1/routing-rules${querySuffix(params)}`, RoutingRuleRecordSchema.array());
  }
  createRoutingRule(input: CreateRoutingRule): Promise<RoutingRuleRecord> { return this.#request('POST', '/v1/routing-rules', RoutingRuleRecordSchema, { body: CreateRoutingRuleSchema.parse(input) }); }
  updateRoutingRule(id: string, input: UpdateRoutingRule): Promise<RoutingRuleRecord> { return this.#request('PATCH', `/v1/routing-rules/${encodeURIComponent(id)}`, RoutingRuleRecordSchema, { body: UpdateRoutingRuleSchema.parse(input) }); }
  deleteRoutingRule(id: string): Promise<DeleteRoutingRuleResponse> { return this.#request('DELETE', `/v1/routing-rules/${encodeURIComponent(id)}`, DeleteRoutingRuleResponseSchema); }

  sendTestActivity(input: SendTestActivity): Promise<SendTestActivityResponse> { return this.#request('POST', '/v1/tests', SendTestActivityResponseSchema, { body: SendTestActivitySchema.parse(input) }); }

  createPairingToken(): Promise<PairingToken> { return this.#request('POST', '/v1/pairing-tokens', PairingTokenSchema, { body: {} }); }
  pairDevice(input: PairDeviceRequest): Promise<DeviceCredential> { return this.#request('POST', '/v1/devices/pair', DeviceCredentialSchema, { body: PairDeviceRequestSchema.parse(input), includeWorkspace: false }); }
  registerDevice(input: RegisterDevice): Promise<RegisterDeviceResponse> { return this.#request('POST', '/v1/devices/register', RegisterDeviceResponseSchema, { body: RegisterDeviceSchema.parse(input) }); }
  listDevices(): Promise<DeviceRecord[]> { return this.#request('GET', '/v1/devices', DeviceRecordSchema.array()); }
  renameDevice(deviceId: string, name: string): Promise<DeviceRecord> { return this.#request('PATCH', `/v1/devices/${encodeURIComponent(deviceId)}`, DeviceRecordSchema, { body: UpdateDeviceNameSchema.parse({ name }) }); }
  updateDevicePushToken(deviceId: string, input: UpdateDevicePushToken): Promise<DeviceRecord> { return this.#request('POST', `/v1/devices/${encodeURIComponent(deviceId)}/push-token`, DeviceRecordSchema, { body: UpdateDevicePushTokenSchema.parse(input) }); }
  unpairDevice(deviceId: string): Promise<DeviceRecord> { return this.#request('POST', `/v1/devices/${encodeURIComponent(deviceId)}/unpair`, DeviceRecordSchema, { body: {} }); }
  unregisterDevice(deviceId: string): Promise<DeviceRecord> { return this.#request('POST', `/v1/devices/${encodeURIComponent(deviceId)}/unregister`, DeviceRecordSchema, { body: {} }); }

  createEventTicket(): Promise<EventTicketResponse> { return this.#request('POST', '/v1/events/ticket', EventTicketResponseSchema, { body: {} }); }
  pollEvents(options: { lastEventId?: number; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<EventPollResponse> {
    const params = new URLSearchParams();
    if (options.lastEventId !== undefined) params.set('lastEventId', String(options.lastEventId));
    if (options.timeoutMs !== undefined) params.set('timeoutMs', String(options.timeoutMs));
    return this.#request('GET', `/v1/events/poll${querySuffix(params)}`, EventPollResponseSchema, { ...(options.signal ? { signal: options.signal } : {}) });
  }

  async createEventStreamURL(options: { lastEventId?: number } = {}): Promise<string> {
    const ticket = await this.createEventTicket();
    const params = new URLSearchParams({ ticket: ticket.ticket });
    if (options.lastEventId !== undefined) params.set('lastEventId', String(options.lastEventId));
    return `${this.#baseUrl}/v1/events?${params.toString()}`;
  }

  async openEventStream(options: { EventSource?: EventSourceConstructor; lastEventId?: number } = {}): Promise<EventSource> {
    const EventSourceImpl = options.EventSource ?? globalThis.EventSource;
    if (!EventSourceImpl) throw new Error('EventSource is not available');
    return new EventSourceImpl(await this.createEventStreamURL({ ...(options.lastEventId !== undefined ? { lastEventId: options.lastEventId } : {}) }));
  }

  async #request<T>(method: string, path: string, schema: ZodType<T>, options: { body?: unknown; includeWorkspace?: boolean; signal?: AbortSignal; bearerToken?: string } = {}): Promise<T> {
    const headers = new Headers({ Accept: 'application/json' });
    const token = options.bearerToken ?? await resolveProvider(this.#tokenProvider);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.includeWorkspace !== false) {
      const workspaceId = await resolveProvider(this.#workspaceIdProvider);
      if (workspaceId) headers.set('X-Agent-Tick-Workspace-ID', workspaceId);
    }
    let body: string | undefined;
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }
    const init: RequestInit = { method, headers, ...(body !== undefined ? { body } : {}), ...(options.signal ? { signal: options.signal } : {}) };
    const response = await this.#fetch(new URL(path, this.#baseUrl), init);
    const text = await response.text();
    const parsed = text ? JSON.parse(text) as unknown : undefined;
    if (!response.ok) {
      const envelope = ApiErrorEnvelopeSchema.safeParse(parsed);
      if (envelope.success) {
        const { error } = envelope.data as ApiErrorEnvelope;
        throw new AgentTickApiError(error.message, response.status, parsed, error.code, error.requestId);
      }
      throw new AgentTickApiError(response.statusText || 'Request failed', response.status, parsed);
    }
    return schema.parse(parsed);
  }
}

async function resolveProvider(provider: TokenProvider | WorkspaceIdProvider | undefined): Promise<string | null | undefined> {
  return typeof provider === 'function' ? provider() : provider;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function querySuffix(params: URLSearchParams): string {
  return params.size ? `?${params.toString()}` : '';
}

export type {
  ActivityItem,
  AddWorkspaceMember,
  AgentCredential,
  AgentTokenRecord,
  AuditEventRecord,
  AuthConfig,
  AvailabilityRecord,
  BillingProductsResponse,
  BillingPurchasePreflightRequest,
  BillingPurchasePreflightResponse,
  BillingStatus,
  CreateAgentToken,
  CreateMobileDiagnostics,
  CreateMobileSession,
  CreateRequest,
  CreateRequestResponse,
  CreateRoutingRule,
  CreateSharedWorkspace,
  CreateStatusUpdate,
  DeleteRoutingRuleResponse,
  DeviceCredential,
  DeviceRecord,
  EventPollEvent,
  EventPollResponse,
  EventTicketResponse,
  HealthResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  MeResponse,
  MobileDiagnosticsResponse,
  MobileSessionResponse,
  OnboardingStatus,
  PairDeviceRequest,
  PairingToken,
  PendingActivityCount,
  PersonalBillingStatus,
  PersonalBillingUpdate,
  RegisterDevice,
  RegisterDeviceResponse,
  ReadyResponse,
  RequestRecord,
  RespondRequest,
  RoutingRuleRecord,
  SendTestActivity,
  SendTestActivityResponse,
  SetAvailability,
  StatusUpdateRecord,
  UpdateAgentToken,
  UpdateDeviceName,
  UpdateDevicePushToken,
  UpdateRoutingRule,
  UpdateWorkspace,
  WaitRequestResponse,
  WorkspaceMemberRecord,
  WorkspaceRecord
};
