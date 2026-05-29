import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AgentTickClient } from "@self-deprecated/agent-tick-sdk";
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
  notificationsEnabled?: boolean;
  currentScreen?: string;
  lastErrorMessage?: string;
};

export const diagnosticsEnabledStorageKey = "agent-tick.diagnostics.enabled";
export const diagnosticsBufferStorageKey = "agent-tick.diagnostics.buffer";

const maxBufferedEvents = 1000;
let enabled = false;
let buffer: DiagnosticEvent[] = [];
let initialized = false;
let globalHandlersInstalled = false;
let flushInFlight: Promise<number> | null = null;
let context: Record<string, unknown> = {};
const duplicateSuppressWindowMs = 30_000;
const maxDiagnosticDedupeKeys = 500;
const lastRecordedAtByKey = new Map<string, number>();

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

export function setDiagnosticContext(next: Record<string, unknown>): void {
  context = sanitizeMetadata(next);
}

export function recordDiagnostic(level: DiagnosticLevel, area: string, message: string, metadata?: Record<string, unknown>): void {
  const sanitizedArea = sanitizeText(area, 80);
  const sanitizedMessage = sanitizeText(message, 200);
  const sanitizedMetadata = sanitizeMetadata({ ...context, ...(metadata ?? {}) });
  const dedupeKey = diagnosticDedupeKey(level, sanitizedArea, sanitizedMessage, sanitizedMetadata);
  const nowMs = Date.now();
  pruneDiagnosticDedupeKeys(nowMs);
  const lastRecordedAt = lastRecordedAtByKey.get(dedupeKey);
  if (lastRecordedAt !== undefined && nowMs - lastRecordedAt < duplicateSuppressWindowMs) return;
  lastRecordedAtByKey.set(dedupeKey, nowMs);
  const event: DiagnosticEvent = {
    level,
    area: sanitizedArea,
    message: sanitizedMessage,
    at: new Date(nowMs).toISOString(),
    metadata: sanitizedMetadata,
  };
  buffer = [...buffer, event].slice(-maxBufferedEvents);
  void persistBuffer();
}

export async function flushDiagnostics(client: Pick<AgentTickClient, "sendMobileDiagnostics">, snapshot: DiagnosticSnapshot): Promise<number> {
  if (flushInFlight) return flushInFlight;
  if (!enabled || buffer.length === 0) return 0;
  flushInFlight = flushDiagnosticsNow(client, snapshot).finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

export async function flushDiagnosticsWithClients(clients: Array<Pick<AgentTickClient, "sendMobileDiagnostics">>, snapshot: DiagnosticSnapshot): Promise<number> {
  if (clients.length === 0) throw new Error("Diagnostics require a connected account.");
  let lastError: unknown;
  for (const client of clients) {
    try {
      return await flushDiagnostics(client, snapshot);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Diagnostics could not be sent.");
}

async function flushDiagnosticsNow(client: Pick<AgentTickClient, "sendMobileDiagnostics">, snapshot: DiagnosticSnapshot): Promise<number> {

  let accepted = 0;
  while (buffer.length > 0) {
    const events = buffer.slice(0, 100);
    const response = await client.sendMobileDiagnostics({
      ...snapshot,
      events,
    });
    accepted += response.accepted;
    buffer = buffer.slice(events.length);
    await persistBuffer();
    if (events.length < 100) break;
  }
  return accepted;
}

export async function sendDiagnosticSnapshot(client: Pick<AgentTickClient, "sendMobileDiagnostics">, snapshot: DiagnosticSnapshot): Promise<number> {
  const snapshotEvent: DiagnosticEvent = {
    level: "info",
    area: "diagnostics",
    message: "manual_snapshot",
    at: new Date().toISOString(),
    metadata: sanitizeMetadata(context),
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

export async function sendDiagnosticSnapshotWithClients(clients: Array<Pick<AgentTickClient, "sendMobileDiagnostics">>, snapshot: DiagnosticSnapshot): Promise<number> {
  if (clients.length === 0) throw new Error("Diagnostics require a connected account.");
  let lastError: unknown;
  for (const client of clients) {
    try {
      return await sendDiagnosticSnapshot(client, snapshot);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Diagnostics could not be sent.");
}

function diagnosticDedupeKey(level: DiagnosticLevel, area: string, message: string, metadata: Record<string, unknown>): string {
  return stableStringify({ level, area, message, metadata });
}

function pruneDiagnosticDedupeKeys(nowMs: number): void {
  for (const [key, lastRecordedAt] of lastRecordedAtByKey) {
    if (nowMs - lastRecordedAt >= duplicateSuppressWindowMs) lastRecordedAtByKey.delete(key);
  }
  while (lastRecordedAtByKey.size > maxDiagnosticDedupeKeys) {
    const oldestKey = lastRecordedAtByKey.keys().next().value as string | undefined;
    if (!oldestKey) break;
    lastRecordedAtByKey.delete(oldestKey);
  }
}

function stableStringify(value: unknown, seen = new WeakSet<object>()): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item, seen)).join(",")}]`;
  if (value && typeof value === "object") {
    if (seen.has(value)) return JSON.stringify("[circular]");
    seen.add(value);
    const result = `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, field]) => `${JSON.stringify(key)}:${stableStringify(field, seen)}`)
      .join(",")}}`;
    seen.delete(value);
    return result;
  }
  return JSON.stringify(value);
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
    else if (Array.isArray(value)) safe[key] = value.map(sanitizeMetadataArrayItem).filter((item) => item !== undefined).slice(0, 20);
  }
  return safe;
}

function sanitizeMetadataArrayItem(item: unknown): string | number | boolean | null | undefined {
  if (typeof item === "string") return sanitizeText(item, 120);
  if (typeof item === "number" || typeof item === "boolean" || item === null) return item;
  if (typeof item === "bigint") return item.toString();
  return undefined;
}
