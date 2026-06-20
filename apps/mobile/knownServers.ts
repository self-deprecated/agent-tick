import AsyncStorage from "@react-native-async-storage/async-storage";

import { hostedServerURL, normalizeServerURL, type RuntimeAuthConfig } from "./mobileAuth";

export type KnownServerAuthProvider = RuntimeAuthConfig["authProvider"];

export type KnownServer = {
  url: string;
  authProvider?: KnownServerAuthProvider;
  label?: string;
  lastUsedAt?: string;
  /** Set when the user accepted an insecure (plain-http, non-loopback) connection warning for this server. */
  insecureConfirmed?: boolean;
};

export type RecordKnownServerOptions = {
  authProvider?: KnownServerAuthProvider;
  label?: string;
  insecureConfirmed?: boolean;
};

export const knownServersStorageKey = "agent-tick.knownServers.v1";
const MAX_KNOWN_SERVERS = 12;

export function hostedKnownServerLabel(): string {
  return "agenttick.sh";
}

export function isHostedServerURL(serverURL: string): boolean {
  return normalizeServerURL(serverURL) === hostedServerURL;
}

export function knownServerLabel(server: Pick<KnownServer, "url" | "label">): string {
  if (server.label && server.label.trim()) return server.label;
  if (isHostedServerURL(server.url)) return hostedKnownServerLabel();
  try {
    return new URL(normalizeServerURL(server.url)).host;
  } catch {
    return normalizeServerURL(server.url);
  }
}

export function knownServerAuthProviderBadge(server: KnownServer): string | null {
  if (server.authProvider === "clerk") return "Clerk sign-in";
  if (server.authProvider === "local") return "Token / pairing";
  return null;
}

function isKnownServerAuthProvider(value: unknown): value is KnownServerAuthProvider {
  return value === "clerk" || value === "local";
}

/**
 * Normalizes arbitrary stored data into the canonical known-server list.
 * The hosted agenttick.sh server is always pinned first and cannot be removed.
 * Self-hosted servers are de-duplicated by normalized URL and sorted so the
 * most recently used entries stay near the top.
 */
export function normalizeKnownServers(value: unknown): KnownServer[] {
  const hosted = hostedKnownServer();
  if (!Array.isArray(value)) return [hosted];

  const seen = new Set<string>();
  const rest: KnownServer[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Partial<KnownServer>;
    const url = typeof record.url === "string" ? normalizeServerURL(record.url) : "";
    if (!url || isHostedServerURL(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    const authProvider = isKnownServerAuthProvider(record.authProvider) ? record.authProvider : undefined;
    const label = typeof record.label === "string" && record.label.trim() ? record.label : undefined;
    const lastUsedAt = typeof record.lastUsedAt === "string" && record.lastUsedAt ? record.lastUsedAt : undefined;
    const insecureConfirmed = record.insecureConfirmed === true ? true : undefined;
    rest.push({
      url,
      ...(authProvider ? { authProvider } : {}),
      ...(label ? { label } : {}),
      ...(lastUsedAt ? { lastUsedAt } : {}),
      ...(insecureConfirmed ? { insecureConfirmed } : {}),
    });
  }

  rest.sort((a, b) => (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? ""));
  return [hosted, ...rest].slice(0, MAX_KNOWN_SERVERS);
}

export function hostedKnownServer(): KnownServer {
  return { url: hostedServerURL, label: hostedKnownServerLabel() };
}

export async function loadKnownServers(): Promise<KnownServer[]> {
  const stored = await AsyncStorage.getItem(knownServersStorageKey);
  if (!stored) return normalizeKnownServers(null);
  try {
    return normalizeKnownServers(JSON.parse(stored));
  } catch {
    return normalizeKnownServers(null);
  }
}

export async function saveKnownServers(servers: KnownServer[]): Promise<void> {
  await AsyncStorage.setItem(knownServersStorageKey, JSON.stringify(normalizeKnownServers(servers)));
}

/**
 * Adds or refreshes a known server, bumps its `lastUsedAt`, and persists the
 * updated list. An existing remembered `authProvider` is preserved unless the
 * caller supplies a new one. Returns the freshly normalized list.
 */
export async function recordKnownServer(input: string, options: RecordKnownServerOptions = {}): Promise<KnownServer[]> {
  const url = normalizeServerURL(input);
  const now = new Date().toISOString();
  const current = await loadKnownServers();
  const existing = current.find((server) => server.url === url);
  const authProvider = options.authProvider ?? existing?.authProvider;
  const label = options.label ?? existing?.label;
  const insecureConfirmed = options.insecureConfirmed ?? existing?.insecureConfirmed;
  const updated: KnownServer = {
    url,
    lastUsedAt: now,
    ...(authProvider ? { authProvider } : {}),
    ...(label ? { label } : {}),
    ...(insecureConfirmed ? { insecureConfirmed } : {}),
  };
  const merged = [updated, ...current.filter((server) => server.url !== url)];
  const normalized = normalizeKnownServers(merged);
  await saveKnownServers(normalized);
  return normalized;
}

/**
 * Removes a remembered self-hosted server. The hosted agenttick.sh entry is
 * always retained. Returns the freshly normalized list.
 */
export async function removeKnownServer(input: string): Promise<KnownServer[]> {
  const url = normalizeServerURL(input);
  if (isHostedServerURL(url)) return loadKnownServers();
  const current = await loadKnownServers();
  const next = current.filter((server) => server.url !== url);
  const normalized = normalizeKnownServers(next);
  await saveKnownServers(normalized);
  return normalized;
}

/**
 * Resolves whether a URL is a remembered server the user explicitly accepted
 * an insecure (plain-http, non-loopback) connection warning for. Sign-in and
 * bootstrap paths use this to relax the HTTPS policy for trusted dev servers.
 */
export async function isKnownInsecureServer(input: string): Promise<boolean> {
  const url = normalizeServerURL(input);
  const servers = await loadKnownServers();
  return servers.some((server) => server.url === url && server.insecureConfirmed === true);
}
