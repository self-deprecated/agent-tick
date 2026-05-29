import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./components/ActivityPage.svelte', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('./App.svelte', import.meta.url), 'utf8');

test('Activity page uses Sessions without mobile stack terminology', () => {
	assert.match(appSource, /scoped\.listSessions/);
	assert.match(appSource, /scoped\.getSession/);
	assert.match(source, /Needs input/);
	assert.match(source, /Recent Sessions/);
	assert.match(source, /Session detail/);
	assert.doesNotMatch(source, /Session Stack|Session Lane/);
});

test('Activity page keeps ready empty, no-pending, error, and web fallback states', () => {
	assert.match(source, /You’re ready\. Agent activity will appear here; use the Native App for day-to-day approvals\./);
	assert.match(source, /No Sessions need input right now\. Terminal and recent Sessions stay available below\./);
	assert.match(source, /Session Activity is temporarily unavailable\. Showing the latest Activity fallback where possible\./);
	assert.match(source, /Web fallback responses are available here; use the Native App for day-to-day approvals\./);
});

test('Activity deep-links selected Sessions and preserves refresh selection', () => {
	assert.match(appSource, /get\('session'\)/);
	assert.match(appSource, /searchParams\.set\('session', sessionId\)/);
	assert.match(appSource, /requestedSessionId && nextSessions\.some/);
});

test('Activity Session detail keeps web fallback response controls available', () => {
	assert.match(source, /sessionDetail\?\.timeline/);
	assert.match(source, /selectedRequest/);
	assert.match(source, /submitResponse\(selectedRequest, \{ choiceId: choice\.id \}\)/);
	assert.match(source, /Web fallback responses are available here/);
});

test('Activity page shows Request waiter liveness without working copy', () => {
	assert.match(source, /Agent waiting for answer/);
	assert.match(source, /Agent wait stale/);
	assert.match(source, /Agent wait expired/);
	assert.match(source, /Agent stopped waiting/);
	assert.match(source, /Agent wait failed/);
	assert.doesNotMatch(source, /Still working/);
});

test('Activity page confirms high-risk Sanctions and hides raw response user IDs', () => {
	assert.match(source, /requiresHighRiskConfirmation/);
	assert.match(source, /Approve this high-risk Sanction\?/);
	assert.doesNotMatch(source, /response\.userId/);
});
