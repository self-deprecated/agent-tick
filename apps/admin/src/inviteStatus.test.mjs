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
	const source = readFileSync(new URL('./inviteStatus.ts', import.meta.url), 'utf8');
	const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
	const directory = mkdtempSync(path.join(tmpdir(), 'agent-tick-admin-invite-status-'));
	tempDirectories.push(directory);
	const modulePath = path.join(directory, 'inviteStatus.mjs');
	writeFileSync(modulePath, outputText);
	return import(pathToFileURL(modulePath).href);
}

const { inviteAcceptedMessage } = await loadModule();

test('inviteAcceptedMessage distinguishes accepted and pending states', () => {
	assert.equal(inviteAcceptedMessage('approved'), 'Invite accepted. You now have access to this Workspace.');
	assert.equal(inviteAcceptedMessage('joined'), 'Invite accepted. You now have access to this Workspace.');
	assert.equal(inviteAcceptedMessage('already_member'), 'Invite accepted. You now have access to this Workspace.');
	assert.equal(inviteAcceptedMessage('pending'), 'Request sent. A Workspace Owner needs to accept your access before you can use this Workspace.');
	assert.equal(inviteAcceptedMessage('rejected'), 'Your request to join this Workspace was rejected.');
	assert.equal(inviteAcceptedMessage('removed'), 'Invite status changed. Refresh your dashboard for the latest access state.');
});
