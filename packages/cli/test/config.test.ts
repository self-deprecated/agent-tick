import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertAgentToken, clientConfigPath, loadClientConfig, maskAgentToken, resolveServerAndToken, saveClientConfig } from '../src/config.js';
import { agentInstructionBlock, agentTickStatePath, buildCliSetupURL, claudeHookSessionId, createProgram, handleMcpRequest, hostedAgentTickURL, installClaudePermissionHook, installClaudeQuestionHook, loadAgentTickMode, mcpToolDefinitions, normalizeAgentTickMode, removeAgentTickClaudeHooks, resolveAgentTickSessionId, saveAgentTickMode, isRiskyCommand, parseChoices, parseDurationMs, tryReadMcpMessage, ensureAgentFeaturesConfig, loadEffectiveAgentFeaturesConfig, setAgentFeature, renderAgentFeaturesConfigTuiScreen, listenForSetupCallback } from '../src/index.js';

const tmpRoots: string[] = [];

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-test-features-'));
  tmpRoots.push(root);
  const featuresPath = path.join(root, 'features.json');
  await fs.writeFile(featuresPath, JSON.stringify({ privacy: { defaultContentMode: 'plain' } }));
  process.env.AGENT_TICK_FEATURES_CONFIG = featuresPath;
});

afterEach(async () => {
  delete process.env.AGENT_TICK_FEATURES_CONFIG;
  delete process.env.AGENT_TICK_PRIVATE_REQUESTS;
  await Promise.all(tmpRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tmpRoots.length = 0;
});

async function withProcessEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function privatePrepareResponse() {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    contentMode: 'private',
    workspaceId: 'wsp_cli',
    required: false,
    recipientVersion: 'version_1',
    recipientUserIds: ['usr_cli'],
    unavailableRecipients: [],
    deviceKeys: [{
      deviceKeyId: 'devkey_cli',
      deviceId: 'dev_cli',
      userId: 'usr_cli',
      algorithm: 'p256-ecdh-hkdf-sha256',
      publicKey: Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).toString('base64url'),
      publicKeyFingerprint: 'fingerprint_cli',
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:00.000Z'
    }]
  };
}

describe('CLI config', () => {
  it('uses AGENT_TICK_CONFIG when set', () => {
    expect(clientConfigPath({ AGENT_TICK_CONFIG: '/tmp/agent-tick.json' })).toBe('/tmp/agent-tick.json');
  });

  it('saves and loads client config', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-cli-'));
    tmpRoots.push(root);
    const configPath = path.join(root, 'config.json');
    const env = { AGENT_TICK_CONFIG: configPath };

    await saveClientConfig({ server: 'https://tick.example.com/', token: ' agent_123 ' }, env);

    await expect(loadClientConfig(env)).resolves.toEqual({ server: 'https://tick.example.com', token: 'agent_123' });
  });

  it('resolves env token before saved config', async () => {
    const config = await resolveServerAndToken(
      { server: undefined, token: undefined },
      { AGENT_TICK_SERVER: 'https://env.example.com', AGENT_TICK_TOKEN: 'agent_env' }
    );
    expect(config).toEqual({ server: 'https://env.example.com', token: 'agent_env' });
  });

  it('masks and validates agent tokens for config display', () => {
    expect(maskAgentToken('agent_123456789')).toBe('agent_…6789');
    expect(maskAgentToken(undefined)).toBe('(not set)');
    expect(assertAgentToken(' agent_123 ')).toBe('agent_123');
    expect(() => assertAgentToken('sk_test_123')).toThrow(/must start with agent_/);
  });

  it('exposes setup and generic features config commands without Pi-specific top-level commands', () => {
    const commands = createProgram().commands.map((command) => command.name());
    expect(commands).toContain('config');
    expect(commands).toContain('login');
    expect(commands).toContain('setup');
    expect(commands).toContain('features');
    expect(commands).not.toContain('pi');
  });

  it('groups Activity-creating commands under send without legacy top-level aliases', () => {
    const program = createProgram();
    const commands = program.commands.map((command) => command.name());
    expect(commands).toContain('send');
    expect(commands).not.toContain('status-update');
    expect(commands).not.toContain('steering');
    expect(commands).not.toContain('sanction');
    const send = program.commands.find((command) => command.name() === 'send');
    expect(send?.commands.map((command) => command.name())).toEqual(['status', 'steering', 'sanction']);
    expect(send?.commands.find((command) => command.name() === 'status')?.options.map((option) => option.long)).toEqual(expect.arrayContaining(['--private', '--plain']));
    expect(send?.commands.find((command) => command.name() === 'steering')?.options.map((option) => option.long)).toEqual(expect.arrayContaining(['--private', '--plain']));
    expect(send?.commands.find((command) => command.name() === 'sanction')?.options.map((option) => option.long)).toEqual(expect.arrayContaining(['--private', '--plain']));
  });

  it('prints root help when run without a command', async () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await createProgram().parseAsync([], { from: 'user' });
    } finally {
      process.stdout.write = originalWrite;
    }
    const output = writes.join('');
    expect(output).toContain('Usage: agent-tick');
    expect(output).toContain('agent-tick send status "Running tests now"');
    expect(output).toContain('setup [options]');
  });

  it('prints send help when send is run without a subcommand', async () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await createProgram().parseAsync(['send'], { from: 'user' });
    } finally {
      process.stdout.write = originalWrite;
    }
    const output = writes.join('');
    expect(output).toContain('agent-tick send status "Running tests now"');
    expect(output).toContain('agent-tick send steering');
    expect(output).toContain('agent-tick send sanction');
  });
});

