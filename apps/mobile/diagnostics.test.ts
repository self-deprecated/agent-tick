import AsyncStorage from "@react-native-async-storage/async-storage";

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

type DiagnosticsModule = typeof import("./diagnostics");

async function loadDiagnostics(enabled = false): Promise<DiagnosticsModule> {
  jest.resetModules();
  const diagnostics = require("./diagnostics") as DiagnosticsModule;
  await AsyncStorage.clear();
  await diagnostics.initializeDiagnostics();
  if (enabled) await diagnostics.setDiagnosticsEnabled(true);
  return diagnostics;
}

describe("mobile diagnostics buffering", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it("buffers info diagnostics before diagnostics are enabled", async () => {
    const diagnostics = await loadDiagnostics(false);

    diagnostics.recordDiagnostic("info", "navigation", "screen_changed");
    await flushPromises();

    expect(diagnostics.diagnosticEvents()).toEqual([expect.objectContaining({ level: "info", area: "navigation", message: "screen_changed" })]);
  });

  it("keeps warn diagnostics before diagnostics are enabled", async () => {
    const diagnostics = await loadDiagnostics(false);

    diagnostics.recordDiagnostic("warn", "requests", "load_failed", { message: "offline" });

    expect(diagnostics.diagnosticEvents()).toHaveLength(1);
  });

  it("does not sync buffered diagnostics until diagnostics are enabled", async () => {
    const diagnostics = await loadDiagnostics(false);
    const client = { sendMobileDiagnostics: jest.fn(async () => ({ accepted: 1 })) };
    const snapshot = {
      serverURL: "https://app.agenttick.sh",
      connectionStatus: "connected" as const,
      pushStatus: "idle" as const,
      notificationStatus: "granted" as const,
    };

    diagnostics.recordDiagnostic("info", "auth_state", "clerk_bound_render");
    await expect(diagnostics.flushDiagnostics(client as any, snapshot)).resolves.toBe(0);
    expect(client.sendMobileDiagnostics).not.toHaveBeenCalled();
    expect(diagnostics.diagnosticEvents()).toHaveLength(1);

    await diagnostics.setDiagnosticsEnabled(true);
    await expect(diagnostics.flushDiagnostics(client as any, snapshot)).resolves.toBe(1);
    expect(client.sendMobileDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      events: [expect.objectContaining({ area: "auth_state", message: "clerk_bound_render" })],
    }));
  });

  it("suppresses repeated diagnostics in a short window", async () => {
    const diagnostics = await loadDiagnostics(true);

    diagnostics.recordDiagnostic("warn", "billing", "personal_billing_load_failed", { message: "Authentication required" });
    diagnostics.recordDiagnostic("warn", "billing", "personal_billing_load_failed", { message: "Authentication required" });
    diagnostics.recordDiagnostic("info", "requests", "loaded", { requestCount: 0, pendingRequestCount: 0, connectionCount: 0 });
    diagnostics.recordDiagnostic("info", "requests", "loaded", { requestCount: 0, pendingRequestCount: 0, connectionCount: 0 });

    expect(diagnostics.diagnosticEvents().map((event) => `${event.area}:${event.message}`)).toEqual([
      "billing:personal_billing_load_failed",
      "requests:loaded",
    ]);
  });

  it("allows repeated diagnostics after the suppress window expires", async () => {
    const diagnostics = await loadDiagnostics(true);
    const now = jest.spyOn(Date, "now");
    now.mockReturnValue(1_000);
    diagnostics.recordDiagnostic("warn", "billing", "personal_billing_load_failed", { message: "Authentication required" });
    now.mockReturnValue(31_001);
    diagnostics.recordDiagnostic("warn", "billing", "personal_billing_load_failed", { message: "Authentication required" });

    expect(diagnostics.diagnosticEvents()).toHaveLength(2);
  });

  it("does not suppress diagnostics with different metadata", async () => {
    const diagnostics = await loadDiagnostics(true);

    diagnostics.recordDiagnostic("warn", "runtime", "fetch_failed", { url: "/first" });
    diagnostics.recordDiagnostic("warn", "runtime", "fetch_failed", { url: "/second" });

    expect(diagnostics.diagnosticEvents().map((event) => event.metadata?.url)).toEqual(["/first", "/second"]);
  });

  it("dedupes equivalent metadata regardless of key order", async () => {
    const diagnostics = await loadDiagnostics(true);

    diagnostics.recordDiagnostic("warn", "runtime", "fetch_failed", { a: 1, b: 2 });
    diagnostics.recordDiagnostic("warn", "runtime", "fetch_failed", { b: 2, a: 1 });

    expect(diagnostics.diagnosticEvents()).toHaveLength(1);
  });

  it("does not throw for non-json-safe array metadata", async () => {
    const diagnostics = await loadDiagnostics(true);

    expect(() => diagnostics.recordDiagnostic("warn", "runtime", "odd_metadata", { values: [1n, Symbol("s"), () => undefined, "ok"] })).not.toThrow();
    expect(diagnostics.diagnosticEvents()[0]?.metadata?.values).toEqual(["1", "ok"]);
  });

  it("caps diagnostic dedupe keys", async () => {
    const diagnostics = await loadDiagnostics(true);
    const now = jest.spyOn(Date, "now");
    now.mockReturnValue(1_000);
    for (let index = 0; index < 502; index += 1) {
      diagnostics.recordDiagnostic("warn", "runtime", "unique", { index });
    }
    diagnostics.recordDiagnostic("warn", "runtime", "unique", { index: 0 });

    expect(diagnostics.diagnosticEvents().filter((event) => event.metadata?.index === 0)).toHaveLength(2);
  });

  it("isolates diagnostics module state between tests", async () => {
    const diagnostics = await loadDiagnostics(false);

    expect(diagnostics.diagnosticEvents()).toEqual([]);
  });

  it("tries connected account clients when sending manual snapshots", async () => {
    const diagnostics = await loadDiagnostics(false);
    const failingClient = { sendMobileDiagnostics: jest.fn(async () => { throw new Error("unauthorized"); }) };
    const workingClient = { sendMobileDiagnostics: jest.fn(async () => ({ accepted: 1 })) };

    await expect(diagnostics.sendDiagnosticSnapshotWithClients([failingClient, workingClient], {
      serverURL: "https://app.agenttick.sh",
      connectionStatus: "connected",
      pushStatus: "idle",
      notificationStatus: "granted",
    })).resolves.toBe(1);

    expect(failingClient.sendMobileDiagnostics).toHaveBeenCalled();
    expect(workingClient.sendMobileDiagnostics).toHaveBeenCalled();
  });

  it("includes current context in manual snapshots", async () => {
    const diagnostics = await loadDiagnostics(false);
    diagnostics.setDiagnosticContext({ currentScreen: "settings" });
    const client = { sendMobileDiagnostics: jest.fn(async () => ({ accepted: 1 })) };

    await diagnostics.sendDiagnosticSnapshot(client as any, {
      serverURL: "https://app.agenttick.sh",
      connectionStatus: "connected",
      pushStatus: "idle",
      notificationStatus: "granted",
    });

    expect(client.sendMobileDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      events: expect.arrayContaining([
        expect.objectContaining({ area: "diagnostics", metadata: expect.objectContaining({ currentScreen: "settings" }) }),
      ]),
    }));
  });
});
