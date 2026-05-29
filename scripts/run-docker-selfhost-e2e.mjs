#!/usr/bin/env node
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptPath);
const projectRoot = resolve(scriptDir, '..');
const composeFile = resolve(projectRoot, 'docker-compose.yml');
const supportedModes = ['single', 'all', 'clerk-test', 'rate-limit', 'config-negative', 'redis', 'postgres', 'postgres-clerk-test', 'retention', 'webhook', 'migration'];

const options = parseArgs(process.argv.slice(2));
const mode = options.mode ?? 'single';
const host = process.env.AGENT_TICK_E2E_HOST ?? '127.0.0.1';
if (mode === 'all') {
  await runAllModes(options);
  process.exit(0);
}
if (mode === 'config-negative') {
  await runConfigNegativeMode(options);
  process.exit(0);
}

const port = Number(options.port ?? process.env.AGENT_TICK_E2E_PORT ?? await findFreePort());
const baseURL = process.env.AGENT_TICK_E2E_BASE_URL ?? `http://${host}:${port}`;
const projectName = sanitizeComposeProjectName(process.env.AGENT_TICK_E2E_COMPOSE_PROJECT ?? `agent-tick-e2e-${mode}-${crypto.randomBytes(4).toString('hex')}`);
const adminToken = process.env.AGENT_TICK_E2E_ADMIN_TOKEN ?? `adm_e2e_${crypto.randomBytes(24).toString('hex')}`;
const keep = truthy(process.env.AGENT_TICK_E2E_KEEP_DOCKER) || Boolean(options.keep);
const tempRoot = await mkdtemp(join(tmpdir(), `agent-tick-e2e-${mode}-`));
const extraComposeFiles = [];
let webhookReceiver;
let cleanedUp = false;
let diagnosticsPrinted = false;

