import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type JsonObject = Record<string, unknown>;

export type AgentFeaturesConfigTargetOptions = {
  file?: string;
  project?: boolean;
  cwd?: string;
  homeDirectory?: string;
  env?: NodeJS.ProcessEnv;
};

export type AgentFeature = {
  id: string;
  aliases: string[];
  label: string;
  path: string[];
  defaultValue: boolean;
};

export type AgentTickContentMode = 'plain' | 'private';
export type ToolActivityVisibility = 'off' | 'names' | 'summaries' | 'details';

export const DEFAULT_AGENT_FEATURES_CONFIG: JsonObject = {
  privacy: {
    defaultContentMode: 'plain'
  },
  status: {
    enabled: true,
    includeTaskSummary: true,
    taskSummaryMaxChars: 160,
    heartbeat: { enabled: true, intervalMs: 285_000, message: 'Still working' },
    hooks: {
      before_agent_start: { send: true, state: 'working', message: 'task-summary' },
      turn_end: { send: false, state: 'working', message: 'none' },
      agent_end: { send: true, state: 'waiting', message: 'Finished; waiting' },
      session_shutdown: { send: false, state: 'done', message: 'none' }
    },
    messageMirroring: {
      enabled: false,
      contentMode: 'private',
      sendAssistant: 'final-only',
      sendUser: false,
      includeToolUseTurns: false,
      includeThinking: false,
      maxBodyChars: 20_000,
      previewMaxChars: 240,
      collapsedByDefault: true,
      includeContextUsage: true
    },
    toolActivity: {
      enabled: false,
      visibility: 'off',
      detailContentMode: 'private',
      maxDetailChars: 2000
    }
  },
  sanctions: {
    enabled: false,
    policy: 'allow-by-default',
    tools: {
      bash: {
        enabled: true,
        parseShell: true,
        allow: {},
        deny: {}
      }
    },
    approval: {
      local: true,
      remote: true,
      timeoutMs: 120_000,
      discloseCommand: 'safe-only'
    }
  }
};

export const AGENT_FEATURES_BOOLEAN_FEATURES: AgentFeature[] = [
  { id: 'status', aliases: ['status-updates', 'lifecycle'], label: 'Lifecycle status updates', path: ['status', 'enabled'], defaultValue: true },
  { id: 'start', aliases: ['before-agent-start', 'before_agent_start', 'agent-start'], label: 'Send status when an agent run starts', path: ['status', 'hooks', 'before_agent_start', 'send'], defaultValue: true },
  { id: 'heartbeat', aliases: ['heartbeats'], label: 'Send periodic working heartbeats', path: ['status', 'heartbeat', 'enabled'], defaultValue: true },
  { id: 'turn-end', aliases: ['turn_end'], label: 'Send status at each turn end', path: ['status', 'hooks', 'turn_end', 'send'], defaultValue: false },
  { id: 'finish', aliases: ['agent-end', 'agent_end', 'end'], label: 'Send status when an agent run finishes', path: ['status', 'hooks', 'agent_end', 'send'], defaultValue: true },
  { id: 'shutdown', aliases: ['session-shutdown', 'session_shutdown'], label: 'Send status on agent session shutdown', path: ['status', 'hooks', 'session_shutdown', 'send'], defaultValue: false },
  { id: 'message-mirroring', aliases: ['messages', 'message', 'assistant-replies', 'reply-mirroring'], label: 'Mirror assistant replies as status activity', path: ['status', 'messageMirroring', 'enabled'], defaultValue: false },
  { id: 'message-user', aliases: ['user-messages', 'mirror-user'], label: 'Mirror user messages', path: ['status', 'messageMirroring', 'sendUser'], defaultValue: false },
  { id: 'message-tool-turns', aliases: ['tool-turns', 'message-tools'], label: 'Mirror assistant text before tool use', path: ['status', 'messageMirroring', 'includeToolUseTurns'], defaultValue: false },
  { id: 'message-thinking', aliases: ['thinking', 'message-thinking'], label: 'Include assistant thinking in mirrored messages', path: ['status', 'messageMirroring', 'includeThinking'], defaultValue: false },
  { id: 'message-context-usage', aliases: ['context-usage', 'message-context'], label: 'Attach context usage to mirrored messages', path: ['status', 'messageMirroring', 'includeContextUsage'], defaultValue: true },
  { id: 'message-collapsed', aliases: ['collapsed', 'messages-collapsed'], label: 'Collapse mirrored messages by default', path: ['status', 'messageMirroring', 'collapsedByDefault'], defaultValue: true },
  { id: 'tool-activity', aliases: ['tools', 'tool-status'], label: 'Mirror structured Tool Activity metadata', path: ['status', 'toolActivity', 'enabled'], defaultValue: false },
  { id: 'sanctions', aliases: ['approval-gates', 'approvals'], label: 'Enable bash Sanction approval gates', path: ['sanctions', 'enabled'], defaultValue: false },
  { id: 'sanction-local', aliases: ['local-sanctions', 'local-approval'], label: 'Show local approval prompt for Sanctions', path: ['sanctions', 'approval', 'local'], defaultValue: true },
  { id: 'sanction-remote', aliases: ['remote-sanctions', 'remote-approval'], label: 'Send remote Agent Tick Sanction requests', path: ['sanctions', 'approval', 'remote'], defaultValue: true },
  { id: 'bash-sanctions', aliases: ['bash-approval', 'bash'], label: 'Apply Sanction rules to bash tool calls', path: ['sanctions', 'tools', 'bash', 'enabled'], defaultValue: true },
  { id: 'bash-parse-shell', aliases: ['parse-shell'], label: 'Parse shell commands for bash Sanction rules', path: ['sanctions', 'tools', 'bash', 'parseShell'], defaultValue: true }
];

