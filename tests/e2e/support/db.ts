import { expect, type APIRequestContext } from '@playwright/test';

export interface TestState {
  users: Array<Record<string, unknown>>;
  workspaces: Array<Record<string, unknown>>;
  workspaceMembers: Array<Record<string, unknown>>;
  agentTokens: Array<Record<string, unknown>>;
  approvalDevices: Array<Record<string, unknown>>;
  requests: Array<Record<string, unknown>>;
  requestRecipients: Array<Record<string, unknown>>;
  routingRules: Array<Record<string, unknown>>;
  routingRuleRecipients: Array<Record<string, unknown>>;
  statusUpdates: Array<Record<string, unknown>>;
  responses: Array<Record<string, unknown>>;
}

export async function readTestState(request: APIRequestContext, baseURL: string | undefined): Promise<TestState> {
  const response = await request.get(`${baseURL}/__test/state`);
  expect(response.ok()).toBeTruthy();
  return await response.json() as TestState;
}

export function rowsFor<T extends Record<string, unknown>>(rows: T[], key: string, value: unknown): T[] {
  return rows.filter((row) => row[key] === value);
}
