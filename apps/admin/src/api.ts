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
	createdAt: string;
	unpairedAt?: string;
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
}

export interface CreateAgentTokenRequest {
	name: string;
	scopes?: string[];
}

export interface AgentTokenRecord {
	agentId: string;
	name: string;
	scopes: string[];
	createdAt: string;
	revokedAt?: string;
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
