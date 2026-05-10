#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { AgentTickClient, type ApprovalRequest } from '@agent-tick/sdk';
import { resolveServerAndToken, saveClientConfig } from './config.js';

export function createProgram(): Command {
  const program = new Command();
  program
    .name('agent-tick')
    .description('Human-in-the-loop approval gateway for AI agents')
    .option('--config <path>', 'config file path [env: AGENT_TICK_CONFIG]')
    .hook('preAction', (thisCommand) => {
      const config = thisCommand.optsWithGlobals<{ config?: string }>().config;
      if (config) process.env.AGENT_TICK_CONFIG = config;
    });

  program
    .command('setup')
    .description('Sign in or save an Agent Tick server URL and agent token')
    .option('--server <url>', 'Agent Tick server URL', 'https://agenttick.sh')
    .option('--token <token>', 'Agent Tick agent token')
    .option('--login', 'open browser sign-in and create an agent token')
    .option('--name <name>', 'agent token name for browser sign-in', defaultAgentName())
    .action(async (options: SetupOptions) => {
      if (options.login) {
        const result = await setupWithBrowser(options);
        process.stdout.write(`saved Agent Tick config to ${result.path}\n`);
        return;
      }
      if (!options.token) throw new Error('setup requires --token, or use --login to sign in with your browser');
      const path = await saveClientConfig({ server: options.server, token: options.token });
      process.stdout.write(`saved Agent Tick config to ${path}\n`);
    });

  program
    .command('install')
    .description('Interactive hosted-service setup for local AI coding agents')
    .option('--server <url>', 'Agent Tick server URL', 'https://agenttick.sh')
    .option('--target <target>', 'agent to configure, repeatable: claude, codex, gemini, pi, cursor, opencode, agents-md', collectOption, [])
    .option('--all', 'configure every supported target without prompting')
    .option('--yes', 'accept defaults and do not prompt')
    .option('--no-login', 'skip browser sign-in and only write agent instructions')
    .option('--dry-run', 'print planned changes without writing files')
    .action(async (options: InstallOptions) => {
      await runInstall(options);
    });

  program
    .command('request')
    .description('Create an approval request and wait for a response')
    .option('--server <url>', 'Agent Tick server URL [env: AGENT_TICK_SERVER]')
    .option('--token <token>', 'Agent Tick agent token [env: AGENT_TICK_TOKEN]')
    .requiredOption('--title <title>', 'approval title')
    .option('--body <body>', 'approval body')
    .option('--command <command>', 'command or action to approve')
    .option('--choice <choice>', 'custom response choice, repeatable: id=Label or id:kind=Label; include one kind=deny choice', collectOption, [])
    .option('--timeout <duration>', 'wait timeout, e.g. 30s, 5m, 0 for no wait', '30m')
    .option('--json', 'print machine-readable JSON events')
    .action(async (options: RequestOptions) => {
      const { client, server } = await clientFromOptions(options);
      const created = await createAndMaybeWait(client, server, options);
      process.exitCode = exitCodeForRequest(created);
    });

  program
    .command('abandon')
    .description('Abandon a pending approval request')
    .argument('<request-id>', 'approval request ID')
    .option('--server <url>', 'Agent Tick server URL [env: AGENT_TICK_SERVER]')
    .option('--token <token>', 'Agent Tick agent token [env: AGENT_TICK_TOKEN]')
    .option('--json', 'print machine-readable JSON')
    .action(async (requestId: string, options: ClientOptions & { json?: boolean }) => {
      const { client } = await clientFromOptions(options);
      const abandoned = await client.abandonApproval(requestId);
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ event: 'abandoned', request: abandoned })}\n`);
      } else {
        process.stdout.write(`abandoned approval request ${abandoned.id}\n`);
      }
    });

  program
    .command('guard')
    .description('Run a command only after approval')
    .allowUnknownOption(true)
    .argument('[command...]', 'command to run after approval')
    .option('--server <url>', 'Agent Tick server URL [env: AGENT_TICK_SERVER]')
    .option('--token <token>', 'Agent Tick agent token [env: AGENT_TICK_TOKEN]')
    .option('--title <title>', 'approval title')
    .option('--body <body>', 'approval body')
    .option('--timeout <duration>', 'wait timeout, e.g. 30s, 5m', '30m')
    .action(async (commandParts: string[], options: RequestOptions) => {
      if (!commandParts.length) throw new Error('guard requires a command after --');
      const commandText = commandParts.join(' ');
      const { client, server } = await clientFromOptions(options);
      const finalRequest = await createAndMaybeWait(client, server, {
        ...options,
        title: options.title ?? `Run command?`,
        command: commandText
      });
      if (exitCodeForRequest(finalRequest) !== 0) {
        process.exitCode = exitCodeForRequest(finalRequest);
        return;
      }
      process.exitCode = await runCommand(commandParts);
    });

  return program;
}

async function clientFromOptions(options: ClientOptions): Promise<{ client: AgentTickClient; server: string; token: string }> {
  const { server, token } = await resolveServerAndToken(options);
  return { server, token, client: new AgentTickClient({ baseUrl: server, tokenProvider: () => token }) };
}

async function setupWithBrowser(options: SetupOptions): Promise<{ path: string }> {
  const state = randomBytes(24).toString('base64url');
  const callbackServer = await listenForSetupCallback({ expectedState: state, fallbackServer: options.server });
  const loginURL = buildCliSetupURL({
    server: options.server,
    callbackURL: callbackServer.callbackURL,
    state,
    ...(options.name ? { name: options.name } : {})
  });
  process.stdout.write(`Opening ${loginURL}\n`);
  process.stdout.write('Sign in in your browser. Agent Tick will redirect back here when setup is complete.\n');
  openBrowser(loginURL);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Timed out waiting for browser sign-in. Run `agent-tick setup --login` again to retry.')), 5 * 60_000);
  });
  try {
    return await Promise.race([callbackServer.result, timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
    callbackServer.server.close();
  }
}

function listenForSetupCallback(options: { expectedState: string; fallbackServer: string }): Promise<{
  callbackURL: string;
  server: Server;
  result: Promise<{ path: string }>;
}> {
  const server = createServer();
  const result = new Promise<{ path: string }>((resolve) => {
    server.on('request', (request, response) => {
      void (async () => {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
        if (url.pathname !== '/agent-tick/setup/callback') {
          response.writeHead(404, { 'content-type': 'text/plain' });
          response.end('Not found');
          return;
        }
        const params = await readCallbackParams(request, url);
        const state = params.get('state') ?? '';
        const token = params.get('token') ?? '';
        const serverURL = params.get('server') ?? options.fallbackServer;
        if (state !== options.expectedState || !token.startsWith('agent_')) {
          response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
          response.end('<h1>Agent Tick setup failed</h1><p>Invalid setup callback. You can close this tab and retry <code>agent-tick setup --login</code>.</p>');
          return;
        }
        const path = await saveClientConfig({ server: serverURL, token });
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<h1>Agent Tick setup complete</h1><p>You can close this tab and return to your terminal.</p>');
        resolve({ path });
      })().catch((error: unknown) => {
        response.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
        response.end(`<h1>Agent Tick setup failed</h1><p>${escapeHTML(error instanceof Error ? error.message : String(error))}</p>`);
      });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not start local setup callback server'));
        return;
      }
      resolve({ callbackURL: `http://127.0.0.1:${address.port}/agent-tick/setup/callback`, server, result });
    });
  });
}

