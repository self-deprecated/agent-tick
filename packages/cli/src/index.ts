#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import os from 'node:os';
import process from 'node:process';
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
    .command('request')
    .description('Create an approval request and wait for a response')
    .option('--server <url>', 'Agent Tick server URL [env: AGENT_TICK_SERVER]')
    .option('--token <token>', 'Agent Tick agent token [env: AGENT_TICK_TOKEN]')
    .requiredOption('--title <title>', 'approval title')
    .option('--body <body>', 'approval body')
    .option('--command <command>', 'command or action to approve')
    .option('--choice <choice>', 'custom response choice, repeatable: id=Label or id:kind=Label', collectOption, [])
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
  if (choice) return choice.kind === 'reject' ? 1 : 0;
  return choiceId === 'approve' ? 0 : 1;
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function parseChoices(values: string[] | undefined): Array<{ id: string; label: string; kind: string }> {
  return (values ?? []).map((value) => {
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
}

function inferredChoiceKind(id: string): string {
  return ['reject', 'deny', 'denied', 'no'].includes(id.toLowerCase()) ? 'reject' : 'approve';
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

interface RequestOptions extends ClientOptions {
  title: string;
  body?: string;
  command?: string;
  choice?: string[];
  timeout?: string;
  json?: boolean;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createProgram().parseAsync(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
