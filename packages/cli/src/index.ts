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
import { Command, CommanderError, type AddHelpTextContext } from 'commander';
import { AgentTickClient, type ApprovalRequest } from '@agent-tick/sdk';
import { EncryptedApprovalPayloadSchema, createEncryptedApprovalPayload, generateApprovalEncryptionKey, type EncryptedApprovalPayload } from '@agent-tick/shared';
import { resolveServerAndToken, saveClientConfig } from './config.js';

export function createProgram(): Command {
  const program = new Command();
  program
    .name('agent-tick')
    .description('Status, steering, and sanction gateway for AI agents')
    .version(CLI_VERSION)
    .option('--config <path>', 'config file path [env: AGENT_TICK_CONFIG]')
    .exitOverride()
    .configureOutput({ writeErr: () => undefined })
    .configureHelp({ visibleCommands: orderedVisibleCommands })
    .addHelpText('beforeAll', topLevelHelpText)
    .addHelpText('afterAll', rootHelpFooter)
    .hook('preAction', (thisCommand) => {
      const config = thisCommand.optsWithGlobals<{ config?: string }>().config;
      if (config) process.env.AGENT_TICK_CONFIG = config;
    });

  program
    .command('login')
    .description('Sign in to Agent Tick in your browser')
    .option('--server <url>', 'Agent Tick server URL', 'https://agenttick.sh')
    .option('--name <name>', 'agent token name for browser sign-in', defaultAgentName())
    .addHelpText('after', loginHelpText)
    .action(async (options: SetupOptions) => {
      const result = await setupWithBrowser({ ...options, login: true });
      process.stdout.write(`${success('saved')} Agent Tick config to ${result.path}\n`);
    });

  program
    .command('setup')
    .description('Sign in or save an Agent Tick server URL and agent token')
    .option('--server <url>', 'Agent Tick server URL', 'https://agenttick.sh')
    .option('--token <token>', 'Agent Tick agent token')
    .option('--login', 'open browser sign-in and create an agent token')
    .option('--name <name>', 'agent token name for browser sign-in', defaultAgentName())
    .addHelpText('after', setupHelpText)
    .action(async (options: SetupOptions) => {
      if (options.login) {
        const result = await setupWithBrowser(options);
        process.stdout.write(`saved Agent Tick config to ${result.path}\n`);
        return;
      }
      if (!options.token) throw cliUsageError('setup', 'setup requires --login for hosted sign-in, or --token for manual/self-hosted setup');
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
    .option('--claude-profile <profile>', 'Claude Code setup profile: interactive or headless')
    .option('--claude-steering <policy>', 'Claude Code steering policy: off, afk, or always')
    .option('--claude-sanctions <policy>', 'Claude Code sanction policy: off, afk, or always')
    .option('--claude-initial-mode <mode>', 'initial Agent Tick mode for Claude Code: afk or pass-through')
    .option('--claude-scope <scope>', 'Claude Code hook install scope: global or local')
    .option('--claude-sandbox <policy>', 'Claude Code sandbox compatibility: auto, allow, or skip')
    .addHelpText('after', installHelpText)
    .action(async (options: InstallOptions) => {
      await runInstall(options);
    });

  program
    .command('mode')
    .description('Show or change Agent Tick local routing mode')
    .argument('[mode]', 'afk or pass-through')
    .action(async (mode?: string) => {
      if (!mode) {
        process.stdout.write(`${await loadAgentTickMode()}\n`);
        return;
      }
      const saved = await saveAgentTickMode(mode);
      process.stdout.write(`Agent Tick mode: ${saved}\n`);
    });

  const hook = program.command('hook', { hidden: true }).description('Internal hook entrypoints used by agent integrations');

  hook
    .command('claude-pre-tool-use')
    .description('Claude Code PreToolUse hook for Agent Tick steering')
    .option('--timeout <duration>', 'approval wait timeout', '30m')
    .action(async (options: { timeout?: string }) => {
      try {
        await runClaudePreToolUseHook(options);
      } catch (error) {
        printClaudePreToolDecision('deny', `Agent Tick hook failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

  hook
    .command('claude-permission-request')
    .description('Claude Code PermissionRequest hook for Agent Tick sanctions')
    .option('--timeout <duration>', 'approval wait timeout', '30m')
    .action(async (options: { timeout?: string }) => {
      try {
        await runClaudePermissionRequestHook(options);
      } catch (error) {
        printClaudePermissionRequestDecision('deny', `Agent Tick hook failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

  program
    .command('sanction')
    .description('Create a human sanction/approval request and wait for a response')
    .allowUnknownOption(true)
    .argument('[command...]', 'optional command to run after sanction approval')
    .option('--server <url>', 'Agent Tick server URL [env: AGENT_TICK_SERVER]')
    .option('--token <token>', 'Agent Tick agent token [env: AGENT_TICK_TOKEN]')
    .option('--title <title>', 'sanction title')
    .option('--body <body>', 'sanction body')
    .option('--command <command>', 'command or action to approve without running it')
    .option('--project <name>', 'project/repository display name')
    .option('--encrypt', 'encrypt title/body/command before sending with AGENT_TICK_E2EE_KEY or --e2ee-key')
    .option('--e2ee-key <key>', 'approval encryption key or passphrase [env: AGENT_TICK_E2EE_KEY]')
    .option('--generate-e2ee-key', 'print a new high-entropy approval encryption key and exit')
    .option('--encrypted-payload-json <json>', 'opaque end-to-end encrypted request envelope JSON')
    .option('--encrypted-payload-file <path>', 'read opaque end-to-end encrypted request envelope JSON from a file')
    .option('--timeout <duration>', 'wait timeout, e.g. 30s, 5m, 0 for no wait', '30m')
    .option('--json', 'print machine-readable JSON events')
    .addHelpText('after', sanctionHelpText)
    .action(async (commandParts: string[], options: RequestOptions) => {
      if (options.generateE2eeKey) {
        process.stdout.write(`${generateApprovalEncryptionKey()}\n`);
        return;
      }
      const commandText = commandParts.length ? commandParts.join(' ') : options.command;
      const { client, server } = await clientFromOptions(options);
      const finalRequest = await createAndMaybeWait(client, server, {
        ...options,
        title: options.title ?? (commandText ? 'Approve command?' : 'Approve action?'),
        ...(commandText ? { command: commandText } : {})
      });
      const exitCode = exitCodeForRequest(finalRequest);
      if (exitCode !== 0 || !commandParts.length) {
        process.exitCode = exitCode;
        return;
      }
      process.exitCode = await runCommand(commandParts);
    });

  program
    .command('steering')
    .description('Ask a structured steering question and wait for a response')
    .option('--server <url>', 'Agent Tick server URL [env: AGENT_TICK_SERVER]')
    .option('--token <token>', 'Agent Tick agent token [env: AGENT_TICK_TOKEN]')
    .option('--title <title>', 'steering question title')
    .option('--body <body>', 'additional context for the steering question')
    .option('--project <name>', 'project/repository display name')
    .option('--choice <choice>', 'steering choice, repeatable: id=Label or id:kind=Label; include one kind=deny choice', collectOption, [])
    .option('--timeout <duration>', 'wait timeout, e.g. 30s, 5m, 0 for no wait', '30m')
    .option('--json', 'print machine-readable JSON events')
    .addHelpText('after', steeringHelpText)
    .action(async (options: RequestOptions) => {
      if (!options.title?.trim()) throw cliUsageError('steering', 'steering requires --title');
      if (!options.choice?.length) throw cliUsageError('steering', 'steering requires at least one --choice');
      let choices: Array<{ id: string; label: string; kind: string }>;
      try {
        choices = parseChoices(options.choice);
      } catch (error) {
        throw cliUsageError('steering', error instanceof Error ? error.message : String(error));
      }
      const { client, server } = await clientFromOptions(options);
      const created = await createAndMaybeWait(client, server, { ...options, hookChoices: choices });
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
    .addHelpText('after', statusHelpText)
    .action(async (messageParts: string[], options: StatusOptions) => {
      const { client } = await clientFromOptions(options);
      const message = messageParts.join(' ').trim();
      if (!message) throw cliUsageError('status', 'status requires a message');
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
    .addHelpText('after', abandonHelpText)
    .action(async (requestId: string, options: ClientOptions & { json?: boolean }) => {
      const { client } = await clientFromOptions(options);
      const abandoned = await client.abandonApproval(requestId);
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ event: 'abandoned', request: abandoned })}\n`);
      } else {
        process.stdout.write(`abandoned approval request ${abandoned.id}\n`);
      }
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

const CLI_VERSION = '0.1.4';

function supportsColor(stream: NodeJS.WriteStream = process.stdout): boolean {
  return stream.isTTY === true && !process.env.NO_COLOR;
}

function color(code: string, value: string, stream: NodeJS.WriteStream = process.stdout): string {
  return supportsColor(stream) ? `\u001b[${code}m${value}\u001b[0m` : value;
}

function heading(value: string): string { return color('1;36', value); }
function command(value: string): string { return color('32', value); }
function muted(value: string): string { return color('2', value); }
function warning(value: string): string { return color('33', value, process.stderr); }
function errorText(value: string): string { return color('31', value, process.stderr); }
function success(value: string): string { return color('32', value); }

function topLevelHelpText(context?: AddHelpTextContext): string {
  if (context?.command.parent) return '';
  return `${heading('Agent Tick — status, steering, and sanctions for AI agents')}\n\n${heading('Most used')}\n  ${command('agent-tick status "Running tests now"')}\n  ${command('agent-tick steering --title "Which approach?" --choice "Small fix" --choice "Refactor"')}\n  ${command('agent-tick sanction --title "Deploy to production?"')}\n  ${command('agent-tick sanction -- npm install')}\n\n${heading('First-time setup')}\n  ${command('agent-tick login')}\n  ${command('agent-tick setup --login')}\n  ${command('agent-tick install --target claude')}\n\n`;
}

function rootHelpFooter(context?: AddHelpTextContext): string {
  return context?.command.parent ? '' : `\n${muted('Run `agent-tick <command> --help` for command-specific examples.')}\n`;
}

function orderedVisibleCommands(cmd: Command): Command[] {
  const priority = ['status', 'steering', 'sanction', 'login', 'setup', 'install', 'mode', 'abandon'];
  return [...cmd.commands]
    .filter((subcommand) => subcommand.name() !== 'hook')
    .sort((left, right) => {
      const leftIndex = priority.indexOf(left.name());
      const rightIndex = priority.indexOf(right.name());
      if (leftIndex === -1 && rightIndex === -1) return 0;
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    });
}

const loginHelpText = `\n${heading('Examples')}\n  ${command('agent-tick login')}\n  ${command('agent-tick login --name "Claude Code on laptop"')}\n`;

const setupHelpText = `\n${heading('Recommended hosted setup')}\n  ${command('agent-tick setup --login')}\n\n${heading('Manual/self-hosted setup')}\n  ${command('agent-tick setup --server http://localhost:8787 --token agent_...')}\n`;

const installHelpText = `\n${heading('Examples')}\n  ${command('agent-tick install --target claude')}\n  ${command('agent-tick install --target claude --claude-scope local')}\n  ${command('agent-tick install --target claude --claude-sandbox allow')}\n`;

const statusHelpText = `\n${heading('Examples')}\n  ${command('agent-tick status "Finished edits; running tests now"')}\n  ${command('agent-tick status --state blocked "Need staging access"')}\n  ${command('agent-tick status --state done "Implemented and validated"')}\n`;

const steeringHelpText = `\n${heading('Examples')}\n  ${command('agent-tick steering --title "Which approach?" --choice "Small fix" --choice "Refactor"')}\n  ${command('agent-tick steering --title "Proceed?" --choice yes="Yes" --choice no:deny="No"')}\n\n${muted('Choices may be plain labels, id=Label, or id:kind=Label. If no deny choice is provided, Agent Tick adds a Cancel choice.')}\n`;

const sanctionHelpText = `\n${heading('Examples')}\n  ${command('agent-tick sanction --title "Deploy to production?"')}\n  ${command('agent-tick sanction --title "Run migration?" --body "Touches billing tables"')}\n  ${command('agent-tick sanction -- npm install')}\n`;

const abandonHelpText = `\n${heading('Example')}\n  ${command('agent-tick abandon apr_123')}\n`;

type UsageCommand = 'status' | 'steering' | 'sanction' | 'setup' | 'login' | 'install' | 'mode' | 'abandon' | 'unknown';

class CliUsageError extends Error {
  constructor(public usageCommand: UsageCommand, message: string) {
    super(message);
  }
}

function cliUsageError(usageCommand: UsageCommand, message: string): CliUsageError {
  return new CliUsageError(usageCommand, message);
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

const agentTickModes = ['afk', 'pass-through'] as const;
export type AgentTickMode = typeof agentTickModes[number];
const claudeRoutingPolicies = ['off', 'afk', 'always'] as const;
type ClaudeRoutingPolicy = typeof claudeRoutingPolicies[number];
type ClaudeProfile = 'interactive' | 'headless';
type ClaudeInstallScope = 'global' | 'local';
type ClaudeSandboxPolicy = 'auto' | 'allow' | 'skip';
interface ClaudeInstallConfig {
  profile: ClaudeProfile;
  steering: ClaudeRoutingPolicy;
  sanctions: ClaudeRoutingPolicy;
  initialMode: AgentTickMode;
  scope: ClaudeInstallScope;
  sandbox: ClaudeSandboxPolicy;
  sandboxDetected: boolean;
  serverDomain?: string;
}
interface AgentTickState {
  mode: AgentTickMode;
  claude?: {
    steering?: ClaudeRoutingPolicy;
    sanctions?: ClaudeRoutingPolicy;
  };
}

export function agentTickStatePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AGENT_TICK_STATE) return env.AGENT_TICK_STATE;
  return path.join(os.homedir(), '.config', 'agent-tick', 'state.json');
}

export function normalizeAgentTickMode(value: string): AgentTickMode {
  const mode = value.trim().toLowerCase();
  if (mode === 'afk') return 'afk';
  if (mode === 'pass-through' || mode === 'passthrough') return 'pass-through';
  throw new Error(`unknown Agent Tick mode: ${value}. Expected afk or pass-through.`);
}

export async function loadAgentTickMode(env: NodeJS.ProcessEnv = process.env): Promise<AgentTickMode> {
  const envMode = env.AGENT_TICK_MODE;
  if (envMode) return normalizeAgentTickMode(envMode);
  return (await loadAgentTickState(env)).mode;
}

export async function saveAgentTickMode(value: string, env: NodeJS.ProcessEnv = process.env): Promise<AgentTickMode> {
  const mode = normalizeAgentTickMode(value);
  await saveAgentTickState({ ...(await loadAgentTickState(env)), mode }, env);
  return mode;
}

async function loadAgentTickState(env: NodeJS.ProcessEnv = process.env): Promise<AgentTickState> {
  try {
    const parsed = JSON.parse(await fs.readFile(agentTickStatePath(env), 'utf8')) as { mode?: unknown; claude?: unknown };
    const mode = typeof parsed.mode === 'string' ? normalizeAgentTickMode(parsed.mode) : 'pass-through';
    const claude = isPlainObject(parsed.claude) ? parseClaudeRoutingState(parsed.claude) : undefined;
    return { mode, ...(claude && Object.keys(claude).length ? { claude } : {}) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { mode: 'pass-through' };
    throw error;
  }
}

async function saveAgentTickState(state: AgentTickState, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const statePath = agentTickStatePath(env);
  await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function parseClaudeRoutingState(value: Record<string, unknown>): NonNullable<AgentTickState['claude']> {
  const claude: NonNullable<AgentTickState['claude']> = {};
  if (typeof value.steering === 'string') claude.steering = normalizeClaudeRoutingPolicy(value.steering);
  if (typeof value.sanctions === 'string') claude.sanctions = normalizeClaudeRoutingPolicy(value.sanctions);
  return claude;
}

function normalizeClaudeRoutingPolicy(value: string): ClaudeRoutingPolicy {
  const policy = value.trim().toLowerCase();
  if (claudeRoutingPolicies.includes(policy as ClaudeRoutingPolicy)) return policy as ClaudeRoutingPolicy;
  throw new Error(`unknown Claude Code routing policy: ${value}. Expected off, afk, or always.`);
}

function normalizeClaudeProfile(value: string): ClaudeProfile {
  const profile = value.trim().toLowerCase();
  if (profile === 'interactive' || profile === 'headless') return profile;
  throw new Error(`unknown Claude Code profile: ${value}. Expected interactive or headless.`);
}

function normalizeClaudeInstallScope(value: string): ClaudeInstallScope {
  const scope = value.trim().toLowerCase();
  if (scope === 'global' || scope === 'user') return 'global';
  if (scope === 'local' || scope === 'project') return 'local';
  throw new Error(`unknown Claude Code install scope: ${value}. Expected global or local.`);
}

function normalizeClaudeSandboxPolicy(value: string): ClaudeSandboxPolicy {
  const policy = value.trim().toLowerCase();
  if (policy === 'auto' || policy === 'allow' || policy === 'skip') return policy;
  throw new Error(`unknown Claude Code sandbox policy: ${value}. Expected auto, allow, or skip.`);
}

async function runInstall(options: InstallOptions): Promise<void> {
  const server = normalizeURL(options.server ?? 'https://agenttick.sh');
  process.stdout.write('Agent Tick installer\n');
  process.stdout.write(`Hosted server: ${server}\n\n`);

  if (options.dryRun) {
    process.stdout.write(options.login === false
      ? 'Step 1/2: [dry-run] would skip browser sign-in because --no-login was provided.\n\n'
      : 'Step 1/2: [dry-run] would connect this machine to Agent Tick.\n\n');
  } else if (options.login !== false) {
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

  const claudeConfig = selected.includes('claude') ? await resolveClaudeInstallConfig(options, server) : undefined;

  process.stdout.write('Step 2/2: install agent hooks.\n');
  const plans = selected.map((target) => installPlanForTarget(target, claudeConfig));
  for (const plan of plans) {
    if (plan.status === 'disabled') {
      process.stdout.write(`skipped ${targetLabels[plan.target]}: ${plan.reason}\n`);
      continue;
    }
    if (options.dryRun) {
      process.stdout.write(`[dry-run] would ${plan.description}\n`);
      if (plan.target === 'claude' && claudeConfig) process.stdout.write(claudeInstallDryRunSummary(claudeConfig));
      continue;
    }
    await plan.apply();
    process.stdout.write(`${plan.description}\n`);
  }

  process.stdout.write(options.dryRun ? '\nDry run complete. No files were changed.\n' : '\nDone. Agent Tick integrations are installed.\n');
  process.stdout.write('Use `agent-tick mode afk` to route configured Claude Code prompts through Agent Tick, and `agent-tick mode pass-through` to restore Claude Code prompts.\n');
  if (selected.includes('claude')) process.stdout.write('Restart Claude Code before relying on newly-installed hooks.\n');
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

async function resolveClaudeInstallConfig(options: InstallOptions, server: string): Promise<ClaudeInstallConfig> {
  const profile = options.claudeProfile ? normalizeClaudeProfile(options.claudeProfile) : options.yes ? 'interactive' : await promptClaudeProfile();
  const scope = options.claudeScope ? normalizeClaudeInstallScope(options.claudeScope) : options.yes ? 'global' : await promptClaudeInstallScope();
  const sandboxDetected = await isClaudeSandboxEnabled();
  const sandbox = options.claudeSandbox ? normalizeClaudeSandboxPolicy(options.claudeSandbox) : options.yes ? 'auto' : await promptClaudeSandboxPolicy(sandboxDetected);
  const defaults = defaultClaudeInstallConfig(profile, scope);
  const steering = options.claudeSteering
    ? normalizeClaudeRoutingPolicy(options.claudeSteering)
    : options.yes ? defaults.steering : await promptClaudeRoutingPolicy('steering / AskUserQuestion', defaults.steering);
  const sanctions = options.claudeSanctions
    ? normalizeClaudeRoutingPolicy(options.claudeSanctions)
    : options.yes ? defaults.sanctions : await promptClaudeRoutingPolicy('sanctions / Claude permission prompts', defaults.sanctions);
  const serverDomain = domainFromURL(server);
  return {
    profile,
    steering,
    sanctions,
    initialMode: options.claudeInitialMode ? normalizeAgentTickMode(options.claudeInitialMode) : defaults.initialMode,
    scope,
    sandbox,
    sandboxDetected,
    ...(serverDomain ? { serverDomain } : {})
  };
}

function defaultClaudeInstallConfig(profile: ClaudeProfile, scope: ClaudeInstallScope = 'global'): ClaudeInstallConfig {
  if (profile === 'headless') return { profile, scope, steering: 'always', sanctions: 'always', initialMode: 'afk', sandbox: 'auto', sandboxDetected: false };
  return { profile, scope, steering: 'afk', sanctions: 'afk', initialMode: 'pass-through', sandbox: 'auto', sandboxDetected: false };
}

async function promptClaudeProfile(): Promise<ClaudeProfile> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return 'interactive';
  process.stdout.write('\nClaude Code setup profiles:\n');
  process.stdout.write('  1. interactive — sometimes at the terminal, sometimes away; start in pass-through mode\n');
  process.stdout.write('  2. headless — no terminal human available; route enabled prompts through Agent Tick always\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Claude Code profile [interactive]? ')).trim().toLowerCase();
    if (!answer || answer === '1' || answer === 'interactive') return 'interactive';
    if (answer === '2' || answer === 'headless') return 'headless';
    return normalizeClaudeProfile(answer);
  } finally {
    rl.close();
  }
}

async function promptClaudeRoutingPolicy(label: string, defaultPolicy: ClaudeRoutingPolicy): Promise<ClaudeRoutingPolicy> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return defaultPolicy;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`Claude Code ${label} policy: off, afk, always [${defaultPolicy}]? `)).trim().toLowerCase();
    return answer ? normalizeClaudeRoutingPolicy(answer) : defaultPolicy;
  } finally {
    rl.close();
  }
}

async function promptClaudeInstallScope(): Promise<ClaudeInstallScope> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return 'global';
  process.stdout.write('\nClaude Code hook install scope:\n');
  process.stdout.write('  1. global — write ~/.claude/settings.json for all Claude Code projects on this machine\n');
  process.stdout.write('  2. local — write .claude/settings.local.json for only this project checkout\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Claude Code hook scope [global]? ')).trim().toLowerCase();
    if (!answer || answer === '1' || answer === 'global' || answer === 'user') return 'global';
    if (answer === '2' || answer === 'local' || answer === 'project') return 'local';
    return normalizeClaudeInstallScope(answer);
  } finally {
    rl.close();
  }
}

async function promptClaudeSandboxPolicy(sandboxDetected: boolean): Promise<ClaudeSandboxPolicy> {
  if (!sandboxDetected || !process.stdin.isTTY || !process.stdout.isTTY) return 'auto';
  process.stdout.write('\nClaude Code sandbox appears enabled. Agent Tick needs sandbox access to call Agent Tick and write local config/state.\n');
  process.stdout.write('  1. allow — add Agent Tick sandbox allowances now\n');
  process.stdout.write('  2. skip — leave sandbox settings unchanged\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Add Agent Tick sandbox allowances [allow]? ')).trim().toLowerCase();
    if (!answer || answer === '1' || answer === 'allow' || answer === 'yes' || answer === 'y') return 'allow';
    if (answer === '2' || answer === 'skip' || answer === 'no' || answer === 'n') return 'skip';
    return normalizeClaudeSandboxPolicy(answer);
  } finally {
    rl.close();
  }
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

function installPlanForTarget(target: InstallTarget, claudeConfig?: ClaudeInstallConfig): InstallPlan {
  if (target === 'claude') {
    const settingsPath = claudeSettingsPath(claudeConfig?.scope ?? 'global');
    return {
      target,
      status: 'enabled',
      description: `install Claude Code AFK/pass-through hooks in ${settingsPath}`,
      apply: () => installClaudeHooks(settingsPath, claudeConfig ?? defaultClaudeInstallConfig('interactive'))
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

function claudeSettingsPath(scope: ClaudeInstallScope): string {
  return scope === 'local' ? path.join(process.cwd(), '.claude', 'settings.local.json') : path.join(os.homedir(), '.claude', 'settings.json');
}

function claudeSettingsPathsToInspect(): string[] {
  return [
    path.join(os.homedir(), '.claude', 'settings.json'),
    path.join(process.cwd(), '.claude', 'settings.json'),
    path.join(process.cwd(), '.claude', 'settings.local.json')
  ];
}

async function isClaudeSandboxEnabled(): Promise<boolean> {
  for (const settingsPath of claudeSettingsPathsToInspect()) {
    const settings = await readJSONFile(settingsPath);
    if (isPlainObject(settings) && isPlainObject(settings.sandbox) && settings.sandbox.enabled === true) return true;
  }
  return false;
}

function shouldInstallClaudeSandboxAllowances(config: ClaudeInstallConfig): boolean {
  return config.sandbox === 'allow' || (config.sandbox === 'auto' && config.sandboxDetected);
}

function claudeInstallDryRunSummary(config: ClaudeInstallConfig): string {
  const sandboxLine = shouldInstallClaudeSandboxAllowances(config)
    ? `  - add sandbox allowances: network ${claudeSandboxDomains(config).join(', ')}, write ~/.config/agent-tick, run agent-tick outside sandbox`
    : config.sandboxDetected ? '  - leave existing Claude sandbox settings unchanged' : '  - no Claude sandbox enabled in inspected settings; no sandbox allowances needed';
  return [
    `  - scope: ${config.scope} (${claudeSettingsPath(config.scope)})`,
    `  - profile: ${config.profile}`,
    `  - steering policy: ${config.steering}`,
    `  - sanction policy: ${config.sanctions}`,
    '  - remove legacy Agent Tick PreToolUse Bash hook if present',
    '  - add PreToolUse AskUserQuestion hook: agent-tick hook claude-pre-tool-use',
    '  - add PermissionRequest * hook: agent-tick hook claude-permission-request',
    '  - add permission allow rule: Bash(agent-tick:*)',
    sandboxLine,
    `  - initialize Agent Tick mode state to ${config.initialMode}`,
    '  - Claude Code will need a restart before new hooks are active',
    ''
  ].join('\n');
}

async function installClaudeHooks(settingsPath: string, config: ClaudeInstallConfig): Promise<void> {
  const settings = await readJSONFile(settingsPath);
  const root = isPlainObject(settings) ? settings : {};
  const hooks = isPlainObject(root.hooks) ? root.hooks : {};
  hooks.PreToolUse = mergeClaudeHookGroups(removeLegacyClaudeBashHookGroups(hooks.PreToolUse), [
    {
      matcher: 'AskUserQuestion',
      hooks: [{ type: 'command', command: 'agent-tick hook claude-pre-tool-use', timeout: 1800, statusMessage: 'Agent Tick steering check' }]
    }
  ]);
  hooks.PermissionRequest = mergeClaudeHookGroups(hooks.PermissionRequest, [
    {
      matcher: '*',
      hooks: [{ type: 'command', command: 'agent-tick hook claude-permission-request', timeout: 1800, statusMessage: 'Agent Tick sanction check' }]
    }
  ]);
  root.hooks = hooks;
  const permissions = isPlainObject(root.permissions) ? root.permissions : {};
  permissions.allow = mergeStringArray(permissions.allow, ['Bash(agent-tick:*)']);
  root.permissions = permissions;
  if (shouldInstallClaudeSandboxAllowances(config)) root.sandbox = mergeClaudeSandboxAllowances(root.sandbox, config);
  await writeJSONFile(settingsPath, root);
  await saveAgentTickState({
    ...(await loadAgentTickState()),
    mode: config.initialMode,
    claude: { steering: config.steering, sanctions: config.sanctions }
  });
}

function mergeClaudeHookGroups(existing: unknown, additions: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const groups = Array.isArray(existing) ? [...existing.filter(isPlainObject)] : [];
  for (const addition of additions) {
    const key = JSON.stringify(addition);
    if (!groups.some((group) => JSON.stringify(group) === key)) groups.push(addition);
  }
  return groups;
}

function mergeClaudeSandboxAllowances(existing: unknown, config: ClaudeInstallConfig): Record<string, unknown> {
  const sandbox = isPlainObject(existing) ? { ...existing } : {};
  const network = isPlainObject(sandbox.network) ? { ...sandbox.network } : {};
  network.allowedDomains = mergeStringArray(network.allowedDomains, claudeSandboxDomains(config));
  sandbox.network = network;

  const filesystem = isPlainObject(sandbox.filesystem) ? { ...sandbox.filesystem } : {};
  filesystem.allowWrite = mergeStringArray(filesystem.allowWrite, ['~/.config/agent-tick']);
  sandbox.filesystem = filesystem;

  sandbox.excludedCommands = mergeStringArray(sandbox.excludedCommands, ['agent-tick']);
  return sandbox;
}

function claudeSandboxDomains(config: ClaudeInstallConfig): string[] {
  return uniqueStrings(['agenttick.sh', ...(config.serverDomain && config.serverDomain !== 'agenttick.sh' ? [config.serverDomain] : [])]);
}

function uniqueStrings(values: string[]): string[] {
  const unique: string[] = [];
  for (const value of values) {
    if (!unique.includes(value)) unique.push(value);
  }
  return unique;
}

function removeLegacyClaudeBashHookGroups(existing: unknown): unknown {
  if (!Array.isArray(existing)) return existing;
  return existing.filter((group) => {
    if (!isPlainObject(group) || group.matcher !== 'Bash' || !Array.isArray(group.hooks)) return true;
    return !group.hooks.some((hook) => isPlainObject(hook) && hook.command === 'agent-tick hook claude-pre-tool-use');
  });
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
  const title = target === 'pi' ? '---\nname: agent-tick\ndescription: Use Agent Tick for sanctions, steering, and status updates.\n---\n\n# Agent Tick human loop' : '# Agent Tick human loop';
  return `${title}\n\nThis machine is connected to Agent Tick. Use the product language directly: status, steering, and sanctions.\n\nFor sanctions before risky, destructive, expensive, production, data-accessing, or dependency-installing actions:\n\n\`\`\`sh\nagent-tick sanction --title "Proceed?" --body "Describe the action and risk."\n\`\`\`\n\nFor a command that should run only after sanction approval:\n\n\`\`\`sh\nagent-tick sanction -- <command and args>\n\`\`\`\n\nFor structured choices that steer the work:\n\n\`\`\`sh\nagent-tick steering --title "Which approach?" --choice option_a="Option A" --choice cancel:deny="Cancel"\n\`\`\`\n\nFor non-blocking progress updates:\n\n\`\`\`sh\nagent-tick status --state working "Finished edits; validating now"\n\`\`\`\n\nIf Agent Tick denies, times out, or exits non-zero, stop and report the outcome. Do not include secrets, tokens, private keys, or full environment files in titles, bodies, commands, or status messages.\n`;
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

function domainFromURL(value: string): string | undefined {
  try {
    return new URL(value).hostname || undefined;
  } catch {
    return undefined;
  }
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
  if (toolName === 'AskUserQuestion' && await shouldRouteClaudeCapability('steering')) await handleClaudeAskUserQuestionHook(input, options);
}

async function runClaudePermissionRequestHook(options: { timeout?: string }): Promise<void> {
  const input = JSON.parse(await readStdin());
  if (!await shouldRouteClaudeCapability('sanctions')) return;
  const toolName = typeof input.tool_name === 'string' ? input.tool_name : 'Claude Code tool';
  if (toolName === 'Bash') {
    const toolInput = isPlainObject(input.tool_input) ? input.tool_input : {};
    const command = typeof toolInput.command === 'string' ? toolInput.command : '';
    if (command && isAgentTickCommand(command)) {
      printClaudePermissionRequestDecision('allow', 'Allowed Agent Tick CLI command');
      return;
    }
  }
  const command = claudePermissionRequestCommand(input);
  const finalRequest = await createHookApproval({
    title: `Approve Claude Code ${toolName}?`,
    body: claudePermissionRequestBody(input),
    ...(command ? { command } : {}),
    ...(options.timeout ? { timeout: options.timeout } : {})
  });
  if (exitCodeForRequest(finalRequest) === 0) {
    printClaudePermissionRequestDecision('allow', 'Approved in Agent Tick');
  } else {
    printClaudePermissionRequestDecision('deny', 'Denied, timed out, or failed in Agent Tick');
  }
}

async function handleClaudeAskUserQuestionHook(input: Record<string, unknown>, options: { timeout?: string }): Promise<void> {
  const toolInput = isPlainObject(input.tool_input) ? input.tool_input : {};
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions.filter(isPlainObject) : [];
  if (!questions.length) return;
  const answers: Record<string, string | string[]> = {};
  for (const [index, question] of questions.entries()) {
    const questionText = typeof question.question === 'string' ? question.question : `Question ${index + 1}`;
    const answer = await answerClaudeQuestion(question, questionText, options);
    if (answer === undefined) {
      printClaudePreToolDecision('deny', 'Question was denied, cancelled, timed out, or failed in Agent Tick');
      return;
    }
    answers[questionText] = answer;
  }
  printClaudePreToolDecision('allow', 'Answered through Agent Tick', { ...toolInput, answers });
}

async function answerClaudeQuestion(question: Record<string, unknown>, questionText: string, options: { timeout?: string }): Promise<string | string[] | undefined> {
  const optionsList = Array.isArray(question.options) ? question.options.filter(isPlainObject) : [];
  const multiSelect = question.multiSelect === true;
  const choices = multiSelect ? multiSelectChoices(optionsList) : singleSelectChoices(optionsList);
  const finalRequest = await createHookApproval({
    title: questionText,
    body: claudeQuestionBody([question]),
    choices: choices.choices,
    ...(options.timeout ? { timeout: options.timeout } : {})
  });
  const choiceId = finalRequest.response?.choiceId;
  return choiceId ? choices.answers.get(choiceId) : undefined;
}

function singleSelectChoices(optionsList: Array<Record<string, unknown>>): { choices: Array<{ id: string; label: string; kind: string }>; answers: Map<string, string> } {
  const answers = new Map<string, string>();
  const choices = optionsList.map((option, index) => {
    const label = typeof option.label === 'string' ? option.label : `Option ${index + 1}`;
    const id = `option_${index + 1}`;
    answers.set(id, label);
    return { id, label, kind: 'approve' };
  });
  choices.push({ id: 'cancel', label: 'Cancel / do not answer', kind: 'deny' });
  return { choices, answers };
}

function multiSelectChoices(optionsList: Array<Record<string, unknown>>): { choices: Array<{ id: string; label: string; kind: string }>; answers: Map<string, string[]> } {
  const labels = optionsList.map((option, index) => typeof option.label === 'string' ? option.label : `Option ${index + 1}`);
  const answers = new Map<string, string[]>();
  const choices: Array<{ id: string; label: string; kind: string }> = [];
  const maxMask = 1 << labels.length;
  for (let mask = 1; mask < maxMask; mask += 1) {
    const selected = labels.filter((_, index) => (mask & (1 << index)) !== 0);
    const id = `options_${mask}`;
    answers.set(id, selected);
    choices.push({ id, label: selected.join(', '), kind: 'approve' });
  }
  choices.push({ id: 'cancel', label: 'Cancel / do not answer', kind: 'deny' });
  return { choices, answers };
}

async function shouldRouteClaudeCapability(capability: 'steering' | 'sanctions'): Promise<boolean> {
  const state = await loadAgentTickState();
  const policy = state.claude?.[capability] ?? 'afk';
  if (policy === 'off') return false;
  if (policy === 'always') return true;
  return state.mode === 'afk';
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

function printClaudePermissionRequestDecision(behavior: 'allow' | 'deny', message: string): void {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior, message }
    }
  })}\n`);
}

function claudePermissionRequestBody(input: Record<string, unknown>): string {
  const toolName = typeof input.tool_name === 'string' ? input.tool_name : 'Claude Code tool';
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const lines = [`Claude Code is requesting permission to use ${toolName}.`, '', `Working directory: ${cwd}`];
  const toolInput = isPlainObject(input.tool_input) ? input.tool_input : undefined;
  if (toolInput) lines.push('', 'Tool input summary:', truncateForDisplay(JSON.stringify(redactHookInput(toolInput), null, 2), 4000));
  return lines.join('\n');
}

function claudePermissionRequestCommand(input: Record<string, unknown>): string | undefined {
  if (input.tool_name !== 'Bash') return undefined;
  const toolInput = isPlainObject(input.tool_input) ? input.tool_input : {};
  return typeof toolInput.command === 'string' ? toolInput.command : undefined;
}

function claudeQuestionBody(questions: Array<Record<string, unknown>>): string {
  return questions.map((question, index) => {
    const questionText = typeof question.question === 'string' ? question.question : `Question ${index + 1}`;
    const optionsList = Array.isArray(question.options) ? question.options.filter(isPlainObject) : [];
    const optionsText = optionsList.map((option, optionIndex) => {
      const label = typeof option.label === 'string' ? option.label : `Option ${optionIndex + 1}`;
      const description = typeof option.description === 'string' ? ` — ${option.description}` : '';
      return `- ${label}${description}`;
    }).join('\n');
    return `${questionText}${question.multiSelect === true ? ' (multi-select)' : ''}\n${optionsText}`;
  }).join('\n\n');
}

function redactHookInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactHookInput);
  if (!isPlainObject(value)) return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = /token|secret|password|credential|key/i.test(key) ? '[redacted]' : redactHookInput(entry);
  }
  return redacted;
}

function truncateForDisplay(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}\n…truncated…`;
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
      host: os.hostname(),
      workingDirectory: process.cwd(),
      projectName: options.project ?? path.basename(process.cwd())
    },
    title: encryptedPayload ? 'Encrypted approval request' : options.title,
    ...(encryptedPayload ? { body: 'Open Agent Tick to decrypt this request.' } : options.body ? { body: options.body } : {}),
    ...(encryptedPayload || !options.command ? {} : { command: options.command }),
    ...(encryptedPayload ? { encryptedPayload } : {}),
    ...(choices.length ? { choices } : {})
  });
  const request = created.request;
  if (encryptedPayload && !request.encryptedPayload) {
    await client.abandonApproval(request.id).catch(() => undefined);
    throw new Error('Server did not preserve encryptedPayload. Upgrade/restart the Agent Tick server before using --encrypt. The placeholder request was abandoned.');
  }

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
  const usedIds = new Set<string>();
  const choices = (values ?? []).map((value, index) => parseChoice(value, index, usedIds));
  if (choices.length && !choices.some((choice) => choice.kind === 'deny')) {
    choices.push({ id: 'cancel', label: 'Cancel / do not answer', kind: 'deny' });
  }
  return choices;
}

function parseChoice(value: string, index: number, usedIds: Set<string>): { id: string; label: string; kind: string } {
  const separator = value.indexOf('=');
  if (separator === -1) {
    const label = value.trim();
    if (!label) throw new Error('invalid choice: label cannot be empty. Use --choice "Small fix" or --choice id=Label.');
    return uniquifyChoiceId({ id: slugifyChoiceId(label) || `choice_${index + 1}`, label, kind: inferredChoiceKind(label) }, usedIds);
  }
  if (separator <= 0) throw new Error(`invalid choice: ${value}. Use a plain label, id=Label, or id:kind=Label.`);
  const idAndKind = value.slice(0, separator).trim();
  const label = value.slice(separator + 1).trim();
  if (!label) throw new Error(`invalid choice: ${value}. Choice label cannot be empty.`);
  const kindSeparator = idAndKind.indexOf(':');
  const id = (kindSeparator === -1 ? idAndKind : idAndKind.slice(0, kindSeparator)).trim();
  const kind = (kindSeparator === -1 ? inferredChoiceKind(id) : idAndKind.slice(kindSeparator + 1).trim()) || 'approve';
  if (!id) throw new Error(`invalid choice: ${value}. Choice id cannot be empty.`);
  if (usedIds.has(id)) throw new Error(`invalid choice: ${value}. Duplicate explicit choice id: ${id}.`);
  usedIds.add(id);
  return { id, label, kind };
}

function uniquifyChoiceId(choice: { id: string; label: string; kind: string }, usedIds: Set<string>): { id: string; label: string; kind: string } {
  let id = choice.id;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${choice.id}_${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return { ...choice, id };
}

function slugifyChoiceId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
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
  claudeProfile?: string;
  claudeSteering?: string;
  claudeSanctions?: string;
  claudeInitialMode?: string;
  claudeScope?: string;
  claudeSandbox?: string;
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
  project?: string;
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

function commandFromArgv(argv: string[]): UsageCommand {
  const commandName = argv.slice(2).find((arg) => !arg.startsWith('-'));
  if (commandName === 'status' || commandName === 'steering' || commandName === 'sanction' || commandName === 'setup' || commandName === 'login' || commandName === 'install' || commandName === 'mode' || commandName === 'abandon') return commandName;
  return 'unknown';
}

function usageHint(name: UsageCommand): string {
  if (name === 'status') return `${statusHelpText}\nRun ${command('agent-tick status --help')} for all options.\n`;
  if (name === 'steering') return `${steeringHelpText}\nRun ${command('agent-tick steering --help')} for all options.\n`;
  if (name === 'sanction') return `${sanctionHelpText}\nRun ${command('agent-tick sanction --help')} for all options.\n`;
  if (name === 'setup') return `${setupHelpText}\nRun ${command('agent-tick setup --help')} for all options.\n`;
  if (name === 'login') return `${loginHelpText}\nRun ${command('agent-tick login --help')} for all options.\n`;
  if (name === 'install') return `${installHelpText}\nRun ${command('agent-tick install --help')} for all options.\n`;
  if (name === 'abandon') return `${abandonHelpText}\nRun ${command('agent-tick abandon --help')} for all options.\n`;
  return `\n${topLevelHelpText()}Run ${command('agent-tick --help')} for all options.\n`;
}

function handleCliError(error: unknown): void {
  if (error instanceof CommanderError && (error.code === 'commander.helpDisplayed' || error.code === 'commander.version')) {
    process.exit(error.exitCode);
  }
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage.replace(/^error:\s*/i, '');
  if (!(error instanceof CliUsageError) && !(error instanceof CommanderError)) {
    process.stderr.write(`${errorText('Error:')} ${message}\n`);
    process.exit(1);
  }
  const usageCommand = error instanceof CliUsageError ? error.usageCommand : commandFromArgv(process.argv);
  process.stderr.write(`${errorText('Error:')} ${warning(message)}\n${usageHint(usageCommand)}`);
  process.exit(error instanceof CommanderError ? error.exitCode : 1);
}

if (isDirectExecution()) {
  createProgram().parseAsync(process.argv).catch(handleCliError);
}
