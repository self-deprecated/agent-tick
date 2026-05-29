import { expect, test } from '@playwright/test';
import { expectOk, waitForHealthAndReady } from './support/selfhost';

test.describe('Docker self-host static/admin security smoke', () => {
  test('serves dashboard routes without exposing internals or API HTML fallbacks', async ({ request, baseURL }) => {
    const api404 = await request.get(`${baseURL}/v1/definitely-not-real`, { headers: { accept: 'application/json' } });
    expect(api404.status()).toBe(404);
    expect(api404.headers()['content-type']).toContain('application/json');
    const apiBody = await api404.json() as { error?: { code?: string; message?: string } };
    expect(apiBody.error?.code).toBe('not_found');

    const dashboardRoute = await request.get(`${baseURL}/settings/privacy`, { headers: { accept: 'text/html' } });
    await expectOk(dashboardRoute, 'dashboard fallback route');
    const html = await dashboardRoute.text();
    expect(html).toContain('<!doctype html>');
    expect(html).not.toContain('AGENT_TICK_ADMIN_TOKEN');

    const assetPaths = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g)).map((match) => match[1]).filter((path) => path.startsWith('/assets/'));
    expect(assetPaths.length).toBeGreaterThan(0);
    for (const asset of assetPaths.slice(0, 5)) await expectOk(await request.get(`${baseURL}${asset}`), `dashboard asset ${asset}`);

    const sensitivePaths = ['/.env', '/agent-tick.db', '/data/agent-tick.db', '/src/index.ts', '/dist/index.js', '/package.json', '/pnpm-lock.yaml', '/assets/app.js.map'];
    for (const path of sensitivePaths) {
      const response = await request.get(`${baseURL}${path}`, { headers: { accept: 'application/json' } });
      expect(response.status(), `${path} should not be served`).toBe(404);
      const text = await response.text();
      expect(text).not.toContain('/app');
      expect(text).not.toContain('AGENT_TICK');
      expect(text).not.toContain('adm_');
    }

    await waitForHealthAndReady(baseURL);
  });
});
