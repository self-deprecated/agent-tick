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
	const source = readFileSync(new URL('./inviteRouting.ts', import.meta.url), 'utf8');
	const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
	const directory = mkdtempSync(path.join(tmpdir(), 'agent-tick-admin-invite-routing-'));
	tempDirectories.push(directory);
	const modulePath = path.join(directory, 'inviteRouting.mjs');
	writeFileSync(modulePath, outputText);
	return import(pathToFileURL(modulePath).href);
}

const { inviteTokenFromLocation } = await loadModule();

test('inviteTokenFromLocation parses path and hash invite links', () => {
	assert.equal(inviteTokenFromLocation('/invite/invite_123', ''), 'invite_123');
	assert.equal(inviteTokenFromLocation('/', '#/invite/invite_456'), 'invite_456');
	assert.equal(inviteTokenFromLocation('/', '#invite/invite%20encoded'), 'invite encoded');
	assert.equal(inviteTokenFromLocation('/dashboard', '#approvals'), '');
});

test('inviteTokenFromLocation survives OAuth callback query noise on invite deep links', () => {
	assert.equal(inviteTokenFromLocation('/invite/invite_path?__clerk_status=complete', ''), 'invite_path');
	assert.equal(inviteTokenFromLocation('/', '#/invite/invite_hash?rotating_token_nonce=nonce&provider=oauth_google'), 'invite_hash');
	assert.equal(inviteTokenFromLocation('/', '#invite/invite_github?provider=oauth_github'), 'invite_github');
});
