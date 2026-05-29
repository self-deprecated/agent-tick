import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./components/ConsoleHeader.svelte', import.meta.url), 'utf8');

test('header delegates account UI to Clerk user button', () => {
	assert.match(source, /clerk\.mountUserButton\(target, \{ userProfileMode: 'modal' \}\)/);
	assert.doesNotMatch(source, />Manage account</);
	assert.doesNotMatch(source, />Sign out</);
	assert.doesNotMatch(source, /currentUser/);
});

test('header keeps workspace identity in the switcher, not the brand block', () => {
	assert.match(source, /\? 'Personal' : `\$\{workspace\.name\} · Shared Workspace`/);
	assert.doesNotMatch(source, /workspace-label/);
	assert.doesNotMatch(source, /selectedWorkspaceLabel/);
	assert.doesNotMatch(source, /Personal · Personal/);
	assert.doesNotMatch(source, /Clerk Organization/);
});
