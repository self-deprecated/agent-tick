import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import type { AddHelpTextContext, Command } from 'commander';

type TextOptions = { color?: boolean; stream?: NodeJS.WriteStream };

type CommandToken = {
  text: string;
  quote?: '"' | "'";
};

const commandColors = {
  binary: '90',
  send: '34;1',
  setup: '35;1',
  status: '32;1',
  steering: '33;1',
  sanction: '31;1',
  flag: '35;1',
  string: '92',
  value: '36',
  raw: '37',
  description: '2'
} as const;

function supportsColor(stream: NodeJS.WriteStream = process.stdout, options: TextOptions = {}): boolean {
  if (options.color === false) return false;
  return stream.isTTY === true && !process.env.NO_COLOR;
}

function color(code: string, value: string, stream: NodeJS.WriteStream = process.stdout, options: TextOptions = {}): string {
  return supportsColor(stream, options) ? `\u001b[${code}m${value}\u001b[0m` : value;
}

function tokenColor(code: string, value: string, options?: TextOptions): string {
  return color(code, value, options?.stream ?? process.stdout, options);
}

export function heading(value: string, options?: TextOptions): string { return tokenColor('1;36', value, options); }
export function command(value: string, options?: TextOptions): string { return commandExample(value, options); }
export function muted(value: string, options?: TextOptions): string { return tokenColor('2', value, options); }
export function warning(value: string, options?: TextOptions): string { return color('33', value, options?.stream ?? process.stderr, options); }
export function errorText(value: string, options?: TextOptions): string { return color('31', value, options?.stream ?? process.stderr, options); }
export function success(value: string, options?: TextOptions): string { return tokenColor('32', value, options); }

export function commandExample(value: string, options?: TextOptions): string {
  const tokens = tokenizeCommand(value);
  let rawCommand = false;
  return tokens.map((token, index) => {
    if (rawCommand) return colorRawCommandToken(token, options);
    if (token.text === '--') {
      rawCommand = true;
      return tokenColor(commandColors.flag, token.text, options);
    }
    return colorCommandToken(token, index, options);
  }).join(' ');
}

function tokenizeCommand(value: string): CommandToken[] {
  const tokens: CommandToken[] = [];
  let index = 0;
  while (index < value.length) {
    while (value[index] === ' ') index += 1;
    if (index >= value.length) break;
    const quote = value[index] === '"' || value[index] === "'" ? value[index] as '"' | "'" : undefined;
    let text = '';
    if (quote) {
      text += value[index++];
      while (index < value.length) {
        text += value[index];
        if (value[index] === quote && value[index - 1] !== '\\') {
          index += 1;
          break;
        }
        index += 1;
      }
      tokens.push({ text, quote });
      continue;
    }
    while (index < value.length && value[index] !== ' ') {
      const currentQuote = value[index] === '"' || value[index] === "'" ? value[index] : undefined;
      if (!currentQuote) {
        text += value[index++];
        continue;
      }
      text += value[index++];
      while (index < value.length) {
        text += value[index];
        if (value[index] === currentQuote && value[index - 1] !== '\\') {
          index += 1;
          break;
        }
        index += 1;
      }
    }
    tokens.push({ text });
  }
  return tokens;
}

function colorCommandToken(token: CommandToken, index: number, options?: TextOptions): string {
  const text = token.text;
  if (index === 0 && (text === 'agent-tick' || text === 'npx' || text === 'node')) return tokenColor(commandColors.binary, text, options);
  if (text === '@self-deprecated/agent-tick' || text.endsWith('/index.js')) return tokenColor(commandColors.binary, text, options);
  if (text === 'send') return tokenColor(commandColors.send, text, options);
  if (text === 'setup') return tokenColor(commandColors.setup, text, options);
  if (text === 'status') return tokenColor(commandColors.status, text, options);
  if (text === 'steering') return tokenColor(commandColors.steering, text, options);
  if (text === 'sanction') return tokenColor(commandColors.sanction, text, options);
  if (text.startsWith('--') || /^-[A-Za-z]$/.test(text)) return tokenColor(commandColors.flag, text, options);
  if (isQuoted(text)) return tokenColor(commandColors.string, text, options);
  if (text.includes('=')) return colorAssignmentToken(text, options);
  if (isEnumLikeValue(text)) return tokenColor(commandColors.value, text, options);
  return tokenColor(commandColors.raw, text, options);
}