try {
  if (!existsSync(composeFile)) throw new Error(`Docker Compose file not found: ${composeFile}`);
  if (mode === 'redis') extraComposeFiles.push(await writeRedisComposeOverride(tempRoot));
  if (usesPostgres(mode)) extraComposeFiles.push(await writePostgresComposeOverride(tempRoot));
  if (mode === 'migration') await prepareWritableDataDir(resolve(tempRoot, 'migration-data'));
  if (mode === 'webhook') webhookReceiver = await startWebhookReceiver(tempRoot);
  const composeEnv = composeEnvironmentForMode(mode, { baseURL, port, adminToken, webhookReceiver });
  const playwrightEnv = playwrightEnvironmentForMode(mode, { baseURL, adminToken, projectName, webhookReceiver });

  await runCompose(['config'], { stdio: 'inherit', composeEnv });
  await runCompose(['up', '--build', '-d', 'server'], { stdio: 'inherit', composeEnv });
  await waitForEndpoint(`${baseURL}/healthz`, 'healthz');
  await waitForEndpoint(`${baseURL}/readyz`, 'readyz');
  await runPlaywright(mode, playwrightEnv);
} catch (error) {
  await printDiagnostics();
  throw error;
} finally {
  await cleanup();
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--mode') parsed.mode = args[++index];
    else if (arg.startsWith('--mode=')) parsed.mode = arg.slice('--mode='.length);
    else if (arg === '--port') parsed.port = args[++index];
    else if (arg.startsWith('--port=')) parsed.port = arg.slice('--port='.length);
    else if (arg === '--keep') parsed.keep = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/run-docker-selfhost-e2e.mjs [--mode ${supportedModes.join('|')}] [--port 18787] [--keep]`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (parsed.mode && !supportedModes.includes(parsed.mode)) throw new Error(`Unsupported Docker E2E mode: ${parsed.mode}`);
  return parsed;
}

function composeEnvironmentForMode(selectedMode, values) {
  const env = {
    ...process.env,
    AGENT_TICK_IMAGE: process.env.AGENT_TICK_IMAGE ?? `agent-tick/server:e2e-${projectName}`,
    AGENT_TICK_PUBLIC_URL: values.baseURL,
    AGENT_TICK_PORT: String(values.port),
    AGENT_TICK_ADMIN_TOKEN: values.adminToken,
    AGENT_TICK_DATABASE_MIGRATE_ON_START: 'true'
  };
  if (selectedMode === 'clerk-test' || selectedMode === 'postgres-clerk-test' || selectedMode === 'retention') {
    env.AGENT_TICK_MODE = 'clerk';
    env.AGENT_TICK_TEST_AUTH = '1';
    env.AGENT_TICK_SESSION_SECRET = process.env.AGENT_TICK_SESSION_SECRET ?? crypto.randomBytes(32).toString('hex');
  } else {
    env.AGENT_TICK_MODE = 'single';
    env.AGENT_TICK_TEST_AUTH = '';
  }
  if (selectedMode === 'rate-limit') {
    env.AGENT_TICK_RATE_LIMIT_MAX_REQUESTS = process.env.AGENT_TICK_RATE_LIMIT_MAX_REQUESTS ?? '2';
    env.AGENT_TICK_RATE_LIMIT_WINDOW_MS = process.env.AGENT_TICK_RATE_LIMIT_WINDOW_MS ?? '60000';
  }
  if (selectedMode === 'redis') {
    env.AGENT_TICK_REDIS_URL = 'redis://redis:6379';
    env.AGENT_TICK_EVENT_BUS_BACKEND = 'redis';
    env.AGENT_TICK_RATE_LIMIT_BACKEND = 'redis';
    env.AGENT_TICK_RATE_LIMIT_MAX_REQUESTS = process.env.AGENT_TICK_RATE_LIMIT_MAX_REQUESTS ?? '2';
    env.AGENT_TICK_RATE_LIMIT_WINDOW_MS = process.env.AGENT_TICK_RATE_LIMIT_WINDOW_MS ?? '60000';
  }
  if (usesPostgres(selectedMode)) {
    env.AGENT_TICK_POSTGRES_USER = process.env.AGENT_TICK_POSTGRES_USER ?? 'agent_tick';
    env.AGENT_TICK_POSTGRES_PASSWORD = process.env.AGENT_TICK_POSTGRES_PASSWORD ?? 'agent_tick_e2e';
    env.AGENT_TICK_POSTGRES_DB = process.env.AGENT_TICK_POSTGRES_DB ?? 'agent_tick';
    env.AGENT_TICK_DATABASE_URL = process.env.AGENT_TICK_DATABASE_URL ?? `postgresql://${env.AGENT_TICK_POSTGRES_USER}:${env.AGENT_TICK_POSTGRES_PASSWORD}@postgres-e2e:5432/${env.AGENT_TICK_POSTGRES_DB}`;
  }
  if (selectedMode === 'retention') {
    env.AGENT_TICK_REQUEST_RETENTION_DAYS = '1';
    env.AGENT_TICK_STATUS_UPDATE_RETENTION_DAYS = '1';
    env.AGENT_TICK_AUDIT_RETENTION_DAYS = '1';
    env.AGENT_TICK_UNREGISTERED_DEVICE_RETENTION_DAYS = '1';
    env.AGENT_TICK_RETENTION_CLEANUP_INTERVAL_MINUTES = '1';
  }
  if (selectedMode === 'webhook') {
    env.AGENT_TICK_REQUEST_NOTIFICATION_WEBHOOK_URL = values.webhookReceiver.url;
  }
  if (selectedMode === 'migration') {
    env.AGENT_TICK_DATA_VOLUME = resolve(tempRoot, 'migration-data');
  }
  return env;
}

function playwrightEnvironmentForMode(selectedMode, values) {
  const env = {
    ...process.env,
    AGENT_TICK_E2E_BASE_URL: values.baseURL,
    AGENT_TICK_E2E_ADMIN_TOKEN: values.adminToken,
    AGENT_TICK_E2E_COMPOSE_FILE: composeFile,
    AGENT_TICK_E2E_COMPOSE_FILES: JSON.stringify([composeFile, ...extraComposeFiles]),
    AGENT_TICK_E2E_COMPOSE_PROJECT: values.projectName,
    AGENT_TICK_E2E_MODE: selectedMode,
    AGENT_TICK_E2E_DOCKER: '1'
  };
  if (values.webhookReceiver) {
    env.AGENT_TICK_E2E_WEBHOOK_CAPTURE_FILE = values.webhookReceiver.captureFile;
    env.AGENT_TICK_E2E_WEBHOOK_CONTROL_URL = values.webhookReceiver.controlURL;
    env.AGENT_TICK_E2E_WEBHOOK_SECRET_NEEDLE = values.adminToken;
  }
  const chromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? firstExisting([
    '/etc/profiles/per-user/jmo/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome'
  ]);
  if (chromium) env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = chromium;
  return env;
}

