#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const isWindows = process.platform === 'win32';
const pnpm = isWindows ? 'pnpm.cmd' : 'pnpm';
const corepack = isWindows ? 'corepack.cmd' : 'corepack';

function run(command, args) {
  const label = [command, ...args].join(' ');
  process.stdout.write(`\n$ ${label}\n`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error) {
    process.stderr.write(`\nFailed to run ${label}: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(corepack, ['enable']);
run(corepack, ['pnpm', 'install', '--frozen-lockfile']);
run(corepack, ['pnpm', '--filter', '@self-deprecated/agent-tick', 'build']);

process.stdout.write(`\nAgent Tick local setup is ready.\n\nNext steps:\n  1. Start the server: docker compose up --build\n  2. Configure the CLI: corepack pnpm --filter @self-deprecated/agent-tick exec agent-tick setup --login --server http://localhost:8787\n  3. Send a test Request: corepack pnpm --filter @self-deprecated/agent-tick exec agent-tick send sanction --title "Test Request"\n\n`);
