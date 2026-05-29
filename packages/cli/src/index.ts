#!/usr/bin/env node
import { Buffer } from 'node:buffer';
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
import { Command, CommanderError, Option } from 'commander';
import { AgentTickClient, type RequestRecord, type CreateRequestResponse } from '@self-deprecated/agent-tick-sdk';
import { agentTickStatePath, loadAgentTickMode, loadAgentTickState, normalizeAgentTickMode, saveAgentTickMode, saveAgentTickState, type AgentTickMode } from './agentTickState.js';
import { abandonHelpText, command, configHelpText, errorText, installHelpText, loginHelpText, orderedVisibleCommands, rootHelpFooter, sanctionHelpText, statusUpdateHelpText, steeringHelpText, success, topLevelHelpText, warning } from './cliText.js';
import { inferredChoiceKind, parseChoices, slugifyChoiceId, type ChoiceInput } from './choiceParsing.js';
import { isRiskyCommand } from './commandRisk.js';
import { assertAgentToken, clientConfigPath, loadClientConfig, maskAgentToken, resolveServerAndToken, saveClientConfig } from './config.js';
import { parseDurationMs } from './duration.js';
import { metadataEntriesFromRecord, statusUpdateMetadata } from './metadata.js';
import { readMcpMessages, writeMcpMessage, type JsonRpcId, type JsonRpcRequest, type McpMessageTransport } from './mcpProtocol.js';
import { claudeHookSessionId, resolveAgentTickSessionId, sessionFieldsFromMcpArgs, sessionFieldsFromOptions, type AgentTickEnv } from './sessionIdentity.js';
import { isPlainObject, mcpErrorMessage, optionalString, optionalStringRecord, requiredString } from './valueGuards.js';

export { agentTickStatePath, loadAgentTickMode, normalizeAgentTickMode, saveAgentTickMode } from './agentTickState.js';
export type { AgentTickMode } from './agentTickState.js';
export { inferredChoiceKind, parseChoices, slugifyChoiceId } from './choiceParsing.js';
export type { ChoiceInput } from './choiceParsing.js';
export { isRiskyCommand } from './commandRisk.js';
export { parseDurationMs } from './duration.js';
export { tryReadMcpMessage } from './mcpProtocol.js';
export { claudeHookSessionId, resolveAgentTickSessionId } from './sessionIdentity.js';
export type { AgentTickEnv } from './sessionIdentity.js';

export const hostedAgentTickURL = 'https://app.agenttick.sh';

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
    .description('Configure this machine by signing in to Agent Tick in your browser')
    .option('--server <url>', `Agent Tick server URL [default: ${hostedAgentTickURL}]`)
    .option('--name <name>', 'agent token name for browser sign-in', defaultAgentName())
    .addHelpText('after', loginHelpText)
    .action(async (options: LoginOptions) => {
      const result = await setupWithBrowser({ server: await promptForServer(options.server), name: options.name });
      process.stdout.write(`${success('saved')} Agent Tick config to ${result.path}\n`);
    });

  const configCommand = program
    .command('config')
    .description('Show or configure the saved Agent Tick server and token')
    .option('--server <url>', `Agent Tick server URL [default: ${hostedAgentTickURL}]`)
    .option('--token <token>', 'Agent Tick agent token')
    .option('--login', 'open browser sign-in and create an agent token')
    .option('--name <name>', 'agent token name for browser sign-in', defaultAgentName())
    .addHelpText('after', configHelpText)
    .action(async (options: ConfigOptions) => {
      const result = await configureSavedClient(options, { allowInteractive: true });
      process.stdout.write(`${success('saved')} Agent Tick config to ${result.path}\n`);
    });

  configCommand
    .command('show')
    .description('Show the saved Agent Tick server and a masked token')
    .option('--json', 'print JSON')
    .action(async (options: { json?: boolean }) => {
      await showSavedConfig(options);
    });


  program
    .command('install')
    .description('Install Agent Tick into local AI coding agents')
    .option('--server <url>', `Agent Tick server URL [default: ${hostedAgentTickURL}]`)
    .option('--token <token>', 'Agent Tick agent token to save before installing integrations')
    .option('--login', 'open browser sign-in before installing integrations')
    .option('--target <target>', 'agent to configure, repeatable: claude, codex, gemini, pi, cursor, opencode, agents-md', collectOption, [])
    .option('--all', 'configure every supported target without prompting')
    .option('--yes', 'accept defaults and do not prompt')
    .option('--no-login', 'skip browser sign-in and only install agent integrations')
    .option('--dry-run', 'print planned changes without writing files')
    .option('--claude-scope <scope>', 'Claude Code MCP/hook install scope: global or local')
    .option('--claude-permission-hook', 'also route Claude Code native permission prompts through Agent Tick')
    .option('--claude-question-hook', 'also route Claude Code AskUserQuestion prompts through Agent Tick')
    .option('--remove-claude-hooks', 'remove existing Agent Tick Claude Code hook entries')
    .addOption(new Option('--claude-profile <profile>', 'legacy Claude Code setup profile').hideHelp())
    .addOption(new Option('--claude-steering <policy>', 'legacy Claude Code steering policy').hideHelp())
    .addOption(new Option('--claude-sanctions <policy>', 'legacy Claude Code sanction policy').hideHelp())
    .addOption(new Option('--claude-initial-mode <mode>', 'legacy initial Agent Tick mode for Claude Code').hideHelp())
    .addOption(new Option('--claude-sandbox <policy>', 'legacy Claude Code sandbox compatibility').hideHelp())
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

  program
    .command('mcp')
    .description('Run the local stdio MCP adapter')
    .option('--server <url>', 'Agent Tick server URL [env: AGENT_TICK_SERVER]')
    .option('--token <token>', 'Agent Tick agent token [env: AGENT_TICK_TOKEN]')
    .action(async (options: ClientOptions) => {
      try {
        await runMcpStdioAdapter(options);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}\nRun \`agent-tick login\`, \`agent-tick config --server <url> --token <token>\`, or \`agent-tick install\` before starting the MCP adapter.`);
      }
    });

  const hook = program.command('hook', { hidden: true }).description('Internal hook entrypoints used by agent integrations');

  hook
    .command('claude-pre-tool-use')
    .description('Claude Code PreToolUse hook for Agent Tick steering')
    .option('--timeout <duration>', 'Request wait timeout', '30m')
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
    .option('--timeout <duration>', 'Request wait timeout', '30m')
    .action(async (options: { timeout?: string }) => {
      try {
        await runClaudePermissionRequestHook(options);
      } catch (error) {
        printClaudePermissionRequestDecision('deny', `Agent Tick hook failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

  program
    .command('sanction')
    .description('Create a human Sanction Request and wait for a Response')
    .allowUnknownOption(true)
    .argument('[command...]', 'optional command to include in the Sanction Request')
    .option('--server <url>', 'Agent Tick server URL [env: AGENT_TICK_SERVER]')
    .option('--token <token>', 'Agent Tick agent token [env: AGENT_TICK_TOKEN]')
    .option('--title <title>', 'sanction title')
    .option('--body <body>', 'sanction body')
    .option('--command <command>', 'command or action to approve without running it')
    .option('--client-name <name>', 'client display name')
    .option('--session <id>', 'real host chat/thread/session identifier [env: AGENT_TICK_SESSION_ID]')
    .option('--session-title <title>', 'human-readable Session title/label [env: AGENT_TICK_SESSION_TITLE]')
    .option('--choice-flag <choice=flag>', 'default sanction choice UI flag, repeatable: approve=production|reject=favorite|...', collectOption, [])
    .option('--choice-tag <choice=tag>', 'default sanction choice display tag, repeatable: approve=tag', collectOption, [])
    .option('--timeout <duration>', 'wait timeout, e.g. 30s, 5m, 0 for no wait', '30m')
    .option('--json', 'print machine-readable JSON events')
    .addHelpText('after', sanctionHelpText)
    .action(async (commandParts: string[], options: RequestOptions) => {
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
    .option('--client-name <name>', 'client display name')
    .option('--session <id>', 'real host chat/thread/session identifier [env: AGENT_TICK_SESSION_ID]')
    .option('--session-title <title>', 'human-readable Session title/label [env: AGENT_TICK_SESSION_TITLE]')
    .option('--choice <choice>', 'steering choice, repeatable: id=Label or id:kind=Label; include one kind=deny choice', collectOption, [])
    .option('--choice-flag <choice=flag>', 'choice UI flag, repeatable: choiceId=favorite|production|destructive|...', collectOption, [])
    .option('--choice-tag <choice=tag>', 'choice display tag, repeatable: choiceId=tag', collectOption, [])
    .option('--timeout <duration>', 'wait timeout, e.g. 30s, 5m, 0 for no wait', '30m')
    .option('--json', 'print machine-readable JSON events')
    .addHelpText('after', steeringHelpText)
    .action(async (options: RequestOptions) => {
      if (!options.title?.trim()) throw cliUsageError('steering', 'steering requires --title');
      if (!options.choice?.length) throw cliUsageError('steering', 'steering requires at least one --choice');
      let choices: ChoiceInput[];
      try {
        choices = parseChoices(options.choice, options.choiceFlag, options.choiceTag);
      } catch (error) {
        throw cliUsageError('steering', error instanceof Error ? error.message : String(error));
      }
      const { client, server } = await clientFromOptions(options);
      const created = await createAndMaybeWait(client, server, { ...options, requestType: 'steering', hookChoices: choices });
      process.exitCode = exitCodeForRequest(created);
    });

  program
    .command('status', { hidden: true })
    .description('Removed; use status-update')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(() => {
      throw cliUsageError('status-update', 'status has been renamed to status-update');
    });

  program
    .command('status-update')
    .description('Send a small progress update to Agent Tick')
    .argument('[message...]', 'status update message')
    .option('--server <url>', 'Agent Tick server URL [env: AGENT_TICK_SERVER]')
    .option('--token <token>', 'Agent Tick agent token [env: AGENT_TICK_TOKEN]')
    .option('--thread <id>', 'legacy thread/chat identifier [env: AGENT_TICK_THREAD_ID]')
    .option('--session <id>', 'real host chat/thread/session identifier [env: AGENT_TICK_SESSION_ID]')
    .option('--session-title <title>', 'human-readable Session title/label [env: AGENT_TICK_SESSION_TITLE]')
    .option('--state <state>', 'semantic status update state: working, waiting, blocked, done, failed', 'working')
    .option('--next <text>', 'what the agent expects to do next')
    .option('--client-name <name>', 'client display name')
    .option('--importance <level>', 'future notification importance hint: low, normal, high, urgent', 'normal')
    .option('--notify', 'future push-notification hint for attention-worthy updates')
    .option('--metadata <key=value>', 'metadata key/value, repeatable', collectOption, [])
    .option('--json', 'print machine-readable JSON')
    .addHelpText('after', statusUpdateHelpText)
    .action(async (messageParts: string[], options: StatusOptions) => {
      const { client } = await clientFromOptions(options);
      const message = messageParts.join(' ').trim();
      if (!message) throw cliUsageError('status-update', 'status-update requires a message');
      const update = await client.createStatusUpdate({
        threadId: options.thread ?? process.env.AGENT_TICK_THREAD_ID ?? defaultThreadId(),
        ...(sessionFieldsFromOptions(options)),
        message,
        state: options.state ?? 'working',
        nextStep: options.next,
        host: os.hostname() || undefined,
        workingDirectory: process.cwd(),
        clientName: options.clientName ?? path.basename(process.cwd()),
        metadata: statusUpdateMetadata(options)
      });
      if (options.json) process.stdout.write(`${JSON.stringify({ event: 'status_update', statusUpdate: update })}\n`);
      else process.stdout.write(`sent status update for ${update.threadId}: ${update.message}\n`);
    });

  program
    .command('abandon')
    .description('Resolve a pending Request')
    .argument('<request-id>', 'Request ID')
    .option('--server <url>', 'Agent Tick server URL [env: AGENT_TICK_SERVER]')
    .option('--token <token>', 'Agent Tick agent token [env: AGENT_TICK_TOKEN]')
    .option('--json', 'print machine-readable JSON')
    .addHelpText('after', abandonHelpText)
    .action(async (requestId: string, options: ClientOptions & { json?: boolean }) => {
      const { client } = await clientFromOptions(options);
      const abandoned = await client.abandonRequest(requestId);
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ event: 'abandoned', request: abandoned })}\n`);
      } else {
        process.stdout.write(`resolved request ${abandoned.id}\n`);
      }
    });


  return program;
}

