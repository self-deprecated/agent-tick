import { spawn } from 'node:child_process';
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { authHeaders, type TestUserSession } from '../../support/auth';

export interface AuthConfig {
  mode?: string;
  authProvider?: string;
  testAuth?: boolean;
}

export interface AgentTokenFixture {
  agentTokenId: string;
  token: string;
  label: string;
  workspaceId: string;
}

export interface DeviceCredentialFixture {
  deviceId: string;
  token: string;
}

export interface CreatedRequestFixture {
  request: {
    id: string;
    title: string;
    status: string;
    workspaceId: string;
    response?: { choiceId?: string; message?: string };
    responses?: Array<{ choiceId?: string; message?: string; final?: boolean }>;
  };
  waiter?: { token: string; waiterId: string };
}

export interface StatusUpdateFixture {
  statusId: string;
  message: string;
  state: string;
  workspaceId: string;
}

export interface ActivityItemFixture {
  kind: 'status_update' | 'request';
  id: string;
  request?: { id: string; title: string; status: string };
  statusUpdate?: { statusId: string; message: string; state: string };
}

export function adminToken(): string {
  const token = process.env.AGENT_TICK_E2E_ADMIN_TOKEN;
  if (!token) throw new Error('AGENT_TICK_E2E_ADMIN_TOKEN is required for Docker self-host E2E tests');
  return token;
}

export function adminHeaders(workspaceId?: string): Record<string, string> {
  return {
    authorization: `Bearer ${adminToken()}`,
    ...(workspaceId ? { 'x-agent-tick-workspace-id': workspaceId } : {})
  };
}

export function bearerHeaders(token: string, workspaceId?: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    ...(workspaceId ? { 'x-agent-tick-workspace-id': workspaceId } : {})
  };
}

export async function createTestUser(request: APIRequestContext, baseURL: string | undefined, options: { subject: string; email?: string; name?: string }): Promise<TestUserSession> {
  const email = options.email ?? `${options.subject}@example.test`;
  const name = options.name ?? options.subject;
  const response = await request.post(`${baseURL}/__test/users`, { data: { subject: options.subject, email, name } });
  await expectOk(response, 'POST /__test/users');
  const session = await response.json() as Omit<TestUserSession, 'subject' | 'email' | 'name'>;
  return { ...session, subject: options.subject, email, name };
}

export async function createMobileSession(request: APIRequestContext, baseURL: string | undefined, user: TestUserSession): Promise<{ token: string; userId: string; workspaceId: string; role: string }> {
  const response = await request.post(`${baseURL}/v1/auth/mobile-session`, { data: { clerkToken: user.token } });
  await expectOk(response, 'POST /v1/auth/mobile-session');
  return await response.json() as { token: string; userId: string; workspaceId: string; role: string };
}

export async function subscribePersonalBilling(request: APIRequestContext, baseURL: string | undefined, user: TestUserSession): Promise<void> {
  const response = await request.post(`${baseURL}/v1/billing/personal`, {
    headers: authHeaders(user),
    data: { event: 'subscribe_monthly' }
  });
  await expectOk(response, 'POST /v1/billing/personal');
}

export async function registerMobileDevice(request: APIRequestContext, baseURL: string | undefined, mobileToken: string, deviceName: string, platform = 'ios'): Promise<{ deviceId: string }> {
  const response = await request.post(`${baseURL}/v1/devices/register`, {
    headers: bearerHeaders(mobileToken),
    data: { deviceName, platform, installationId: `${deviceName}-${Date.now()}` }
  });
  await expectOk(response, 'POST /v1/devices/register');
  return await response.json() as { deviceId: string };
}

export async function expectError(response: APIResponse, statuses: number | number[], label: string): Promise<{ error?: { code?: string; message?: string; requestId?: string } }> {
  const expected = Array.isArray(statuses) ? statuses : [statuses];
  const text = await response.text().catch(() => '');
  expect(expected, `${label} returned HTTP ${response.status()}: ${text}`).toContain(response.status());
  const body = text ? JSON.parse(text) as { error?: { code?: string; message?: string; requestId?: string } } : {};
  expect(body.error?.code, `${label} should return a machine-readable error: ${text}`).toBeTruthy();
  return body;
}

export async function getAuthConfig(request: APIRequestContext, baseURL: string | undefined): Promise<AuthConfig> {
  const response = await request.get(`${baseURL}/v1/auth/config`);
  await expectOk(response, 'GET /v1/auth/config');
  return await response.json() as AuthConfig;
}

