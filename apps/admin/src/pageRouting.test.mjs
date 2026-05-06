import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { pathToFileURL } from 'node:url';
import * as ts from 'typescript';

const tempDirectories = [];

after(() => {
	for (const directory of tempDirectories) {
		rmSync(directory, { recursive: true, force: true });
	}
});

async function loadRoutingModule() {
	const source = readFileSync(new URL('./pageRouting.ts', import.meta.url), 'utf8');
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.ES2022,
			target: ts.ScriptTarget.ES2022
		}
	});
	const directory = mkdtempSync(path.join(tmpdir(), 'agent-tick-admin-routing-'));
	tempDirectories.push(directory);
	const modulePath = path.join(directory, 'pageRouting.mjs');
	writeFileSync(modulePath, outputText);
	return import(pathToFileURL(modulePath).href);
}

const routing = await loadRoutingModule();

test('pageFromHash maps known pages', () => {
	assert.equal(routing.pageFromHash('#setup', true), 'setup');
	assert.equal(routing.pageFromHash('#approvals', true), 'approvals');
	assert.equal(routing.pageFromHash('#organization', true), 'organization');
});

test('pageFromHash gates direct admin hashes for non-admin users', () => {
	assert.equal(routing.pageFromHash('#admin', true), 'admin');
	assert.equal(routing.pageFromHash('#admin', false), 'setup');
});

test('pageFromHash keeps setup anchors on the setup page', () => {
	assert.equal(routing.pageFromHash('#setup', true, 'approvals'), 'setup');
	assert.equal(routing.pageFromHash('#devices', true, 'approvals'), 'setup');
	assert.equal(routing.pageFromHash('#agents', true, 'approvals'), 'setup');
	assert.equal(routing.pageFromHash('', true), 'setup');
	assert.equal(routing.pageFromHash('', true, 'approvals'), 'approvals');
});

test('defaultPageForSetupStatus sends complete setups to approvals', () => {
	assert.equal(routing.defaultPageForSetupStatus({ hasActiveDevice: false, hasActiveAgent: false }), 'setup');
	assert.equal(routing.defaultPageForSetupStatus({ hasActiveDevice: true, hasActiveAgent: false }), 'setup');
	assert.equal(routing.defaultPageForSetupStatus({ hasActiveDevice: false, hasActiveAgent: true }), 'setup');
	assert.equal(routing.defaultPageForSetupStatus({ hasActiveDevice: true, hasActiveAgent: true }), 'approvals');
});

test('refreshLoadKeys avoids duplicate page-specific fetches', () => {
	assert.deepEqual(routing.refreshLoadKeys('setup'), ['devices', 'agents', 'approvals', 'organizations']);
	assert.deepEqual(routing.refreshLoadKeys('approvals'), ['devices', 'agents', 'organizations']);
	assert.deepEqual(routing.refreshLoadKeys('organization'), ['devices', 'agents', 'approvals']);
	assert.deepEqual(routing.refreshLoadKeys('admin'), ['devices', 'agents', 'approvals']);
});

test('shouldShowBillingPanel shows hosted loading and error states', () => {
	assert.equal(
		routing.shouldShowBillingPanel({ activePage: 'admin', isOrgAdmin: true, isUserMode: true, billingStatus: 'loading', billingError: '', billingPlan: undefined }),
		true
	);
	assert.equal(
		routing.shouldShowBillingPanel({ activePage: 'admin', isOrgAdmin: true, isUserMode: true, billingStatus: 'error', billingError: 'billing unavailable', billingPlan: undefined }),
		true
	);
	for (const billingError of ['   ', '\n\t']) {
		assert.equal(
			routing.shouldShowBillingPanel({ activePage: 'admin', isOrgAdmin: true, isUserMode: true, billingStatus: 'error', billingError, billingPlan: undefined }),
			true
		);
	}
});

test('shouldShowBillingPanel preserves hosted-plan display semantics', () => {
	assert.equal(
		routing.shouldShowBillingPanel({ activePage: 'admin', isOrgAdmin: true, isUserMode: true, billingStatus: 'ready', billingError: '', billingPlan: 'team' }),
		true
	);
	assert.equal(
		routing.shouldShowBillingPanel({ activePage: 'admin', isOrgAdmin: true, isUserMode: true, billingStatus: 'ready', billingError: '', billingPlan: '' }),
		true
	);
});

test('shouldShowBillingPanel hides self-hosted, unauthorized, and idle hosted states', () => {
	assert.equal(
		routing.shouldShowBillingPanel({ activePage: 'admin', isOrgAdmin: true, isUserMode: true, billingStatus: 'ready', billingError: '', billingPlan: 'self-hosted' }),
		false
	);
	assert.equal(
		routing.shouldShowBillingPanel({ activePage: 'admin', isOrgAdmin: true, isUserMode: true, billingStatus: 'idle', billingError: '', billingPlan: undefined }),
		false
	);
	assert.equal(
		routing.shouldShowBillingPanel({ activePage: 'admin', isOrgAdmin: false, isUserMode: true, billingStatus: 'error', billingError: 'billing unavailable' }),
		false
	);
	assert.equal(
		routing.shouldShowBillingPanel({ activePage: 'admin', isOrgAdmin: true, isUserMode: false, billingStatus: 'loading', billingError: '' }),
		false
	);
});
