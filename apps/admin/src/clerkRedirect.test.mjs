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
	const source = readFileSync(new URL('./clerkRedirect.ts', import.meta.url), 'utf8');
	const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
	const directory = mkdtempSync(path.join(tmpdir(), 'agent-tick-admin-clerk-redirect-'));
	tempDirectories.push(directory);
	const modulePath = path.join(directory, 'clerkRedirect.mjs');
	writeFileSync(modulePath, outputText);
	return import(pathToFileURL(modulePath).href);
}

const { clerkRedirectTarget, hasClerkRedirectCallback } = await loadModule();

test('hasClerkRedirectCallback detects Clerk OAuth callback parameters', () => {
	assert.equal(hasClerkRedirectCallback('https://tick.example.com/?__clerk_status=complete'), true);
	assert.equal(hasClerkRedirectCallback('https://tick.example.com/?rotating_token_nonce=nonce&provider=oauth_github'), true);
	assert.equal(hasClerkRedirectCallback('https://tick.example.com/?cli_state=abc'), false);
});

test('clerkRedirectTarget strips Clerk callback noise but keeps app state', () => {
	assert.equal(
		clerkRedirectTarget('https://tick.example.com/?cli_state=abc&__clerk_status=complete&provider=oauth_github'),
		'https://tick.example.com/?cli_state=abc'
	);
	assert.equal(
		clerkRedirectTarget('https://tick.example.com/invite/invite_123?rotating_token_nonce=nonce&provider=oauth_github'),
		'https://tick.example.com/invite/invite_123'
	);
});

test('clerkRedirectTarget recovers from hosted Clerk routes served by the SPA fallback', () => {
	assert.equal(
		clerkRedirectTarget('https://tick.example.com/sign-in?__clerk_status=complete'),
		'https://tick.example.com/'
	);
});