function colorRawCommandToken(token: CommandToken, options?: TextOptions): string {
  return isQuoted(token.text) ? tokenColor(commandColors.string, token.text, options) : tokenColor(commandColors.raw, token.text, options);
}

function colorAssignmentToken(value: string, options?: TextOptions): string {
  const separator = value.indexOf('=');
  const left = value.slice(0, separator + 1);
  const right = value.slice(separator + 1);
  if (isQuoted(right)) return `${tokenColor(commandColors.value, left, options)}${tokenColor(commandColors.string, right, options)}`;
  return tokenColor(commandColors.value, value, options);
}

function isQuoted(value: string): boolean {
  return (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
}

function isEnumLikeValue(value: string): boolean {
  return ['working', 'waiting', 'blocked', 'done', 'failed', 'low', 'normal', 'high', 'urgent', 'private', 'plain'].includes(value);
}

export function styleCommandText(value: string): string {
  return commandExample(value);
}

export function styleOptionTerm(value: string): string {
  return value.split(/(,?\s+)/).map((part) => part.startsWith('-') ? tokenColor(commandColors.flag, part) : part).join('');
}

export function styleSubcommandTerm(value: string): string {
  const [name = '', ...rest] = value.split(' ');
  return [colorSubcommandName(name), ...rest].join(' ');
}

export function styleArgumentTerm(value: string): string {
  return tokenColor(commandColors.value, value);
}

export function styleDescriptionText(value: string): string {
  return tokenColor(commandColors.description, value);
}

function colorSubcommandName(value: string): string {
  if (value === 'send') return tokenColor(commandColors.send, value);
  if (value === 'setup') return tokenColor(commandColors.setup, value);
  if (value === 'status') return tokenColor(commandColors.status, value);
  if (value === 'steering') return tokenColor(commandColors.steering, value);
  if (value === 'sanction') return tokenColor(commandColors.sanction, value);
  return value;
}

export function topLevelHelpText(context?: AddHelpTextContext): string {
  if (context?.command.parent) return '';
  return `${heading('Agent Tick — Status Updates, Steering Requests, and Sanction Requests for AI agents')}\n\n${heading('Most used')}\n  ${command('agent-tick send status "Running tests now"')}\n  ${command('agent-tick send steering --title "Which approach?" --choice small="Small fix" --choice refactor="Refactor" --choice stop:deny="Stop"')}\n  ${command('agent-tick send sanction --title "Deploy to production?" --command "deploy production"')}\n  ${command('agent-tick send sanction -- npm install')}\n\n${heading('First-time setup')}\n  ${command('agent-tick setup')}\n  ${command('npx @self-deprecated/agent-tick setup')}\n  ${command('agent-tick login')}\n  ${command('agent-tick config --server http://localhost:8787 --token agent_...')}\n\n`;
}

export function rootHelpFooter(context?: AddHelpTextContext): string {
  return context?.command.parent ? '' : `\n${muted('Run `agent-tick <command> --help` for command-specific examples. Commands that create Agent Activity are under `agent-tick send`.')}\n`;
}

export function orderedVisibleCommands(cmd: Command): Command[] {
  const isRoot = !cmd.parent;
  const priority = isRoot
    ? ['send', 'setup', 'mcp', 'login', 'config', 'features', 'mode', 'abandon']
    : ['status', 'steering', 'sanction'];
  const hidden = isRoot ? ['hook', 'install', 'status-update', 'steering', 'sanction'] : ['hook'];
  return [...cmd.commands]
    .filter((subcommand) => !hidden.includes(subcommand.name()))
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

export const setupHelpText = `\n${heading('Examples')}\n  ${command('agent-tick setup')}\n  ${command('npx @self-deprecated/agent-tick setup')}\n  ${command('agent-tick setup --target claude')}\n  ${command('agent-tick setup --server http://localhost:8787 --token agent_... --target claude')}\n  ${command('agent-tick setup --target claude --claude-scope local')}\n  ${command('agent-tick setup --target claude --claude-permission-hook')}\n\n${heading('What setup does')}\n  Opens browser sign-in unless --token or --no-login is provided.\n  Sets up supported local coding-agent integrations for selected targets.\n  Use --dry-run to preview file/settings changes before writing.\n`;

export function sendHelpText(): string {
  const privacyDefault = currentPrivacyDefaultText();
  return `\n${heading('Send Agent Activity')}\n  ${command('agent-tick send status "Running tests now"')}\n  ${command('agent-tick send steering --title "Which approach?" --choice small="Small fix" --choice refactor="Refactor" --choice stop:deny="Stop"')}\n  ${command('agent-tick send sanction --title "Deploy to production?" --command "deploy production"')}\n\n${heading('Status Update examples')}\n  ${command('agent-tick send status --state working --next "Run tests" "Finished edits; validating now"')}\n  ${command('agent-tick send status --state blocked --notify --importance high "Need staging access"')}\n  ${command('agent-tick send status --state done "Implemented and validated"')}\n\n${heading('Steering Request examples')}\n  ${command('agent-tick send steering --title "Proceed?" --choice yes="Yes" --choice no:deny="No"')}\n  ${command('agent-tick send steering --title "Which fix?" --choice small="Small fix" --choice rewrite="Rewrite" --choice stop:deny="Stop" --choice-flag small=favorite')}\n\n${heading('Sanction Request examples')}\n  ${command('agent-tick send sanction --title "Run migration?" --body "Touches billing tables" --command "./migrate-staging.sh"')}\n  ${command('agent-tick send sanction --title "Install dependency?" -- npm install left-pad')}\n  ${command('agent-tick send sanction --title "Run combined command?" -- sh -c \'npm install && npm test\'')}\n\n${heading('Privacy and Sessions')}\n  Default privacy follows config: ${tokenColor(commandColors.value, privacyDefault)}.\n  Use ${tokenColor(commandColors.flag, '--private')} to encrypt this Activity for approval devices.\n  Use ${tokenColor(commandColors.flag, '--plain')} to send plaintext for this send only.\n  Use ${tokenColor(commandColors.flag, '--session')} only for a real host chat/thread/run ID; use ${tokenColor(commandColors.flag, '--session-title')} for its label.\n`;
}

export const statusUpdateHelpText = `\n${heading('Examples')}\n  ${command('agent-tick send status "Finished edits; running tests now"')}\n  ${command('agent-tick send status --state working --next "Run tests" "Finished edits; validating now"')}\n  ${command('agent-tick send status --state blocked --notify --importance high "Need staging access"')}\n  ${command('agent-tick send status --state done "Implemented and validated"')}\n\n${heading('States')}\n  ${tokenColor(commandColors.value, 'working')}, ${tokenColor(commandColors.value, 'waiting')}, ${tokenColor(commandColors.value, 'blocked')}, ${tokenColor(commandColors.value, 'done')}, ${tokenColor(commandColors.value, 'failed')}\n\n${heading('Privacy')}\n  Default privacy follows config: ${tokenColor(commandColors.value, currentPrivacyDefaultText())}.\n  Use ${tokenColor(commandColors.flag, '--private')} to encrypt this Status Update for approval devices.\n  Use ${tokenColor(commandColors.flag, '--plain')} to send plaintext for this send only.\n  Set ${tokenColor(commandColors.value, 'privacy.defaultContentMode')} with ${command('agent-tick features')} for a saved default.\n\n${heading('Sessions')}\n  Use ${tokenColor(commandColors.flag, '--session')}/AGENT_TICK_SESSION_ID only for a real host chat/thread/run ID.\n  Use ${tokenColor(commandColors.flag, '--session-title')}/AGENT_TICK_SESSION_TITLE for a human-readable label.\n  If no real host Session ID is available, omit it; Agent Tick groups best-effort by source metadata.\n\n${muted('Do not send a waiting Status Update just because you created an Agent Tick Request; the Request itself is the waiting signal. Custom states are accepted for older integrations as display-only labels; use metadata or message text for custom reasons.')}\n`;

export const steeringHelpText = `\n${heading('Examples')}\n  ${command('agent-tick send steering --title "Which approach?" --choice small="Small fix" --choice refactor="Refactor" --choice stop:deny="Stop"')}\n  ${command('agent-tick send steering --title "Proceed?" --choice yes="Yes" --choice no:deny="No"')}\n  ${command('agent-tick send steering --title "Which fix?" --choice small="Small fix" --choice rewrite="Rewrite" --choice stop:deny="Stop" --choice-flag small=favorite')}\n\n${heading('Choices')}\n  Choices may be plain labels, id=Label, or id:kind=Label.\n  Include a deny choice such as ${tokenColor(commandColors.value, 'stop:deny=')}${tokenColor(commandColors.string, '"Stop"')} when the human should be able to decline.\n  Use ${tokenColor(commandColors.flag, '--choice-flag')} choiceId=favorite and ${tokenColor(commandColors.flag, '--choice-tag')} choiceId=tag for mobile-visible annotations.\n\n${heading('Privacy')}\n  Default privacy follows config: ${tokenColor(commandColors.value, currentPrivacyDefaultText())}.\n  Use ${tokenColor(commandColors.flag, '--private')} to encrypt this Steering Request for approval devices.\n  Use ${tokenColor(commandColors.flag, '--plain')} to send plaintext for this send only.\n`;

export const sanctionHelpText = `\n${heading('Examples')}\n  ${command('agent-tick send sanction --title "Deploy to production?" --command "deploy production"')}\n  ${command('agent-tick send sanction --title "Run migration?" --body "Touches billing tables" --command "./migrate-staging.sh"')}\n  ${command('agent-tick send sanction --title "Install dependency?" -- npm install left-pad')}\n\n${heading('Command handling')}\n  Use ${tokenColor(commandColors.flag, '--command')} when the command/action is reviewer context only.\n  Put a command after ${tokenColor(commandColors.flag, '--')} when Agent Tick should run it locally after approval.\n  Denial, timeout, or failure prevents the command after ${tokenColor(commandColors.flag, '--')} from running.\n\n${heading('Privacy')}\n  Default privacy follows config: ${tokenColor(commandColors.value, currentPrivacyDefaultText())}.\n  Use ${tokenColor(commandColors.flag, '--private')} to encrypt this Sanction Request for approval devices.\n  Use ${tokenColor(commandColors.flag, '--plain')} to send plaintext for this send only.\n`;

export const abandonHelpText = `\n${heading('Example')}\n  ${command('agent-tick abandon req_123')}\n`;

function currentPrivacyDefaultText(): string {
  const configured = explicitPrivacyDefaultContentMode();
  if (configured) return `privacy.defaultContentMode = ${configured}`;
  if (process.env.AGENT_TICK_PRIVATE_REQUESTS === 'always') return 'private (from AGENT_TICK_PRIVATE_REQUESTS=always)';
  return 'privacy.defaultContentMode = plain (built-in default)';
}

function explicitPrivacyDefaultContentMode(): 'plain' | 'private' | undefined {
  let configured: 'plain' | 'private' | undefined;
  for (const configPath of agentFeaturesConfigLoadPathsSync()) {
    if (!fs.existsSync(configPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown;
      const value = isPlainObject(parsed) && isPlainObject(parsed.privacy) ? parsed.privacy.defaultContentMode : undefined;
      if (value === 'plain' || value === 'private') configured = value;
    } catch {
      // Ignore unreadable config in help text; command execution will report config errors when needed.
    }
  }
  return configured;
}

function agentFeaturesConfigLoadPathsSync(): string[] {
  const cwd = process.cwd();
  const explicit = (process.env.AGENT_TICK_FEATURES_CONFIG ?? '')
    .split(/[,:]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => path.resolve(cwd, part));
  return [
    path.join(os.homedir(), '.config', 'agent-tick', 'features.json'),
    path.join(cwd, '.agent-tick', 'features.json'),
    ...explicit
  ];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
