import { clerkTokenCacheKey, fetchRuntimeAuthConfig, normalizeServerURL } from "./mobileAuth";

describe("mobile auth config", () => {
  it("normalizes server URLs", () => {
    expect(normalizeServerURL(" https://tick.example.com/// ")).toBe("https://tick.example.com");
    expect(normalizeServerURL(" ")).toBe("http://localhost:8787");
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
