import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { pathToFileURL } from 'node:url';
import * as ts from 'typescript';

const tempDirectories = [];
after(() => { for (const directory of tempDirectories) rmSync(directory, { recursive: true, force: true }); });

async function loadModule() {
	const source = readFileSync(new URL('./inviteFlow.ts', import.meta.url), 'utf8');
	const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
	const directory = mkdtempSync(path.join(tmpdir(), 'agent-tick-admin-invite-flow-'));
	tempDirectories.push(directory);
	const modulePath = path.join(directory, 'inviteFlow.mjs');
	writeFileSync(modulePath, outputText);
	return import(pathToFileURL(modulePath).href);
}

const { inviteAcceptStarted } = await loadModule();

test('inviteAcceptStarted clears stale success before a new accept attempt', () => {
	assert.deepEqual(inviteAcceptStarted(), { inviteAccepted: null, inviteAcceptStatus: 'loading', inviteFlowError: '' });
});
