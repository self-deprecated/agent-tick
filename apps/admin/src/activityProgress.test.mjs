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

async function loadModule() {
	const source = readFileSync(new URL('./components/activityProgress.ts', import.meta.url), 'utf8');
	const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
	const directory = mkdtempSync(path.join(tmpdir(), 'agent-tick-admin-activity-progress-'));
	tempDirectories.push(directory);
	const modulePath = path.join(directory, 'activityProgress.mjs');
	writeFileSync(modulePath, outputText);
	return import(pathToFileURL(modulePath).href);
}

const progress = await loadModule();

function request(workspaceId) {
	return {
		id: 'req_1',
		workspaceId,
		requester: { name: 'Agent' },
		requestType: 'sanction',
		title: 'Approve deploy',
		choices: [],
		status: 'pending',
		createdAt: new Date(0).toISOString(),
		quorum: {
			requiredResponseCount: 1,
			receivedResponseCount: 0,
			waitingFor: 1,
			currentUserEligible: true,
			currentUserResponded: false,
			recipients: [],
			responses: []
		}
	};
}

test('quorumText suppresses redundant progress for one-user workspaces', () => {
	assert.equal(progress.quorumText(request('w_one'), { w_one: 1 }), 'pending');
});

test('quorumText keeps progress for multi-user workspaces', () => {
	assert.equal(progress.quorumText(request('w_team'), { w_team: 2 }), '0/1 Responses · waiting for 1');
});

test('suppression is based on the request workspace id', () => {
	assert.equal(progress.quorumText(request('w_team'), { w_one: 1, w_team: 3 }), '0/1 Responses · waiting for 1');
	assert.equal(progress.quorumText(request('w_one'), { w_one: 1, w_team: 3 }), 'pending');
});

test('high-risk Sanctions require confirmation only for non-deny choices', () => {
	const highRisk = { ...request('w_one'), risk: 'high' };
	assert.equal(progress.requiresHighRiskConfirmation(highRisk, { kind: 'approve' }), true);
	assert.equal(progress.requiresHighRiskConfirmation(highRisk, { kind: 'deny' }), false);
	assert.equal(progress.requiresHighRiskConfirmation({ ...highRisk, requestType: 'steering' }, { kind: 'approve' }), false);
	assert.equal(progress.requiresHighRiskConfirmation({ ...highRisk, risk: 'medium' }, { kind: 'approve' }), false);
});