async function clientFromOptions(options: ClientOptions): Promise<{ client: AgentTickClient; server: string; token: string }> {
  const { server, token } = await resolveServerAndToken(options);
  return { server, token, client: new AgentTickClient({ baseUrl: server, tokenProvider: () => token }) };
}

type ConfigMethod = 'browser' | 'token';
type SavedConfigResult = { path: string; method: ConfigMethod; server: string };

async function configureSavedClient(options: ConfigOptions, settings: { allowInteractive: boolean; usageCommand?: UsageCommand; defaultMethod?: ConfigMethod } = { allowInteractive: true }): Promise<SavedConfigResult> {
  const usageCommand = settings.usageCommand ?? 'config';
  const server = await promptForServer(options.server);
  if (options.login) {
    return { ...(await setupWithBrowser({ server, name: options.name })), method: 'browser', server };
  }
  if (options.token) {
    return { path: await saveConfigWithToken(server, options.token), method: 'token', server };
  }
  if (settings.allowInteractive && isInteractiveTerminal()) {
    const method = await promptConfigMethod(settings.defaultMethod ?? 'browser');
    if (method === 'browser') return { ...(await setupWithBrowser({ server, name: options.name })), method, server };
    const token = await promptForToken();
    return { path: await saveConfigWithToken(server, token), method, server };
  }
  if (settings.defaultMethod === 'browser') return { ...(await setupWithBrowser({ server, name: options.name })), method: 'browser', server };
  throw cliUsageError(usageCommand, 'configuration requires --login, --token, or an interactive terminal. Use `agent-tick login` for browser sign-in.');
}

async function saveConfigWithToken(server: string, token: string): Promise<string> {
  return saveClientConfig({ server: normalizeURL(server), token: assertAgentToken(token) });
}

async function promptForServer(value: string | undefined): Promise<string> {
  const defaultServer = hostedAgentTickURL;
  if (value?.trim()) return normalizeURL(value);
  if (!isInteractiveTerminal()) return defaultServer;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`Agent Tick server [${defaultServer}]: `)).trim();
    return normalizeURL(answer || defaultServer);
  } finally {
    rl.close();
  }
}

async function promptConfigMethod(defaultMethod: ConfigMethod): Promise<ConfigMethod> {
  process.stdout.write('How do you want to configure this machine?\n');
  process.stdout.write('  1. Open browser sign-in\n');
  process.stdout.write('  2. Paste an agent token\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`Choice [${defaultMethod === 'browser' ? '1' : '2'}]: `)).trim().toLowerCase();
    if (!answer) return defaultMethod;
    if (answer === '1' || answer === 'browser' || answer === 'login') return 'browser';
    if (answer === '2' || answer === 'token' || answer === 'paste') return 'token';
    throw new Error('Expected 1 for browser sign-in or 2 for agent token.');
  } finally {
    rl.close();
  }
}

async function promptForToken(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return assertAgentToken(await rl.question('Agent token: '));
  } finally {
    rl.close();
  }
}