async function readCallbackParams(request: IncomingMessage, url: URL): Promise<URLSearchParams> {
  if (request.method !== 'POST') return url.searchParams;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 16_384) throw new Error('Setup callback is too large');
    chunks.push(buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export function buildCliSetupURL(options: { server: string; callbackURL: string; state: string; name?: string }): string {
  const url = new URL('/', options.server);
  url.searchParams.set('cli_callback', options.callbackURL);
  url.searchParams.set('cli_state', options.state);
  if (options.name?.trim()) url.searchParams.set('cli_name', options.name.trim());
  return url.toString();
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {
    process.stderr.write(`Could not open your browser automatically. Open this URL instead:\n${url}\n`);
  });
  child.unref();
}

function defaultAgentName(): string {
  return `Agent on ${os.hostname() || 'local machine'}`;
}

const installTargets = ['claude', 'codex', 'gemini', 'pi', 'cursor', 'opencode', 'agents-md'] as const;
type InstallTarget = typeof installTargets[number];

const targetLabels: Record<InstallTarget, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  pi: 'Pi',
  cursor: 'Cursor',
  opencode: 'OpenCode',
  'agents-md': 'local AGENTS.md'
};

async function runInstall(options: InstallOptions): Promise<void> {
  const server = normalizeURL(options.server ?? 'https://agenttick.sh');
  process.stdout.write('Agent Tick installer\n');
  process.stdout.write(`Hosted server: ${server}\n\n`);

  if (options.login !== false) {
    process.stdout.write('Step 1/2: connect this machine to Agent Tick.\n');
    const result = await setupWithBrowser({ server, login: true, name: defaultAgentName() });
    process.stdout.write(`saved Agent Tick config to ${result.path}\n\n`);
  } else {
    process.stdout.write('Step 1/2: skipped browser sign-in because --no-login was provided.\n\n');
  }

  const selected = await selectInstallTargets(options);
  if (!selected.length) {
    process.stdout.write('No agent integrations selected. You can re-run `agent-tick install` later.\n');
    return;
  }

  process.stdout.write('Step 2/2: install approval instructions for your agents.\n');
  const plans = dedupePlansByPath(selected.map((target) => installPlanForTarget(target)));
  for (const plan of plans) {
    if (options.dryRun) {
      process.stdout.write(`[dry-run] would update ${plan.path}\n`);
      continue;
    }
    await appendInstallBlock(plan.path, plan.content);
    process.stdout.write(`updated ${plan.path}\n`);
  }

  process.stdout.write('\nDone. Try this in any configured agent:\n');
  process.stdout.write('  Before risky commands, ask Agent Tick approval with `agent-tick guard -- <command>`.\n');
  process.stdout.write('  For decisions, use `agent-tick request --title "..." --body "..."`.\n');
}

