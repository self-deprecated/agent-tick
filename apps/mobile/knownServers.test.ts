import AsyncStorage from "@react-native-async-storage/async-storage";

import { hostedServerURL } from "./mobileAuth";
import {
  hostedKnownServer,
  hostedKnownServerLabel,
  isHostedServerURL,
  isKnownInsecureServer,
  knownServerAuthProviderBadge,
  knownServerLabel,
  knownServersStorageKey,
  loadKnownServers,
  normalizeKnownServers,
  recordKnownServer,
  removeKnownServer,
  saveKnownServers,
} from "./knownServers";

describe("known servers storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("always pins the hosted agenttick.sh server first", () => {
    expect(normalizeKnownServers(null)).toEqual([{ url: hostedServerURL, label: hostedKnownServerLabel() }]);
  });

  it("keeps the hosted server pinned and sorts self-hosted servers by last use", () => {
    const normalized = normalizeKnownServers([
      { url: "https://dev.example.com/", authProvider: "clerk", lastUsedAt: "2026-01-01T00:00:00.000Z" },
      { url: "https://tick.example.com", authProvider: "local", lastUsedAt: "2026-06-01T00:00:00.000Z" },
      { url: hostedServerURL, authProvider: "clerk" },
    ]);

    expect(normalized[0]).toEqual(hostedKnownServer());
    expect(normalized[1]?.url).toBe("https://tick.example.com");
    expect(normalized[2]?.url).toBe("https://dev.example.com");
  });

  it("de-duplicates servers that normalize to the same URL and ignores junk", () => {
    const normalized = normalizeKnownServers([
      { url: "https://dev.example.com", authProvider: "clerk", lastUsedAt: "2026-06-01T00:00:00.000Z" },
      { url: "https://dev.example.com/" },
      "not-an-object",
      { url: 42 },
      { authProvider: "clerk" },
    ]);

    // First-seen entry wins on duplicates; junk and partial entries are dropped.
    expect(normalized.map((server) => server.url)).toEqual([hostedServerURL, "https://dev.example.com"]);
    expect(normalized[1]?.authProvider).toBe("clerk");
  });

  it("records a new server, bumps lastUsedAt, and persists", async () => {
    const next = await recordKnownServer("https://dev.example.com/", { authProvider: "clerk" });

    expect(next.map((server) => server.url)).toEqual([hostedServerURL, "https://dev.example.com"]);
    expect(next[1]?.authProvider).toBe("clerk");
    expect(next[1]?.lastUsedAt).toBeTruthy();

    const stored = await AsyncStorage.getItem(knownServersStorageKey);
    expect(stored).toContain("https://dev.example.com");
  });

  it("preserves an existing authProvider when re-recording without one", async () => {
    await recordKnownServer("https://dev.example.com", { authProvider: "clerk" });
    const next = await recordKnownServer("https://dev.example.com");

    expect(next.find((server) => server.url === "https://dev.example.com")?.authProvider).toBe("clerk");
  });

  it("removes a remembered self-hosted server but never the hosted entry", async () => {
    await recordKnownServer("https://dev.example.com", { authProvider: "clerk" });
    await recordKnownServer("https://tick.example.com", { authProvider: "local" });

    const afterRemoval = await removeKnownServer("https://dev.example.com");
    expect(afterRemoval.map((server) => server.url)).toEqual([hostedServerURL, "https://tick.example.com"]);

    const hostedIntact = await removeKnownServer(hostedServerURL);
    expect(hostedIntact[0]).toEqual(hostedKnownServer());
  });

  it("round-trips through save and load", async () => {
    await saveKnownServers([{ url: "https://dev.example.com", authProvider: "clerk", lastUsedAt: "2026-06-01T00:00:00.000Z" }]);
    const loaded = await loadKnownServers();
    expect(loaded.map((server) => server.url)).toEqual([hostedServerURL, "https://dev.example.com"]);
  });

  it("treats corrupt storage as an empty list with only the hosted server", async () => {
    await AsyncStorage.setItem(knownServersStorageKey, "{not json");
    await expect(loadKnownServers()).resolves.toEqual([hostedKnownServer()]);
  });

  it("preserves an insecure-confirmation flag when re-recording a server", async () => {
    await recordKnownServer("http://dev.example.com", { authProvider: "local", insecureConfirmed: true });

    expect(await isKnownInsecureServer("http://dev.example.com")).toBe(true);
    expect(await isKnownInsecureServer("https://dev.example.com")).toBe(false);

    // Re-recording without the flag must not erase an existing confirmation
    // (sign-in re-records with only authProvider, so the upsert preserves it).
    const rerecorded = await recordKnownServer("http://dev.example.com");
    expect(rerecorded.find((server) => server.url === "http://dev.example.com")?.insecureConfirmed).toBe(true);
  });

  it("labels hosted and self-hosted servers readably", () => {
    expect(knownServerLabel({ url: hostedServerURL })).toBe(hostedKnownServerLabel());
    expect(knownServerLabel({ url: "https://dev.example.com" })).toBe("dev.example.com");
    expect(knownServerLabel({ url: "https://dev.example.com", label: "Dev box" })).toBe("Dev box");
  });

  it("reports auth badges and hosted detection", () => {
    expect(knownServerAuthProviderBadge({ url: "https://dev.example.com", authProvider: "clerk" })).toBe("Clerk sign-in");
    expect(knownServerAuthProviderBadge({ url: "https://tick.example.com", authProvider: "local" })).toBe("Token / pairing");
    expect(knownServerAuthProviderBadge({ url: "https://tick.example.com" })).toBeNull();
    expect(isHostedServerURL("https://app.agenttick.sh/")).toBe(true);
    expect(isHostedServerURL("https://dev.example.com")).toBe(false);
  });
});
