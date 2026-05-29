import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { pathToFileURL } from 'node:url';
import * as ts from 'typescript';

const tempDirectories = [];

after(() => {
	for (const directory of tempDirectories) rmSync(directory, { recursive: true, force: true });
});

async function loadRoutingModule() {
	const source = readFileSync(new URL('./pageRouting.ts', import.meta.url), 'utf8');
	const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
	const directory = mkdtempSync(path.join(tmpdir(), 'agent-tick-admin-routing-'));
	tempDirectories.push(directory);
	const modulePath = path.join(directory, 'pageRouting.mjs');
	writeFileSync(modulePath, outputText);
	return import(pathToFileURL(modulePath).href);
}

const routing = await loadRoutingModule();

const readyOnboarding = { hasActiveDevice: true, hasActiveAgent: true };
const baseWorkspace = { workspaceId: 'wsp_hidden', type: 'personal', name: 'Personal', userId: 'usr_hidden', role: 'owner', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' };
const pushReadyDevice = { deviceId: 'dev_hidden', userId: 'usr_hidden', name: 'Phone', expoPushToken: 'ExponentPushToken[token]', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const connectedToken = { agentTokenId: 'agt_hidden', workspaceId: 'wsp_hidden', label: 'Agent', scopes: [], lastCheckInAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' };
const routingRule = { routingRuleId: 'rul_hidden', workspaceId: 'wsp_hidden', name: 'Route', requiredResponseMode: 'any_one', requiredResponseCount: 1, recipientUserIds: ['usr_hidden'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

test('pageFromPath maps clean console routes', () => {
	assert.equal(routing.pageFromPath('/'), 'root');
	assert.equal(routing.pageFromPath('/setup'), 'connections');
	assert.equal(routing.pageFromPath('/connections'), 'connections');
	assert.equal(routing.pageFromPath('/workspace'), 'workspace');
	assert.equal(routing.pageFromPath('/members'), 'workspace');
	assert.equal(routing.pageFromPath('/activity'), 'activity');
	assert.equal(routing.pageFromPath('/settings'), 'settings');
	assert.equal(routing.pageFromPath('/unknown/path'), 'setup');
});

test('pageFromPath detects CLI authorization query flow', () => {
	assert.equal(routing.pageFromPath('/', '?cli_callback=http%3A%2F%2F127.0.0.1%2Fcb&cli_state=abc'), 'cli-authorize');
});

test('legacy hashes only map supported console routes', () => {
	assert.equal(routing.pageFromHash('#activity'), 'activity');
	assert.equal(routing.pageFromHash('#setup'), 'connections');
	assert.equal(routing.pageFromHash('#connections'), 'connections');
	assert.equal(routing.pageFromHash('#workspace'), 'workspace');
	assert.equal(routing.pageFromHash('#members'), 'workspace');
	assert.equal(routing.pageFromHash('#settings'), 'settings');
	assert.equal(routing.pageFromHash('#/unknown/path'), 'setup');
	assert.equal(routing.pageFromHash('#unknown'), 'setup');
	assert.equal(routing.pageFromHash('', true, 'setup'), 'setup');
});

test('defaultPageForSetupStatus routes ready and incomplete Personal Workspaces', () => {
	assert.equal(routing.defaultPageForSetupStatus({ hasActiveDevice: false, hasActiveAgent: false }), 'connections');
	assert.equal(routing.defaultPageForSetupStatus(readyOnboarding), 'activity');
});

test('selectedWorkspaceReadiness routes Personal Workspace ready and incomplete states', () => {
	assert.deepEqual(routing.selectedWorkspaceReadiness({ workspace: baseWorkspace, devices: [pushReadyDevice], agentTokens: [connectedToken], pendingRequestCount: 2 }), {
		landingPage: 'activity',
		ready: true,
		memberReady: true,
		approvalDeviceReady: true,
		agentConnectionReady: true,
		routeHealthReady: true,
		pendingRequestCount: 2,
		reasons: []
	});
	assert.deepEqual(routing.selectedWorkspaceReadiness({ workspace: baseWorkspace, devices: [], agentTokens: [connectedToken], pendingRequestCount: 5 }), {
		landingPage: 'connections',
		ready: false,
		memberReady: true,
		approvalDeviceReady: false,
		agentConnectionReady: true,
		routeHealthReady: true,
		pendingRequestCount: 5,
		reasons: ['needs_approval_device']
	});
});

test('selectedWorkspaceReadiness sends Shared Workspaces with too few active members to Workspace', () => {
	const readiness = routing.selectedWorkspaceReadiness({ workspace: { ...baseWorkspace, type: 'shared' }, activeMemberCount: 1, devices: [pushReadyDevice], agentTokens: [{ ...connectedToken, routingRuleId: 'rul_hidden' }], routingRules: [routingRule] });
	assert.equal(readiness.landingPage, 'workspace');
	assert.equal(readiness.memberReady, false);
	assert.deepEqual(readiness.reasons, ['shared_needs_members']);
});

test('selectedWorkspaceReadiness treats unhealthy Shared Workspace routing as incomplete', () => {
	const readiness = routing.selectedWorkspaceReadiness({ workspace: { ...baseWorkspace, type: 'shared' }, activeMemberCount: 2, devices: [pushReadyDevice], agentTokens: [connectedToken], routingRules: [routingRule] });
	assert.equal(readiness.landingPage, 'connections');
	assert.equal(readiness.routeHealthReady, false);
	assert.deepEqual(readiness.reasons, ['needs_route_health']);
});

test('selectedWorkspaceReadiness uses server Routing Preview health for Shared Workspace root routing', () => {
	const readiness = routing.selectedWorkspaceReadiness({
		workspace: { ...baseWorkspace, type: 'shared' },
		activeMemberCount: 2,
		devices: [pushReadyDevice],
		agentTokens: [{ ...connectedToken, routingRuleId: 'rul_hidden' }],
		routingRules: [routingRule],
		routingPreviews: { rul_hidden: { routingRuleId: 'rul_hidden', status: 'unhealthy', summary: '1 selected · 0 push-ready · 1 available', selectedRecipientCount: 1, pushReadyRecipientCount: 0, availableRecipientCount: 1, requiredResponseCount: 1, unhealthyReasons: ['no_push_ready_recipients'] } }
	});
	assert.equal(readiness.landingPage, 'connections');
	assert.equal(readiness.routeHealthReady, false);
	assert.deepEqual(readiness.reasons, ['needs_route_health']);
});

test('selectedWorkspaceReadiness fails closed when Shared Workspace Routing Preview is unavailable', () => {
	const readiness = routing.selectedWorkspaceReadiness({
		workspace: { ...baseWorkspace, type: 'shared' },
		activeMemberCount: 2,
		devices: [pushReadyDevice],
		agentTokens: [{ ...connectedToken, routingRuleId: 'rul_hidden' }],
		routingRules: [routingRule],
		routingPreviews: {}
	});
	assert.equal(readiness.landingPage, 'connections');
	assert.equal(readiness.routeHealthReady, false);
	assert.deepEqual(readiness.reasons, ['needs_route_health']);
});

test('canManageConnections is limited to Shared Workspace Owners and Admins', () => {
	assert.equal(routing.canManageConnections({ ...baseWorkspace, type: 'shared', role: 'owner' }), true);
	assert.equal(routing.canManageConnections({ ...baseWorkspace, type: 'shared', role: 'admin' }), true);
	assert.equal(routing.canManageConnections({ ...baseWorkspace, type: 'shared', role: 'member' }), false);
	assert.equal(routing.canManageConnections({ ...baseWorkspace, type: 'personal', role: 'owner' }), false);
});

test('pending Requests do not override incomplete readiness for root routing', () => {
	const readiness = routing.selectedWorkspaceReadiness({ workspace: baseWorkspace, devices: [], agentTokens: [connectedToken], pendingRequestCount: 7 });
	assert.equal(readiness.landingPage, 'connections');
	assert.equal(readiness.pendingRequestCount, 7);
});

test('refreshLoadKeys follows the active page', () => {
	assert.deepEqual(routing.refreshLoadKeys('setup'), ['setup']);
	assert.deepEqual(routing.refreshLoadKeys('connections'), ['setup']);
	assert.deepEqual(routing.refreshLoadKeys('workspace'), ['settings']);
	assert.deepEqual(routing.refreshLoadKeys('activity'), ['activity']);
	assert.deepEqual(routing.refreshLoadKeys('settings'), ['settings']);
});

test('shouldShowEntitlementStatus is scoped to Workspace', () => {
	assert.equal(routing.shouldShowEntitlementStatus({ activePage: 'workspace', isWorkspaceOwner: true, billingPlan: 'shared' }), true);
	assert.equal(routing.shouldShowEntitlementStatus({ activePage: 'workspace', isWorkspaceOwner: false, billingError: 'billing unavailable' }), true);
	assert.equal(routing.shouldShowEntitlementStatus({ activePage: 'settings', isWorkspaceOwner: true, billingPlan: 'shared' }), false);
});
