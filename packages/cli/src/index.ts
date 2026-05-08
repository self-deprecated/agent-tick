#!/usr/bin/env node
import os from 'node:os';
import process from 'node:process';
import { Command } from 'commander';
import { AgentTickClient } from '@agent-tick/sdk';
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
    .description('Save server URL and agent token for later commands')
    .requiredOption('--server <url>', 'Agent Tick server URL')
    .requiredOption('--token <token>', 'Agent Tick agent token')
    .action(async (options: { server: string; token: string }) => {
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
    .option('--timeout <duration>', 'wait timeout, e.g. 30s, 5m, 0 for no wait', '30m')
    .option('--json', 'print machine-readable JSON events')
    .action(async (options: RequestOptions) => {
      const { server, token } = await resolveServerAndToken(options);
      const client = new AgentTickClient({ baseUrl: server, tokenProvider: () => token });
      const created = await client.createApprovalRequest({
        requester: {
          name: process.env.AGENT_TICK_REQUESTER_NAME || os.hostname() || 'agent',
          host: os.hostname()
        },
        title: options.title,
        ...(options.body ? { body: options.body } : {}),
        ...(options.command ? { command: options.command } : {})
      });

      if (options.json) {
        process.stdout.write(`${JSON.stringify({ event: 'created', request: created })}\n`);
      } else {
        process.stdout.write(`created approval request ${created.id}: ${created.title}\n`);
      }

      const timeoutMs = parseDurationMs(options.timeout);
      if (timeoutMs === 0) {
        process.exitCode = 0;
        return;
      }

      const waited = await client.waitForApproval(created.id, { timeoutMs });
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ event: waited.terminal ? 'terminal' : 'timeout', ...waited })}\n`);
      } else if (!waited.terminal) {
        process.stderr.write(`timed out waiting for approval request ${created.id}\n`);
      } else {
        const choice = waited.request.response?.choiceId ?? waited.request.response?.message ?? waited.request.status;
        process.stdout.write(`approval request ${created.id} completed: ${choice}\n`);
      }

      if (!waited.terminal) {
        process.exitCode = 2;
      } else {
        process.exitCode = waited.request.response?.choiceId === 'approve' ? 0 : 1;
      }
    });

  return program;
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

interface RequestOptions {
  server?: string;
  token?: string;
  title: string;
  body?: string;
  command?: string;
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
