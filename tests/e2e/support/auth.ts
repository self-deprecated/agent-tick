import { expect, type APIRequestContext, type Page } from '@playwright/test';

export interface TestUserSession {
  token: string;
  userId: string;
  workspaceId: string;
  role: string;
  subject: string;
  email: string;
  name: string;
}

export async function testAuthEnabled(request: APIRequestContext, baseURL: string | undefined): Promise<boolean> {
  const response = await request.get(`${baseURL}/v1/auth/config`);
  const config = await response.json() as { testAuth?: boolean };
  return config.testAuth === true;
}

export async function signInAsTestUser(page: Page, request: APIRequestContext, baseURL: string | undefined, options: { subject: string; email?: string; name?: string }): Promise<TestUserSession> {
  const email = options.email ?? `${options.subject}@example.test`;
  const name = options.name ?? options.subject;
  const response = await request.post(`${baseURL}/__test/users`, { data: { subject: options.subject, email, name } });
  expect(response.ok()).toBeTruthy();
  const session = await response.json() as Omit<TestUserSession, 'subject' | 'email' | 'name'>;
  const token = session.token;
  await page.addInitScript(({ tokenValue }) => {
    window.localStorage.setItem('agent_tick_test_auth_token', tokenValue);
  }, { tokenValue: token });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  return { ...session, token, subject: options.subject, email, name };
}

export function authHeaders(session: TestUserSession, workspaceId?: string): Record<string, string> {
  return {
    authorization: `Bearer ${session.token}`,
    'x-agent-tick-test-email': session.email,
    'x-agent-tick-test-name': session.name,
    ...(workspaceId ? { 'x-agent-tick-workspace-id': workspaceId } : {})
  };
}
