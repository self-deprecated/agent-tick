import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isRiskyCommand } from '../src/commandRisk.js';
import { parseDurationMs } from '../src/duration.js';
import { agentTickStatePath, loadAgentTickMode, normalizeAgentTickMode, saveAgentTickMode } from '../src/agentTickState.js';

const tmpRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tmpRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tmpRoots.length = 0;
});

describe('CLI policy utility modules', () => {
  it('parses wait durations from a dedicated module', () => {
    expect(parseDurationMs(undefined)).toBe(30 * 60_000);
    expect(parseDurationMs('0')).toBe(0);
    expect(parseDurationMs('1.5m')).toBe(90_000);
    expect(() => parseDurationMs('forever')).toThrow(/invalid duration/);
  });

  it('classifies risky commands from a dedicated module', () => {
    expect(isRiskyCommand('rm -rf dist')).toBe(true);
    expect(isRiskyCommand('jj git push')).toBe(true);
    expect(isRiskyCommand('echo safe')).toBe(false);
  });

  it('persists Agent Tick mode through a dedicated state module', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-state-'));
    tmpRoots.push(root);
    const statePath = path.join(root, 'state.json');
    const env = { AGENT_TICK_STATE: statePath };

    expect(agentTickStatePath(env)).toBe(statePath);
    expect(normalizeAgentTickMode('passthrough')).toBe('pass-through');
    await expect(loadAgentTickMode(env)).resolves.toBe('pass-through');
    await expect(saveAgentTickMode('afk', env)).resolves.toBe('afk');
    await expect(loadAgentTickMode(env)).resolves.toBe('afk');
  });
});
