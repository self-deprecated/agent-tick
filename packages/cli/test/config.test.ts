import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertAgentToken, clientConfigPath, loadClientConfig, maskAgentToken, resolveServerAndToken, saveClientConfig } from '../src/config.js';
import { agentInstructionBlock, agentTickStatePath, buildCliSetupURL, createProgram, handleMcpRequest, hostedAgentTickURL, loadAgentTickMode, mcpToolDefinitions, normalizeAgentTickMode, saveAgentTickMode, isRiskyCommand, parseChoices, parseDurationMs, tryReadMcpMessage } from '../src/index.js';

const tmpRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tmpRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tmpRoots.length = 0;
});

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
      params: { name: 'agent_tick_status_update', arguments: { message: 'Running tests', threadId: 'thread_1', notify: true, importance: 'high' } }
    }, client as never, 'https://tick.example.com')).resolves.toEqual({
      content: [{ type: 'text', text: 'Sent status update status_1 for thread_1: Running tests' }]
    });
    expect(capturedInput).toMatchObject({ metadata: { agentTickNotify: 'true', agentTickImportance: 'high' } });
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
      createApprovalRequest: async (input: { title: string }) => {
        createdTitle = input.title;
        return { request: { id: 'req_1', title: input.title, status: 'pending' } };
      },
      waitForApproval: async () => new Promise(() => undefined),
      abandonApproval: async (id: string) => {
        abandonedId = id;
        return { id, status: 'abandoned' };
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
