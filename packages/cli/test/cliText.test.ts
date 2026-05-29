import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { command, orderedVisibleCommands, rootHelpFooter, success, topLevelHelpText } from '../src/cliText.js';

describe('CLI text helpers', () => {
  it('formats root help and command ordering from a dedicated module', () => {
    expect(topLevelHelpText()).toContain('Agent Tick');
    expect(rootHelpFooter()).toContain('agent-tick <command> --help');
    expect(command('agent-tick login', { color: false })).toBe('agent-tick login');
    expect(success('saved', { color: false })).toBe('saved');

    const program = new Command();
    program.command('install');
    program.command('status-update');
    program.command('zzz');
    expect(orderedVisibleCommands(program).map((entry) => entry.name())).toEqual(['status-update', 'install', 'zzz']);
  });
});
