import { agentTickHostedServerURL, clerkTokenCacheKey, coerceServerURLInput, fetchRuntimeAuthConfig, hostedServerURL, httpVariantOf, isInsecureServerURL, mobileSessionStorageKeyList, mobileSessionStorageKeys, normalizeSavedMobileAccounts, normalizeServerURL, savedMobileAccountID, serverURLPolicyError, upsertSavedMobileAccount, upsertSavedMobileAccountIfChanged } from "./mobileAuth";

describe("mobile auth config", () => {
  it("normalizes server URLs", () => {
    expect(agentTickHostedServerURL).toBe("https://app.agenttick.sh");
    expect(hostedServerURL).toBe("https://app.agenttick.sh");
    expect(normalizeServerURL(" https://tick.example.com/// ")).toBe("https://tick.example.com");
    expect(normalizeServerURL(" ")).toBe(hostedServerURL);
  });

  it("coerces bare hostnames to https and loopback to http", () => {
    expect(coerceServerURLInput("")).toBe("");
    expect(coerceServerURLInput("   ")).toBe("");
    expect(coerceServerURLInput("dev.example.com")).toBe("https://dev.example.com");
    expect(coerceServerURLInput("dev.example.com/")).toBe("https://dev.example.com/");
    expect(coerceServerURLInput("dev.example.com:8443")).toBe("https://dev.example.com:8443");
    expect(coerceServerURLInput("https://dev.example.com")).toBe("https://dev.example.com");
    expect(coerceServerURLInput("http://localhost:8787")).toBe("http://localhost:8787");
    expect(coerceServerURLInput("localhost:8787")).toBe("http://localhost:8787");
    expect(coerceServerURLInput("localhost")).toBe("http://localhost");
    expect(coerceServerURLInput("127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(coerceServerURLInput("[::1]:8787")).toBe("http://[::1]:8787");
  });

  it("namespaces mobile session state by normalized server URL", () => {
    expect(mobileSessionStorageKeys("https://tick.example.com/")).toEqual({
      token: "agent-tick.session.https_3a__2f__2f_tick.example.com.token",
      deviceID: "agent-tick.session.https_3a__2f__2f_tick.example.com.deviceID",
      workspaceID: "agent-tick.session.https_3a__2f__2f_tick.example.com.workspaceID",
      pushStatus: "agent-tick.session.https_3a__2f__2f_tick.example.com.pushStatus",
      notificationsEnabled: "agent-tick.session.https_3a__2f__2f_tick.example.com.notificationsEnabled",
    });
    expect(mobileSessionStorageKeyList("https://tick.example.com/")).toEqual([
      "agent-tick.session.https_3a__2f__2f_tick.example.com.token",
      "agent-tick.session.https_3a__2f__2f_tick.example.com.deviceID",
      "agent-tick.session.https_3a__2f__2f_tick.example.com.workspaceID",
      "agent-tick.session.https_3a__2f__2f_tick.example.com.pushStatus",
      "agent-tick.session.https_3a__2f__2f_tick.example.com.notificationsEnabled",
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
      clerkSessionID: "sess_1",
      workspaceID: "org_1",
      label: "GitHub account",
      updatedAt: "2026-05-10T00:01:00.000Z",
    });

    expect(first[0]?.id).toBe(savedMobileAccountID({ serverURL: "https://tick.example.com", authProvider: "local", deviceID: "dev_1" }));
    expect(second[0]?.id).toBe(savedMobileAccountID({ serverURL: "https://app.agenttick.sh", authProvider: "clerk", userID: "usr_1", clerkSessionID: "sess_1" }));
    expect(JSON.stringify(second)).not.toContain("agent_");
    expect(normalizeSavedMobileAccounts(JSON.parse(JSON.stringify(second)))[0]).toMatchObject({ label: "GitHub account", clerkSessionID: "sess_1" });
    expect(normalizeSavedMobileAccounts(JSON.parse(JSON.stringify(second))).map((account) => account.label)).toEqual(["GitHub account", "Example device"]);
  });

  it("does not churn unchanged saved hosted accounts", () => {
    const first = upsertSavedMobileAccount([], {
      serverURL: "https://app.agenttick.sh",
      authProvider: "clerk",
      userID: "usr_1",
      email: "ada@example.com",
      clerkSessionID: "sess_1",
      signInMethod: "Apple",
      label: "Apple account",
      workspaces: [{ id: "wsp_1", name: "Personal", role: "owner" }],
      updatedAt: "2026-05-10T00:00:00.000Z",
    });

    const unchanged = upsertSavedMobileAccountIfChanged(first, {
      serverURL: "https://app.agenttick.sh/",
      authProvider: "clerk",
      userID: "usr_1",
      email: "ada@example.com",
      clerkSessionID: "sess_1",
      signInMethod: "Apple",
      label: "Apple account",
      workspaces: [{ id: "wsp_1", name: "Personal", role: "owner" }],
    });
    const changed = upsertSavedMobileAccountIfChanged(first, {
      serverURL: "https://app.agenttick.sh",
      authProvider: "clerk",
      userID: "usr_1",
      email: "ada@example.com",
      clerkSessionID: "sess_1",
      signInMethod: "Apple",
      label: "Apple account",
      workspaces: [{ id: "wsp_2", name: "Team", role: "admin" }],
    });

    expect(unchanged).toBe(first);
    expect(changed).not.toBe(first);
    expect(changed[0]?.workspaces).toEqual([{ id: "wsp_2", name: "Team", role: "admin" }]);
  });

  it("keeps simultaneous Clerk sessions distinct even when profile details match", () => {
    const first = upsertSavedMobileAccount([], {
      serverURL: "https://app.agenttick.sh",
      authProvider: "clerk",
      userID: "usr_1",
      email: "ada@example.com",
      clerkSessionID: "sess_github",
      signInMethod: "GitHub",
      label: "GitHub account",
    });
    const second = upsertSavedMobileAccount(first, {
      serverURL: "https://app.agenttick.sh",
      authProvider: "clerk",
      userID: "usr_1",
      email: "ada@example.com",
      clerkSessionID: "sess_apple",
      signInMethod: "Apple",
      label: "Apple account",
    });

    expect(second).toHaveLength(2);
    expect(second.map((account) => account.clerkSessionID)).toEqual(["sess_apple", "sess_github"]);
  });

  it("namespaces Clerk token cache by server and publishable key", () => {
    expect(clerkTokenCacheKey("https://tick.example.com/", "pk_test_123")).toBe(
      "agent-tick.clerk.https_3a__2f__2f_tick.example.com.pk_5f_test_5f_123",
    );
    expect(clerkTokenCacheKey("https://tick.example.com/", "pk_test_123")).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("enforces HTTPS server URLs for non-loopback production self-hosted connections", async () => {
    expect(serverURLPolicyError("https://tick.example.com")).toBeNull();
    expect(serverURLPolicyError("http://tick.example.com")).toBe("Agent Tick server URLs must use HTTPS in production builds.");
    expect(serverURLPolicyError("http://localhost:8787")).toBeNull();
    expect(serverURLPolicyError("http://127.0.0.1:8787")).toBeNull();
    expect(serverURLPolicyError("not a url")).toBe("Enter a valid Agent Tick server URL.");
  });

  it("allows a non-loopback http URL only with an explicit insecure confirmation", () => {
    expect(serverURLPolicyError("http://tick.example.com", { allowInsecure: false })).toBe("Agent Tick server URLs must use HTTPS in production builds.");
    expect(serverURLPolicyError("http://tick.example.com", { allowInsecure: true })).toBeNull();
    // Loopback is always allowed regardless of the insecure flag.
    expect(serverURLPolicyError("http://localhost:8787", { allowInsecure: false })).toBeNull();
  });

  it("derives the http fallback variant and flags insecure urls", () => {
    expect(httpVariantOf("https://dev.example.com")).toBe("http://dev.example.com");
    expect(httpVariantOf("https://dev.example.com:8443/path")).toBe("http://dev.example.com:8443/path");
    expect(httpVariantOf("http://localhost:8787")).toBeNull();
    expect(httpVariantOf("http://dev.example.com")).toBeNull();
    expect(httpVariantOf("not a url")).toBeNull();

    expect(isInsecureServerURL("http://dev.example.com")).toBe(true);
    expect(isInsecureServerURL("https://dev.example.com")).toBe(false);
    expect(isInsecureServerURL("http://localhost:8787")).toBe(false);
    expect(isInsecureServerURL("http://127.0.0.1:8787")).toBe(false);
    expect(isInsecureServerURL("not a url")).toBe(false);
  });

  it("does not fetch runtime auth config for production HTTP URLs", async () => {
    const fetchImpl = jest.fn();

    await expect(fetchRuntimeAuthConfig("http://tick.example.com", fetchImpl)).rejects.toThrow("Agent Tick server URLs must use HTTPS in production builds.");

    expect(fetchImpl).not.toHaveBeenCalled();
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
          mobile: { minimumSupportedVersion: "0.2.0", updateURL: "https://apps.apple.com/app/id123" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    expect(config).toEqual({
      mode: "clerk",
      authProvider: "clerk",
      publicURL: "https://tick.example.com",
      clerkPublishableKey: "pk_test_123",
      mobile: { minimumSupportedVersion: "0.2.0", updateURL: "https://apps.apple.com/app/id123" },
    });
  });
});
