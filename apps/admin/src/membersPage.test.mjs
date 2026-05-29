import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./components/WorkspacePage.svelte', import.meta.url), 'utf8');
const routingSource = readFileSync(new URL('./pageRouting.ts', import.meta.url), 'utf8');

test('Workspace tab shows Shared Workspace roles Availability and approval readiness', () => {
	assert.match(source, /Manage selected Workspace members, roles, response entitlement, and approval readiness/);
	assert.match(source, /memberRoleLabel/);
	assert.match(source, /memberAvailabilityLabel/);
	assert.match(source, /memberApprovalReadiness/);
	assert.match(source, /Can receive Requests from/);
	assert.match(source, /Needs a push-ready Approval Device/);
	assert.match(source, /No Routing Rules include this member/);
});

test('Workspace tab opens real Clerk organization management for shared workspaces only', () => {
	assert.doesNotMatch(source, /mountOrganizationList/);
	assert.doesNotMatch(source, /Clerk Workspace list/);
	assert.match(source, /canManageWorkspace/);
	assert.match(source, /workspace\?\.role === 'owner' \|\| workspace\?\.role === 'admin'/);
	assert.match(source, /openOrganizationProfile/);
	assert.match(source, /Manage in Clerk/);
	assert.match(source, /Invite people and change Workspace roles with Clerk/);
	assert.match(source, /member\.userId === currentUser\?\.userId/);
	assert.match(source, /onUpdateOwnAvailability/);
});

test('Workspace tab and routing hide raw ids outside diagnostics and route incomplete Shared Workspaces to Workspace', () => {
	assert.doesNotMatch(source, /clerkMembershipId/);
	assert.doesNotMatch(source, /routingRuleId\}/);
	assert.match(routingSource, /!memberReady \? 'workspace'/);
});
