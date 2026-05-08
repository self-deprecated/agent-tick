export interface Requester {
	name: string;
	agentId: string;
	host?: string;
	workingDirectory?: string;
	projectName?: string;
	projectId?: string;
}

export interface Choice {
	id: string;
	label: string;
	kind: string;
}

export interface QuestionOption {
	label: string;
}

export interface Question {
	header: string;
	question: string;
	options: QuestionOption[];
	multiSelect: boolean;
}

export interface ResponsePayload {
	choiceId?: string;
	message?: string;
	answers?: Record<string, string[]>;
}

export type RequestType = 'approval' | 'questionnaire' | 'steer' | string;
export type RequestStatus = 'pending' | 'responded' | 'expired' | 'abandoned' | string;

export interface ApprovalRequest {
	id: string;
	userId?: string;
	requester: Requester;
	requestType: RequestType;
	title: string;
	body?: string;
	command?: string;
	choices: Choice[];
	questions?: Question[];
	defaultChoice?: string;
	allowFreeformReply: boolean;
	expiresAt?: string;
	risk?: string;
	metadata?: Record<string, string>;
	status: RequestStatus;
	createdAt: string;
	respondedAt?: string;
	response?: ResponsePayload;
}

export interface PairingToken {
	token: string;
	expiresAt: string;
	qrDataUrl?: string;
}

export interface DeviceRecord {
	deviceId: string;
	name: string;
	pushNotifications: boolean;
	lastSeenAt?: string;
	createdAt: string;
	unpairedAt?: string;
}

export type AvailabilityState = 'available' | 'busy' | 'do-not-disturb' | 'off-call' | string;

export interface UserAvailabilityRecord {
	userId: string;
	state: AvailabilityState;
	lastSeenAt?: string;
	overrideUntil?: string;
}

export interface TeamCoverageRecord {
	teamId: string;
	primaryUserId?: string;
	secondaryUserId?: string;
	selectedApproverId?: string;
	summary: string;
	members: UserAvailabilityRecord[];
}

export interface OnCallScheduleRecord {
	scheduleId: string;
	teamId: string;
	primaryUserId: string;
	secondaryUserId?: string;
	startsAt?: string;
	endsAt?: string;
	createdAt: string;
	updatedAt: string;
}

export interface UpsertOnCallScheduleRequest {
	primaryUserId: string;
	secondaryUserId?: string;
	startsAt?: string;
	endsAt?: string;
}

export interface LoginRequest {
	email: string;
	password: string;
	name?: string;
}

export interface SessionCredential {
	userId: string;
	email?: string;
	name?: string;
	expiry?: string;
}

export interface AgentCredential {
	agentId: string;
	name: string;
	token: string;
	scopes: string[];
	organizationId?: string;
	projectId?: string;
	ownerUserId?: string;
	teamId?: string;
	defaultApprovalPolicy?: string;
}

export interface CreateAgentTokenRequest {
	name: string;
	scopes?: string[];
	projectId?: string;
	ownerUserId?: string;
	teamId?: string;
	defaultApprovalPolicy?: string;
}

export interface AgentTokenRecord {
	agentId: string;
	name: string;
	scopes: string[];
	organizationId?: string;
	projectId?: string;
	ownerUserId?: string;
	teamId?: string;
	defaultApprovalPolicy?: string;
	lastRequestAt?: string;
	createdAt: string;
	revokedAt?: string;
}

export type OrganizationRole = 'owner' | 'admin' | 'approver' | 'viewer' | string;

export interface OrganizationRecord {
	organizationId: string;
	name: string;
	defaultPolicyId?: string;
	createdAt: string;
}

export interface OrganizationMembershipRecord {
	organizationId: string;
	name: string;
	userId: string;
	role: OrganizationRole;
	createdAt: string;
}

export interface CreateOrganizationRequest {
	name: string;
}

export interface CreateOrganizationInviteRequest {
	label?: string;
	role: OrganizationRole;
	teamIds?: string[];
	approvalRequired?: boolean;
	email?: string;
	domain?: string;
	expiresAt?: string;
	maxUses?: number;
}

export interface OrganizationInviteRecord {
	inviteId: string;
	organizationId: string;
	label?: string;
	role: OrganizationRole;
	teamIds?: string[];
	approvalRequired: boolean;
	email?: string;
	domain?: string;
	expiresAt?: string;
	maxUses?: number;
	usedCount: number;
	pendingCount?: number;
	approvedCount?: number;
	revokedAt?: string;
	createdAt: string;
	url?: string;
	token?: string;
}