async function selectInstallTargets(options: InstallOptions): Promise<InstallTarget[]> {
  const explicit = uniqueInstallTargets(options.target ?? []);
  if (options.all) return [...installTargets];
  if (explicit.length) return explicit;
  if (options.yes) return defaultDetectedTargets();

  const detected = defaultDetectedTargets();
  process.stdout.write('Detected/default agent targets:\n');
  detected.forEach((target, index) => process.stdout.write(`  ${index + 1}. ${targetLabels[target]}\n`));
  process.stdout.write('  all. Every supported target\n');
  process.stdout.write('  none. Skip agent instruction install\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`Install for [${detected.join(', ')}]? `)).trim().toLowerCase();
    if (!answer) return detected;
    if (answer === 'none' || answer === 'n' || answer === 'no') return [];
    if (answer === 'all' || answer === 'a') return [...installTargets];
    return uniqueInstallTargets(answer.split(/[\s,]+/).filter(Boolean));
  } finally {
    rl.close();
  }
}

function uniqueInstallTargets(values: string[]): InstallTarget[] {
  const selected: InstallTarget[] = [];
  for (const value of values) {
    const target = value.trim().toLowerCase();
    if (!installTargets.includes(target as InstallTarget)) {
      throw new Error(`unknown install target: ${value}. Expected one of: ${installTargets.join(', ')}`);
    }
    if (!selected.includes(target as InstallTarget)) selected.push(target as InstallTarget);
  }
  return selected;
}

function defaultDetectedTargets(): InstallTarget[] {
  const detected: InstallTarget[] = [];
  for (const target of installTargets) {
    if (target === 'agents-md' || commandExists(targetCommand(target))) detected.push(target);
  }
  return detected.length ? detected : ['agents-md'];
}