export async function createAgentToken(request: APIRequestContext, baseURL: string | undefined, label: string): Promise<AgentTokenFixture> {
  const response = await request.post(`${baseURL}/v1/agent-tokens`, {
    headers: adminHeaders(),
    data: { label }
  });
  await expectOk(response, 'POST /v1/agent-tokens');
  return await response.json() as AgentTokenFixture;
}

export async function listAgentTokens(request: APIRequestContext, baseURL: string | undefined): Promise<Array<{ agentTokenId: string; label: string; workspaceId: string; revokedAt?: string }>> {
  const response = await request.get(`${baseURL}/v1/agent-tokens`, { headers: adminHeaders() });
  await expectOk(response, 'GET /v1/agent-tokens');
  return await response.json() as Array<{ agentTokenId: string; label: string; workspaceId: string; revokedAt?: string }>;
}

export async function createPairingToken(request: APIRequestContext, baseURL: string | undefined): Promise<{ token: string; expiresAt: string }> {
  const response = await request.post(`${baseURL}/v1/pairing-tokens`, { headers: adminHeaders() });
  await expectOk(response, 'POST /v1/pairing-tokens');
  return await response.json() as { token: string; expiresAt: string };
}

export async function pairSpoofedDevice(request: APIRequestContext, baseURL: string | undefined, pairingToken: string, deviceName: string, platform = 'ios'): Promise<DeviceCredentialFixture> {
  const response = await request.post(`${baseURL}/v1/devices/pair`, {
    data: { token: pairingToken, deviceName, platform }
  });
  await expectOk(response, 'POST /v1/devices/pair');
  return await response.json() as DeviceCredentialFixture;
}

export async function createSpoofedDevice(request: APIRequestContext, baseURL: string | undefined, deviceName: string, platform = 'ios'): Promise<DeviceCredentialFixture> {
  const pairing = await createPairingToken(request, baseURL);
  return await pairSpoofedDevice(request, baseURL, pairing.token, deviceName, platform);
}

export async function listDevices(request: APIRequestContext, baseURL: string | undefined): Promise<Array<{ deviceId: string; name?: string; platform?: string }>> {
  const response = await request.get(`${baseURL}/v1/devices`, { headers: adminHeaders() });
  await expectOk(response, 'GET /v1/devices');
  return await response.json() as Array<{ deviceId: string; name?: string; platform?: string }>;
}

export async function createStatusUpdate(request: APIRequestContext, baseURL: string | undefined, agentToken: string, message: string, options: { sessionId?: string } = {}): Promise<StatusUpdateFixture> {
  const response = await request.post(`${baseURL}/v1/status-updates`, {
    headers: bearerHeaders(agentToken),
    data: {
      message,
      state: 'working',
      nextStep: 'Waiting for Docker self-host E2E validation',
      host: 'docker-selfhost-e2e',
      workingDirectory: '/workspace',
      clientName: 'docker-selfhost-e2e',
      ...(options.sessionId ? { sessionId: options.sessionId } : {})
    }
  });
  await expectOk(response, 'POST /v1/status-updates');
  return await response.json() as StatusUpdateFixture;
}

export async function createSanctionRequest(request: APIRequestContext, baseURL: string | undefined, agentToken: string, title: string, options: { sessionId?: string; deadline?: string; body?: string; metadata?: Record<string, unknown> } = {}): Promise<CreatedRequestFixture> {
  const response = await request.post(`${baseURL}/v1/requests`, {
    headers: bearerHeaders(agentToken),
    data: sanctionRequestPayload(title, options)
  });
  await expectOk(response, 'POST /v1/requests');
  return await response.json() as CreatedRequestFixture;
}

export function sanctionRequestPayload(title: string, options: { sessionId?: string; deadline?: string; body?: string; metadata?: Record<string, unknown> } = {}): Record<string, unknown> {
  return {
    requester: { name: 'Docker self-host E2E agent' },
    requestType: 'sanction',
    title,
    body: options.body ?? 'Created by Docker self-hosting E2E coverage.',
    command: 'echo docker-selfhost-e2e',
    choices: [
      { id: 'approve', label: 'Approve', kind: 'approve' },
      { id: 'deny', label: 'Deny', kind: 'deny' }
    ],
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.deadline ? { deadline: options.deadline } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {})
  };
}

