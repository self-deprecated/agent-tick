import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AgentTickClient } from "@agent-tick/sdk";
import type { ConnectionStatus, NotificationStatus, PushStatus } from "./SettingsScreen";

export type DiagnosticLevel = "info" | "warn" | "error";

export type DiagnosticEvent = {
  level: DiagnosticLevel;
  area: string;
  message: string;
  at: string;
  metadata?: Record<string, unknown>;
};

export type DiagnosticSnapshot = {
  appVersion?: string;
  platform?: string;
  deviceModel?: string;
  serverURL: string;
  authMode?: string;
  connectionStatus: ConnectionStatus;
  pushStatus: PushStatus;
  notificationStatus: NotificationStatus;
  currentScreen?: string;
  lastErrorMessage?: string;
};

export const diagnosticsEnabledStorageKey = "agent-tick.diagnostics.enabled";
export const diagnosticsBufferStorageKey = "agent-tick.diagnostics.buffer";

const maxBufferedEvents = 100;
let enabled = false;
let buffer: DiagnosticEvent[] = [];
let initialized = false;
let globalHandlersInstalled = false;

export async function initializeDiagnostics(): Promise<boolean> {
  if (initialized) return enabled;
  initialized = true;
  enabled = (await AsyncStorage.getItem(diagnosticsEnabledStorageKey)) === "1";
  buffer = parseEvents(await AsyncStorage.getItem(diagnosticsBufferStorageKey));
  installGlobalDiagnosticsHandlers();
  return enabled;
}

export function diagnosticsEnabled(): boolean {
  return enabled;
}

export async function setDiagnosticsEnabled(next: boolean): Promise<void> {
  enabled = next;
  await AsyncStorage.setItem(diagnosticsEnabledStorageKey, next ? "1" : "0");
}

export function diagnosticEvents(): DiagnosticEvent[] {
  return [...buffer];
}

export function recordDiagnostic(level: DiagnosticLevel, area: string, message: string, metadata?: Record<string, unknown>): void {
  const event: DiagnosticEvent = {
    level,
    area: sanitizeText(area, 80),
    message: sanitizeText(message, 200),
    at: new Date().toISOString(),
    ...(metadata ? { metadata: sanitizeMetadata(metadata) } : {}),
  };
  buffer = [...buffer, event].slice(-maxBufferedEvents);
  void persistBuffer();
}

export async function flushDiagnostics(client: AgentTickClient, snapshot: DiagnosticSnapshot): Promise<number> {
  if (!enabled || buffer.length === 0) return 0;
  const events = [...buffer];
  const response = await client.sendMobileDiagnostics({
    ...snapshot,
    events,
  });
  buffer = buffer.slice(events.length);
  await persistBuffer();
  return response.accepted;
}

export async function sendDiagnosticSnapshot(client: AgentTickClient, snapshot: DiagnosticSnapshot): Promise<number> {
  const snapshotEvent: DiagnosticEvent = {
    level: "info",
    area: "diagnostics",
    message: "manual_snapshot",
    at: new Date().toISOString(),
  };
  const events = [...buffer, snapshotEvent].slice(-maxBufferedEvents);
  const response = await client.sendMobileDiagnostics({
    ...snapshot,
    events,
  });
  buffer = [];
  await persistBuffer();
  return response.accepted;
}

function installGlobalDiagnosticsHandlers(): void {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;
  const maybeErrorUtils = globalThis as typeof globalThis & {
    ErrorUtils?: {
      getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
      setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
    };
  };
  const previous = maybeErrorUtils.ErrorUtils?.getGlobalHandler?.();
  maybeErrorUtils.ErrorUtils?.setGlobalHandler?.((error, isFatal) => {
    recordDiagnostic("error", "runtime", isFatal ? "fatal_js_error" : "js_error", { message: errorMessage(error) });
    previous?.(error, isFatal);
  });
}

async function persistBuffer(): Promise<void> {
  await AsyncStorage.setItem(diagnosticsBufferStorageKey, JSON.stringify(buffer)).catch(() => undefined);
}

function parseEvents(raw: string | null): DiagnosticEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as DiagnosticEvent[];
    return Array.isArray(parsed) ? parsed.slice(-maxBufferedEvents) : [];
  } catch {
    return [];
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeText(value: string, maxLength: number): string {
  return value.replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [redacted]").replace(/agent_[a-z0-9._-]+/gi, "agent_[redacted]").slice(0, maxLength);
}

function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/token|secret|authorization|cookie/i.test(key)) continue;
    if (typeof value === "string") safe[key] = sanitizeText(value, 300);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) safe[key] = value;
  }
  return safe;
}
