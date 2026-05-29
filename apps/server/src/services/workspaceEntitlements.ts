import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { RequestRecord } from '@self-deprecated/agent-tick-shared';
import type { AuthContext } from '../auth/context.js';
import type { ServerConfig } from '../config.js';
import { requireHostedPersonalResponse } from './personalEntitlements.js';

export async function requireRoutingEntitlement(config: ServerConfig, store: AgentTickStore, auth: AuthContext): Promise<void> {
  if (auth.workspaceType === 'shared') return requireSharedWorkspaceResponses(config, store, auth.workspaceId);
  // Personal hosted routing is intentionally open: CLI setup is step 1, Phone/App access is step 2.
  // Fresh accounts may create status updates and Requests before the phone purchase/trial is ready;
  // entitlement is enforced when a human responds.
}

export async function requireResponseEntitlement(config: ServerConfig, store: AgentTickStore, auth: AuthContext, request?: Pick<RequestRecord, 'isTest'>): Promise<void> {
  if (auth.workspaceType === 'shared') return requireSharedWorkspaceResponses(config, store, auth.workspaceId);
  await requireHostedPersonalResponse(config, store, auth, request);
}

export function requireRequestResponseEntitlement(config: ServerConfig, request: RequestRecord): void {
  if (request.workspaceType === 'shared') requireSharedWorkspaceRequestResponses(config, request.workspaceResponsesEntitled === true);
}

async function requireSharedWorkspaceResponses(config: ServerConfig, store: AgentTickStore, workspaceId: string): Promise<void> {
  if (!sharedWorkspaceBillingApplies(config)) return;
  if (await store.workspaceResponsesEntitled(workspaceId)) return;
  throw workspaceBillingError();
}

function requireSharedWorkspaceRequestResponses(config: ServerConfig, entitled: boolean): void {
  if (!sharedWorkspaceBillingApplies(config)) return;
  if (entitled) return;
  throw workspaceBillingError();
}

function sharedWorkspaceBillingApplies(config: ServerConfig): boolean {
  return config.mode === 'clerk';
}

function workspaceBillingError(): Error & { statusCode: number; code: string } {
  const error = new Error('Workspace billing is inactive. Ask a Workspace Owner or Admin to renew before responding.') as Error & { statusCode: number; code: string };
  error.statusCode = 402;
  error.code = 'workspace_billing_inactive';
  return error;
}