async function runAllModes(parsedOptions) {
  for (const childMode of ['single', 'clerk-test', 'rate-limit', 'redis', 'postgres', 'postgres-clerk-test', 'retention', 'webhook', 'migration', 'config-negative']) {
    const args = [scriptPath, '--mode', childMode];
    if (parsedOptions.keep) args.push('--keep');
    await run(process.execPath, args, { cwd: projectRoot, stdio: 'inherit', env: process.env });
  }
}

async function runPlaywright(selectedMode, env) {
  const args = ['pnpm', 'exec', 'playwright', 'test'];
  if (selectedMode === 'clerk-test' || selectedMode === 'postgres-clerk-test') {
    args.push('tests/e2e/docker/selfhost-clerk-test.spec.ts', 'tests/e2e/docker/selfhost-authorization-boundaries.spec.ts');
  } else if (selectedMode === 'rate-limit') {
    args.push('tests/e2e/docker/selfhost-rate-limits.spec.ts');
  } else if (selectedMode === 'redis') {
    args.push('tests/e2e/docker/selfhost-redis-runtime.spec.ts');
  } else if (selectedMode === 'postgres') {
    args.push(
      'tests/e2e/docker/selfhost-postgres-runtime.spec.ts',
      'tests/e2e/docker/selfhost-dashboard-smoke.spec.ts',
      'tests/e2e/docker/selfhost-invalid-payloads.spec.ts',
      'tests/e2e/docker/selfhost-waiter-lifecycle.spec.ts',
      'tests/e2e/docker/selfhost-admin-token-boundaries.spec.ts',
      'tests/e2e/docker/selfhost-request-expiration.spec.ts',
      'tests/e2e/docker/selfhost-concurrent-responses.spec.ts',
      'tests/e2e/docker/selfhost-static-admin-security-smoke.spec.ts'
    );
  } else if (selectedMode === 'retention') {
    args.push('tests/e2e/docker/selfhost-retention-cleanup.spec.ts');
  } else if (selectedMode === 'webhook') {
    args.push('tests/e2e/docker/selfhost-webhook-notification.spec.ts');
  } else if (selectedMode === 'migration') {
    args.push('tests/e2e/docker/selfhost-migration-existing-db.spec.ts');
  } else {
    args.push(
      'tests/e2e/docker/selfhost-single.spec.ts',
      'tests/e2e/docker/selfhost-single-persistence.spec.ts',
      'tests/e2e/docker/selfhost-dashboard-smoke.spec.ts',
      'tests/e2e/docker/selfhost-invalid-payloads.spec.ts',
      'tests/e2e/docker/selfhost-waiter-lifecycle.spec.ts',
      'tests/e2e/docker/selfhost-admin-token-boundaries.spec.ts',
      'tests/e2e/docker/selfhost-request-expiration.spec.ts',
      'tests/e2e/docker/selfhost-concurrent-responses.spec.ts',
      'tests/e2e/docker/selfhost-static-admin-security-smoke.spec.ts'
    );
  }
  args.push('--project=chromium', '--workers=1');
  await run('corepack', args, { cwd: projectRoot, stdio: 'inherit', env });
}

