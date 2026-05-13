import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clientConfigPath, loadClientConfig, resolveServerAndToken, saveClientConfig } from '../src/config.js';
import { agentInstructionBlock, agentTickStatePath, buildCliSetupURL, loadAgentTickMode, normalizeAgentTickMode, saveAgentTickMode, isRiskyCommand, parseChoices, parseDurationMs } from '../src/index.js';

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
    expect(url.searchParams.get('cli_name')).toBe('Claude Code');
  });
});

describe('install instructions', () => {
  it('documents sanction, steering, and status commands', () => {
    const block = agentInstructionBlock('claude');
    expect(block).toContain('agent-tick sanction -- <command and args>');
    expect(block).toContain('agent-tick steering --title');
    expect(block).toContain('agent-tick status --state working');
    expect(block).toContain('Do not include secrets');
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

  it('infers deny kind for deny-style ids', () => {
    expect(parseChoices(['deny=No thanks'])).toEqual([{ id: 'deny', label: 'No thanks', kind: 'deny' }]);
  });

  it('rejects malformed choices', () => {
    expect(() => parseChoices(['missing-label='])).toThrow(/label cannot be empty/);
    expect(() => parseChoices(['missing-separator'])).toThrow(/invalid choice/);
    expect(() => parseChoices(['red=Red option', 'blue=Blue option'])).toThrow(/kind "deny"/);
  });
});
