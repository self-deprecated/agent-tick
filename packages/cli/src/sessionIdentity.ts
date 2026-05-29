import process from 'node:process';

export type AgentTickEnv = Record<string, string | undefined>;

export function resolveAgentTickSessionId(input: { explicitSessionId?: string | undefined; env?: AgentTickEnv | undefined } = {}): string | undefined {
  const env = input.env ?? process.env;
  const explicit = input.explicitSessionId?.trim();
  if (explicit) return explicit;
  const envOverride = env.AGENT_TICK_SESSION_ID?.trim();
  if (envOverride) return envOverride;
  return knownHostSessionId(env);
}

function knownHostSessionId(env: AgentTickEnv): string | undefined {
  return namespacedHostSessionId('codex', env.CODEX_THREAD_ID);
}

export function namespacedHostSessionId(namespace: string, value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const sanitized = trimmed.replace(/[^A-Za-z0-9._:-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 160);
  return sanitized ? `${namespace}_${sanitized}` : undefined;
}

export function claudeHookSessionId(input: unknown): string | undefined {
  if (!isPlainObject(input)) return undefined;
  return namespacedHostSessionId('claude', optionalString(input.session_id));
}

export function sessionFieldsFromOptions(options: { session?: string; sessionTitle?: string }, env: AgentTickEnv = process.env): { sessionId?: string; session?: { title: string } } {
  return sessionFields(resolveAgentTickSessionId({ explicitSessionId: options.session, env }), sessionMetadataFromOptions(options, env));
}

export function sessionFieldsFromMcpArgs(args: Record<string, unknown>, env: AgentTickEnv = process.env): { sessionId?: string; session?: { title: string } } {
  return sessionFields(resolveAgentTickSessionId({ explicitSessionId: optionalString(args.sessionId), env }), sessionMetadataFromMcpArgs(args, env));
}

function sessionFields(sessionId: string | undefined, session: { title: string } | undefined): { sessionId?: string; session?: { title: string } } {
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(session ? { session } : {})
  };
}

function sessionMetadataFromOptions(options: { sessionTitle?: string }, env: AgentTickEnv): { title: string } | undefined {
  const title = options.sessionTitle?.trim() || env.AGENT_TICK_SESSION_TITLE?.trim();
  return title ? { title } : undefined;
}

function sessionMetadataFromMcpArgs(args: Record<string, unknown>, env: AgentTickEnv): { title: string } | undefined {
  const title = optionalString(args.sessionTitle) ?? env.AGENT_TICK_SESSION_TITLE?.trim();
  return title ? { title } : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