export function globalAgentFeaturesConfigPath(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, '.config', 'agent-tick', 'features.json');
}

export function projectAgentFeaturesConfigPath(cwd = process.cwd()): string {
  return path.join(cwd, '.agent-tick', 'features.json');
}

export function resolveAgentFeaturesConfigPath(options: AgentFeaturesConfigTargetOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const homeDirectory = options.homeDirectory ?? os.homedir();
  if (options.file?.trim()) return path.resolve(cwd, options.file.trim());
  if (options.project) return projectAgentFeaturesConfigPath(cwd);
  return globalAgentFeaturesConfigPath(homeDirectory);
}

export function agentFeaturesConfigLoadPaths(options: AgentFeaturesConfigTargetOptions = {}): string[] {
  const cwd = options.cwd ?? process.cwd();
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const env = options.env ?? process.env;
  const explicit = (env.AGENT_TICK_FEATURES_CONFIG ?? '')
    .split(/[,:]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => path.resolve(cwd, part));
  const target = options.file?.trim() ? [path.resolve(cwd, options.file.trim())] : [];
  return [globalAgentFeaturesConfigPath(homeDirectory), projectAgentFeaturesConfigPath(cwd), ...explicit, ...target];
}

export async function ensureAgentFeaturesConfig(options: AgentFeaturesConfigTargetOptions = {}): Promise<{ path: string; created: boolean }> {
  const configPath = resolveAgentFeaturesConfigPath(options);
  if (await fileExists(configPath)) return { path: configPath, created: false };
  await writeJSON(configPath, DEFAULT_AGENT_FEATURES_CONFIG);
  return { path: configPath, created: true };
}