describe('Agent Tick features config', () => {
  it('creates a first-run features config with status defaults', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-features-config-'));
    tmpRoots.push(root);
    const file = path.join(root, 'config.json');

    await expect(ensureAgentFeaturesConfig({ file, cwd: root })).resolves.toEqual({ path: file, created: true });
    await expect(ensureAgentFeaturesConfig({ file, cwd: root })).resolves.toEqual({ path: file, created: false });

    const effective = await loadEffectiveAgentFeaturesConfig({ file, cwd: root, homeDirectory: root, env: {} });
    expect(effective.config).toMatchObject({
      privacy: { defaultContentMode: 'plain' },
      status: {
        enabled: true,
        heartbeat: { enabled: true, intervalMs: 285000 },
        hooks: {
          before_agent_start: { send: true },
          agent_end: { send: true },
          turn_end: { send: false },
          session_shutdown: { send: false }
        },
        messageMirroring: { enabled: false, sendAssistant: 'final-only', contentMode: 'private' },
        toolActivity: { enabled: false, visibility: 'off', detailContentMode: 'private', maxDetailChars: 2000 }
      },
      sanctions: { enabled: false }
    });
  });

  it('toggles named Agent Tick features from the CLI', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-features-cli-'));
    tmpRoots.push(root);
    const file = path.join(root, 'config.json');

    await createProgram().parseAsync(['features', 'enable', 'message-mirroring', '--file', file], { from: 'user' });
    await createProgram().parseAsync(['features', 'enable', 'tool-activity', '--file', file], { from: 'user' });
    await createProgram().parseAsync(['features', 'disable', 'heartbeat', '--file', file], { from: 'user' });

    const saved = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, any>;
    expect(saved.status.messageMirroring.enabled).toBe(true);
    expect(saved.status.toolActivity).toMatchObject({ enabled: true, visibility: 'names' });
    expect(saved.status.heartbeat.enabled).toBe(false);
  });

  it('passes feature file options through subcommands without arguments', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-features-show-'));
    tmpRoots.push(root);
    const file = path.join(root, 'config.json');
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await createProgram().parseAsync(['features', 'show', '--json', '--file', file], { from: 'user' });
    } finally {
      process.stdout.write = originalWrite;
    }

    const output = JSON.parse(writes.join('')) as { targetPath: string };
    expect(output.targetPath).toBe(file);
  });

  it('renders the features TUI with a movable selector instead of a numbered prompt', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-features-tui-'));
    tmpRoots.push(root);
    const file = path.join(root, 'config.json');
    await ensureAgentFeaturesConfig({ file, cwd: root });
    const effective = await loadEffectiveAgentFeaturesConfig({ file, cwd: root, homeDirectory: root, env: {} });

    const screen = renderAgentFeaturesConfigTuiScreen(effective.config, file, { selectedIndex: 1 }, 100);

    expect(screen).toContain('Move with ↑/↓ or j/k.');
    expect(screen).toContain('Privacy mode: plain');
    expect(screen).toContain('Legend: [x] effective');
    expect(screen).toContain('> [x] start');
    expect(screen).toContain('message-tool-turns');
    expect(screen).toContain('Mirror assistant text before tool use');
    expect(screen).toContain('tool-activity');
    expect(screen).toContain('Mirror structured Tool Activity metadata');
    expect(screen).toContain('Selected: start');
    expect(screen).toContain('Sends now: A generic working Status Update');
    expect(screen).toContain('Space/Enter: toggle/cycle');
    expect(screen).toContain('e: edit JSON');
    expect(screen).toContain('s: save+quit');
    expect(screen).not.toContain('Enter a number');
    expect(screen).not.toContain('Agent Tick features>');
  });

  it('renders unsaved-change and discard confirmation state in the features TUI', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-features-dirty-'));
    tmpRoots.push(root);
    const file = path.join(root, 'config.json');
    await ensureAgentFeaturesConfig({ file, cwd: root });
    const effective = await loadEffectiveAgentFeaturesConfig({ file, cwd: root, homeDirectory: root, env: {} });

    const screen = renderAgentFeaturesConfigTuiScreen(effective.config, file, { dirty: true, confirmDiscard: true }, 100);

    expect(screen).toContain('(unsaved)');
    expect(screen).toContain('Unsaved changes: q discards, s saves');
    expect(screen).toContain('q: quit/discard');
  });

  it('shows privacy-limited feature effects in the features TUI', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-features-effects-'));
    tmpRoots.push(root);
    const file = path.join(root, 'config.json');
    await fs.writeFile(file, JSON.stringify({
      privacy: { defaultContentMode: 'plain' },
      status: { messageMirroring: { enabled: true, includeThinking: true } }
    }));
    const effective = await loadEffectiveAgentFeaturesConfig({ file, cwd: root, homeDirectory: root, env: {} });

    const screen = renderAgentFeaturesConfigTuiScreen(effective.config, file, { selectedIndex: 9 }, 100);

    expect(screen).toContain('> [~] message-thinking');
    expect(screen).toContain('generic in plain mode');
    expect(screen).toContain('Sends now: Thinking is not sent as useful plaintext');
    expect(screen).toContain('Example: Generic Activity only; no thinking text');
  });

  it('shows Tool Activity visibility and private detail gating in the features TUI', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-features-tool-activity-'));
    tmpRoots.push(root);
    const file = path.join(root, 'config.json');
    await fs.writeFile(file, JSON.stringify({
      privacy: { defaultContentMode: 'plain' },
      status: { toolActivity: { enabled: true, visibility: 'details' } }
    }));
    const effective = await loadEffectiveAgentFeaturesConfig({ file, cwd: root, homeDirectory: root, env: {} });

    const screen = renderAgentFeaturesConfigTuiScreen(effective.config, file, { selectedIndex: 12 }, 120);

    expect(screen).toContain('> [~] tool-activity');
    expect(screen).toContain('visibility: details; private mode required');
    expect(screen).toContain('Cycle: off → names → summaries → details');
    expect(screen).toContain('Details are gated: switch privacy.defaultContentMode to private');
    expect(screen).toContain('raw inputs/results omitted in plain mode');
  });

  it('supports direct feature and dotted-value Agent Tick features config writes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-features-set-'));
    tmpRoots.push(root);
    const file = path.join(root, 'config.json');

    await setAgentFeature('turn-end', true, { file, cwd: root });
    await createProgram().parseAsync(['features', 'set', 'status.heartbeat.intervalMs', '15000', '--file', file], { from: 'user' });
    await createProgram().parseAsync(['features', 'set', 'status.toolActivity.visibility', 'summaries', '--file', file], { from: 'user' });

    const saved = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, any>;
    expect(saved.status.hooks.turn_end.send).toBe(true);
    expect(saved.status.heartbeat.intervalMs).toBe(15000);
    expect(saved.status.toolActivity.visibility).toBe('summaries');
  });
});