export interface InvitePreview {
	organizationName: string;
	role: OrganizationRole;
	approvalRequired: boolean;
	expiresAt?: string;
}

export interface MembershipRequestRecord {
	requestId: string;
	inviteId: string;
	organizationId: string;
	userId: string;
	userName?: string;
	userEmail?: string;
	requestedRole: OrganizationRole;
	requestedTeamIds?: string[];
	status: string;
	acceptedAt: string;
}

export interface TeamRecord {
	teamId: string;
	organizationId: string;
	name: string;
	description?: string;
	createdAt: string;
	updatedAt: string;
}

export interface CreateTeamRequest {
	name: string;
	description?: string;
}

export interface TeamMemberRecord {
	teamId: string;
	userId: string;
	role: OrganizationRole;
	createdAt: string;
}

export interface UpsertTeamMemberRequest {
	userId: string;
	role: OrganizationRole;
}

export interface ProjectRecord {
	projectId: string;
	organizationId: string;
	teamId?: string;
	name: string;
	slug: string;
	description?: string;
	defaultPolicyId?: string;
	createdAt: string;
	updatedAt: string;
}

export interface CreateProjectRequest {
	name: string;
	teamId?: string;
	description?: string;
	defaultPolicyId?: string;
}

export type ApprovalPolicyTemplate =
	| 'owner-only'
	| 'any-team-member'
	| 'on-call'
	| 'recently-active'
	| 'quorum'
	| 'sequence'
	| 'risk-based'
	| string;

export interface ApprovalPolicyStep {
	stepId?: string;
	position: number;
	stepType: string;
	teamId?: string;
	quorum?: number;
	timeoutSeconds?: number;
	escalationTarget?: string;
	denyVeto: boolean;
}

export interface ApprovalPolicyRecord {
	policyId: string;
	organizationId: string;
	projectId?: string;
	teamId?: string;
	name: string;
	template: ApprovalPolicyTemplate;
	summary: string;
	settings: Record<string, string>;
	steps: ApprovalPolicyStep[];
	createdAt: string;
	updatedAt: string;
}

export interface CreateApprovalPolicyRequest {
	name: string;
	template: ApprovalPolicyTemplate;
	projectId?: string;
	teamId?: string;
	settings?: Record<string, string>;
	steps?: ApprovalPolicyStep[];
}

export interface ApprovalPolicyPreview {
	policyId: string;
	summary: string;
	notifies: string[];
	limitations?: string[];
}

export interface BillingLimits {
	seats: number;
	teams: number;
	agents: number;
	requests: number;
	auditRetentionDays: number;
	approvalRetentionDays: number;
}

export interface BillingUsage {
	activeUsers: number;
	teams: number;
	activeAgents: number;
	approvalRequests30d: number;
	pushNotifications30d: number;
	auditEventsRetained: number;
}

export interface BillingStatus {
	organizationId: string;
	plan: string;
	limits: BillingLimits;
	usage: BillingUsage;
	portalUrl?: string;
	invoicesUrl?: string;
	upgradeUrl?: string;
}

export interface AuditEventRecord {
	eventId: number;
	organizationId: string;
	userId: string;
	eventType: string;
	targetId: string;
	payload: Record<string, unknown>;
	createdAt: string;
}

export interface AdminAuthProvider {
	bearerToken?: () => string | undefined;
	csrfToken?: () => string | undefined;
}

interface JSONRequestInit extends Omit<RequestInit, 'body'> {
	body?: unknown;
}

interface ErrorBody {
	error?: string;
}

export class ApiError extends Error {
	readonly status: number;
	readonly body: unknown;

	constructor(message: string, status: number, body: unknown) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.body = body;
	}
}

export class AdminApiClient {
	readonly #auth: AdminAuthProvider;

	constructor(auth: AdminAuthProvider = {}) {
		this.#auth = auth;
	}

	getSession(): Promise<SessionCredential> {
		return this.#requestJSON<SessionCredential>('/v1/session');
	}

