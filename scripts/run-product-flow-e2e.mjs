#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const port = Number(process.env.AGENT_TICK_E2E_PORT ?? 18787);
const host = '127.0.0.1';
const baseURL = `http://${host}:${port}`;
const tempDir = await mkdtemp(join(tmpdir(), 'agent-tick-flow-e2e-'));
const databasePath = join(tempDir, 'agent-tick.db');
let server;

try {
  await run('corepack', ['pnpm', '--filter', '@self-deprecated/agent-tick-shared', 'build'], { stdio: 'inherit' });
  await run('corepack', ['pnpm', '--filter', '@agent-tick/db', 'build'], { stdio: 'inherit' });
  await run('corepack', ['pnpm', '--filter', '@self-deprecated/agent-tick-sdk', 'build'], { stdio: 'inherit' });
  await run('corepack', ['pnpm', '--filter', '@agent-tick/i18n', 'build'], { stdio: 'inherit' });
  await run('corepack', ['pnpm', '--filter', 'agent-tick-admin', 'build'], { stdio: 'inherit' });
  await run('corepack', ['pnpm', '--filter', '@agent-tick/server', 'build'], { stdio: 'inherit' });

  server = spawn('corepack', ['pnpm', '--filter', '@agent-tick/server', 'start'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AGENT_TICK_MODE: 'clerk',
      AGENT_TICK_TEST_AUTH: '1',
      AGENT_TICK_DATABASE_URL: `file:${databasePath}`,
      AGENT_TICK_ADMIN_DIST: join(process.cwd(), 'apps/server/public/admin'),
      AGENT_TICK_HOST: host,
      AGENT_TICK_PORT: String(port)
    }
  });
  server.stdout.pipe(process.stdout);
  server.stderr.pipe(process.stderr);

  await waitForHealth(`${baseURL}/healthz`, server);

  const playwrightEnv = { ...process.env, AGENT_TICK_E2E_BASE_URL: baseURL };
  const chromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? firstExisting(['/etc/profiles/per-user/jmo/bin/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']);
  if (chromium) playwrightEnv.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = chromium;

  await run('corepack', ['pnpm', 'exec', 'playwright', 'test', 'tests/e2e/flows', '--project=chromium', '--workers=1'], {
    stdio: 'inherit',
    env: playwrightEnv
  });
} finally {
  if (server && !server.killed) server.kill('SIGTERM');
  await rm(tempDir, { recursive: true, force: true });
}

function firstExisting(paths) {
  return paths.find((path) => existsSync(path));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, env: options.env ?? process.env });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}`));
    });
  });
}

async function waitForHealth(url, processToWatch) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    if (processToWatch.exitCode !== null) throw new Error('server exited before becoming healthy');
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${url}`);
}
