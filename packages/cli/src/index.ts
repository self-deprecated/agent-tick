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
import { EncryptedApprovalPayloadSchema, createEncryptedApprovalPayload, generateApprovalEncryptionKey, type EncryptedApprovalPayload } from '@agent-tick/shared';
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
    .option('--no-login', 'skip browser sign-in and only install agent hooks')
    .option('--dry-run', 'print planned changes without writing files')
    .action(async (options: InstallOptions) => {
      await runInstall(options);
    });

  const hook = program.command('hook').description('Internal hook entrypoints used by agent integrations');

  hook
    .command('claude-pre-tool-use')
    .description('Claude Code PreToolUse hook for Agent Tick approvals')
    .option('--timeout <duration>', 'approval wait timeout', '30m')
    .action(async (options: { timeout?: string }) => {
      try {
        await runClaudePreToolUseHook(options);
      } catch (error) {
        printClaudePreToolDecision('deny', `Agent Tick hook failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

  program
    .command('request')
    .description('Create an approval request and wait for a response')
    .option('--server <url>', 'Agent Tick server URL [env: AGENT_TICK_SERVER]')
    .option('--token <token>', 'Agent Tick agent token [env: AGENT_TICK_TOKEN]')
    .requiredOption('--title <title>', 'approval title')
    .option('--body <body>', 'approval body')
    .option('--command <command>', 'command or action to approve')
    .option('--encrypt', 'encrypt title/body/command before sending with AGENT_TICK_E2EE_KEY or --e2ee-key')
    .option('--e2ee-key <key>', 'approval encryption key or passphrase [env: AGENT_TICK_E2EE_KEY]')
    .option('--generate-e2ee-key', 'print a new high-entropy approval encryption key and exit')
    .option('--encrypted-payload-json <json>', 'opaque end-to-end encrypted request envelope JSON')
    .option('--encrypted-payload-file <path>', 'read opaque end-to-end encrypted request envelope JSON from a file')
    .option('--choice <choice>', 'custom response choice, repeatable: id=Label or id:kind=Label; include one kind=deny choice', collectOption, [])
    .option('--timeout <duration>', 'wait timeout, e.g. 30s, 5m, 0 for no wait', '30m')
    .option('--json', 'print machine-readable JSON events')
    .action(async (options: RequestOptions) => {
      if (options.generateE2eeKey) {
        process.stdout.write(`${generateApprovalEncryptionKey()}\n`);
        return;
      }
      const { client, server } = await clientFromOptions(options);
      const created = await createAndMaybeWait(client, server, options);
      process.exitCode = exitCodeForRequest(created);
    });

  program
    .command('status')
    .description('Send a small progress update to Agent Tick')
    .argument('[message...]', 'status message')
    .option('--server <url>', 'Agent Tick server URL [env: AGENT_TICK_SERVER]')
    .option('--token <token>', 'Agent Tick agent token [env: AGENT_TICK_TOKEN]')
    .option('--thread <id>', 'thread/chat identifier [env: AGENT_TICK_THREAD_ID]')
    .option('--state <state>', 'status state: working, blocked, done', 'working')
    .option('--next <text>', 'what the agent expects to do next')
    .option('--project <name>', 'project/repository display name')
    .option('--metadata <key=value>', 'metadata key/value, repeatable', collectOption, [])
    .option('--json', 'print machine-readable JSON')
    .action(async (messageParts: string[], options: StatusOptions) => {
      const { client } = await clientFromOptions(options);
      const message = messageParts.join(' ').trim();
      if (!message) throw new Error('status requires a message');
      const update = await client.createStatusUpdate({
        threadId: options.thread ?? process.env.AGENT_TICK_THREAD_ID ?? defaultThreadId(),
        message,
        state: options.state ?? 'working',
        nextStep: options.next,
        host: os.hostname() || undefined,
        workingDirectory: process.cwd(),
        projectName: options.project ?? path.basename(process.cwd()),
        metadata: parseMetadata(options.metadata)
      });
      if (options.json) process.stdout.write(`${JSON.stringify({ event: 'status', status: update })}\n`);
      else process.stdout.write(`sent status update for ${update.threadId}: ${update.message}\n`);
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

  process.stdout.write('Step 2/2: install agent hooks.\n');
  const plans = selected.map((target) => installPlanForTarget(target));
  for (const plan of plans) {
    if (plan.status === 'disabled') {
      process.stdout.write(`skipped ${targetLabels[plan.target]}: ${plan.reason}\n`);
      continue;
    }
    if (options.dryRun) {
      process.stdout.write(`[dry-run] would ${plan.description}\n`);
      continue;
    }
    await plan.apply();
    process.stdout.write(`${plan.description}\n`);
  }

  process.stdout.write('\nDone. Agent Tick hook integrations auto-allow Agent Tick CLI commands and request approval for risky actions.\n');
}

async function selectInstallTargets(options: InstallOptions): Promise<InstallTarget[]> {
  const explicit = uniqueInstallTargets(options.target ?? []);
  if (options.all) return [...installTargets];
  if (explicit.length) return explicit;
  if (options.yes) return defaultDetectedTargets();

  const detected = defaultDetectedTargets();
  process.stdout.write('Detected agent targets:\n');
  detected.forEach((target, index) => {
    const plan = installPlanForTarget(target);
    const suffix = plan.status === 'disabled' ? ` (scaffold only: ${plan.reason})` : '';
    process.stdout.write(`  ${index + 1}. ${targetLabels[target]}${suffix}\n`);
  });
  process.stdout.write('  all. Every known target, including disabled scaffolds\n');
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
    if (isTargetDetected(target)) detected.push(target);
  }
  return detected.length ? detected : ['agents-md'];
}

function isTargetDetected(target: InstallTarget): boolean {
  if (target === 'agents-md') return fileExistsSync(path.join(process.cwd(), 'AGENTS.md')) || fileExistsSync(path.join(process.cwd(), 'CLAUDE.md'));
  if (target === 'claude') return commandExists('claude') || fileExistsSync(path.join(os.homedir(), '.claude', 'settings.json'));
  if (target === 'codex') return commandExists('codex') || fileExistsSync(path.join(os.homedir(), '.codex', 'config.toml'));
  if (target === 'gemini') return commandExists('gemini') || fileExistsSync(path.join(os.homedir(), '.gemini'));
  if (target === 'pi') return commandExists('pi') || fileExistsSync(path.join(os.homedir(), '.pi', 'agent', 'settings.json'));
  if (target === 'cursor') return commandExists('cursor') || fileExistsSync(path.join(process.cwd(), '.cursor'));
  if (target === 'opencode') return commandExists('opencode') || fileExistsSync(path.join(os.homedir(), '.config', 'opencode'));
  return false;
}

function fileExistsSync(filePath: string): boolean {
  return spawnSync(process.platform === 'win32' ? 'cmd' : 'test', process.platform === 'win32' ? ['/c', 'if', 'exist', filePath, 'exit', '0'] : ['-e', filePath], { stdio: 'ignore' }).status === 0;
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

type InstallPlan =
  | { target: InstallTarget; status: 'enabled'; description: string; apply: () => Promise<void> }
  | { target: InstallTarget; status: 'disabled'; reason: string; description: string; apply: () => Promise<void> };

function installPlanForTarget(target: InstallTarget): InstallPlan {
  if (target === 'claude') {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    return {
      target,
      status: 'enabled',
      description: `install Claude Code PreToolUse hooks in ${settingsPath}`,
      apply: () => installClaudeHooks(settingsPath)
    };
  }
  if (target === 'pi') {
    const extensionPath = path.join(os.homedir(), '.pi', 'agent', 'extensions', 'agent-tick-approval.ts');
    return {
      target,
      status: 'enabled',
      description: `install Pi tool_call approval extension in ${extensionPath}`,
      apply: () => installPackagedPiExtension(extensionPath)
    };
  }
  return {
    target,
    status: 'disabled',
    reason: 'hook-based integration has not been verified yet',
    description: `scaffolded ${targetLabels[target]} integration`,
    apply: async () => undefined
  };
}

async function installClaudeHooks(settingsPath: string): Promise<void> {
  const settings = await readJSONFile(settingsPath);
  const root = isPlainObject(settings) ? settings : {};
  const hooks = isPlainObject(root.hooks) ? root.hooks : {};
  hooks.PreToolUse = mergeClaudeHookGroups(hooks.PreToolUse, [
    {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'agent-tick hook claude-pre-tool-use', timeout: 1800, statusMessage: 'Checking Agent Tick approval policy' }]
    },
    {
      matcher: 'AskUserQuestion',
      hooks: [{ type: 'command', command: 'agent-tick hook claude-pre-tool-use', timeout: 1800, statusMessage: 'Routing question through Agent Tick' }]
    }
  ]);
  root.hooks = hooks;
  const permissions = isPlainObject(root.permissions) ? root.permissions : {};
  permissions.allow = mergeStringArray(permissions.allow, [
    'Bash(agent-tick:*)',
    'Bash(npx @self-deprecated/agent-tick:*)',
    'Bash(npm install -g @self-deprecated/agent-tick)'
  ]);
  root.permissions = permissions;
  await writeJSONFile(settingsPath, root);
}

function mergeClaudeHookGroups(existing: unknown, additions: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const groups = Array.isArray(existing) ? [...existing.filter(isPlainObject)] : [];
  for (const addition of additions) {
    const key = JSON.stringify(addition);
    if (!groups.some((group) => JSON.stringify(group) === key)) groups.push(addition);
  }
  return groups;
}

function mergeStringArray(existing: unknown, additions: string[]): string[] {
  const values = Array.isArray(existing) ? existing.filter((value): value is string => typeof value === 'string') : [];
  for (const addition of additions) {
    if (!values.includes(addition)) values.push(addition);
  }
  return values;
}

async function readJSONFile(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

async function writeJSONFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeFileEnsuringDir(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function installPackagedPiExtension(extensionPath: string): Promise<void> {
  const source = await fs.readFile(packagedAssetPath('pi/agent-tick-approval.ts'), 'utf8');
  await writeFileEnsuringDir(extensionPath, source);
}

function packagedAssetPath(relativePath: string): string {
  return fileURLToPath(new URL(`../assets/${relativePath}`, import.meta.url));
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

async function runClaudePreToolUseHook(options: { timeout?: string }): Promise<void> {
  const input = JSON.parse(await readStdin());
  const toolName = typeof input.tool_name === 'string' ? input.tool_name : '';
  if (toolName === 'Bash') {
    await handleClaudeBashHook(input, options);
    return;
  }
  if (toolName === 'AskUserQuestion') {
    await handleClaudeAskUserQuestionHook(input, options);
  }
}

async function handleClaudeBashHook(input: Record<string, unknown>, options: { timeout?: string }): Promise<void> {
  const toolInput = isPlainObject(input.tool_input) ? input.tool_input : {};
  const command = typeof toolInput.command === 'string' ? toolInput.command : '';
  if (!command || isAgentTickCommand(command) || !isRiskyCommand(command)) {
    printClaudePreToolDecision('allow', 'Allowed by Agent Tick hook policy');
    return;
  }
  const finalRequest = await createHookApproval({
    title: 'Approve Claude Code command?',
    body: `Claude Code wants to run a command that matched Agent Tick's risky-command policy.\n\nWorking directory: ${String(input.cwd ?? '')}`,
    command,
    ...(options.timeout ? { timeout: options.timeout } : {})
  });
  if (exitCodeForRequest(finalRequest) === 0) {
    printClaudePreToolDecision('allow', 'Approved in Agent Tick');
  } else {
    printClaudePreToolDecision('deny', 'Denied, timed out, or failed in Agent Tick');
  }
}

async function handleClaudeAskUserQuestionHook(input: Record<string, unknown>, options: { timeout?: string }): Promise<void> {
  const toolInput = isPlainObject(input.tool_input) ? input.tool_input : {};
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions.filter(isPlainObject) : [];
  if (questions.length !== 1) return;
  const question = questions[0];
  if (!question) return;
  const questionText = typeof question.question === 'string' ? question.question : 'Claude Code question';
  const optionsList = Array.isArray(question.options) ? question.options.filter(isPlainObject) : [];
  const choices = optionsList.map((option, index) => ({
    id: `option_${index + 1}`,
    label: typeof option.label === 'string' ? option.label : `Option ${index + 1}`,
    kind: 'approve'
  }));
  choices.push({ id: 'cancel', label: 'Cancel / do not answer', kind: 'deny' });
  const finalRequest = await createHookApproval({
    title: questionText,
    body: 'Claude Code asked a question. Choose the answer to send back to Claude.',
    choices,
    ...(options.timeout ? { timeout: options.timeout } : {})
  });
  const choiceId = finalRequest.response?.choiceId;
  const selected = choices.find((choice) => choice.id === choiceId);
  if (selected && selected.kind !== 'deny') {
    printClaudePreToolDecision('allow', 'Answered through Agent Tick', {
      ...toolInput,
      answers: { [questionText]: selected.label }
    });
  } else {
    printClaudePreToolDecision('deny', 'Question was denied, cancelled, timed out, or failed in Agent Tick');
  }
}

async function createHookApproval(options: { title: string; body?: string; command?: string; timeout?: string; choices?: Array<{ id: string; label: string; kind: string }> }): Promise<ApprovalRequest> {
  const { client, server } = await clientFromOptions({});
  return createAndMaybeWait(client, server, {
    title: options.title,
    timeout: options.timeout ?? '30m',
    choice: [],
    silent: true,
    ...(options.body ? { body: options.body } : {}),
    ...(options.command ? { command: options.command } : {}),
    ...(options.choices ? { hookChoices: options.choices } : {})
  });
}

function printClaudePreToolDecision(permissionDecision: 'allow' | 'deny', permissionDecisionReason: string, updatedInput?: unknown): void {
  const output: Record<string, unknown> = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason
    }
  };
  if (updatedInput !== undefined && isPlainObject(output.hookSpecificOutput)) output.hookSpecificOutput.updatedInput = updatedInput;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function isAgentTickCommand(command: string): boolean {
  const trimmed = command.trim();
  return /^(agent-tick|npx\s+@self-deprecated\/agent-tick|npm\s+install\s+-g\s+@self-deprecated\/agent-tick)(\s|$)/.test(trimmed);
}