async function showSavedConfig(options: { json?: boolean }): Promise<void> {
  const configPath = clientConfigPath();
  const config = await loadClientConfig();
  const server = config.server || '(not set)';
  const token = maskAgentToken(config.token);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ path: configPath, server: config.server || null, token })}\n`);
    return;
  }
  process.stdout.write(`Config file: ${configPath}\nServer: ${server}\nToken: ${token}\n`);
}

function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

async function setupWithBrowser(options: { server: string; name?: string | undefined }): Promise<{ path: string }> {
  const state = randomBytes(24).toString('base64url');
  const callbackServer = await listenForSetupCallback({ expectedState: state, fallbackServer: options.server });
  const loginURL = buildCliSetupURL({
    server: options.server,
    callbackURL: callbackServer.callbackURL,
    state,
    ...(options.name ? { name: options.name } : {})
  });
  process.stdout.write(`Opening ${loginURL}\n`);
  process.stdout.write('Sign in in your browser. Agent Tick will redirect back here when configuration is complete.\n');
  openBrowser(loginURL);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Timed out waiting for browser sign-in. Run `agent-tick login` again to retry.')), 5 * 60_000);
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
          response.end('<h1>Agent Tick configuration failed</h1><p>Invalid sign-in callback. You can close this tab and retry <code>agent-tick login</code>.</p>');
          return;
        }
        const path = await saveClientConfig({ server: serverURL, token });
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<h1>Agent Tick configuration complete</h1><p>You can close this tab and return to your terminal.</p>');
        resolve({ path });
      })().catch((error: unknown) => {
        response.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
        response.end(`<h1>Agent Tick configuration failed</h1><p>${escapeHTML(error instanceof Error ? error.message : String(error))}</p>`);
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

export function buildCliSetupURL(options: { appURL?: string; server: string; callbackURL: string; state: string; name?: string }): string {
  const appURL = normalizeURL(options.appURL ?? options.server);
  const server = normalizeURL(options.server);
  const url = new URL('/', appURL);
  url.searchParams.set('cli_callback', options.callbackURL);
  url.searchParams.set('cli_state', options.state);
  if (server !== appURL) url.searchParams.set('cli_server', server);
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

const CLI_VERSION = '1.1.0';

type UsageCommand = 'status-update' | 'steering' | 'sanction' | 'config' | 'login' | 'install' | 'mode' | 'mcp' | 'abandon' | 'unknown';

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

type ClaudeInstallScope = 'global' | 'local';
type ClaudeSandboxPolicy = 'auto' | 'allow' | 'skip';
interface ClaudeInstallConfig {
  scope: ClaudeInstallScope;
  permissionHook: boolean;
  questionHook: boolean;
  removeHooks: boolean;
  legacyHooksDetected: boolean;
  sandbox: ClaudeSandboxPolicy;
  sandboxDetected: boolean;
  serverDomain?: string;
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
  let server = normalizeURL(options.server ?? hostedAgentTickURL);
  process.stdout.write('Agent Tick installer\n');
  if (options.dryRun || options.login === false) process.stdout.write(`Agent Tick server: ${server}\n\n`);

  if (options.dryRun) {
    process.stdout.write(options.login === false
      ? 'Step 1/2: [dry-run] would skip Agent Tick configuration because --no-login was provided.\n\n'
      : options.token
        ? 'Step 1/2: [dry-run] would save Agent Tick config with the provided token.\n\n'
        : 'Step 1/2: [dry-run] would connect this machine to Agent Tick.\n\n');
  } else if (options.login !== false) {
    process.stdout.write('Step 1/2: connect this machine to Agent Tick.\n');
    const result = await configureSavedClient({ server: options.server, token: options.token, login: options.login, name: defaultAgentName() }, { allowInteractive: !options.yes, usageCommand: 'install', defaultMethod: 'browser' });
    server = result.server;
    process.stdout.write(`saved Agent Tick config to ${result.path}\n\n`);
  } else {
    process.stdout.write('Step 1/2: skipped Agent Tick configuration because --no-login was provided.\n\n');
  }

  const selected = await selectInstallTargets(options);
  if (!selected.length) {
    process.stdout.write('No agent integrations selected. You can re-run `agent-tick install` later.\n');
    return;
  }

  const claudeConfig = selected.includes('claude') ? await resolveClaudeInstallConfig(options, server) : undefined;

  process.stdout.write('Step 2/2: install agent integrations.\n');
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
  if (selected.includes('claude')) {
    process.stdout.write('Claude Code MCP tools: agent_tick_status_update, agent_tick_steering, agent_tick_sanction.\n');
    process.stdout.write(claudeMcpSessionInstructionText());
    if (claudeConfig?.permissionHook || claudeConfig?.questionHook) process.stdout.write('Restart Claude Code before relying on newly-installed hooks.\n');
  }
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
  warnOnLegacyClaudeInstallOptions(options);
  const scope = options.claudeScope ? normalizeClaudeInstallScope(options.claudeScope) : options.yes ? 'global' : await promptClaudeInstallScope();
  const legacyHooksDetected = await hasAgentTickClaudeHooks();
  const removeHooks = options.removeClaudeHooks === true || (!options.yes && legacyHooksDetected && await promptYesNo('Remove old Agent Tick Claude Code hooks if present?', false));
  const interactiveHookPrompt = !options.yes && !options.claudePermissionHook && !options.claudeQuestionHook;
  const permissionHook = options.claudePermissionHook === true || (interactiveHookPrompt && await promptYesNo('\nClaude MCP will be configured.\n\nOptional: also route Claude Code native permission prompts through Agent Tick?\nThis catches Claude Code Bash/Edit/etc permission prompts automatically.\nInstall permission hook?', false));
  const questionHook = options.claudeQuestionHook === true;
  const sandboxDetected = permissionHook || questionHook ? await isClaudeSandboxEnabled() : false;
  const sandbox = options.claudeSandbox ? normalizeClaudeSandboxPolicy(options.claudeSandbox) : options.yes ? 'auto' : await promptClaudeSandboxPolicy(sandboxDetected);
  const serverDomain = domainFromURL(server);
  return {
    scope,
    permissionHook,
    questionHook,
    removeHooks,
    legacyHooksDetected,
    sandbox,
    sandboxDetected,
    ...(serverDomain ? { serverDomain } : {})
  };
}

function warnOnLegacyClaudeInstallOptions(options: InstallOptions): void {
  const legacy = [
    options.claudeProfile ? '--claude-profile' : undefined,
    options.claudeSteering ? '--claude-steering' : undefined,
    options.claudeSanctions ? '--claude-sanctions' : undefined,
    options.claudeInitialMode ? '--claude-initial-mode' : undefined
  ].filter((value): value is string => Boolean(value));
  if (legacy.length) process.stderr.write(`${warning('Warning:')} ${legacy.join(', ')} are legacy Claude hook options and are ignored by MCP-first install. Use --claude-permission-hook or --claude-question-hook for optional hooks.\n`);
}

async function promptClaudeInstallScope(): Promise<ClaudeInstallScope> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return 'global';
  process.stdout.write('\nClaude Code MCP install scope:\n');
  process.stdout.write('  1. global — add Agent Tick to the user Claude Code MCP config\n');
  process.stdout.write('  2. local — add Agent Tick to this project Claude Code MCP config\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Claude Code MCP scope [global]? ')).trim().toLowerCase();
    if (!answer || answer === '1' || answer === 'global' || answer === 'user') return 'global';
    if (answer === '2' || answer === 'local' || answer === 'project') return 'local';
    return normalizeClaudeInstallScope(answer);
  } finally {
    rl.close();
  }
}

async function promptClaudeSandboxPolicy(sandboxDetected: boolean): Promise<ClaudeSandboxPolicy> {
  if (!sandboxDetected || !process.stdin.isTTY || !process.stdout.isTTY) return 'auto';
  process.stdout.write('\nClaude Code sandbox appears enabled. Optional hooks need sandbox access to call Agent Tick and write local config/state.\n');
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

async function promptYesNo(question: string, defaultValue: boolean): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return defaultValue;
  const suffix = defaultValue ? '[Y/n]' : '[y/N]';
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} ${suffix} `)).trim().toLowerCase();
    if (!answer) return defaultValue;
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
    throw new Error(`Expected yes or no, got ${answer}.`);
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
    return {
      target,
      status: 'enabled',
      description: 'configure Claude Code MCP server for Agent Tick',
      apply: () => installClaudeIntegration(claudeConfig ?? defaultClaudeMcpInstallConfig())
    };
  }
  if (target === 'pi') {
    const extensionPath = path.join(os.homedir(), '.pi', 'agent', 'extensions', 'agent-tick-sanction.ts');
    return {
      target,
      status: 'enabled',
      description: `install Pi tool_call Sanction Request extension in ${extensionPath}`,
      apply: () => installPackagedPiExtension(extensionPath)
    };
  }
  if (target === 'codex') {
    return {
      target,
      status: 'disabled',
      reason: 'automatic Codex config writing is not enabled yet; configure `agent-tick mcp` manually and allow MCP elicitations',
      description: 'configure Codex MCP tools for status updates, steering, and sanctions',
      apply: async () => undefined
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

function defaultClaudeMcpInstallConfig(): ClaudeInstallConfig {
  return { scope: 'global', permissionHook: false, questionHook: false, removeHooks: false, legacyHooksDetected: false, sandbox: 'auto', sandboxDetected: false };
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
  const lines = [
    '[dry-run] would configure Claude Code MCP server:',
    `  ${formatCommand(['claude', 'mcp', 'add', ...claudeMcpAddArgs(config.scope)])}`,
    '[dry-run] would verify:',
    '  claude mcp get agent-tick',
    '  - primary MCP tools: agent_tick_status_update, agent_tick_steering, agent_tick_sanction',
    `  - ${claudeMcpSessionInstructionText().trim()}`
  ];
  if (config.legacyHooksDetected || config.removeHooks) {
    lines.push(config.removeHooks
      ? '[dry-run] would remove old Agent Tick Claude hooks from inspected Claude settings files'
      : '[dry-run] would offer to remove old Agent Tick Claude hooks if present');
  }
  if (config.permissionHook || config.questionHook) {
    lines.push(`  - optional hook settings: ${claudeSettingsPath(config.scope)}`);
    if (config.permissionHook) lines.push('  - add PermissionRequest * hook: agent-tick hook claude-permission-request');
    if (config.questionHook) lines.push('  - add PreToolUse AskUserQuestion hook: agent-tick hook claude-pre-tool-use');
    lines.push('  - add permission allow rule: Bash(agent-tick:*)');
    if (shouldInstallClaudeSandboxAllowances(config)) lines.push(`  - add sandbox allowances: network ${claudeSandboxDomains(config).join(', ')}, write ~/.config/agent-tick, run agent-tick outside sandbox`);
    else if (config.sandboxDetected) lines.push('  - leave existing Claude sandbox settings unchanged');
    lines.push('  - Claude Code will need a restart before new hooks are active');
  } else {
    lines.push('  - no Claude hooks would be installed by default');
  }
  lines.push('');
  return lines.join('\n');
}

async function installClaudeIntegration(config: ClaudeInstallConfig): Promise<void> {
  await installClaudeMcp(config.scope);
  if (config.removeHooks) await removeAgentTickClaudeHooks();
  const settingsPath = claudeSettingsPath(config.scope);
  if (config.permissionHook) await installClaudePermissionHook(settingsPath, config);
  if (config.questionHook) await installClaudeQuestionHook(settingsPath, config);
  if (config.permissionHook || config.questionHook) await activateOptionalClaudeHooks(config);
}

async function activateOptionalClaudeHooks(config: ClaudeInstallConfig): Promise<void> {
  const state = await loadAgentTickState();
  await saveAgentTickState({
    ...state,
    claude: {
      ...(state.claude ?? {}),
      ...(config.questionHook ? { steering: 'always' as const } : {}),
      ...(config.permissionHook ? { sanctions: 'always' as const } : {})
    }
  });
}

async function installClaudeMcp(scope: ClaudeInstallScope): Promise<void> {
  if (!commandExists('claude')) throw new Error(`Claude Code CLI was not found on PATH. Install Claude Code, then run:\n${manualClaudeMcpInstructions(scope)}`);
  const add = runClaudeCommand(['mcp', 'add', ...claudeMcpAddArgs(scope)]);
  if (add.status !== 0) throw new Error(`Failed to configure Claude Code MCP server.\n${add.output}\nManual command:\n${manualClaudeMcpInstructions(scope)}`);
  const verify = runClaudeCommand(['mcp', 'get', 'agent-tick']);
  if (verify.status !== 0) throw new Error(`Claude Code MCP server was added, but verification failed.\n${verify.output}\nCheck with: claude mcp get agent-tick`);
}

function claudeMcpAddArgs(scope: ClaudeInstallScope): string[] {
  return ['--scope', scope === 'global' ? 'user' : 'local', 'agent-tick', '--', 'agent-tick', 'mcp'];
}

function runClaudeCommand(args: string[]): { status: number; output: string } {
  const result = spawnSync('claude', args, { encoding: 'utf8' });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  return { status: result.status ?? 1, output };
}

function manualClaudeMcpInstructions(scope: ClaudeInstallScope): string {
  return formatCommand(['claude', 'mcp', 'add', ...claudeMcpAddArgs(scope)]);
}

function claudeMcpSessionInstructionText(): string {
  return 'Claude MCP Session identity: pass sessionId "claude_${CLAUDE_SESSION_ID}" on every Agent Tick MCP tool call in a Claude chat when the prompt substitution token is available. Add sessionTitle when Claude has a useful human-readable chat label; titles do not group Activity. ${CLAUDE_SESSION_ID} is not a shell environment variable. Claude hooks use hook stdin session_id automatically.\n';
}

function formatCommand(parts: string[]): string {
  return parts.map((part) => /^[A-Za-z0-9_./:-]+$/.test(part) ? part : shellQuote(part)).join(' ');
}

export async function installClaudePermissionHook(settingsPath: string, config: ClaudeInstallConfig = defaultClaudeMcpInstallConfig()): Promise<void> {
  await updateClaudeHookSettings(settingsPath, config, [{ event: 'PermissionRequest', matcher: '*', command: 'agent-tick hook claude-permission-request', statusMessage: 'Agent Tick sanction check' }]);
}

export async function installClaudeQuestionHook(settingsPath: string, config: ClaudeInstallConfig = defaultClaudeMcpInstallConfig()): Promise<void> {
  await updateClaudeHookSettings(settingsPath, config, [{ event: 'PreToolUse', matcher: 'AskUserQuestion', command: 'agent-tick hook claude-pre-tool-use', statusMessage: 'Agent Tick steering check' }]);
}

async function updateClaudeHookSettings(settingsPath: string, config: ClaudeInstallConfig, additions: Array<{ event: 'PreToolUse' | 'PermissionRequest'; matcher: string; command: string; statusMessage: string }>): Promise<void> {
  const settings = await readJSONFile(settingsPath);
  const root = isPlainObject(settings) ? settings : {};
  const hooks = isPlainObject(root.hooks) ? root.hooks : {};
  for (const addition of additions) {
    hooks[addition.event] = mergeClaudeHookGroups(hooks[addition.event], [
      {
        matcher: addition.matcher,
        hooks: [{ type: 'command', command: addition.command, timeout: 1800, statusMessage: addition.statusMessage }]
      }
    ]);
  }
  root.hooks = hooks;
  const permissions = isPlainObject(root.permissions) ? root.permissions : {};
  permissions.allow = mergeStringArray(permissions.allow, ['Bash(agent-tick:*)']);
  root.permissions = permissions;
  if (shouldInstallClaudeSandboxAllowances(config)) root.sandbox = mergeClaudeSandboxAllowances(root.sandbox, config);
  await writeJSONFile(settingsPath, root);
}

async function hasAgentTickClaudeHooks(): Promise<boolean> {
  for (const settingsPath of claudeSettingsPathsToInspect()) {
    if (containsAgentTickClaudeHooks(await readJSONFile(settingsPath))) return true;
  }
  return false;
}

function containsAgentTickClaudeHooks(settings: unknown): boolean {
  if (!isPlainObject(settings) || !isPlainObject(settings.hooks)) return false;
  const hooks = settings.hooks;
  return ['PreToolUse', 'PermissionRequest'].some((event) => containsAgentTickHookCommand(hooks[event]));
}

function containsAgentTickHookCommand(groups: unknown): boolean {
  return Array.isArray(groups) && groups.some((group) => isPlainObject(group) && Array.isArray(group.hooks) && group.hooks.some(isAgentTickClaudeHook));
}

export async function removeAgentTickClaudeHooks(settingsPaths: string[] = claudeSettingsPathsToInspect()): Promise<void> {
  for (const settingsPath of uniqueStrings(settingsPaths)) {
    const settings = await readJSONFile(settingsPath);
    if (!isPlainObject(settings)) continue;
    const cleaned = removeAgentTickClaudeHooksFromSettings(settings);
    if (cleaned.changed) await writeJSONFile(settingsPath, cleaned.settings);
  }
}

function removeAgentTickClaudeHooksFromSettings(root: Record<string, unknown>): { settings: Record<string, unknown>; changed: boolean } {
  let changed = false;
  if (isPlainObject(root.hooks)) {
    const hooks = { ...root.hooks };
    for (const event of ['PreToolUse', 'PermissionRequest']) {
      const cleaned = removeAgentTickClaudeHookGroups(hooks[event]);
      if (cleaned.changed) {
        changed = true;
        if (cleaned.groups.length) hooks[event] = cleaned.groups;
        else delete hooks[event];
      }
    }
    root.hooks = hooks;
  }
  if (isPlainObject(root.permissions) && Array.isArray(root.permissions.allow)) {
    const allow = root.permissions.allow.filter((value) => value !== 'Bash(agent-tick:*)');
    if (allow.length !== root.permissions.allow.length) {
      changed = true;
      root.permissions = { ...root.permissions, allow };
    }
  }
  return { settings: root, changed };
}

function removeAgentTickClaudeHookGroups(existing: unknown): { groups: Array<Record<string, unknown>>; changed: boolean } {
  if (!Array.isArray(existing)) return { groups: [], changed: false };
  let changed = false;
  const groups: Array<Record<string, unknown>> = [];
  for (const group of existing) {
    if (!isPlainObject(group) || !Array.isArray(group.hooks)) {
      if (isPlainObject(group)) groups.push(group);
      continue;
    }
    const hooks = group.hooks.filter((hook) => !isAgentTickClaudeHook(hook));
    if (hooks.length !== group.hooks.length) changed = true;
    if (hooks.length) groups.push({ ...group, hooks });
  }
  return { groups, changed };
}

function isAgentTickClaudeHook(value: unknown): boolean {
  return isPlainObject(value) && (value.command === 'agent-tick hook claude-pre-tool-use' || value.command === 'agent-tick hook claude-permission-request');
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

async function installPackagedPiExtension(extensionPath: string): Promise<void> {
  const source = await fs.readFile(packagedAssetPath('pi/agent-tick-sanction.ts'), 'utf8');
  await writeFileEnsuringDir(extensionPath, source);
}

function packagedAssetPath(relativePath: string): string {
  return fileURLToPath(new URL(`../assets/${relativePath}`, import.meta.url));
}

export function agentInstructionBlock(target: string = 'agent'): string {
  const title = target === 'pi' ? '---\nname: agent-tick\ndescription: Use Agent Tick for status updates, steering, and sanctions.\n---\n\n# Agent Tick human loop' : '# Agent Tick human loop';
  return `${title}\n\nThis machine is connected to Agent Tick. Use the product language directly: status updates, steering, and sanctions.\n\nFor sanctions before risky, destructive, expensive, production, data-accessing, or dependency-installing actions:\n\n\`\`\`sh\nagent-tick sanction --title "Proceed?" --body "Describe the action and risk."\n\`\`\`\n\nFor a command that should run only after a granted Sanction Request:\n\n\`\`\`sh\nagent-tick sanction -- <command and args>\n\`\`\`\n\nFor structured choices that steer the work:\n\n\`\`\`sh\nagent-tick steering --title "Which approach?" --choice option_a="Option A" --choice cancel:deny="Cancel"\n\`\`\`\n\nFor non-blocking progress updates:\n\n\`\`\`sh\nagent-tick status-update --state working "Finished edits; validating now"\n\`\`\`\n\nIf Agent Tick denies, times out, or exits non-zero, stop and report the outcome. Do not include secrets, tokens, private keys, or full environment files in titles, bodies, commands, or status update messages.\n`;
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
  const session = claudeHookSessionId(input);
  const toolName = typeof input.tool_name === 'string' ? input.tool_name : '';
  if (toolName === 'AskUserQuestion' && await shouldRouteClaudeCapability('steering')) await handleClaudeAskUserQuestionHook(input, { ...options, ...(session ? { session } : {}) });
}

async function runClaudePermissionRequestHook(options: { timeout?: string }): Promise<void> {
  const input = JSON.parse(await readStdin());
  const session = claudeHookSessionId(input);
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
  const finalRequest = await createHookRequest({
    title: `Approve Claude Code ${toolName}?`,
    body: claudePermissionRequestBody(input),
    ...(command ? { command } : {}),
    ...(session ? { session } : {}),
    ...(options.timeout ? { timeout: options.timeout } : {})
  });
  if (exitCodeForRequest(finalRequest) === 0) {
    printClaudePermissionRequestDecision('allow', 'Approved in Agent Tick');
  } else {
    printClaudePermissionRequestDecision('deny', 'Denied, timed out, or failed in Agent Tick');
  }
}

async function handleClaudeAskUserQuestionHook(input: Record<string, unknown>, options: ClaudeHookOptions): Promise<void> {
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

async function answerClaudeQuestion(question: Record<string, unknown>, questionText: string, options: ClaudeHookOptions): Promise<string | string[] | undefined> {
  const optionsList = Array.isArray(question.options) ? question.options.filter(isPlainObject) : [];
  const multiSelect = question.multiSelect === true;
  const choices = multiSelect ? multiSelectChoices(optionsList) : singleSelectChoices(optionsList);
  const finalRequest = await createHookRequest({
    title: questionText,
    body: claudeQuestionBody([question]),
    choices: choices.choices,
    ...(options.session ? { session: options.session } : {}),
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
  const policy = state.claude?.[capability];
  if (!policy) return true;
  if (policy === 'off') return false;
  if (policy === 'always') return true;
  return state.mode === 'afk';
}

type ClaudeHookOptions = { timeout?: string; session?: string };

async function createHookRequest(options: { title: string; body?: string; command?: string; timeout?: string; session?: string; choices?: Array<{ id: string; label: string; kind: string }> }): Promise<RequestRecord> {
  const { client, server } = await clientFromOptions({});
  return createAndMaybeWait(client, server, {
    title: options.title,
    timeout: options.timeout ?? '30m',
    choice: [],
    silent: true,
    ...(options.body ? { body: options.body } : {}),
    ...(options.command ? { command: options.command } : {}),
    ...(options.session ? { session: options.session } : {}),
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

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
interface McpRequestContext {
  clientCapabilities?: Record<string, unknown>;
  elicit?: (params: McpElicitationParams, options?: McpElicitationOptions) => Promise<McpElicitationResult>;
}
interface McpElicitationOptions {
  signal?: AbortSignal;
}
interface McpElicitationParams {
  mode?: 'form';
  message: string;
  requestedSchema: Record<string, unknown>;
}
interface McpElicitationResult {
  action?: 'accept' | 'decline' | 'cancel';
  content?: Record<string, unknown>;
}

export const mcpToolDefinitions: McpToolDefinition[] = [
  {
    name: 'agent_tick_status_update',
    description: 'Send a non-blocking Agent Tick Status Update for the current agent thread. Use only working, waiting, blocked, done, and failed as semantic states.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Short status update message. Do not include secrets.' },
        state: { type: 'string', enum: ['working', 'waiting', 'blocked', 'done', 'failed'], default: 'working', description: 'Semantic Status Update state. Custom state strings are accepted by the HTTP API for compatibility but are display-only.' },
        nextStep: { type: 'string', description: 'Optional next step.' },
        threadId: { type: 'string', description: 'Legacy thread/chat/source metadata for compatibility.' },
        sessionId: { type: 'string', description: 'Optional real host chat/thread/session identifier.' },
        sessionTitle: { type: 'string', description: 'Optional human-readable Session title/label.' },
        clientName: { type: 'string', description: 'Optional client display name.' },
        importance: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal', description: 'Future notification importance hint; recorded as metadata today.' },
        notify: { type: 'boolean', description: 'Future push-notification hint; recorded as metadata today.' },
        metadata: { type: 'object', additionalProperties: { type: 'string' } }
      },
      required: ['message'],
      additionalProperties: false
    }
  },
  {
    name: 'agent_tick_sanction',
    description: 'Create a Sanction Request and wait for the human Response by default.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Request title. Do not include secrets.' },
        body: { type: 'string', description: 'Request context. Do not include secrets.' },
        command: { type: 'string', description: 'Optional command/action being approved.' },
        clientName: { type: 'string', description: 'Optional client display name.' },
        sessionId: { type: 'string', description: 'Optional real host chat/thread/session identifier.' },
        sessionTitle: { type: 'string', description: 'Optional human-readable Session title/label.' },
        timeout: { type: 'string', default: '30m', description: 'Wait timeout such as 30s, 5m, 0 for no wait.' },
        localElicitation: { type: 'string', enum: ['auto', 'off', 'only'], default: 'auto', description: 'Use MCP elicitation locally when the client supports it.' }
      },
      required: ['title'],
      additionalProperties: false
    }
  },
  {
    name: 'agent_tick_steering',
    description: 'Ask a structured steering question and wait for a human choice.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Steering question title. Do not include secrets.' },
        body: { type: 'string', description: 'Optional context. Do not include secrets.' },
        sessionId: { type: 'string', description: 'Optional real host chat/thread/session identifier.' },
        sessionTitle: { type: 'string', description: 'Optional human-readable Session title/label.' },
        choices: {
          type: 'array',
          minItems: 1,
          items: {
            anyOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: { id: { type: 'string' }, label: { type: 'string' }, kind: { type: 'string', enum: ['approve', 'deny'] } },
                required: ['label'],
                additionalProperties: false
              }
            ]
          }
        },
        clientName: { type: 'string', description: 'Optional client display name.' },
        timeout: { type: 'string', default: '30m', description: 'Wait timeout such as 30s, 5m, 0 for no wait.' },
        localElicitation: { type: 'string', enum: ['auto', 'off', 'only'], default: 'auto', description: 'Use MCP elicitation locally when the client supports it.' }
      },
      required: ['title', 'choices'],
      additionalProperties: false
    }
  }
];