function targetCommand(target: InstallTarget): string {
  return target === 'claude' ? 'claude' : target === 'codex' ? 'codex' : target === 'gemini' ? 'gemini' : target === 'pi' ? 'pi' : target === 'cursor' ? 'cursor' : target === 'opencode' ? 'opencode' : '';
}

function commandExists(command: string): boolean {
  if (!command) return false;
  const checker = process.platform === 'win32' ? 'where' : 'sh';
  const args = process.platform === 'win32' ? [command] : ['-c', `command -v ${shellQuote(command)} >/dev/null 2>&1`];
  return spawnSync(checker, args, { stdio: 'ignore' }).status === 0;
}

function dedupePlansByPath(plans: Array<{ path: string; content: string }>): Array<{ path: string; content: string }> {
  const seen = new Set<string>();
  return plans.filter((plan) => {
    if (seen.has(plan.path)) return false;
    seen.add(plan.path);
    return true;
  });
}

function installPlanForTarget(target: InstallTarget): { path: string; content: string } {
  const home = os.homedir();
  const cwd = process.cwd();
  const file = target === 'claude'
    ? path.join(home, '.claude', 'CLAUDE.md')
    : target === 'codex'
      ? path.join(home, '.codex', 'AGENTS.md')
      : target === 'gemini'
        ? path.join(home, '.gemini', 'GEMINI.md')
        : target === 'pi'
          ? path.join(home, '.pi', 'agent', 'skills', 'agent-tick', 'SKILL.md')
          : target === 'cursor'
            ? path.join(cwd, '.cursor', 'rules', 'agent-tick.mdc')
            : target === 'opencode'
              ? path.join(cwd, 'AGENTS.md')
              : path.join(cwd, 'AGENTS.md');
  return { path: file, content: agentInstructionBlock(target) };
}

export function agentInstructionBlock(target: string = 'agent'): string {
  const title = target === 'pi' ? '---\nname: agent-tick\ndescription: Use Agent Tick before risky commands or sensitive actions.\n---\n\n# Agent Tick approval gate' : '# Agent Tick approval gate';
  return `${title}\n\nThis machine is connected to Agent Tick. Before running risky, destructive, expensive, production, data-accessing, or dependency-installing actions, request human approval.\n\nUse command approval when possible:\n\n\`\`\`sh\nagent-tick guard -- <command and args>\n\`\`\`\n\nFor decisions that are not a single command, ask for approval:\n\n\`\`\`sh\nagent-tick request --title "Proceed?" --body "Describe the action and risk."\n\`\`\`\n\nIf Agent Tick denies, times out, or exits non-zero, stop and report the outcome. Do not include secrets, tokens, private keys, or full environment files in approval titles or bodies.\n`;
}

async function appendInstallBlock(filePath: string, block: string): Promise<void> {
  const markerStart = '<!-- agent-tick:start -->';
  const markerEnd = '<!-- agent-tick:end -->';
  const wrapped = `${markerStart}\n${block.trim()}\n${markerEnd}\n`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let existing = '';
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const pattern = new RegExp(`${escapeRegExp(markerStart)}[\\s\\S]*?${escapeRegExp(markerEnd)}\\n?`);
  const next = pattern.test(existing) ? existing.replace(pattern, wrapped) : `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}\n${wrapped}`;
  await fs.writeFile(filePath, next, 'utf8');
}

