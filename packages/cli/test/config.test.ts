import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { assertAgentToken, clientConfigPath, loadClientConfig, maskAgentToken, resolveServerAndToken, saveClientConfig } from '../src/config.js';
import { agentInstructionBlock, agentTickStatePath, buildCliSetupURL, claudeHookSessionId, createProgram, handleMcpRequest, hostedAgentTickURL, installClaudePermissionHook, installClaudeQuestionHook, loadAgentTickMode, mcpToolDefinitions, normalizeAgentTickMode, removeAgentTickClaudeHooks, resolveAgentTickSessionId, saveAgentTickMode, isRiskyCommand, parseChoices, parseDurationMs, tryReadMcpMessage } from '../src/index.js';

const tmpRoots: string[] = [];

afterEach(async () => {
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

  it('exposes config and login commands without setup', () => {
    const commands = createProgram().commands.map((command) => command.name());
    expect(commands).toContain('config');
    expect(commands).toContain('login');
    expect(commands).not.toContain('setup');
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
});

describe('install instructions', () => {
  it('documents status update, steering, and sanction commands', () => {
    const block = agentInstructionBlock('claude');
    expect(block).toContain('agent-tick sanction -- <command and args>');
    expect(block).toContain('agent-tick steering --title');
    expect(block).toContain('agent-tick status-update --state working');
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
      await createProgram().parseAsync(['install', '--target', 'claude', '--dry-run', '--no-login', '--yes'], { from: 'user' });
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
      await createProgram().parseAsync(['install', '--target', 'claude', '--no-login', '--yes'], { from: 'user' });
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
      await createProgram().parseAsync(['install', '--target', 'claude', '--no-login', '--yes', '--claude-permission-hook'], { from: 'user' });
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