async function runMcpStdioAdapter(options: ClientOptions): Promise<void> {
  const { client, server } = await clientFromOptions(options);
  const session = new McpStdioSession(process.stdout, client, server);
  await readMcpMessages(process.stdin, (message, transport) => session.handleMessage(message, transport));
}

class McpStdioSession {
  readonly #context: McpRequestContext;
  readonly #pending = new Map<JsonRpcId, { resolve: (result: McpElicitationResult) => void; reject: (error: Error) => void }>();
  #nextServerRequestId = 1;
  #transport: McpMessageTransport = 'framed';

  constructor(readonly output: NodeJS.WritableStream, readonly client: AgentTickClient, readonly server: string) {
    this.#context = { elicit: (params) => this.#sendElicitation(params) };
  }

  handleMessage(message: JsonRpcRequest & { result?: unknown; error?: unknown }, transport: McpMessageTransport = 'framed'): void {
    this.#transport = transport;
    if (message.method) {
      if (message.id === undefined) return;
      void this.#handleClientRequest(message);
      return;
    }
    if (message.id === undefined) return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    if (message.error) pending.reject(new Error(mcpErrorMessage(message.error)));
    else pending.resolve(isPlainObject(message.result) ? message.result as McpElicitationResult : {});
  }

  async #handleClientRequest(request: JsonRpcRequest): Promise<void> {
    try {
      const result = await handleMcpRequest(request, this.client, this.server, this.#context);
      writeMcpMessage(this.output, { jsonrpc: '2.0', id: request.id, result }, this.#transport);
    } catch (error) {
      writeMcpMessage(this.output, {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) }
      }, this.#transport);
    }
  }

