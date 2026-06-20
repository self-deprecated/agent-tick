import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('./App.svelte', import.meta.url), 'utf8');
const setupSource = readFileSync(new URL('./components/SetupPage.svelte', import.meta.url), 'utf8');

test('Send Test Activity surfaces a visible error instead of failing silently', () => {
  // App.svelte must catch sendTestActivity failures and expose a safe message.
  assert.match(appSource, /try\s*\{[\s\S]*sendTestActivity[\s\S]*catch\s*\(error\)\s*\{[\s\S]*testError\s*=\s*testActivityErrorMessage\(error\)/);
  // The message must avoid leaking raw SQL/internals for schema drift.
  assert.match(appSource, /error\.code === 'schema_mismatch'/);
  // The error state must be passed to the setup component.
  assert.match(appSource, /\{testError\}/);
});

test('Setup page renders the inline test-request error', () => {
  assert.match(setupSource, /testError/);
  assert.match(setupSource, /Test activity failed:/);
  assert.match(setupSource, /role="alert"/);
});