export async function readAgentFeaturesConfigFile(configPath: string): Promise<JsonObject> {
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export async function loadEffectiveAgentFeaturesConfig(options: AgentFeaturesConfigTargetOptions = {}): Promise<{ config: JsonObject; paths: string[]; existingPaths: string[] }> {
  let config = deepClone(DEFAULT_AGENT_FEATURES_CONFIG);
  const paths = agentFeaturesConfigLoadPaths(options);
  const existingPaths: string[] = [];
  for (const configPath of paths) {
    if (!(await fileExists(configPath))) continue;
    existingPaths.push(configPath);
    config = deepMerge(config, await readAgentFeaturesConfigFile(configPath));
  }
  return { config, paths, existingPaths };
}

export async function loadExplicitPrivacyDefaultContentMode(options: AgentFeaturesConfigTargetOptions = {}): Promise<AgentTickContentMode | undefined> {
  let contentMode: AgentTickContentMode | undefined;
  for (const configPath of agentFeaturesConfigLoadPaths(options)) {
    if (!(await fileExists(configPath))) continue;
    const configured = normalizeContentMode(getPath(await readAgentFeaturesConfigFile(configPath), ['privacy', 'defaultContentMode']));
    if (configured) contentMode = configured;
  }
  return contentMode;
}

export function normalizeContentMode(value: unknown): AgentTickContentMode | undefined {
  return value === 'plain' || value === 'private' ? value : undefined;
}

export function normalizeToolActivityVisibility(value: unknown): ToolActivityVisibility | undefined {
  return value === 'off' || value === 'names' || value === 'summaries' || value === 'details' ? value : undefined;
}

export async function setAgentFeature(featureName: string, enabled: boolean, options: AgentFeaturesConfigTargetOptions = {}): Promise<{ path: string; feature: AgentFeature; config: JsonObject }> {
  const feature = resolveAgentFeature(featureName);
  const configPath = resolveAgentFeaturesConfigPath(options);
  const config = await readAgentFeaturesConfigFile(configPath);
  setPath(config, feature.path, enabled);
  if (feature.id === 'tool-activity') {
    const currentVisibility = normalizeToolActivityVisibility(getPath(config, ['status', 'toolActivity', 'visibility']));
    setPath(config, ['status', 'toolActivity', 'visibility'], enabled ? (currentVisibility && currentVisibility !== 'off' ? currentVisibility : 'names') : 'off');
  }
  await writeJSON(configPath, config);
  return { path: configPath, feature, config };
}

export function resolveAgentFeature(name: string): AgentFeature {
  const normalized = normalizeFeatureName(name);
  const feature = AGENT_FEATURES_BOOLEAN_FEATURES.find((entry) => entry.id === normalized || entry.aliases.map(normalizeFeatureName).includes(normalized));
  if (!feature) throw new Error(`unknown Agent Tick feature: ${name}. Expected one of: ${AGENT_FEATURES_BOOLEAN_FEATURES.map((entry) => entry.id).join(', ')}`);
  return feature;
}

export function getPath(root: JsonObject, pathParts: string[]): unknown {
  let current: unknown = root;
  for (const part of pathParts) {
    if (!isPlainObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

export function setPath(root: JsonObject, pathParts: string[], value: unknown): void {
  let current: JsonObject = root;
  for (const part of pathParts.slice(0, -1)) {
    const next = current[part];
    if (!isPlainObject(next)) {
      const created: JsonObject = {};
      current[part] = created;
      current = created;
    } else {
      current = next;
    }
  }
  const last = pathParts[pathParts.length - 1];
  if (!last) throw new Error('cannot set empty config path');
  current[last] = value;
}

export function featureSummary(config: JsonObject): Array<{ feature: AgentFeature; enabled: boolean }> {
  return AGENT_FEATURES_BOOLEAN_FEATURES.map((feature) => ({
    feature,
    enabled: feature.id === 'tool-activity'
      ? Boolean(getPath(config, feature.path) ?? feature.defaultValue) || (normalizeToolActivityVisibility(getPath(config, ['status', 'toolActivity', 'visibility'])) ?? 'off') !== 'off'
      : Boolean(getPath(config, feature.path) ?? feature.defaultValue)
  }));
}

export function parseToggleValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on', 'enable', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off', 'disable', 'disabled'].includes(normalized)) return false;
  throw new Error(`expected on/off, enable/disable, true/false, or yes/no; got ${value}`);
}

function normalizeFeatureName(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-');
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepClone(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function deepMerge(base: JsonObject, override: JsonObject): JsonObject {
  const result: JsonObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return result;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJSON(filePath: string, value: JsonObject): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