describe('browser setup', () => {
  it('builds a dashboard URL with local callback state and agent name', () => {
    const url = new URL(buildCliSetupURL({
      server: 'https://tick.example.com/app',
      callbackURL: 'http://127.0.0.1:1234/agent-tick/setup/callback',
      state: 'state_123',
      name: 'Claude Code'
    }));

    expect(url.origin).toBe('https://tick.example.com');
    expect(url.pathname).toBe('/');
    expect(url.searchParams.get('cli_callback')).toBe('http://127.0.0.1:1234/agent-tick/setup/callback');
    expect(url.searchParams.get('cli_state')).toBe('state_123');
    expect(url.searchParams.get('cli_server')).toBeNull();
    expect(url.searchParams.get('cli_name')).toBe('Claude Code');
  });

  it('uses the hosted app origin as the hosted setup server', () => {
    const url = new URL(buildCliSetupURL({
      server: hostedAgentTickURL,
      callbackURL: 'http://127.0.0.1:1234/agent-tick/setup/callback',
      state: 'state_123'
    }));

    expect(url.origin).toBe(hostedAgentTickURL);
    expect(url.searchParams.get('cli_server')).toBeNull();
  });

  it('accepts setup tokens in a POST body and saves CLI config', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-cli-callback-'));
    tmpRoots.push(root);
    const configPath = path.join(root, 'config.json');

    await withProcessEnv({ AGENT_TICK_CONFIG: configPath }, async () => {
      const callbackServer = await listenForSetupCallback({ expectedState: 'state_123', fallbackServer: 'https://fallback.example.com' });
      try {
        const response = await fetch(callbackServer.callbackURL, {
          method: 'POST',
          body: new URLSearchParams({ state: 'state_123', token: 'agent_post_token', server: 'https://tick.example.com' })
        });
        await expect(callbackServer.result).resolves.toEqual({ path: configPath });
        expect(response.status).toBe(200);
        await expect(loadClientConfig({ AGENT_TICK_CONFIG: configPath })).resolves.toEqual({ server: 'https://tick.example.com', token: 'agent_post_token' });
      } finally {
        callbackServer.server.close();
      }
    });
  });

  it('rejects setup tokens in callback query strings', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-cli-callback-query-'));
    tmpRoots.push(root);
    const configPath = path.join(root, 'config.json');

    await withProcessEnv({ AGENT_TICK_CONFIG: configPath }, async () => {
      const callbackServer = await listenForSetupCallback({ expectedState: 'state_123', fallbackServer: 'https://fallback.example.com' });
      try {
        const url = new URL(callbackServer.callbackURL);
        url.searchParams.set('state', 'state_123');
        url.searchParams.set('token', 'agent_query_token');
        url.searchParams.set('server', 'https://tick.example.com');
        const response = await fetch(url);
        expect(response.status).toBe(400);
        await expect(response.text()).resolves.toContain('Token-in-query setup callbacks are no longer supported');
        await expect(loadClientConfig({ AGENT_TICK_CONFIG: configPath })).resolves.toEqual({});
      } finally {
        callbackServer.server.close();
      }
    });
  });
});