export function isRiskyCommand(command: string): boolean {
  return riskyCommandPatterns.some((pattern) => pattern.test(command));
}

const riskyCommandPatterns = [
  /\brm\s+(-rf?|--recursive)\b/i,
  /\bsudo\b/i,
  /\b(chmod|chown)\b.*\b777\b/i,
  /\b(git|jj)\s+.*\bpush\b/i,
  /\b(docker|podman)\s+compose\s+up\b/i,
  /\b(kubectl|helm|terraform|tofu)\b/i,
  /\b(npm|pnpm|yarn|bun)\s+(install|add|remove|update|upgrade)\b/i,
  /\b(migrate|migration|deploy|release|publish)\b/i,
  /\b\.env\b/i
];

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8') || '{}';
}

async function createAndMaybeWait(client: AgentTickClient, server: string, options: RequestOptions): Promise<ApprovalRequest> {
  const choices = options.hookChoices ?? parseChoices(options.choice);
  const encryptedPayload = await encryptedPayloadFromOptions(options);
  const created = await client.createApprovalRequest({
    requester: {
      name: process.env.AGENT_TICK_REQUESTER_NAME || os.hostname() || 'agent',
      host: os.hostname()
    },
    title: encryptedPayload ? 'Encrypted approval request' : options.title,
    ...(encryptedPayload ? { body: 'Open Agent Tick to decrypt this request.' } : options.body ? { body: options.body } : {}),
    ...(encryptedPayload || !options.command ? {} : { command: options.command }),
    ...(encryptedPayload ? { encryptedPayload } : {}),
    ...(choices.length ? { choices } : {})
  });
  const request = created.request;

  if (!options.silent) {
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ event: 'created', request, waiter: created.waiter })}\n`);
    } else {
      process.stdout.write(`created approval request ${request.id}: ${request.title}\n`);
    }
  }

  const timeoutMs = parseDurationMs(options.timeout);
  if (timeoutMs === 0) return request;

  const waitClient = created.waiter ? new AgentTickClient({ baseUrl: server, tokenProvider: () => created.waiter?.token }) : client;
  const waited = await waitClient.waitForApproval(request.id, { timeoutMs });
  if (!options.silent) {
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ event: waited.terminal ? 'terminal' : 'timeout', ...waited })}\n`);
    } else if (!waited.terminal) {
      process.stderr.write(`timed out waiting for approval request ${request.id}\n`);
    } else {
      const choice = waited.request.response?.choiceId ?? waited.request.response?.message ?? waited.request.status;
      process.stdout.write(`approval request ${request.id} completed: ${choice}\n`);
    }
  }
  return waited.request;
}

