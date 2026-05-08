import type { ZodType } from 'zod';
import {
  AgentCredentialSchema,
  AgentTokenRecordSchema,
  ApiErrorEnvelopeSchema,
  ApprovalRequestSchema,
  AuthConfigSchema,
  CreateAgentTokenSchema,
  CreateApprovalRequestSchema,
  CreateOrganizationSchema,
  DeviceCredentialSchema,
  DeviceRecordSchema,
  EventTicketResponseSchema,
  HealthResponseSchema,
  MeResponseSchema,
  OrganizationMembershipSchema,
  PairDeviceRequestSchema,
  PairingTokenSchema,
  RegisterDeviceResponseSchema,
  RegisterDeviceSchema,
  RespondApprovalRequestSchema,
  UpdateDevicePushTokenSchema,
  WaitApprovalResponseSchema,
  type AgentCredential,
  type AgentTokenRecord,
  type ApiErrorEnvelope,
  type ApprovalRequest,
  type AuthConfig,
  type CreateAgentToken,
  type CreateApprovalRequest,
  type CreateOrganization,
  type DeviceCredential,
  type DeviceRecord,
  type EventTicketResponse,
  type HealthResponse,
  type MeResponse,
  type OrganizationMembership,
  type PairDeviceRequest,
  type PairingToken,
  type RegisterDevice,
  type RegisterDeviceResponse,
  type RespondApprovalRequest,
  type UpdateDevicePushToken,
  type WaitApprovalResponse
} from '@agent-tick/shared';

export type TokenProvider = () => Promise<string | null | undefined> | string | null | undefined;
export type OrganizationIdProvider = () => Promise<string | null | undefined> | string | null | undefined;

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
    this.#fetch = options.fetch ?? globalThis.fetch;
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

  createApprovalRequest(input: CreateApprovalRequest): Promise<ApprovalRequest> {
    return this.#request('POST', '/v1/approval-requests', ApprovalRequestSchema, {
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

  createEventTicket(): Promise<EventTicketResponse> {
    return this.#request('POST', '/v1/events/ticket', EventTicketResponseSchema, { body: {} });
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

  async #request<T>(method: string, path: string, schema: ZodType<T>, options: { body?: unknown } = {}): Promise<T> {
    const headers = new Headers();
    headers.set('Accept', 'application/json');

    const token = (await this.#tokenProvider?.())?.trim();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const organizationId = (await this.#organizationIdProvider?.())?.trim();
    if (organizationId) headers.set('X-Agent-Tick-Organization-ID', organizationId);

    const init: RequestInit = { method, headers };
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
  AgentCredential,
  AgentTokenRecord,
  ApiErrorEnvelope,
  ApprovalRequest,
  AuthConfig,
  CreateAgentToken,
  CreateApprovalRequest,
  CreateOrganization,
  DeviceCredential,
  DeviceRecord,
  EventTicketResponse,
  HealthResponse,
  MeResponse,
  OrganizationMembership,
  PairDeviceRequest,
  PairingToken,
  RegisterDevice,
  RegisterDeviceResponse,
  RespondApprovalRequest,
  UpdateDevicePushToken,
  WaitApprovalResponse
};