async function runConfigNegativeMode(parsedOptions) {
  const cases = [
    { name: 'invalid-mode', env: { AGENT_TICK_MODE: 'not-a-real-mode' }, expectLog: /Invalid enum|invalid/i, expectReady: false },
    { name: 'clerk-missing-secrets', env: { AGENT_TICK_MODE: 'clerk', AGENT_TICK_TEST_AUTH: '', AGENT_TICK_CLERK_PUBLISHABLE_KEY: '', AGENT_TICK_CLERK_SECRET_KEY: '' }, expectLog: /requires AGENT_TICK_CLERK_PUBLISHABLE_KEY/i, expectReady: false },
    { name: 'clerk-test-auth-no-secrets', env: { AGENT_TICK_MODE: 'clerk', AGENT_TICK_TEST_AUTH: '1', AGENT_TICK_SESSION_SECRET: crypto.randomBytes(32).toString('hex') }, expectReady: true },
    { name: 'bad-redis-url', env: { AGENT_TICK_REDIS_URL: 'redis://127.0.0.1:6399', AGENT_TICK_EVENT_BUS_BACKEND: 'redis', AGENT_TICK_RATE_LIMIT_BACKEND: 'redis' }, expectLog: /ECONNREFUSED|connect/i, expectReady: false },
    { name: 'bad-postgres-url', env: { AGENT_TICK_DATABASE_URL: 'postgresql://agent_tick:wrong@127.0.0.1:6543/agent_tick' }, expectLog: /ECONNREFUSED|connect|database|postgres/i, expectReady: false },
    { name: 'bad-sqlite-path', env: { AGENT_TICK_DATABASE_URL: 'file:/data/missing/agent-tick.db' }, expectLog: /unable to open database|Cannot open database|SQLITE_CANTOPEN|no such file|directory does not exist/i, expectReady: false }
  ];
  for (const testCase of cases) {
    const casePort = Number(parsedOptions.port ?? await findFreePort());
    const caseBaseURL = `http://127.0.0.1:${casePort}`;
    const caseProject = sanitizeComposeProjectName(`agent-tick-e2e-config-${testCase.name}-${crypto.randomBytes(3).toString('hex')}`);
    const caseEnv = {
      ...process.env,
      AGENT_TICK_IMAGE: process.env.AGENT_TICK_IMAGE ?? `agent-tick/server:e2e-config`,
      AGENT_TICK_MODE: 'single',
      AGENT_TICK_PUBLIC_URL: caseBaseURL,
      AGENT_TICK_PORT: String(casePort),
      AGENT_TICK_ADMIN_TOKEN: `adm_e2e_${crypto.randomBytes(12).toString('hex')}`,
      AGENT_TICK_DATABASE_MIGRATE_ON_START: 'true',
      ...testCase.env
    };
    const composeArgs = ['compose', '-p', caseProject, '-f', composeFile];
    try {
      await run('docker', [...composeArgs, 'config'], { cwd: projectRoot, env: caseEnv, stdio: 'inherit' });
      await run('docker', [...composeArgs, 'up', '--build', '-d', 'server'], { cwd: projectRoot, env: caseEnv, stdio: 'inherit' });
      if (testCase.expectReady) {
        await waitForEndpoint(`${caseBaseURL}/readyz`, `${testCase.name} readyz`);
      } else {
        const logs = await waitForLogs(caseProject, caseEnv, testCase.expectLog);
        if (!testCase.expectLog.test(logs)) throw new Error(`${testCase.name} did not log expected startup failure. Logs:\n${logs}`);
      }
      console.error(`config-negative case passed: ${testCase.name}`);
    } finally {
      await run('docker', [...composeArgs, 'down', '-v', '--remove-orphans'], { cwd: projectRoot, env: caseEnv, stdio: 'inherit', allowFailure: true });
    }
  }
}

async function waitForLogs(caseProject, caseEnv, pattern) {
  const startedAt = Date.now();
  let logs = '';
  while (Date.now() - startedAt < 60_000) {
    const result = await run('docker', ['compose', '-p', caseProject, '-f', composeFile, 'logs', '--no-color', 'server'], { cwd: projectRoot, env: caseEnv, allowFailure: true });
    const fallback = result.failed ? await run('docker', ['compose', '-p', caseProject, '-f', composeFile, 'logs', 'server'], { cwd: projectRoot, env: caseEnv, allowFailure: true }) : null;
    logs = `${result.stdout}\n${result.stderr}\n${fallback?.stdout ?? ''}\n${fallback?.stderr ?? ''}`;
    if (pattern.test(logs)) return logs;
    await delay(750);
  }
  return logs;
}

async function prepareWritableDataDir(path) {
  await mkdir(path, { recursive: true });
  await chmod(path, 0o777);
}

async function writeRedisComposeOverride(root) {
  const path = join(root, 'docker-compose.redis.yml');
  await writeFile(path, `services:\n  redis:\n    image: docker.io/library/redis:7-alpine\n  server:\n    depends_on:\n      - redis\n`, 'utf8');
  return path;
}

async function writePostgresComposeOverride(root) {
  const path = join(root, 'docker-compose.postgres.yml');
  const user = process.env.AGENT_TICK_POSTGRES_USER ?? 'agent_tick';
  const password = process.env.AGENT_TICK_POSTGRES_PASSWORD ?? 'agent_tick_e2e';
  const database = process.env.AGENT_TICK_POSTGRES_DB ?? 'agent_tick';
  await writeFile(path, `services:\n  postgres-e2e:\n    image: docker.io/library/postgres:17-alpine\n    environment:\n      POSTGRES_USER: ${JSON.stringify(user)}\n      POSTGRES_PASSWORD: ${JSON.stringify(password)}\n      POSTGRES_DB: ${JSON.stringify(database)}\n    volumes:\n      - postgres_e2e_data:/var/lib/postgresql/data\n    healthcheck:\n      test: [\"CMD-SHELL\", ${JSON.stringify(`pg_isready -U ${user} -d ${database}`)}]\n      interval: 2s\n      timeout: 5s\n      retries: 30\n  server:\n    depends_on:\n      postgres-e2e:\n        condition: service_healthy\nvolumes:\n  postgres_e2e_data:\n`, 'utf8');
  return path;
}

