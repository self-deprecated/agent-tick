import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./components/SettingsPage.svelte', import.meta.url), 'utf8');

test('Settings is slimmed to personal account, preferences, support, and diagnostics', () => {
	assert.match(source, /Account and preferences/);
	assert.match(source, /Clerk account management/);
	assert.match(source, /Language/);
	assert.doesNotMatch(source, /Billing and entitlement/);
	assert.doesNotMatch(source, /Workspace membership/);
	assert.doesNotMatch(source, /mountOrganizationSwitcher/);
	assert.match(source, /Support and privacy/);
	assert.match(source, /Developer diagnostics/);
});

test('Settings removes operational setup surfaces from normal UI', () => {
	assert.doesNotMatch(source, /Create Agent Token/);
	assert.doesNotMatch(source, /Create Routing Rule/);
	assert.doesNotMatch(source, /Approval Devices \(/);
	assert.doesNotMatch(source, /Recipient user IDs/);
});

test('Settings lazy-loads raw diagnostics only inside Developer diagnostics', () => {
	assert.match(source, /diagnosticsLoaded = diagnosticsLoaded \|\| event\.currentTarget\.open/);
	assert.match(source, /Developer diagnostics may include raw Workspace, Agent Connection, Approval Device, and event identifiers\./);
	assert.match(source, /Workspace ID/);
	assert.match(source, /event\.targetId/);
});
