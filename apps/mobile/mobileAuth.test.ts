import { agentTickHostedServerURL, clerkTokenCacheKey, fetchRuntimeAuthConfig, hostedServerURL, mobileAccountSessionTokenKey, mobileSessionStorageKeyList, mobileSessionStorageKeys, normalizeSavedMobileAccounts, normalizeServerURL, savedMobileAccountID, upsertSavedMobileAccount } from "./mobileAuth";

describe("mobile auth config", () => {
  it("normalizes server URLs", () => {
    expect(agentTickHostedServerURL).toBe("https://app.agenttick.sh");
    expect(hostedServerURL).toBe("https://app.agenttick.sh");
    expect(normalizeServerURL(" https://tick.example.com/// ")).toBe("https://tick.example.com");
    expect(normalizeServerURL(" ")).toBe(hostedServerURL);
  });

  it("namespaces mobile session state by normalized server URL", () => {
    expect(mobileSessionStorageKeys("https://tick.example.com/")).toEqual({
      token: "agent-tick.session.https%3A%2F%2Ftick.example.com.token",
      deviceID: "agent-tick.session.https%3A%2F%2Ftick.example.com.deviceID",
      workspaceID: "agent-tick.session.https%3A%2F%2Ftick.example.com.workspaceID",
      pushStatus: "agent-tick.session.https%3A%2F%2Ftick.example.com.pushStatus",
      notificationsEnabled: "agent-tick.session.https%3A%2F%2Ftick.example.com.notificationsEnabled",
    });
    expect(mobileSessionStorageKeyList("https://tick.example.com/")).toEqual([
      "agent-tick.session.https%3A%2F%2Ftick.example.com.token",
      "agent-tick.session.https%3A%2F%2Ftick.example.com.deviceID",
      "agent-tick.session.https%3A%2F%2Ftick.example.com.workspaceID",
      "agent-tick.session.https%3A%2F%2Ftick.example.com.pushStatus",
      "agent-tick.session.https%3A%2F%2Ftick.example.com.notificationsEnabled",
    ]);
  });

  it("tracks saved mobile accounts without storing bearer tokens", () => {
    const first = upsertSavedMobileAccount([], {
      serverURL: "https://tick.example.com/",
      authProvider: "local",
      deviceID: "dev_1",
      label: "Example device",
      updatedAt: "2026-05-10T00:00:00.000Z",
    });
    const second = upsertSavedMobileAccount(first, {
      serverURL: "https://app.agenttick.sh",
      authProvider: "clerk",
      userID: "usr_1",
      email: "ada@example.com",
      workspaceID: "org_1",
      label: "GitHub account",
      updatedAt: "2026-05-10T00:01:00.000Z",
    });

    expect(first[0]?.id).toBe(savedMobileAccountID({ serverURL: "https://tick.example.com", authProvider: "local", deviceID: "dev_1" }));
    expect(second[0]?.id).toBe(savedMobileAccountID({ serverURL: "https://app.agenttick.sh", authProvider: "clerk", userID: "usr_1" }));
    expect(JSON.stringify(second)).not.toContain("agent_");
    expect(normalizeSavedMobileAccounts(JSON.parse(JSON.stringify(second))).map((account) => account.label)).toEqual(["GitHub account", "Example device"]);
  });

  it("deduplicates legacy workspace-scoped hosted accounts by user", () => {
    const legacy = normalizeSavedMobileAccounts([
      {
        id: savedMobileAccountID({ serverURL: "https://app.agenttick.sh", authProvider: "clerk", workspaceID: "org_1" }),
        serverURL: "https://app.agenttick.sh",
        authProvider: "clerk",
        workspaceID: "org_1",
        label: "Platform",
        updatedAt: "2026-05-10T00:00:00.000Z",
      },
    ]);

    const next = upsertSavedMobileAccount(legacy, {
      serverURL: "https://app.agenttick.sh",
      authProvider: "clerk",
      userID: "usr_1",
      email: "ada@example.com",
      signInMethod: "GitHub",
      label: "GitHub account",
    });

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ userID: "usr_1", email: "ada@example.com", signInMethod: "GitHub" });
    expect(next[0]?.workspaceID).toBeUndefined();
  });

  it("namespaces saved Agent Tick account session tokens by account ID", () => {
    expect(mobileAccountSessionTokenKey("clerk:https://app.agenttick.sh:usr_1")).toBe(
      "agent-tick.mobileAccountSession.clerk%3Ahttps%3A%2F%2Fapp.agenttick.sh%3Ausr_1",
    );
  });

  it("namespaces Clerk token cache by server and publishable key", () => {
    expect(clerkTokenCacheKey("https://tick.example.com/", "pk_test_123")).toBe(
      "agent-tick.clerk.https://tick.example.com.pk_test_123",
    );
  });

  it("fetches runtime auth config", async () => {
    const config = await fetchRuntimeAuthConfig("https://tick.example.com/", async (url) => {
      expect(String(url)).toBe("https://tick.example.com/v1/auth/config");
      return new Response(
        JSON.stringify({
          mode: "clerk",
          authProvider: "clerk",
          publicURL: "https://tick.example.com",
          clerkPublishableKey: "pk_test_123",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    expect(config).toEqual({
      mode: "clerk",
      authProvider: "clerk",
      publicURL: "https://tick.example.com",
      clerkPublishableKey: "pk_test_123",
    });
  });
});