async function encryptedPayloadFromOptions(options: RequestOptions): Promise<EncryptedApprovalPayload | undefined> {
  if (options.encrypt) {
    if (options.encryptedPayloadJson || options.encryptedPayloadFile) throw new Error('use either --encrypt or an existing encrypted payload, not both');
    const key = options.e2eeKey ?? process.env.AGENT_TICK_E2EE_KEY;
    if (!key) throw new Error('--encrypt requires --e2ee-key/--e2ee-passphrase or AGENT_TICK_E2EE_KEY');
    return createEncryptedApprovalPayload({
      title: options.title,
      ...(options.body ? { body: options.body } : {}),
      ...(options.command ? { command: options.command } : {})
    }, key);
  }
  return readEncryptedPayloadOption(options);
}

async function readEncryptedPayloadOption(options: RequestOptions): Promise<EncryptedApprovalPayload | undefined> {
  if (options.encryptedPayloadJson && options.encryptedPayloadFile) {
    throw new Error('use either --encrypted-payload-json or --encrypted-payload-file, not both');
  }
  const raw = options.encryptedPayloadJson ?? (options.encryptedPayloadFile ? await fs.readFile(options.encryptedPayloadFile, 'utf8') : undefined);
  if (!raw) return undefined;
  try {
    return EncryptedApprovalPayloadSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new Error(`invalid encrypted payload JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
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

function defaultThreadId(): string {
  return `${os.hostname() || 'local'}:${process.cwd()}`;
}

function parseMetadata(values: string[] | undefined): Record<string, string> | undefined {
  const metadata: Record<string, string> = {};
  for (const value of values ?? []) {
    const separator = value.indexOf('=');
    if (separator <= 0) throw new Error(`invalid metadata: ${value}. Use key=value.`);
    const key = value.slice(0, separator).trim();
    const entry = value.slice(separator + 1).trim();
    if (!key) throw new Error(`invalid metadata: ${value}. Metadata key cannot be empty.`);
    metadata[key] = entry;
  }
  return Object.keys(metadata).length ? metadata : undefined;
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

interface StatusOptions extends ClientOptions {
  thread?: string;
  state?: string;
  next?: string;
  project?: string;
  metadata?: string[];
  json?: boolean;
}

interface RequestOptions extends ClientOptions {
  title: string;
  body?: string;
  command?: string;
  encrypt?: boolean;
  e2eeKey?: string;
  generateE2eeKey?: boolean;
  encryptedPayloadJson?: string;
  encryptedPayloadFile?: string;
  choice?: string[];
  hookChoices?: Array<{ id: string; label: string; kind: string }>;
  timeout?: string;
  json?: boolean;
  silent?: boolean;
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