describe('setup instructions', () => {
  it('documents status update, steering, and sanction commands', () => {
    const block = agentInstructionBlock('claude');
    expect(block).toContain('agent-tick send sanction -- <command and args>');
    expect(block).toContain('agent-tick send steering --title');
    expect(block).toContain('agent-tick send status --state working');
    expect(block).toContain('Do not include secrets');
  });

  it('shows Claude MCP setup in dry-run instead of hook profile setup', async () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await createProgram().parseAsync(['setup', '--target', 'claude', '--dry-run', '--no-login', '--yes'], { from: 'user' });
    } finally {
      process.stdout.write = originalWrite;
    }

    const output = writes.join('');
    expect(output).toContain('would configure Claude Code MCP server');
    expect(output).toContain('claude mcp add --scope user agent-tick -- agent-tick mcp');
    expect(output).toContain('claude mcp get agent-tick');
    expect(output).toContain('agent_tick_status_update');
    expect(output).toContain('sessionId "claude_${CLAUDE_SESSION_ID}"');
    expect(output).toContain('not a shell environment variable');
    expect(output).not.toContain('AFK/pass-through');
    expect(output).not.toContain('--claude-profile');
  });

  it('configures Claude MCP by default without writing hooks', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-cli-'));
    tmpRoots.push(root);
    const bin = path.join(root, 'bin');
    const logPath = path.join(root, 'claude-args.log');
    await fs.mkdir(bin, { recursive: true });
    await fs.writeFile(path.join(bin, 'claude'), `#!/bin/sh\necho "$@" >> ${JSON.stringify(logPath)}\nexit 0\n`, { mode: 0o755 });
    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    process.env.PATH = `${bin}${path.delimiter}${originalPath ?? ''}`;
    process.env.HOME = root;
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await createProgram().parseAsync(['setup', '--target', 'claude', '--no-login', '--yes'], { from: 'user' });
    } finally {
      process.stdout.write = originalWrite;
      process.env.PATH = originalPath;
      process.env.HOME = originalHome;
    }

    await expect(fs.readFile(logPath, 'utf8')).resolves.toContain('mcp add --scope user agent-tick -- agent-tick mcp');
    await expect(fs.readFile(logPath, 'utf8')).resolves.toContain('mcp get agent-tick');
    await expect(fs.access(path.join(root, '.claude', 'settings.json'))).rejects.toThrow();
    expect(writes.join('')).toContain('Claude Code MCP tools: agent_tick_status_update, agent_tick_steering, agent_tick_sanction.');
    expect(writes.join('')).toContain('sessionId "claude_${CLAUDE_SESSION_ID}"');
  });

  it('activates optional Claude permission hooks even when legacy mode state exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-cli-'));
    tmpRoots.push(root);
    const bin = path.join(root, 'bin');
    const logPath = path.join(root, 'claude-args.log');
    const statePath = path.join(root, 'state.json');
    await fs.mkdir(bin, { recursive: true });
    await fs.writeFile(path.join(bin, 'claude'), `#!/bin/sh\necho "$@" >> ${JSON.stringify(logPath)}\nexit 0\n`, { mode: 0o755 });
    await fs.writeFile(statePath, JSON.stringify({ mode: 'pass-through', claude: { sanctions: 'afk' } }));
    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    const originalState = process.env.AGENT_TICK_STATE;
    process.env.PATH = `${bin}${path.delimiter}${originalPath ?? ''}`;
    process.env.HOME = root;
    process.env.AGENT_TICK_STATE = statePath;
    const originalWrite = process.stdout.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      await createProgram().parseAsync(['setup', '--target', 'claude', '--no-login', '--yes', '--claude-permission-hook'], { from: 'user' });
    } finally {
      process.stdout.write = originalWrite;
      process.env.PATH = originalPath;
      process.env.HOME = originalHome;
      process.env.AGENT_TICK_STATE = originalState;
    }

    const settings = JSON.parse(await fs.readFile(path.join(root, '.claude', 'settings.json'), 'utf8'));
    expect(settings.hooks.PermissionRequest[0].hooks[0].command).toBe('agent-tick hook claude-permission-request');
    await expect(fs.readFile(statePath, 'utf8')).resolves.toContain('"sanctions": "always"');
  });

  it('installs only the optional Claude permission hook when requested', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-cli-'));
    tmpRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');

    await installClaudePermissionHook(settingsPath);

    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    expect(settings.hooks.PermissionRequest).toEqual([
      {
        matcher: '*',
        hooks: [{ type: 'command', command: 'agent-tick hook claude-permission-request', timeout: 1800, statusMessage: 'Agent Tick sanction check' }]
      }
    ]);
    expect(settings.hooks.PreToolUse).toBeUndefined();
    expect(settings.permissions.allow).toContain('Bash(agent-tick:*)');
  });

  it('installs only the optional Claude question hook when requested', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-cli-'));
    tmpRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');

    await installClaudeQuestionHook(settingsPath);

    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    expect(settings.hooks.PreToolUse).toEqual([
      {
        matcher: 'AskUserQuestion',
        hooks: [{ type: 'command', command: 'agent-tick hook claude-pre-tool-use', timeout: 1800, statusMessage: 'Agent Tick steering check' }]
      }
    ]);
    expect(settings.hooks.PermissionRequest).toBeUndefined();
    expect(settings.permissions.allow).toContain('Bash(agent-tick:*)');
  });

  it('removes old Agent Tick Claude hooks without removing unrelated hooks', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-cli-'));
    tmpRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: 'agent-tick hook claude-pre-tool-use' }, { type: 'command', command: 'echo keep' }] },
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo unrelated' }] }
        ],
        PermissionRequest: [
          { matcher: '*', hooks: [{ type: 'command', command: 'agent-tick hook claude-permission-request' }] }
        ]
      },
      permissions: { allow: ['Bash(agent-tick:*)', 'Bash(echo:*)'] }
    }, null, 2));

    await removeAgentTickClaudeHooks([settingsPath]);

    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    expect(settings.hooks.PreToolUse).toEqual([
      { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: 'echo keep' }] },
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo unrelated' }] }
    ]);
    expect(settings.hooks.PermissionRequest).toBeUndefined();
    expect(settings.permissions.allow).toEqual(['Bash(echo:*)']);
  });
});

