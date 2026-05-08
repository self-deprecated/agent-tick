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

test('inviteAcceptedMessage distinguishes approved and pending states', () => {
	assert.equal(inviteAcceptedMessage('approved'), 'Invite accepted. You now have access to this organization.');
	assert.equal(inviteAcceptedMessage('joined'), 'Invite accepted. You now have access to this organization.');
	assert.equal(inviteAcceptedMessage('already_member'), 'Invite accepted. You now have access to this organization.');
	assert.equal(inviteAcceptedMessage('pending_approval'), 'Request sent. An organization admin needs to approve your access before you can use this organization.');
	assert.equal(inviteAcceptedMessage('rejected'), 'Your request to join this organization was rejected.');
	assert.equal(inviteAcceptedMessage('removed'), 'Invite status changed. Refresh your dashboard for the latest access state.');
});