  #sendElicitation(params: McpElicitationParams, options: McpElicitationOptions = {}): Promise<McpElicitationResult> {
    const id = `agent_tick_elicit_${this.#nextServerRequestId++}`;
    const result = new Promise<McpElicitationResult>((resolve, reject) => {
      let removeAbortListener = (): void => undefined;
      const finish = <T>(complete: (value: T) => void, value: T): void => {
        removeAbortListener();
        complete(value);
      };
      const cancel = (): void => {
        if (!this.#pending.delete(id)) return;
        removeAbortListener();
        const reason = typeof options.signal?.reason === 'string' ? options.signal.reason : 'Agent Tick no longer needs this local elicitation.';
        writeMcpMessage(this.output, { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason } }, this.#transport);
        reject(new Error(reason));
      };
      this.#pending.set(id, {
        resolve: (value) => finish(resolve, value),
        reject: (error) => finish(reject, error)
      });
      if (options.signal) {
        if (options.signal.aborted) cancel();
        else {
          options.signal.addEventListener('abort', cancel, { once: true });
          removeAbortListener = () => options.signal?.removeEventListener('abort', cancel);
        }
      }
      writeMcpMessage(this.output, { jsonrpc: '2.0', id, method: 'elicitation/create', params }, this.#transport);
    });
    return result;
  }
}