describe('Session identity resolution', () => {
  it('prefers explicit Session IDs over environment and host overrides', () => {
    expect(resolveAgentTickSessionId({ explicitSessionId: ' cli_session ', env: { AGENT_TICK_SESSION_ID: 'env_session', CODEX_THREAD_ID: 'codex_thread' } })).toBe('cli_session');
  });

  it('uses AGENT_TICK_SESSION_ID as the universal explicit environment override', () => {
    expect(resolveAgentTickSessionId({ env: { AGENT_TICK_SESSION_ID: ' env_session ', CODEX_THREAD_ID: 'codex_thread' } })).toBe('env_session');
  });

  it('uses sanitized Codex thread IDs as namespaced host Session IDs', () => {
    expect(resolveAgentTickSessionId({ env: { CODEX_THREAD_ID: ' 019e9c78/ab9c 73b0 ' } })).toBe('codex_019e9c78_ab9c_73b0');
  });

  it('omits Session ID instead of generating a random default for generic CLI/MCP Activity', () => {
    expect(resolveAgentTickSessionId({ env: {} })).toBeUndefined();
  });

  it('maps Claude hook session_id values to sanitized namespaced Session IDs', () => {
    expect(claudeHookSessionId({ session_id: ' df39e0b0/7701 4352 ' })).toBe('claude_df39e0b0_7701_4352');
  });

  it('omits explicit Session ID for Claude hooks without session_id', () => {
    expect(claudeHookSessionId({ tool_name: 'Bash' })).toBeUndefined();
  });
});

