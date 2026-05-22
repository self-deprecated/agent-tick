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

test('pageFromPath maps clean console routes', () => {
	assert.equal(routing.pageFromPath('/'), 'setup');
	assert.equal(routing.pageFromPath('/setup'), 'setup');
	assert.equal(routing.pageFromPath('/activity'), 'activity');
	assert.equal(routing.pageFromPath('/settings'), 'settings');
	assert.equal(routing.pageFromPath('/invite/token-123'), 'invite');
});

test('pageFromPath detects CLI authorization query flow', () => {
	assert.equal(routing.pageFromPath('/', '?cli_callback=http%3A%2F%2F127.0.0.1%2Fcb&cli_state=abc'), 'cli-authorize');
});

test('legacy hashes only map supported focused routes', () => {
	assert.equal(routing.pageFromHash('#activity'), 'activity');
	assert.equal(routing.pageFromHash('#settings'), 'settings');
	assert.equal(routing.pageFromHash('#/invite/token-123'), 'invite');
	assert.equal(routing.pageFromHash('#unknown'), 'setup');
	assert.equal(routing.pageFromHash('', true, 'setup'), 'setup');
});

test('defaultPageForSetupStatus keeps root on Setup', () => {
	assert.equal(routing.defaultPageForSetupStatus({ hasActiveDevice: false, hasActiveAgent: false }), 'setup');
	assert.equal(routing.defaultPageForSetupStatus({ hasActiveDevice: true, hasActiveAgent: true }), 'setup');
});

test('refreshLoadKeys follows the active page', () => {
	assert.deepEqual(routing.refreshLoadKeys('setup'), ['setup']);
	assert.deepEqual(routing.refreshLoadKeys('activity'), ['activity']);
	assert.deepEqual(routing.refreshLoadKeys('settings'), ['settings']);
	assert.deepEqual(routing.refreshLoadKeys('invite'), ['setup']);
});

test('shouldShowEntitlementStatus is scoped to Settings', () => {
	assert.equal(routing.shouldShowEntitlementStatus({ activePage: 'settings', isWorkspaceOwner: true, billingPlan: 'shared' }), true);
	assert.equal(routing.shouldShowEntitlementStatus({ activePage: 'settings', isWorkspaceOwner: false, billingError: 'billing unavailable' }), true);
	assert.equal(routing.shouldShowEntitlementStatus({ activePage: 'setup', isWorkspaceOwner: true, billingPlan: 'shared' }), false);
});