export async function handleMcpRequest(request: JsonRpcRequest, client: AgentTickClient, server: string, context: McpRequestContext = {}): Promise<unknown> {
  if (request.method === 'initialize') {
    const capabilities = initializeCapabilitiesFromParams(request.params);
    if (capabilities) context.clientCapabilities = capabilities;
    else delete context.clientCapabilities;
    return {
      protocolVersion: protocolVersionFromParams(request.params),
      capabilities: { tools: {} },
      serverInfo: { name: 'agent-tick', version: CLI_VERSION }
    };
  }
  if (request.method === 'ping') return {};
  if (request.method === 'tools/list') return { tools: mcpToolDefinitions };
  if (request.method === 'tools/call') return callMcpTool(request.params, client, server, context);
  throw new Error(`Unsupported MCP method: ${request.method ?? 'unknown'}`);
}

function protocolVersionFromParams(params: unknown): string {
  if (isPlainObject(params) && typeof params.protocolVersion === 'string') return params.protocolVersion;
  return '2024-11-05';
}

function initializeCapabilitiesFromParams(params: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(params) || !isPlainObject(params.capabilities)) return undefined;
  return params.capabilities;
}

function clientSupportsFormElicitation(context: McpRequestContext): boolean {
  const elicitation = isPlainObject(context.clientCapabilities?.elicitation) ? context.clientCapabilities.elicitation : undefined;
  return Boolean(elicitation && (!('form' in elicitation) || isPlainObject(elicitation.form)));
}

function mcpLocalElicitationAvailable(context: McpRequestContext): boolean {
  return Boolean(context.elicit && clientSupportsFormElicitation(context));
}