	login(input: LoginRequest): Promise<SessionCredential> {
		return this.#requestJSON<SessionCredential>('/v1/session', {
			method: 'POST',
			body: input
		});
	}

	listApprovals(): Promise<ApprovalRequest[]> {
		return this.#requestJSON<ApprovalRequest[]>('/v1/approval-requests');
	}

	respondToApproval(id: string, choiceId: string): Promise<ApprovalRequest> {
		return this.#requestJSON<ApprovalRequest>(`/v1/approval-requests/${encodeURIComponent(id)}/responses`, {
			method: 'POST',
			body: { choiceId }
		});
	}

	listDevices(): Promise<DeviceRecord[]> {
		return this.#requestJSON<DeviceRecord[]>('/v1/devices');
	}

	createPairingToken(): Promise<PairingToken> {
		return this.#requestJSON<PairingToken>('/v1/pairing-tokens', {
			method: 'POST',
			body: {}
		});
	}

	unpairDevice(id: string): Promise<{ status: string }> {
		return this.#requestJSON<{ status: string }>(`/v1/devices/${encodeURIComponent(id)}/unpair`, {
			method: 'POST',
			body: {}
		});
	}

	listAgentTokens(): Promise<AgentTokenRecord[]> {
		return this.#requestJSON<AgentTokenRecord[]>('/v1/agent-tokens');
	}

	createAgentToken(input: CreateAgentTokenRequest): Promise<AgentCredential> {
		return this.#requestJSON<AgentCredential>('/v1/agent-tokens', {
			method: 'POST',
			body: input
		});
	}

	revokeAgentToken(id: string): Promise<{ status: string }> {
		return this.#requestJSON<{ status: string }>(`/v1/agent-tokens/${encodeURIComponent(id)}/revoke`, {
			method: 'POST',
			body: {}
		});
	}

	rotateAgentToken(id: string): Promise<AgentCredential> {
		return this.#requestJSON<AgentCredential>(`/v1/agent-tokens/${encodeURIComponent(id)}/rotate`, {
			method: 'POST',
			body: {}
		});
	}

	listOrganizations(): Promise<OrganizationMembershipRecord[]> {
		return this.#requestJSON<OrganizationMembershipRecord[]>('/v1/organizations');
	}

	createOrganization(input: CreateOrganizationRequest): Promise<OrganizationRecord> {
		return this.#requestJSON<OrganizationRecord>('/v1/organizations', {
			method: 'POST',
			body: input
		});
	}

	previewInvite(token: string): Promise<InvitePreview> {
		return this.#requestJSON<InvitePreview>(`/v1/invites/${encodeURIComponent(token)}`);
	}

	acceptInvite(token: string): Promise<MembershipRequestRecord> {
		return this.#requestJSON<MembershipRequestRecord>(`/v1/invites/${encodeURIComponent(token)}/accept`, { method: 'POST', body: {} });
	}

	listOrganizationInvites(): Promise<OrganizationInviteRecord[]> {
		return this.#requestJSON<OrganizationInviteRecord[]>('/v1/organization-invites');
	}

	createOrganizationInvite(input: CreateOrganizationInviteRequest): Promise<OrganizationInviteRecord> {
		return this.#requestJSON<OrganizationInviteRecord>('/v1/organization-invites', { method: 'POST', body: input });
	}

	revokeOrganizationInvite(id: string): Promise<OrganizationInviteRecord> {
		return this.#requestJSON<OrganizationInviteRecord>(`/v1/organization-invites/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: {} });
	}

	listMembershipRequests(): Promise<MembershipRequestRecord[]> {
		return this.#requestJSON<MembershipRequestRecord[]>('/v1/organization-membership-requests');
	}

	approveMembershipRequest(id: string): Promise<MembershipRequestRecord> {
		return this.#requestJSON<MembershipRequestRecord>(`/v1/organization-membership-requests/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {} });
	}

	rejectMembershipRequest(id: string): Promise<MembershipRequestRecord> {
		return this.#requestJSON<MembershipRequestRecord>(`/v1/organization-membership-requests/${encodeURIComponent(id)}/reject`, { method: 'POST', body: {} });
	}

	listTeams(): Promise<TeamRecord[]> {
		return this.#requestJSON<TeamRecord[]>('/v1/teams');
	}

	createTeam(input: CreateTeamRequest): Promise<TeamRecord> {
		return this.#requestJSON<TeamRecord>('/v1/teams', {
			method: 'POST',
			body: input
		});
	}

	listTeamMembers(teamId: string): Promise<TeamMemberRecord[]> {
		return this.#requestJSON<TeamMemberRecord[]>(`/v1/teams/${encodeURIComponent(teamId)}/members`);
	}

	listTeamAvailability(teamId: string): Promise<UserAvailabilityRecord[]> {
		return this.#requestJSON<UserAvailabilityRecord[]>(`/v1/teams/${encodeURIComponent(teamId)}/availability`);
	}

	getTeamCoverage(teamId: string): Promise<TeamCoverageRecord> {
		return this.#requestJSON<TeamCoverageRecord>(`/v1/teams/${encodeURIComponent(teamId)}/coverage`);
	}

	listOnCallSchedules(teamId: string): Promise<OnCallScheduleRecord[]> {
		return this.#requestJSON<OnCallScheduleRecord[]>(`/v1/teams/${encodeURIComponent(teamId)}/on-call`);
	}

	upsertOnCallSchedule(teamId: string, input: UpsertOnCallScheduleRequest): Promise<OnCallScheduleRecord> {
		return this.#requestJSON<OnCallScheduleRecord>(`/v1/teams/${encodeURIComponent(teamId)}/on-call`, {
			method: 'POST',
			body: input
		});
	}

	upsertTeamMember(teamId: string, input: UpsertTeamMemberRequest): Promise<TeamMemberRecord> {
		return this.#requestJSON<TeamMemberRecord>(`/v1/teams/${encodeURIComponent(teamId)}/members`, {
			method: 'POST',
			body: input
		});
	}

	listProjects(): Promise<ProjectRecord[]> {
		return this.#requestJSON<ProjectRecord[]>('/v1/projects');
	}

	createProject(input: CreateProjectRequest): Promise<ProjectRecord> {
		return this.#requestJSON<ProjectRecord>('/v1/projects', {
			method: 'POST',
			body: input
		});
	}

	listPolicies(): Promise<ApprovalPolicyRecord[]> {
		return this.#requestJSON<ApprovalPolicyRecord[]>('/v1/policies');
	}

	createPolicy(input: CreateApprovalPolicyRequest): Promise<ApprovalPolicyRecord> {
		return this.#requestJSON<ApprovalPolicyRecord>('/v1/policies', {
			method: 'POST',
			body: input
		});
	}

	previewPolicy(id: string): Promise<ApprovalPolicyPreview> {
		return this.#requestJSON<ApprovalPolicyPreview>(`/v1/policies/${encodeURIComponent(id)}/preview`);
	}

	getBillingStatus(): Promise<BillingStatus> {
		return this.#requestJSON<BillingStatus>('/v1/billing');
	}

	listAuditEvents(eventType = '', limit = 100): Promise<AuditEventRecord[]> {
		const params = new URLSearchParams({ limit: String(limit) });
		if (eventType.trim()) params.set('eventType', eventType.trim());
		return this.#requestJSON<AuditEventRecord[]>(`/v1/audit-events?${params.toString()}`);
	}

	exportAuditEventsCSV(eventType = '', limit = 1000): Promise<string> {
		const params = new URLSearchParams({ limit: String(limit) });
		if (eventType.trim()) params.set('eventType', eventType.trim());
		return this.#requestText(`/v1/audit-events/export?${params.toString()}`);
	}

	async #requestJSON<T>(path: string, init: JSONRequestInit = {}): Promise<T> {
		const { body, ...requestOptions } = init;
		const headers = new Headers(init.headers);
		const bearerToken = this.#auth.bearerToken?.()?.trim();
		if (bearerToken) {
			headers.set('Authorization', `Bearer ${bearerToken}`);
		}

		const csrfToken = this.#auth.csrfToken?.()?.trim();
		if (csrfToken) {
			headers.set('X-Agent-Tick-CSRF', csrfToken);
		}

		const requestInit: RequestInit = {
			...requestOptions,
			credentials: 'same-origin',
			headers
		};

		if (body !== undefined) {
			headers.set('Content-Type', 'application/json');
			requestInit.body = JSON.stringify(body);
		}

		const response = await fetch(path, requestInit);
		const responseBody = await readJSON(response);
		if (!response.ok) {
			const errorBody = responseBody as ErrorBody | undefined;
			throw new ApiError(errorBody?.error || response.statusText || 'Request failed', response.status, responseBody);
		}
		return responseBody as T;
	}

	async #requestText(path: string, init: RequestInit = {}): Promise<string> {
		const headers = new Headers(init.headers);
		const bearerToken = this.#auth.bearerToken?.()?.trim();
		if (bearerToken) {
			headers.set('Authorization', `Bearer ${bearerToken}`);
		}
		const csrfToken = this.#auth.csrfToken?.()?.trim();
		if (csrfToken) {
			headers.set('X-Agent-Tick-CSRF', csrfToken);
		}
		const response = await fetch(path, { ...init, credentials: 'same-origin', headers });
		const text = await response.text();
		if (!response.ok) {
			throw new ApiError(text || response.statusText || 'Request failed', response.status, text);
		}
		return text;
	}
}

async function readJSON(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) return {};
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return { error: text };
	}
}

export function csrfTokenFromCookie(cookie = document.cookie): string | undefined {
	return cookie
		.split(';')
		.map((part) => part.trim().split('='))
		.find(([key]) => key === 'agent_tick_csrf')
		?.slice(1)
		.join('=');
}
