import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createAgentToken, createSanctionRequest, expectOk, waitForHealthAndReady } from './support/selfhost';

async function readCaptures(): Promise<Array<{ body: string; url: string }>> {
  const path = process.env.AGENT_TICK_E2E_WEBHOOK_CAPTURE_FILE;
  if (!path) throw new Error('AGENT_TICK_E2E_WEBHOOK_CAPTURE_FILE is required');
  const text = await readFile(path, 'utf8').catch(() => '');
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { body: string; url: string });
}

async function waitForCaptureContaining(title: string): Promise<{ body: string; url: string }> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const match = (await readCaptures()).find((capture) => capture.body.includes(title));
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for webhook capture containing ${title}`);
}

test.describe('Docker self-host webhook notifications', () => {
  test('delivers sanitized request-created payloads and tolerates receiver failure', async ({ request, baseURL }) => {
    const controlURL = process.env.AGENT_TICK_E2E_WEBHOOK_CONTROL_URL;
    if (!controlURL) throw new Error('AGENT_TICK_E2E_WEBHOOK_CONTROL_URL is required');
    const secretNeedle = process.env.AGENT_TICK_E2E_WEBHOOK_SECRET_NEEDLE ?? 'adm_';
    const stamp = Date.now();
    const agent = await createAgentToken(request, baseURL, `Docker webhook agent ${stamp}`);

    await fetch(`${controlURL}/ok`, { method: 'POST' });
    const delivered = await createSanctionRequest(request, baseURL, agent.token, `Docker webhook delivered ${stamp}`, { metadata: { purpose: 'webhook-e2e' } });
    expect(delivered.request.status).toBe('pending');
    const capture = await waitForCaptureContaining(delivered.request.title);
    const payload = JSON.parse(capture.body) as { type: string; workspaceId: string; request: { id: string; title: string; body?: string; command?: string }; url?: string };
    expect(payload).toMatchObject({ type: 'request.created', workspaceId: delivered.request.workspaceId, request: { id: delivered.request.id, title: delivered.request.title } });
    expect(capture.body).not.toContain(secretNeedle);
    expect(capture.body).not.toContain(agent.token);
    expect(capture.body).not.toContain('wait_');
    expect(capture.body).not.toContain('device_');

    await fetch(`${controlURL}/fail`, { method: 'POST' });
    const failedTitle = `Docker webhook receiver failure ${stamp}`;
    const stillCreated = await createSanctionRequest(request, baseURL, agent.token, failedTitle);
    expect(stillCreated.request.status).toBe('pending');
    await waitForCaptureContaining(failedTitle);

    const health = await request.get(`${baseURL}/healthz`);
    await expectOk(health, 'health after webhook failure');
    await waitForHealthAndReady(baseURL);
  });
});