describe('MCP stdio adapter', () => {
  it('advertises Agent Tick MCP tools', async () => {
    expect(mcpToolDefinitions.map((tool) => tool.name)).toEqual(['agent_tick_status_update', 'agent_tick_sanction', 'agent_tick_steering']);

    await expect(handleMcpRequest({ method: 'tools/list', id: 1 }, {} as never, 'https://tick.example.com')).resolves.toEqual({ tools: mcpToolDefinitions });
  });

  it('advertises contentMode on every Activity-creating MCP tool', () => {
    for (const tool of mcpToolDefinitions) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, any>;
      expect(properties.contentMode).toMatchObject({ enum: ['default', 'private', 'plain'], default: 'default' });
      expect(properties.contentMode.description).toContain('private');
      expect(properties.contentMode.description).toContain('plain');
      expect(properties.contentMode.description).toContain('Omit this field unless the user explicitly asks');
    }
  });

  it('returns MCP initialize server capabilities', async () => {
    await expect(handleMcpRequest({ method: 'initialize', id: 1, params: { protocolVersion: '2024-11-05' } }, {} as never, 'https://tick.example.com')).resolves.toMatchObject({
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'agent-tick' }
    });
  });

  it('reads Codex JSON-lines MCP messages', () => {
    const line = '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{"elicitation":{"form":{}}}}}\n';

    expect(tryReadMcpMessage(Buffer.from(line))).toMatchObject({
      body: line.trim(),
      rest: Buffer.alloc(0),
      transport: 'jsonl'
    });
  });

  it('maps the status update MCP tool to a status update', async () => {
    let capturedInput: unknown;
    const client = {
      createStatusUpdate: async (input: unknown) => {
        capturedInput = input;
        return { statusId: 'status_1', threadId: 'thread_1', message: (input as { message: string }).message };
      }
    };

    await expect(handleMcpRequest({
      method: 'tools/call',
      id: 1,
      params: { name: 'agent_tick_status_update', arguments: { message: 'Running tests', threadId: 'thread_1', sessionId: 'run_123', sessionTitle: 'Billing migration', notify: true, importance: 'high' } }
    }, client as never, 'https://tick.example.com')).resolves.toEqual({
      content: [{ type: 'text', text: 'Sent status update status_1 for thread_1: Running tests' }]
    });
    expect(capturedInput).toMatchObject({ sessionId: 'run_123', session: { title: 'Billing migration' }, metadata: { agentTickNotify: 'true', agentTickImportance: 'high' } });
  });

  it('encrypts MCP status updates when contentMode is private', async () => {
    let capturedInput: any;
    const client = {
      preparePrivateStatusUpdate: async () => privatePrepareResponse(),
      createStatusUpdate: async (input: unknown) => {
        capturedInput = input;
        return { statusId: 'status_private', threadId: 'thread_1', message: (input as { message: string }).message };
      }
    };

    await expect(handleMcpRequest({
      method: 'tools/call',
      id: 1,
      params: { name: 'agent_tick_status_update', arguments: { message: 'Secret MCP status', nextStep: 'Hidden next', threadId: 'thread_1', contentMode: 'private' } }
    }, client as never, 'https://tick.example.com')).resolves.toEqual({
      content: [{ type: 'text', text: 'Sent status update status_private for thread_1: Private Status Update' }]
    });
    expect(capturedInput).toMatchObject({ message: 'Private Status Update', contentMode: 'private', privateRecipientVersion: 'version_1' });
    expect(JSON.stringify(capturedInput)).not.toContain('Secret MCP status');
    expect(JSON.stringify(capturedInput)).not.toContain('Hidden next');
  });

  it('uses saved MCP default privacy and lets explicit plain override it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-mcp-private-default-'));
    tmpRoots.push(root);
    const featuresPath = path.join(root, 'features.json');
    await fs.writeFile(featuresPath, JSON.stringify({ privacy: { defaultContentMode: 'private' } }));
    const capturedInputs: any[] = [];
    const client = {
      preparePrivateStatusUpdate: async () => privatePrepareResponse(),
      createStatusUpdate: async (input: unknown) => {
        capturedInputs.push(input);
        return { statusId: `status_${capturedInputs.length}`, threadId: 'thread_1', message: (input as { message: string }).message };
      }
    };

    await withProcessEnv({ AGENT_TICK_FEATURES_CONFIG: featuresPath, AGENT_TICK_PRIVATE_REQUESTS: undefined }, async () => {
      await handleMcpRequest({ method: 'tools/call', id: 1, params: { name: 'agent_tick_status_update', arguments: { message: 'Default-private MCP status', contentMode: 'default' } } }, client as never, 'https://tick.example.com');
      await handleMcpRequest({ method: 'tools/call', id: 2, params: { name: 'agent_tick_status_update', arguments: { message: 'Plain MCP status', contentMode: 'plain' } } }, client as never, 'https://tick.example.com');
    });

    expect(capturedInputs[0]).toMatchObject({ message: 'Private Status Update', contentMode: 'private' });
    expect(JSON.stringify(capturedInputs[0])).not.toContain('Default-private MCP status');
    expect(capturedInputs[1]).toMatchObject({ message: 'Plain MCP status' });
    expect((capturedInputs[1] as { contentMode?: string }).contentMode).toBeUndefined();
  });

  it('rejects invalid MCP contentMode values before sending Activity', async () => {
    const client = { createStatusUpdate: async () => { throw new Error('should not send'); } };
    await expect(handleMcpRequest({
      method: 'tools/call',
      id: 1,
      params: { name: 'agent_tick_status_update', arguments: { message: 'Nope', contentMode: 'encrypted' } }
    }, client as never, 'https://tick.example.com')).rejects.toThrow(/contentMode must be default, private, or plain/);
  });

  it('encrypts MCP steering and sanctions when contentMode is private', async () => {
    const capturedRequests: any[] = [];
    const client = {
      preparePrivateRequest: async () => privatePrepareResponse(),
      createRequest: async (input: unknown) => {
        capturedRequests.push(input);
        return { request: { id: `req_${capturedRequests.length}`, title: (input as { title: string }).title, status: 'pending', choices: [] } };
      }
    };

    await handleMcpRequest({ method: 'tools/call', id: 1, params: { name: 'agent_tick_sanction', arguments: { title: 'Secret sanction', command: 'deploy secret', timeout: '0', localElicitation: 'off', contentMode: 'private' } } }, client as never, 'https://tick.example.com');
    await handleMcpRequest({ method: 'tools/call', id: 2, params: { name: 'agent_tick_steering', arguments: { title: 'Secret steering', timeout: '0', localElicitation: 'off', contentMode: 'private', choices: [{ id: 'go', label: 'Go' }, { id: 'stop', label: 'Stop', kind: 'deny' }] } } }, client as never, 'https://tick.example.com');

    expect(capturedRequests).toHaveLength(2);
    expect(capturedRequests.every((request) => request.title === 'Private Request' && request.contentMode === 'private')).toBe(true);
    expect(JSON.stringify(capturedRequests)).not.toContain('Secret sanction');
    expect(JSON.stringify(capturedRequests)).not.toContain('Secret steering');
    expect(JSON.stringify(capturedRequests)).not.toContain('deploy secret');
  });

  it('uses saved MCP default privacy for requests and lets explicit plain override it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-mcp-request-default-'));
    tmpRoots.push(root);
    const featuresPath = path.join(root, 'features.json');
    await fs.writeFile(featuresPath, JSON.stringify({ privacy: { defaultContentMode: 'private' } }));
    const capturedRequests: any[] = [];
    const client = {
      preparePrivateRequest: async () => privatePrepareResponse(),
      createRequest: async (input: unknown) => {
        capturedRequests.push(input);
        return { request: { id: `req_${capturedRequests.length}`, title: (input as { title: string }).title, status: 'pending', choices: [] } };
      }
    };

    await withProcessEnv({ AGENT_TICK_FEATURES_CONFIG: featuresPath, AGENT_TICK_PRIVATE_REQUESTS: undefined }, async () => {
      await handleMcpRequest({ method: 'tools/call', id: 1, params: { name: 'agent_tick_sanction', arguments: { title: 'Default private sanction', timeout: '0', localElicitation: 'off' } } }, client as never, 'https://tick.example.com');
      await handleMcpRequest({ method: 'tools/call', id: 2, params: { name: 'agent_tick_steering', arguments: { title: 'Plain steering', timeout: '0', localElicitation: 'off', contentMode: 'plain', choices: [{ id: 'go', label: 'Go' }, { id: 'stop', label: 'Stop', kind: 'deny' }] } } }, client as never, 'https://tick.example.com');
    });

    expect(capturedRequests[0]).toMatchObject({ title: 'Private Request', contentMode: 'private' });
    expect(JSON.stringify(capturedRequests[0])).not.toContain('Default private sanction');
    expect(capturedRequests[1]).toMatchObject({ title: 'Plain steering', requestType: 'steering' });
    expect(capturedRequests[1].contentMode).toBeUndefined();
  });

  it('does not synthesize one process-wide Session ID for MCP Activity without caller run metadata', async () => {
    const capturedInputs: unknown[] = [];
    const client = {
      createStatusUpdate: async (input: unknown) => {
        capturedInputs.push(input);
        return { statusId: `status_${capturedInputs.length}`, threadId: 'thread_1', message: (input as { message: string }).message };
      }
    };

    await withProcessEnv({ AGENT_TICK_SESSION_ID: undefined, CODEX_THREAD_ID: undefined }, async () => {
      await handleMcpRequest({ method: 'tools/call', id: 1, params: { name: 'agent_tick_status_update', arguments: { message: 'First update' } } }, client as never, 'https://tick.example.com');
      await handleMcpRequest({ method: 'tools/call', id: 2, params: { name: 'agent_tick_status_update', arguments: { message: 'Second update' } } }, client as never, 'https://tick.example.com');
    });

    expect(capturedInputs).toHaveLength(2);
    expect((capturedInputs[0] as { sessionId?: string }).sessionId).toBeUndefined();
    expect((capturedInputs[1] as { sessionId?: string }).sessionId).toBeUndefined();
    expect((capturedInputs[0] as { threadId?: string }).threadId).toContain(process.cwd());
  });

  it('uses Codex thread IDs for MCP status updates when no explicit Session ID is supplied', async () => {
    let capturedInput: unknown;
    const client = {
      createStatusUpdate: async (input: unknown) => {
        capturedInput = input;
        return { statusId: 'status_1', threadId: 'thread_1', message: (input as { message: string }).message };
      }
    };

    await withProcessEnv({ AGENT_TICK_SESSION_ID: undefined, CODEX_THREAD_ID: '019e9c78-ab9c-73b0-b21c-ce18a32c8499' }, async () => {
      await handleMcpRequest({ method: 'tools/call', id: 1, params: { name: 'agent_tick_status_update', arguments: { message: 'Running tests' } } }, client as never, 'https://tick.example.com');
    });

    expect(capturedInput).toMatchObject({ sessionId: 'codex_019e9c78-ab9c-73b0-b21c-ce18a32c8499' });
  });

  it('uses the same Codex thread Session ID for MCP steering and sanctions', async () => {
    const capturedRequests: unknown[] = [];
    const client = {
      createRequest: async (input: unknown) => {
        capturedRequests.push(input);
        return { request: { id: `req_${capturedRequests.length}`, title: (input as { title: string }).title, status: 'pending', choices: [] } };
      }
    };

    await withProcessEnv({ AGENT_TICK_SESSION_ID: undefined, CODEX_THREAD_ID: 'thread:abc/123' }, async () => {
      await handleMcpRequest({ method: 'tools/call', id: 1, params: { name: 'agent_tick_sanction', arguments: { title: 'Approve?', timeout: '0', localElicitation: 'off' } } }, client as never, 'https://tick.example.com');
      await handleMcpRequest({ method: 'tools/call', id: 2, params: { name: 'agent_tick_steering', arguments: { title: 'Pick one', timeout: '0', localElicitation: 'off', choices: [{ id: 'go', label: 'Go' }, { id: 'stop', label: 'Stop', kind: 'deny' }] } } }, client as never, 'https://tick.example.com');
    });

    expect(capturedRequests.map((input) => (input as { sessionId?: string }).sessionId)).toEqual(['codex_thread:abc_123', 'codex_thread:abc_123']);
  });

  it('installs Pi sanctions without a generated fallback Session ID environment', () => {
    const source = readFileSync(new URL('../assets/pi/agent-tick-sanction.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('piRunSessionId');
    expect(source).not.toContain('randomBytes');
    expect(source).not.toContain('AGENT_TICK_SESSION_ID');
  });

  it('uses MCP elicitation for steering when the client supports it', async () => {
    let elicitationParams: unknown;
    const context = {
      clientCapabilities: { elicitation: { form: {} } },
      elicit: async (params: unknown) => {
        elicitationParams = params;
        return { action: 'accept' as const, content: { choiceId: 'small' } };
      }
    };

    await expect(handleMcpRequest({
      method: 'tools/call',
      id: 1,
      params: {
        name: 'agent_tick_steering',
        arguments: { title: 'Pick one', localElicitation: 'only', choices: [{ id: 'small', label: 'Small fix' }, { id: 'cancel', label: 'Cancel', kind: 'deny' }] }
      }
    }, {} as never, 'https://tick.example.com', context)).resolves.toEqual({
      content: [{ type: 'text', text: 'Local MCP elicitation accepted: small (Small fix)' }]
    });
    expect(elicitationParams).toMatchObject({
      message: 'Pick one',
      requestedSchema: { properties: { choiceId: { enum: ['small', 'cancel'] } } }
    });
  });

  it('races local and remote MCP steering in auto mode', async () => {
    let createdTitle = '';
    let abandonedId = '';
    const client = {
      createRequest: async (input: { title: string }) => {
        createdTitle = input.title;
        return { request: { id: 'req_1', title: input.title, status: 'pending' } };
      },
      waitForCreatedRequest: async () => new Promise(() => undefined),
      abandonRequest: async (id: string) => {
        abandonedId = id;
        return { id, status: 'resolved' };
      }
    };
    const context = {
      clientCapabilities: { elicitation: { form: {} } },
      elicit: async () => ({ action: 'accept' as const, content: { choiceId: 'small' } })
    };

    await expect(handleMcpRequest({
      method: 'tools/call',
      id: 1,
      params: {
        name: 'agent_tick_steering',
        arguments: { title: 'Pick one', localElicitation: 'auto', choices: [{ id: 'small', label: 'Small fix' }, { id: 'cancel', label: 'Cancel', kind: 'deny' }] }
      }
    }, client as never, 'https://tick.example.com', context)).resolves.toEqual({
      content: [{ type: 'text', text: 'Local MCP elicitation accepted: small (Small fix)' }]
    });
    expect(createdTitle).toBe('Pick one');
    expect(abandonedId).toBe('req_1');
  });

  it('cancels the local MCP steering elicitation when the remote response wins', async () => {
    let localAbortReason = '';
    const client = {
      createRequest: async (input: { title: string }) => ({ request: { id: 'req_1', title: input.title, status: 'pending' } }),
      waitForCreatedRequest: async () => ({
        terminal: true,
        request: {
          id: 'req_1',
          status: 'responded',
          choices: [{ id: 'banana', label: 'Banana', kind: 'approve' }, { id: 'cancel', label: 'Cancel', kind: 'deny' }],
          response: { choiceId: 'banana' }
        }
      })
    };
    const context = {
      clientCapabilities: { elicitation: { form: {} } },
      elicit: async (_params: unknown, options?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          localAbortReason = String(options.signal?.reason ?? '');
          reject(new Error(localAbortReason));
        }, { once: true });
      })
    };

    await expect(handleMcpRequest({
      method: 'tools/call',
      id: 1,
      params: {
        name: 'agent_tick_steering',
        arguments: { title: 'Pick fruit', localElicitation: 'auto', choices: [{ id: 'banana', label: 'Banana' }, { id: 'cancel', label: 'Cancel', kind: 'deny' }] }
      }
    }, client as never, 'https://tick.example.com', context)).resolves.toEqual({
      content: [{ type: 'text', text: 'Request req_1 is responded: banana' }]
    });
    expect(localAbortReason).toBe('Remote Agent Tick request resolved first.');
  });

  it('marks declined local MCP sanctions as tool errors', async () => {
    const context = {
      clientCapabilities: { elicitation: { form: {} } },
      elicit: async () => ({ action: 'decline' as const })
    };

    await expect(handleMcpRequest({
      method: 'tools/call',
      id: 1,
      params: { name: 'agent_tick_sanction', arguments: { title: 'Approve deploy?', localElicitation: 'only' } }
    }, {} as never, 'https://tick.example.com', context)).resolves.toEqual({
      content: [{ type: 'text', text: 'Local MCP elicitation was declined.' }],
      isError: true
    });
  });
});