async function startWebhookReceiver(root) {
  const captureFile = join(root, 'webhook-captures.jsonl');
  await writeFile(captureFile, '', 'utf8');
  let mode = 'ok';
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (request.url?.includes('/fail')) mode = 'fail';
      if (request.url?.includes('/ok')) mode = 'ok';
      await writeFile(captureFile, JSON.stringify({ method: request.method, url: request.url, headers: request.headers, body }) + '\n', { flag: 'a' });
      if (mode === 'fail') response.writeHead(500).end('fail');
      else response.writeHead(204).end();
    });
  });
  await new Promise((resolveStart, rejectStart) => {
    server.once('error', rejectStart);
    server.listen(0, '0.0.0.0', resolveStart);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, captureFile, url: `http://host.docker.internal:${port}/webhook/ok`, controlURL: `http://127.0.0.1:${port}/webhook` };
}

async function runCompose(args, options = {}) {
  const fileArgs = [composeFile, ...extraComposeFiles].flatMap((file) => ['-f', file]);
  return await run('docker', ['compose', '-p', projectName, ...fileArgs, ...args], {
    cwd: projectRoot,
    env: options.composeEnv,
    ...options
  });
}

async function waitForEndpoint(url, label) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < 120_000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${label} returned HTTP ${response.status}: ${await response.text().catch(() => '')}`);
    } catch (error) {
      lastError = error;
    }
    await delay(750);
  }
  throw new Error(`Timed out waiting for ${label} at ${url}${lastError ? ` (${lastError.message})` : ''}`);
}

async function printDiagnostics() {
  if (diagnosticsPrinted) return;
  diagnosticsPrinted = true;
  console.error('\n--- docker compose ps ---');
  await runCompose(['ps'], { stdio: 'inherit', allowFailure: true, composeEnv: process.env });
  console.error('\n--- docker compose logs server ---');
  const logsResult = await runCompose(['logs', '--no-color', 'server'], { stdio: 'inherit', allowFailure: true, composeEnv: process.env });
  if (logsResult.failed) await runCompose(['logs', 'server'], { stdio: 'inherit', allowFailure: true, composeEnv: process.env });
  console.error('\n--- docker compose config ---');
  await runCompose(['config'], { stdio: 'inherit', allowFailure: true, composeEnv: process.env });
}

async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  webhookReceiver?.server?.close();
  if (keep) {
    const fileFlags = [composeFile, ...extraComposeFiles].map((file) => `-f ${file}`).join(' ');
    console.error(`Keeping Docker E2E project ${projectName}. Clean up with: docker compose -p ${projectName} ${fileFlags} down -v --remove-orphans`);
    return;
  }
  await runCompose(['down', '-v', '--remove-orphans'], { stdio: 'inherit', allowFailure: true, composeEnv: process.env });
  await rm(tempRoot, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'pipe'
    });
    let stdout = '';
    let stderr = '';
    if (!options.stdio || options.stdio === 'pipe') {
      child.stdout?.on('data', (chunk) => { stdout += chunk; });
      child.stderr?.on('data', (chunk) => { stderr += chunk; });
    }
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolveRun({ stdout, stderr });
      else if (options.allowFailure) resolveRun({ stdout, stderr, failed: true, code, signal });
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}${stderr ? `\n${stderr}` : ''}`));
    });
  });
}

function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address) resolvePort(address.port);
        else reject(new Error('Unable to allocate a free TCP port'));
      });
    });
  });
}

function sanitizeComposeProjectName(value) {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 60) || `agent-tick-e2e-${crypto.randomBytes(4).toString('hex')}`;
}

function firstExisting(paths) {
  return paths.find((path) => existsSync(path));
}

function usesPostgres(selectedMode) {
  return selectedMode === 'postgres' || selectedMode === 'postgres-clerk-test';
}

function truthy(value) {
  return value === '1' || value?.toLowerCase() === 'true' || value?.toLowerCase() === 'yes';
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