async function callMcpTool(params: unknown, client: AgentTickClient, server: string, context: McpRequestContext): Promise<unknown> {
  if (!isPlainObject(params) || typeof params.name !== 'string') throw new Error('tools/call requires a tool name');
  const args = isPlainObject(params.arguments) ? params.arguments : {};
  if (params.name === 'agent_tick_status_update') return mcpTextResult(await callMcpStatusUpdate(args, client));
  if (params.name === 'agent_tick_sanction') return callMcpSanction(args, client, server, context);
  if (params.name === 'agent_tick_steering') return callMcpSteering(args, client, server, context);
  throw new Error(`Unknown Agent Tick MCP tool: ${params.name}`);
}

async function callMcpStatusUpdate(args: Record<string, unknown>, client: AgentTickClient): Promise<string> {
  const message = requiredString(args.message, 'message');
  const update = await client.createStatusUpdate({
    threadId: optionalString(args.threadId) ?? process.env.AGENT_TICK_THREAD_ID ?? defaultThreadId(),
    message,
    state: optionalString(args.state) ?? 'working',
    nextStep: optionalString(args.nextStep),
    host: os.hostname() || undefined,
    workingDirectory: process.cwd(),
    clientName: optionalString(args.clientName) ?? path.basename(process.cwd()),
    ...(sessionFieldsFromMcpArgs(args)),
    metadata: statusUpdateMetadata({
      metadata: metadataEntriesFromRecord(optionalStringRecord(args.metadata)),
      importance: optionalString(args.importance),
      notify: args.notify === true
    })
  });
  return `Sent status update ${update.statusId} for ${update.threadId}: ${update.message}`;
}

async function callMcpSanction(args: Record<string, unknown>, client: AgentTickClient, server: string, context: McpRequestContext): Promise<unknown> {
  const title = requiredString(args.title, 'title');
  const body = optionalString(args.body);
  const command = optionalString(args.command);
  const localMode = localElicitationMode(args.localElicitation);
  const options: RequestOptions = {
    title,
    timeout: optionalString(args.timeout) ?? '30m',
    requestType: 'sanction',
    choice: [],
    silent: true
  };
  const clientName = optionalString(args.clientName);
  const sessionId = optionalString(args.sessionId);
  const sessionTitle = optionalString(args.sessionTitle);
  if (body) options.body = body;
  if (command) options.command = command;
  if (clientName) options.clientName = clientName;
  if (sessionId) options.session = sessionId;
  if (sessionTitle) options.sessionTitle = sessionTitle;

  if (localMode === 'auto' && mcpLocalElicitationAvailable(context)) {
    const result = await raceMcpLocalAndRemote(
      (signal) => tryMcpSanctionElicitation({ title, mode: localMode, ...(body ? { body } : {}), ...(command ? { command } : {}) }, context, signal),
      client,
      server,
      options
    );
    return mcpTextResult(result.text, result.isError);
  }

  const local = await tryMcpSanctionElicitation({ title, mode: localMode, ...(body ? { body } : {}), ...(command ? { command } : {}) }, context);
  if (local) return mcpTextResult(local.text, local.isError);
  if (localMode === 'only') return mcpTextResult('Local MCP elicitation is not available or was rejected by the client.', true);

  const request = await createAndMaybeWait(client, server, options);
  return mcpTextResult(mcpRequestSummary(request), exitCodeForRequest(request) !== 0);
}

async function callMcpSteering(args: Record<string, unknown>, client: AgentTickClient, server: string, context: McpRequestContext): Promise<unknown> {
  const rawChoices = Array.isArray(args.choices) ? args.choices : undefined;
  if (!rawChoices?.length) throw new Error('choices must be a non-empty array');
  const hookChoices = mcpChoiceInputs(rawChoices);
  if (!hookChoices.some((choice) => choice.kind === 'deny')) throw new Error('agent_tick_steering requires an explicit deny/decline choice');
  const title = requiredString(args.title, 'title');
  const body = optionalString(args.body);
  const localMode = localElicitationMode(args.localElicitation);
  const options: RequestOptions = {
    title,
    timeout: optionalString(args.timeout) ?? '30m',
    requestType: 'steering',
    choice: [],
    hookChoices,
    silent: true
  };
  const clientName = optionalString(args.clientName);
  const sessionId = optionalString(args.sessionId);
  const sessionTitle = optionalString(args.sessionTitle);
  if (body) options.body = body;
  if (clientName) options.clientName = clientName;
  if (sessionId) options.session = sessionId;
  if (sessionTitle) options.sessionTitle = sessionTitle;

  if (localMode === 'auto' && mcpLocalElicitationAvailable(context)) {
    const result = await raceMcpLocalAndRemote(
      (signal) => tryMcpSteeringElicitation({ title, choices: hookChoices, mode: localMode, ...(body ? { body } : {}) }, context, signal),
      client,
      server,
      options
    );
    return mcpTextResult(result.text, result.isError);
  }

  const local = await tryMcpSteeringElicitation({ title, choices: hookChoices, mode: localMode, ...(body ? { body } : {}) }, context);
  if (local) return mcpTextResult(local.text, local.isError);
  if (localMode === 'only') return mcpTextResult('Local MCP elicitation is not available or was rejected by the client.', true);

  const request = await createAndMaybeWait(client, server, options);
  return mcpTextResult(mcpRequestSummary(request), exitCodeForRequest(request) !== 0);
}

async function raceMcpLocalAndRemote(
  localRequest: (signal: AbortSignal) => Promise<{ text: string; isError?: boolean } | undefined>,
  client: AgentTickClient,
  server: string,
  options: RequestOptions
): Promise<{ text: string; isError?: boolean }> {
  const created = await createRequestFromOptions(client, options);
  const localAbortController = new AbortController();
  const remotePromise = waitForCreatedRequest(client, server, created, options)
    .then((request) => ({ source: 'remote' as const, request }))
    .catch((error: unknown) => ({ source: 'remote_error' as const, error }));
  const localPromise = localRequest(localAbortController.signal)
    .then((local) => ({ source: 'local' as const, local }))
    .catch(() => ({ source: 'local' as const, local: undefined }));

  const winner = await Promise.race([remotePromise, localPromise]);
  if (winner.source === 'remote') {
    localAbortController.abort('Remote Agent Tick request resolved first.');
    return { text: mcpRequestSummary(winner.request), isError: exitCodeForRequest(winner.request) !== 0 };
  }
  if (winner.source === 'remote_error') throw winner.error instanceof Error ? winner.error : new Error(String(winner.error));
  if (!winner.local) {
    const result = await remotePromise;
    if (result.source === 'remote_error') throw result.error instanceof Error ? result.error : new Error(String(result.error));
    const request = result.request;
    return { text: mcpRequestSummary(request), isError: exitCodeForRequest(request) !== 0 };
  }

  await client.abandonRequest(created.request.id).catch(() => undefined);
  return winner.local;
}

function mcpChoiceInputs(rawChoices: unknown[]): ChoiceInput[] {
  return rawChoices.map((choice, index): ChoiceInput => {
    if (typeof choice === 'string') return { id: slugifyChoiceId(choice) || `choice_${index + 1}`, label: choice, kind: inferredChoiceKind(choice) };
    if (!isPlainObject(choice)) throw new Error('each choice must be a string or object');
    const label = requiredString(choice.label, `choices[${index}].label`);
    const kind = optionalString(choice.kind) ?? inferredChoiceKind(label);
    return { id: optionalString(choice.id) ?? (slugifyChoiceId(label) || `choice_${index + 1}`), label, kind: kind === 'option' ? 'approve' : kind };
  });
}