describe('Agent Tick mode state', () => {
  it('defaults to pass-through and saves AFK mode', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-mode-'));
    tmpRoots.push(root);
    const env = { AGENT_TICK_STATE: path.join(root, 'state.json') };

    expect(agentTickStatePath(env)).toBe(env.AGENT_TICK_STATE);
    await expect(loadAgentTickMode(env)).resolves.toBe('pass-through');
    await expect(saveAgentTickMode('afk', env)).resolves.toBe('afk');
    await expect(loadAgentTickMode(env)).resolves.toBe('afk');
  });

  it('normalizes pass-through aliases and rejects unknown modes', () => {
    expect(normalizeAgentTickMode('passthrough')).toBe('pass-through');
    expect(normalizeAgentTickMode('pass-through')).toBe('pass-through');
    expect(() => normalizeAgentTickMode('normal')).toThrow(/unknown Agent Tick mode/);
  });
});

describe('hook risk policy', () => {
  it('detects risky commands and leaves simple reads alone', () => {
    expect(isRiskyCommand('npm install')).toBe(true);
    expect(isRiskyCommand('terraform apply')).toBe(true);
    expect(isRiskyCommand('ls -la')).toBe(false);
  });
});

describe('parseDurationMs', () => {
  it('parses duration suffixes', () => {
    expect(parseDurationMs('10ms')).toBe(10);
    expect(parseDurationMs('2s')).toBe(2000);
    expect(parseDurationMs('3m')).toBe(180000);
    expect(parseDurationMs('1h')).toBe(3600000);
    expect(parseDurationMs('0')).toBe(0);
  });
});

