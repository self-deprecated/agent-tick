import http from 'node:http';
import { expect, test } from '@playwright/test';

const adminToken = process.env.AGENT_TICK_E2E_ADMIN_TOKEN;

type CapturedCallback = {
  method: string;
  url: string;
  body: string;
  headers: http.IncomingHttpHeaders;
};

async function startSetupCallbackServer(): Promise<{
  callbackURL: string;
  close: () => Promise<void>;
  nextCallback: Promise<CapturedCallback>;
}> {
  let resolveCallback!: (callback: CapturedCallback) => void;
  const nextCallback = new Promise<CapturedCallback>((resolve) => {
    resolveCallback = resolve;
  });
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on('end', () => {
      resolveCallback({
        method: request.method ?? '',
        url: request.url ?? '',
        body: Buffer.concat(chunks).toString('utf8'),
        headers: request.headers
      });
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<h1>Agent Tick configuration complete</h1>');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start setup callback server');
  return {
    callbackURL: `http://127.0.0.1:${address.port}/agent-tick/setup/callback`,
    nextCallback,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

test.describe('Docker self-host CLI setup', () => {
  test('posts the setup token to the loopback callback instead of putting it in the URL', async ({ page, request, baseURL }) => {
    test.skip(!adminToken, 'AGENT_TICK_E2E_ADMIN_TOKEN is required for Docker CLI setup coverage');

    const callbackServer = await startSetupCallbackServer();
    try {
      await page.addInitScript(({ token }) => {
        window.localStorage.setItem('agent_tick_admin_token', token);
      }, { token: adminToken! });

      const state = `state_${Date.now()}`;
      const agentName = `Docker CLI setup ${Date.now()}`;
      const setupURL = new URL('/', baseURL);
      setupURL.searchParams.set('cli_callback', callbackServer.callbackURL);
      setupURL.searchParams.set('cli_state', state);
      setupURL.searchParams.set('cli_name', agentName);

      await page.goto(setupURL.toString(), { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'Authorize Agent Token' })).toBeVisible();
      await page.getByRole('button', { name: 'Authorize' }).click();

      const callback = await callbackServer.nextCallback;
      expect(callback.method).toBe('POST');
      expect(callback.url).toBe('/agent-tick/setup/callback');
      expect(callback.url).not.toContain('token=');
      expect(callback.headers.referer ?? '').not.toContain('agent_');

      const body = new URLSearchParams(callback.body);
      expect(body.get('state')).toBe(state);
      expect(body.get('server')).toBe(baseURL);
      expect(body.get('token')).toMatch(/^agent_/);

      await expect(page.getByText('Agent Token authorized. Return to your terminal.')).toBeVisible();

      const tokensResponse = await request.get(`${baseURL}/v1/agent-tokens`, {
        headers: { authorization: `Bearer ${adminToken}` }
      });
      expect(tokensResponse.ok()).toBeTruthy();
      const tokens = await tokensResponse.json() as Array<{ label: string }>;
      expect(tokens.some((token) => token.label === agentName)).toBe(true);
    } finally {
      await callbackServer.close();
    }
  });
});