async function tryMcpSanctionElicitation(options: { title: string; body?: string; command?: string; mode: 'auto' | 'off' | 'only' }, context: McpRequestContext, signal?: AbortSignal): Promise<{ text: string; isError?: boolean } | undefined> {
  if (options.mode === 'off' || !context.elicit || !clientSupportsFormElicitation(context)) return undefined;
  try {
    const lines = [options.title];
    if (options.body) lines.push('', options.body);
    if (options.command) lines.push('', `Command/action: ${options.command}`);
    const result = await context.elicit({
      mode: 'form',
      message: lines.join('\n'),
      requestedSchema: {
        type: 'object',
        properties: {
          choiceId: { type: 'string', title: 'Decision', description: 'Approve or reject this Agent Tick sanction.', enum: ['approve', 'reject'] }
        },
        required: ['choiceId']
      }
    }, signal ? { signal } : undefined);
    return localElicitationChoiceResult(result, new Map([['approve', 'Approve'], ['reject', 'Reject']]));
  } catch {
    return undefined;
  }
}

async function tryMcpSteeringElicitation(options: { title: string; body?: string; choices: ChoiceInput[]; mode: 'auto' | 'off' | 'only' }, context: McpRequestContext, signal?: AbortSignal): Promise<{ text: string; isError?: boolean } | undefined> {
  if (options.mode === 'off' || !context.elicit || !clientSupportsFormElicitation(context)) return undefined;
  try {
    const labels = new Map(options.choices.map((choice) => [choice.id, choice.label]));
    const result = await context.elicit({
      mode: 'form',
      message: [options.title, options.body].filter(Boolean).join('\n\n'),
      requestedSchema: {
        type: 'object',
        properties: {
          choiceId: { type: 'string', title: 'Choice', description: 'Select one Agent Tick steering option.', enum: options.choices.map((choice) => choice.id) }
        },
        required: ['choiceId']
      }
    }, signal ? { signal } : undefined);
    return localElicitationChoiceResult(result, labels);
  } catch {
    return undefined;
  }
}

function localElicitationChoiceResult(result: McpElicitationResult, labels: Map<string, string>): { text: string; isError?: boolean } {
  if (result.action === 'decline') return { text: 'Local MCP elicitation was declined.', isError: true };
  if (result.action === 'cancel') return { text: 'Local MCP elicitation was cancelled.', isError: true };
  const choiceId = typeof result.content?.choiceId === 'string' ? result.content.choiceId : '';
  if (result.action !== 'accept' || !choiceId) return { text: 'Local MCP elicitation did not return a choice.', isError: true };
  const label = labels.get(choiceId) ?? choiceId;
  const isError = ['reject', 'deny', 'cancel'].includes(choiceId.toLowerCase());
  return { text: `Local MCP elicitation accepted: ${choiceId} (${label})`, isError };
}

function localElicitationMode(value: unknown): 'auto' | 'off' | 'only' {
  if (value === 'off' || value === 'only') return value;
  return 'auto';
}

function mcpRequestSummary(request: RequestRecord): string {
  const choice = request.response?.choiceId ?? request.response?.message ?? request.status;
  return `Request ${request.id} is ${request.status}: ${choice}`;
}

function mcpTextResult(text: string, isError?: boolean): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  return { content: [{ type: 'text', text }], ...(isError ? { isError } : {}) };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8') || '{}';
}

async function createAndMaybeWait(client: AgentTickClient, server: string, options: RequestOptions): Promise<RequestRecord> {
  const created = await createRequestFromOptions(client, options);
  return waitForCreatedRequest(client, server, created, options);
}

async function createRequestFromOptions(client: AgentTickClient, options: RequestOptions): Promise<CreateRequestResponse> {
  const choices = options.hookChoices ?? parseRequestChoices(options);
  return client.createRequest({
    requester: {
      name: process.env.AGENT_TICK_REQUESTER_NAME || os.hostname() || 'agent',
      host: os.hostname(),
      workingDirectory: process.cwd(),
      clientName: options.clientName ?? path.basename(process.cwd())
    },
    title: options.title,
    ...(options.body ? { body: options.body } : {}),
    ...(options.command ? { command: options.command } : {}),
    requestType: options.requestType ?? 'sanction',
    ...(sessionFieldsFromOptions(options)),
    ...(choices.length ? { choices } : {})
  });
}

async function waitForCreatedRequest(client: AgentTickClient, _server: string, created: CreateRequestResponse, options: RequestOptions): Promise<RequestRecord> {
  const request = created.request;
  if (!options.silent) {
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ event: 'created', request, waiter: created.waiter })}\n`);
    } else {
      process.stdout.write(`created request ${request.id}: ${request.title}\n`);
    }
  }

  const timeoutMs = parseDurationMs(options.timeout);
  if (timeoutMs === 0) return request;

  const waited = await client.waitForCreatedRequest(created, { timeoutMs });
  if (!options.silent) {
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ event: waited.terminal ? 'terminal' : 'timeout', ...waited })}\n`);
    } else if (!waited.terminal) {
      process.stderr.write(`timed out waiting for request ${request.id}\n`);
    } else {
      const choice = waited.request.response?.choiceId ?? waited.request.response?.message ?? waited.request.status;
      process.stdout.write(`request ${request.id} completed: ${choice}\n`);
    }
  }
  return waited.request;
}

function exitCodeForRequest(request: RequestRecord): number {
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

function parseRequestChoices(options: RequestOptions): ChoiceInput[] {
  const hasAnnotations = Boolean(options.choiceFlag?.length || options.choiceTag?.length);
  const values = options.choice?.length || !hasAnnotations
    ? options.choice
    : ['approve:approve=Approve', 'reject:deny=Reject'];
  return parseChoices(values, options.choiceFlag, options.choiceTag);
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

interface ClientOptions {
  server?: string;
  token?: string;
}

interface LoginOptions {
  server?: string | undefined;
  name?: string | undefined;
}

interface ConfigOptions extends LoginOptions {
  token?: string | undefined;
  login?: boolean | undefined;
}

interface InstallOptions extends ConfigOptions {
  target?: string[];
  all?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  claudeProfile?: string;
  claudeSteering?: string;
  claudeSanctions?: string;
  claudeInitialMode?: string;
  claudeScope?: string;
  claudePermissionHook?: boolean;
  claudeQuestionHook?: boolean;
  removeClaudeHooks?: boolean;
  claudeSandbox?: string;
}

interface StatusOptions extends ClientOptions {
  thread?: string;
  session?: string;
  sessionTitle?: string;
  state?: string;
  next?: string;
  clientName?: string;
  importance?: string;
  notify?: boolean;
  metadata?: string[];
  json?: boolean;
}

interface RequestOptions extends ClientOptions {
  title: string;
  body?: string;
  command?: string;
  clientName?: string;
  session?: string;
  sessionTitle?: string;
  choice?: string[];
  choiceFlag?: string[];
  choiceTag?: string[];
  hookChoices?: ChoiceInput[];
  requestType?: 'steering' | 'sanction';
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
  if (commandName === 'status-update' || commandName === 'steering' || commandName === 'sanction' || commandName === 'config' || commandName === 'login' || commandName === 'install' || commandName === 'mode' || commandName === 'mcp' || commandName === 'abandon') return commandName;
  return 'unknown';
}

function usageHint(name: UsageCommand): string {
  if (name === 'status-update') return `${statusUpdateHelpText}\nRun ${command('agent-tick status-update --help')} for all options.\n`;
  if (name === 'steering') return `${steeringHelpText}\nRun ${command('agent-tick steering --help')} for all options.\n`;
  if (name === 'sanction') return `${sanctionHelpText}\nRun ${command('agent-tick sanction --help')} for all options.\n`;
  if (name === 'config') return `${configHelpText}\nRun ${command('agent-tick config --help')} for all options.\n`;
  if (name === 'login') return `${loginHelpText}\nRun ${command('agent-tick login --help')} for all options.\n`;
  if (name === 'install') return `${installHelpText}\nRun ${command('agent-tick install --help')} for all options.\n`;
  if (name === 'mcp') return `\nRun ${command('agent-tick mcp --help')} for all options.\n`;
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