describe('parseChoices', () => {
  it('parses repeated custom choices with a deny choice', () => {
    expect(parseChoices(['red=Red option', 'green:deny=Green option'])).toEqual([
      { id: 'red', label: 'Red option', kind: 'approve' },
      { id: 'green', label: 'Green option', kind: 'deny' }
    ]);
  });

  it('accepts label-only choices and adds a cancel choice', () => {
    expect(parseChoices(['Nothing', 'Everything'])).toEqual([
      { id: 'nothing', label: 'Nothing', kind: 'approve' },
      { id: 'everything', label: 'Everything', kind: 'approve' },
      { id: 'cancel', label: 'Cancel / do not answer', kind: 'deny' }
    ]);
  });

  it('infers deny kind for deny-style ids', () => {
    expect(parseChoices(['deny=No thanks'])).toEqual([{ id: 'deny', label: 'No thanks', kind: 'deny' }]);
  });

  it('applies choice flags and tags', () => {
    expect(parseChoices(['small=Small fix', 'stop:deny=Stop'], ['small=favorite', 'small=reversible'], ['small=quick'])).toEqual([
      { id: 'small', label: 'Small fix', kind: 'approve', flags: ['favorite', 'reversible'], tags: ['quick'] },
      { id: 'stop', label: 'Stop', kind: 'deny' }
    ]);
  });

  it('rejects malformed choices', () => {
    expect(() => parseChoices(['missing-label='])).toThrow(/label cannot be empty/);
    expect(() => parseChoices(['=Missing id'])).toThrow(/invalid choice/);
    expect(() => parseChoices(['small=Small', 'stop:deny=Stop'], ['missing=favorite'])).toThrow(/unknown choice id/);
    expect(() => parseChoices(['small=Small', 'stop:deny=Stop'], ['small=unknown'])).toThrow(/invalid choice flag/);
  });

  it('rejects duplicate explicit choice ids', () => {
    expect(() => parseChoices(['id:test=nothing', 'id:other=other'])).toThrow(/Duplicate explicit choice id: id/);
  });
});