export async function respondToRequest(request: APIRequestContext, baseURL: string | undefined, deviceToken: string, requestId: string, choiceId = 'approve'): Promise<{ id: string; status: string; response?: { choiceId?: string } }> {
  const response = await request.post(`${baseURL}/v1/requests/${requestId}/responses`, {
    headers: bearerHeaders(deviceToken),
    data: { choiceId, message: `Docker E2E ${choiceId}` }
  });
  await expectOk(response, `POST /v1/requests/${requestId}/responses`);
  return await response.json() as { id: string; status: string; response?: { choiceId?: string } };
}

export async function waitForRequest(request: APIRequestContext, baseURL: string | undefined, requestId: string, waiterToken: string): Promise<{ request: { id: string; status: string; response?: { choiceId?: string } }; terminal: boolean }> {
  const response = await request.get(`${baseURL}/v1/requests/${requestId}/wait?timeoutMs=5000`, {
    headers: bearerHeaders(waiterToken)
  });
  await expectOk(response, `GET /v1/requests/${requestId}/wait`);
  return await response.json() as { request: { id: string; status: string; response?: { choiceId?: string } }; terminal: boolean };
}

export async function getRequest(request: APIRequestContext, baseURL: string | undefined, requestId: string): Promise<{ id: string; title: string; status: string; response?: { choiceId?: string; message?: string }; responses?: Array<{ choiceId?: string; message?: string; final?: boolean }> }> {
  const response = await request.get(`${baseURL}/v1/requests/${requestId}`, { headers: adminHeaders() });
  await expectOk(response, `GET /v1/requests/${requestId}`);
  return await response.json() as { id: string; title: string; status: string; response?: { choiceId?: string; message?: string }; responses?: Array<{ choiceId?: string; message?: string; final?: boolean }> };
}

export async function pendingCount(request: APIRequestContext, baseURL: string | undefined): Promise<number> {
  const response = await request.get(`${baseURL}/v1/activity/pending-count`, { headers: adminHeaders() });
  await expectOk(response, 'GET /v1/activity/pending-count');
  const body = await response.json() as { pendingRequests: number };
  return body.pendingRequests;
}

export async function activityHistory(request: APIRequestContext, baseURL: string | undefined, limit = 100): Promise<ActivityItemFixture[]> {
  const response = await request.get(`${baseURL}/v1/activity/history?limit=${limit}`, { headers: adminHeaders() });
  await expectOk(response, 'GET /v1/activity/history');
  return await response.json() as ActivityItemFixture[];
}

export async function listStatusUpdates(request: APIRequestContext, baseURL: string | undefined, limit = 20): Promise<StatusUpdateFixture[]> {
  const response = await request.get(`${baseURL}/v1/status-updates?limit=${limit}`, { headers: adminHeaders() });
  await expectOk(response, 'GET /v1/status-updates');
  return await response.json() as StatusUpdateFixture[];
}

export async function restartDockerService(): Promise<void> {
  const composeFiles = dockerComposeFiles();
  const projectName = process.env.AGENT_TICK_E2E_COMPOSE_PROJECT;
  if (composeFiles.length === 0 || !projectName) throw new Error('AGENT_TICK_E2E_COMPOSE_FILE(S) and AGENT_TICK_E2E_COMPOSE_PROJECT are required to restart Docker E2E services');
  await run('docker', ['compose', '-p', projectName, ...composeFiles.flatMap((file) => ['-f', file]), 'restart', 'server']);
}

function dockerComposeFiles(): string[] {
  const filesJSON = process.env.AGENT_TICK_E2E_COMPOSE_FILES;
  if (filesJSON) {
    const parsed = JSON.parse(filesJSON) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((file) => typeof file === 'string' && file.length > 0)) {
      throw new Error('AGENT_TICK_E2E_COMPOSE_FILES must be a JSON array of file paths');
    }
    return parsed;
  }
  return process.env.AGENT_TICK_E2E_COMPOSE_FILE ? [process.env.AGENT_TICK_E2E_COMPOSE_FILE] : [];
}

export async function waitForHealthAndReady(baseURL: string | undefined): Promise<void> {
  const health = await fetch(`${baseURL}/healthz`);
  expect(health.ok, `GET /healthz returned ${health.status}: ${await health.text().catch(() => '')}`).toBeTruthy();
  await waitForReady(baseURL);
}

export async function waitForReady(baseURL: string | undefined): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/readyz`);
      if (response.ok) return;
      lastError = new Error(`readyz returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for Docker service readiness after restart: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function expectOk(response: APIResponse, label: string): Promise<void> {
  if (response.ok()) return;
  const text = await response.text().catch(() => '<unreadable body>');
  expect(response.ok(), `${label} failed with HTTP ${response.status()}: ${text}`).toBeTruthy();
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}`));
    });
  });
}