function normalizeURL(value: string): string {
  const url = new URL(value);
  return url.toString().replace(/\/$/, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function escapeHTML(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

async function createAndMaybeWait(client: AgentTickClient, server: string, options: RequestOptions): Promise<ApprovalRequest> {
  const choices = parseChoices(options.choice);
  const created = await client.createApprovalRequest({
    requester: {
      name: process.env.AGENT_TICK_REQUESTER_NAME || os.hostname() || 'agent',
      host: os.hostname()
    },
    title: options.title,
    ...(options.body ? { body: options.body } : {}),
    ...(options.command ? { command: options.command } : {}),
    ...(choices.length ? { choices } : {})
  });
  const request = created.request;

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ event: 'created', request, waiter: created.waiter })}\n`);
  } else {
    process.stdout.write(`created approval request ${request.id}: ${request.title}\n`);
  }

  const timeoutMs = parseDurationMs(options.timeout);
  if (timeoutMs === 0) return request;

  const waitClient = created.waiter ? new AgentTickClient({ baseUrl: server, tokenProvider: () => created.waiter?.token }) : client;
  const waited = await waitClient.waitForApproval(request.id, { timeoutMs });
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ event: waited.terminal ? 'terminal' : 'timeout', ...waited })}\n`);
  } else if (!waited.terminal) {
    process.stderr.write(`timed out waiting for approval request ${request.id}\n`);
  } else {
    const choice = waited.request.response?.choiceId ?? waited.request.response?.message ?? waited.request.status;
    process.stdout.write(`approval request ${request.id} completed: ${choice}\n`);
  }
  return waited.request;
}

function exitCodeForRequest(request: ApprovalRequest): number {
  if (request.status === 'pending') return 0;
  if (request.status !== 'responded') return 1;
  const choiceId = request.response?.choiceId;
  const choice = request.choices.find((candidate) => candidate.id === choiceId);
  if (choice) return ['deny', 'reject'].includes(choice.kind) ? 1 : 0;
  return choiceId === 'approve' ? 0 : 1;
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function parseChoices(values: string[] | undefined): Array<{ id: string; label: string; kind: string }> {
  const choices = (values ?? []).map((value) => {
    const separator = value.indexOf('=');
    if (separator <= 0) throw new Error(`invalid choice: ${value}. Use id=Label or id:kind=Label.`);
    const idAndKind = value.slice(0, separator).trim();
    const label = value.slice(separator + 1).trim();
    if (!label) throw new Error(`invalid choice: ${value}. Choice label cannot be empty.`);
    const kindSeparator = idAndKind.indexOf(':');
    const id = (kindSeparator === -1 ? idAndKind : idAndKind.slice(0, kindSeparator)).trim();
    const kind = (kindSeparator === -1 ? inferredChoiceKind(id) : idAndKind.slice(kindSeparator + 1).trim()) || 'approve';
    if (!id) throw new Error(`invalid choice: ${value}. Choice id cannot be empty.`);
    return { id, label, kind };
  });
  if (choices.length && !choices.some((choice) => choice.kind === 'deny')) {
    throw new Error('custom choices require at least one choice with kind "deny", for example --choice cancel:deny="Cancel"');
  }
  return choices;
}

function inferredChoiceKind(id: string): string {
  return ['cancel', 'reject', 'deny', 'denied', 'no'].includes(id.toLowerCase()) ? 'deny' : 'approve';
}

function runCommand(commandParts: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const [command, ...args] = commandParts;
    if (!command) return resolve(1);
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) return resolve(128 + (os.constants.signals[signal] ?? 0));
      resolve(code ?? 1);
    });
  });
}

export function parseDurationMs(value: string | number | undefined): number {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return 30 * 60_000;
  if (text === '0') return 0;
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text);
  if (!match) throw new Error(`invalid duration: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2] ?? 'ms';
  const multiplier = unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : unit === 's' ? 1_000 : 1;
  return Math.round(amount * multiplier);
}

interface ClientOptions {
  server?: string;
  token?: string;
}

interface SetupOptions extends ClientOptions {
  server: string;
  login?: boolean;
  name?: string;
}

interface InstallOptions extends SetupOptions {
  target?: string[];
  all?: boolean;
  yes?: boolean;
  dryRun?: boolean;
}

interface RequestOptions extends ClientOptions {
  title: string;
  body?: string;
  command?: string;
  choice?: string[];
  timeout?: string;
  json?: boolean;
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
}

if (isDirectExecution()) {
  createProgram().parseAsync(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
