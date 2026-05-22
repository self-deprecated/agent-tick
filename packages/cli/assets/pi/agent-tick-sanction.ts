import { spawnSync } from 'node:child_process';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const riskyPatterns = [
  /\brm\s+(-rf?|--recursive)/i,
  /\bsudo\b/i,
  /\b(chmod|chown)\b.*777/i,
  /\b(git|jj)\s+.*\bpush\b/i,
  /\b(docker|podman)\s+compose\s+up\b/i,
  /\b(npm|pnpm|yarn|bun)\s+(install|add)\b/i
];

export default function (pi: ExtensionAPI) {
  pi.on('tool_call', async (event) => {
    if (event.toolName !== 'bash') return undefined;

    const command = String((event.input as { command?: unknown }).command ?? '');
    if (!command || command.trim().startsWith('agent-tick ')) return undefined;
    if (!riskyPatterns.some((pattern) => pattern.test(command))) return undefined;

    const result = spawnSync(
      'agent-tick',
      [
        'sanction',
        '--title',
        'Authorize Pi command?',
        '--body',
        'Pi wants to run a risky command.',
        '--command',
        command,
        '--timeout',
        '30m'
      ],
      { stdio: 'inherit' }
    );

    if (result.status === 0) return undefined;
    return { block: true, reason: 'Agent Tick Sanction denied, timed out, or failed' };
  });
}
