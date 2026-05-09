import { expect, type APIRequestContext } from '@playwright/test';

export interface TestState {
  users: Array<Record<string, unknown>>;
  organizations: Array<Record<string, unknown>>;
  memberships: Array<Record<string, unknown>>;
  agentTokens: Array<Record<string, unknown>>;
  devices: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
  policies: Array<Record<string, unknown>>;
  teams: Array<Record<string, unknown>>;
  teamMemberships: Array<Record<string, unknown>>;
  invites: Array<Record<string, unknown>>;
  membershipRequests: Array<Record<string, unknown>>;
}

export async function readTestState(request: APIRequestContext, baseURL: string | undefined): Promise<TestState> {
  const response = await request.get(`${baseURL}/__test/state`);
  expect(response.ok()).toBeTruthy();
  return await response.json() as TestState;
}

export function rowsFor<T extends Record<string, unknown>>(rows: T[], key: string, value: unknown): T[] {
  return rows.filter((row) => row[key] === value);
}
