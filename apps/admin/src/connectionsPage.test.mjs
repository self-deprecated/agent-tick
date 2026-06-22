import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./components/SetupPage.svelte', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('./App.svelte', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('./components/SettingsPage.svelte', import.meta.url), 'utf8');

test('Connections page presents phone-first recommended order', () => {
	assert.match(source, /1\. Connect your phone/);
	assert.match(source, /2\. Send a Test Request/);
	assert.match(source, /3\. Connect an Agent/);
	assert.match(source, /4\. Receive real Agent Activity/);
	assert.match(source, /agenttick\.sh\/skill/);
});

test('Connections page keeps setup instructions visible and tests usable', () => {
	assert.match(source, /These instructions stay visible from the start/);
	assert.match(source, /Recommended after there is/);
	assert.doesNotMatch(source, /disabled=\{Boolean\(testRequirements\.length/);
	assert.match(source, /Send Steering Test Request/);
});

test('Connections page explains Private Request-only test paths', () => {
	assert.match(appSource, /privateRequestsPolicy=\{currentUser\?\.privateRequestsPolicy\}/);
	assert.match(source, /privateRequestTestReason\(rule\)/);
	assert.match(source, /Web Steering and Sanction tests are plaintext/);
	assert.match(source, /agent-tick send steering --private/);
	assert.match(source, /disabled=\{Boolean\(testBusy\) \|\| Boolean\(selectedTestRoutePrivateRequiredReason\)\}/);
	assert.match(source, /disabled=\{Boolean\(testBusy\) \|\| Boolean\(routePrivateRequiredReason\)\}/);
	assert.match(source, /Status Update tests remain available/);
});

test('CLI authorization posts setup tokens outside the callback URL', () => {
	assert.match(appSource, /new URLSearchParams\(\)/);
	assert.match(appSource, /callbackBody\.set\('token', credential\.token\)/);
	assert.match(appSource, /fetch\(cliSetup\.callbackURL, \{ method: 'POST'/);
	assert.doesNotMatch(appSource, /callback\.searchParams\.set\('token'/);
});

test('Connections page gates mutating routing controls and uses server preview for saved rules', () => {
	assert.match(appSource, /selectedWorkspaceCanManageConnections/);
	assert.match(appSource, /canManageConnections\(selectedWorkspace\)/);
	assert.match(appSource, /onRunRuleTest=\{selectedWorkspaceCanManageConnections \?/);
	assert.match(source, /@const health = routeHealth\(rule\)/);
	assert.doesNotMatch(source, /@const health = routeHealthForInput\(recipients, requiredCount/);
});

test('Connections page uses Workspace Member picker for Routing Rule create and edit', () => {
	assert.match(source, /Workspace Member picker/);
	assert.match(source, /Create Routing Rule/);
	assert.match(source, /Save Routing Rule/);
	assert.match(source, /Save recipients/);
	assert.match(source, /memberRoleLabel/);
	assert.match(source, /memberAvailabilityLabel/);
	assert.match(source, /Push ready/);
	assert.match(source, /Required responses/);
	assert.doesNotMatch(source, /Recipient user IDs|comma-separated raw user IDs/);
});

test('Connections page shows Shared Workspace Routing Rules and Agent Assignment route health', () => {
	assert.match(source, /Routing Rules/);
	assert.match(source, /Agent Assignment/);
	assert.match(source, /assigned Agent Connections/);
	assert.match(source, /route health/);
	assert.match(source, /Send route test/);
	assert.doesNotMatch(settingsSource, /Create Routing Rule/);
});

test('Connections page explains unhealthy routes without exposing device inventories', () => {
	assert.match(source, /This rule has no selected recipients/);
	assert.match(source, /No selected recipient has a push-ready Approval Device/);
	assert.match(source, /Selected recipients are unavailable; this may become Unrouted/);
	assert.match(source, /This rule cannot be satisfied until recipients are added or required responses are lowered/);
	assert.match(source, /Assigned Agent Connections may become unroutable/);
	assert.match(source, /Recipient readiness is shown as aggregate counts/);
});

test('Connections and Workspace architecture keeps future external/audience controls out of launch UI', () => {
	assert.doesNotMatch(source, /External Approver|Audience Channel|Audience Participant/);
	assert.doesNotMatch(settingsSource, /External Approver|Audience Channel|Audience Participant/);
});

test('Connections page uses product-facing rows without raw ID display', () => {
	assert.match(source, /Agent Connections/);
	assert.match(source, /Approval Devices/);
	assert.match(source, /Disconnect/);
	assert.doesNotMatch(source, />\{token\.agentTokenId\}</);
	assert.doesNotMatch(source, />\{device\.deviceId\}</);
	assert.doesNotMatch(source, /No Routing Rule/);
	assert.match(source, /workspace\?\.type === 'shared'/);
	assert.match(settingsSource, /Developer/);
});
