import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('./App.svelte', import.meta.url), 'utf8');
const headerSource = readFileSync(new URL('./components/ConsoleHeader.svelte', import.meta.url), 'utf8');

test('hosted Shared Workspace creation uses Clerk organization mechanics', () => {
	assert.match(appSource, /createClerkBackedSharedWorkspace/);
	assert.match(appSource, /clerkOrganization\.createOrganization/);
	assert.match(appSource, /redirectToCreateOrganization/);
	assert.match(appSource, /action: 'clerk_workspace_create'/);
});

test('workspace switching mirrors Clerk active organization and labels Personal context', () => {
	assert.match(appSource, /clerkSetActiveOrganization/);
	assert.match(appSource, /workspace\?\.type === 'shared' \? workspace\.clerkOrganizationId \?\? null : null/);
	assert.match(appSource, /activeClerkOrganizationId/);
	assert.match(appSource, /workspaceIdForActiveClerkOrganization/);
	assert.match(headerSource, /mountOrganizationSwitcher/);
	assert.match(headerSource, /aria-label="Clerk Workspace switcher"/);
	assert.doesNotMatch(headerSource, /selectedWorkspaceLabel/);
	assert.match(headerSource, /workspace\.type === 'personal' \? 'Personal'/);
});

test('admin boot cleans Clerk callbacks and only redirects Personal Workspace after data loads', () => {
	assert.match(appSource, /const callbackUrl = window\.location\.href/);
	assert.match(appSource, /replaceLocation\(redirectTarget\)/);
	assert.match(appSource, /workspaces\.length > 0 && activePage === 'workspace'/);
	assert.match(appSource, /replacePage\('connections'\)/);
});
