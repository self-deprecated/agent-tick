import process from 'node:process';
import type { AddHelpTextContext, Command } from 'commander';

type TextOptions = { color?: boolean; stream?: NodeJS.WriteStream };

function supportsColor(stream: NodeJS.WriteStream = process.stdout, options: TextOptions = {}): boolean {
  if (options.color === false) return false;
  return stream.isTTY === true && !process.env.NO_COLOR;
}

function color(code: string, value: string, stream: NodeJS.WriteStream = process.stdout, options: TextOptions = {}): string {
  return supportsColor(stream, options) ? `\u001b[${code}m${value}\u001b[0m` : value;
}

export function heading(value: string, options?: TextOptions): string { return color('1;36', value, options?.stream ?? process.stdout, options); }
export function command(value: string, options?: TextOptions): string { return color('32', value, options?.stream ?? process.stdout, options); }
export function muted(value: string, options?: TextOptions): string { return color('2', value, options?.stream ?? process.stdout, options); }
export function warning(value: string, options?: TextOptions): string { return color('33', value, options?.stream ?? process.stderr, options); }
export function errorText(value: string, options?: TextOptions): string { return color('31', value, options?.stream ?? process.stderr, options); }
export function success(value: string, options?: TextOptions): string { return color('32', value, options?.stream ?? process.stdout, options); }

export function topLevelHelpText(context?: AddHelpTextContext): string {
  if (context?.command.parent) return '';
  return `${heading('Agent Tick — Status Updates, Steering, and Sanctions for AI agents')}\n\n${heading('Most used')}\n  ${command('agent-tick status-update "Running tests now"')}\n  ${command('agent-tick steering --title "Which approach?" --choice "Small fix" --choice "Refactor"')}\n  ${command('agent-tick sanction --title "Deploy to production?"')}\n  ${command('agent-tick sanction -- npm install')}\n\n${heading('First-time setup')}\n  ${command('agent-tick login')}\n  ${command('agent-tick config --server http://localhost:8787 --token agent_...')}\n  ${command('agent-tick install --target claude')}\n\n`;
}

export function rootHelpFooter(context?: AddHelpTextContext): string {
  return context?.command.parent ? '' : `\n${muted('Run `agent-tick <command> --help` for command-specific examples.')}\n`;
}

export function orderedVisibleCommands(cmd: Command): Command[] {
  const priority = ['status-update', 'steering', 'sanction', 'mcp', 'login', 'config', 'install', 'mode', 'abandon'];
  return [...cmd.commands]
    .filter((subcommand) => subcommand.name() !== 'hook' && subcommand.name() !== 'status')
    .sort((left, right) => {
      const leftIndex = priority.indexOf(left.name());
      const rightIndex = priority.indexOf(right.name());
      if (leftIndex === -1 && rightIndex === -1) return 0;
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    });
}

export const loginHelpText = `\n${heading('Examples')}\n  ${command('agent-tick login')}\n  ${command('agent-tick login --server http://localhost:8787')}\n  ${command('agent-tick login --name "Claude Code on laptop"')}\n`;

export const configHelpText = `\n${heading('Examples')}\n  ${command('agent-tick config')}\n  ${command('agent-tick config --server http://localhost:8787 --token agent_...')}\n  ${command('agent-tick config show')}\n`;

export const installHelpText = `\n${heading('Examples')}\n  ${command('agent-tick install --target claude')}\n  ${command('agent-tick install --server http://localhost:8787 --token agent_... --target claude')}\n  ${command('agent-tick install --target claude --claude-scope local')}\n  ${command('agent-tick install --target claude --claude-permission-hook')}\n`;

export const statusUpdateHelpText = `\n${heading('Examples')}\n  ${command('agent-tick status-update "Finished edits; running tests now"')}\n  ${command('AGENT_TICK_SESSION_ID=codex_019e9c78-ab9c-73b0-b21c-ce18a32c8499 agent-tick status-update --session-title "Billing migration" --state waiting "Waiting for CI"')}\n  ${command('agent-tick status-update --state blocked --notify --importance high "Need staging access"')}\n  ${command('agent-tick status-update --state done "Implemented and validated"')}\n\n${muted('Semantic states: working, waiting, blocked, done, failed. Use --session/AGENT_TICK_SESSION_ID only for a real host chat/thread/session ID, with optional --session-title/AGENT_TICK_SESSION_TITLE as a label. If no real host Session ID is available, omit it; Agent Tick will group best-effort by source metadata. Custom states are accepted for older integrations, but treated as display-only and must not drive Session behavior. Use metadata for custom reason/context values. Do not send a waiting Status Update just because you created an Agent Tick Request; the Request itself is the waiting signal.')}\n`;

export const steeringHelpText = `\n${heading('Examples')}\n  ${command('agent-tick steering --title "Which approach?" --choice "Small fix" --choice "Refactor"')}\n  ${command('agent-tick steering --title "Proceed?" --choice yes="Yes" --choice no:deny="No"')}\n  ${command('agent-tick steering --title "Which fix?" --choice small="Small fix" --choice rewrite="Rewrite" --choice-flag small=favorite')}\n\n${muted('Choices may be plain labels, id=Label, or id:kind=Label. If no deny choice is provided, Agent Tick adds a Cancel choice. Use --choice-flag choiceId=favorite and --choice-tag choiceId=tag for mobile-visible annotations.')}\n`;

export const sanctionHelpText = `\n${heading('Examples')}\n  ${command('agent-tick sanction --title "Deploy to production?"')}\n  ${command('agent-tick sanction --title "Run migration?" --body "Touches billing tables" --choice-flag approve=production --choice-flag approve=destructive')}\n  ${command('agent-tick sanction -- npm install')}\n`;

export const abandonHelpText = `\n${heading('Example')}\n  ${command('agent-tick abandon apr_123')}\n`;
