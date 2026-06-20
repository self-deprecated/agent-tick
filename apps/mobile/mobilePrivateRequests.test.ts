import type { DevicePublicKeyRecord, EncryptedRequestPayload } from "@self-deprecated/agent-tick-shared";

jest.mock("./diagnostics", () => ({
  recordDiagnostic: jest.fn(),
}));

const mockNativeCrypto = {
  isAvailableAsync: jest.fn(async () => true),
  ensureKeyPairAsync: jest.fn(async () => ({ algorithm: "p256-ecdh-hkdf-sha256" as const, publicKey: "public-key" })),
  decryptRequestPayloadAsync: jest.fn(async () => JSON.stringify({
    title: "Secret deploy?",
    body: "Ship build 123",
    command: "deploy production",
    choices: [{ id: "approve", label: "Approve production deploy", kind: "approve" }],
  })),
};

import {
  decryptMobileRequest,
  decryptMobileSessionDetail,
  decryptMobileStatusUpdate,
  decryptMobileToolActivity,
  ensurePrivateRequestDeviceKeyRegistered,
  privateRequestInstallationKeyAlias,
  privateRequestLocalInstallKeyStatus,
  setPrivateRequestCryptoModuleForTesting,
} from "./mobilePrivateRequests";
import { recordDiagnostic } from "./diagnostics";
import type { MobileRequest } from "./requests";

const encryptedPayload: EncryptedRequestPayload = {
  version: 1,
  algorithm: "aes-256-gcm",
  nonce: "content-nonce",
  ciphertext: "content-ciphertext",
  tag: "content-tag",
  keyEnvelopes: [{
    deviceKeyId: "devkey_1",
    algorithm: "p256-ecdh-hkdf-sha256+aes-256-gcm",
    ephemeralPublicKey: "ephemeral-public-key",
    nonce: "envelope-nonce",
    ciphertext: "envelope-ciphertext",
    tag: "envelope-tag",
  }],
};

function privateRequest(): MobileRequest {
  return {
    id: "req_1",
    workspaceId: "wsp_default",
    requester: { name: "Pi" },
    requestType: "sanction",
    deliveryKind: "routed_members",
    responsePolicy: "quorum",
    title: "Private Request",
    choices: [{ id: "approve", label: "Approve", kind: "approve" }],
    allowFreeformReply: false,
    contentMode: "private",
    encryptedPayload,
    status: "pending",
    createdAt: "2026-06-12T00:00:00.000Z",
  };
}

function registeredKey(deviceId: string): DevicePublicKeyRecord {
  return {
    deviceKeyId: `devkey_${deviceId}`,
    deviceId,
    userId: "usr_1",
    algorithm: "p256-ecdh-hkdf-sha256",
    publicKey: "public-key",
    publicKeyFingerprint: "fingerprint",
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
  };
}

describe("mobile Private Requests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPrivateRequestCryptoModuleForTesting(mockNativeCrypto);
  });

  it("reports the shared install key status", async () => {
    await expect(privateRequestLocalInstallKeyStatus()).resolves.toMatchObject({
      status: "ready",
      alias: privateRequestInstallationKeyAlias,
      algorithm: "p256-ecdh-hkdf-sha256",
      publicKey: "public-key",
    });
    expect(mockNativeCrypto.ensureKeyPairAsync).toHaveBeenCalledWith(privateRequestInstallationKeyAlias);
  });

  it("reports unsupported crypto for builds without native encryption", async () => {
    setPrivateRequestCryptoModuleForTesting(null);
    await expect(privateRequestLocalInstallKeyStatus()).resolves.toMatchObject({ status: "unsupported" });
  });

  it("registers the same install public key for different remote Approval Devices", async () => {
    const client = {
      listDevicePublicKeys: jest.fn(async () => []),
      registerDevicePublicKey: jest.fn(async (deviceId: string) => registeredKey(deviceId)),
    };

    await expect(ensurePrivateRequestDeviceKeyRegistered(client, "dev_1")).resolves.toMatchObject({ status: "registered", publicKey: "public-key" });
    await expect(ensurePrivateRequestDeviceKeyRegistered(client, "dev_2")).resolves.toMatchObject({ status: "registered", publicKey: "public-key" });

    expect(mockNativeCrypto.ensureKeyPairAsync).toHaveBeenNthCalledWith(1, privateRequestInstallationKeyAlias);
    expect(mockNativeCrypto.ensureKeyPairAsync).toHaveBeenNthCalledWith(2, privateRequestInstallationKeyAlias);
    expect(client.registerDevicePublicKey).toHaveBeenCalledWith("dev_1", { algorithm: "p256-ecdh-hkdf-sha256", publicKey: "public-key" });
    expect(client.registerDevicePublicKey).toHaveBeenCalledWith("dev_2", { algorithm: "p256-ecdh-hkdf-sha256", publicKey: "public-key" });
  });

  it("decrypts private Request display content with the shared install key", async () => {
    const request = { ...privateRequest(), connectionID: "conn_1" };
    const decrypted = await decryptMobileRequest(request, { savedAccounts: [{ id: "conn_1", deviceID: "dev_1" }] });

    expect(mockNativeCrypto.decryptRequestPayloadAsync).toHaveBeenCalledWith(privateRequestInstallationKeyAlias, JSON.stringify(encryptedPayload));
    expect(decrypted).toMatchObject({
      title: "Secret deploy?",
      body: "Ship build 123",
      command: "deploy production",
      privateContent: { status: "decrypted" },
      choices: [{ id: "approve", label: "Approve production deploy", kind: "approve" }],
    });
  });

  it("decrypts private Request display content without a saved remote device id", async () => {
    const decrypted = await decryptMobileRequest(privateRequest(), {});

    expect(mockNativeCrypto.decryptRequestPayloadAsync).toHaveBeenCalledWith(privateRequestInstallationKeyAlias, JSON.stringify(encryptedPayload));
    expect(decrypted.privateContent).toMatchObject({ status: "decrypted" });
  });

  it("decrypts private Request content inside Session timelines", async () => {
    const detail = {
      summary: {
        sessionId: "session_1",
        title: "Session",
        state: "needs-input",
        pendingRequestCount: 1,
        latestActivity: { kind: "request", id: "req_1", createdAt: "2026-06-12T00:00:00.000Z", preview: "Private Request", requestStatus: "pending" },
        startedAt: "2026-06-12T00:00:00.000Z",
        updatedAt: "2026-06-12T00:00:00.000Z",
      },
      timeline: [{ kind: "request", id: "req_1", workspaceId: "wsp_default", createdAt: "2026-06-12T00:00:00.000Z", request: privateRequest() }],
    } as any;

    const decrypted = await decryptMobileSessionDetail(detail, {});

    expect(mockNativeCrypto.decryptRequestPayloadAsync).toHaveBeenCalledWith(privateRequestInstallationKeyAlias, JSON.stringify(encryptedPayload));
    const decryptedRequest = (decrypted.timeline[0] as any).request;
    expect(decryptedRequest).toMatchObject({
      title: "Secret deploy?",
      body: "Ship build 123",
      choices: [{ id: "approve", label: "Approve production deploy", kind: "approve" }],
      privateContent: { status: "decrypted" },
    });
  });

  it("decrypts private Status Update reply content with the shared install key", async () => {
    mockNativeCrypto.decryptRequestPayloadAsync.mockResolvedValueOnce(JSON.stringify({
      schemaVersion: 1,
      kind: "status_update",
      message: "Assistant preview",
      body: "Full **assistant** reply",
      nextStep: "Review encrypted full reply",
      role: "assistant",
      presentation: { collapsedByDefault: true, contentFormat: "markdown" },
    }));

    const decrypted = await decryptMobileStatusUpdate({
      statusId: "stat_1",
      workspaceId: "wsp_default",
      message: "Assistant replied",
      state: "waiting",
      contentMode: "private",
      encryptedPayload,
      contextUsage: { tokens: 42000, contextWindow: 200000, percent: 21 },
      createdAt: "2026-06-12T00:00:00.000Z",
    }, {});

    expect(mockNativeCrypto.decryptRequestPayloadAsync).toHaveBeenCalledWith(privateRequestInstallationKeyAlias, JSON.stringify(encryptedPayload));
    expect(decrypted).toMatchObject({
      message: "Assistant preview",
      nextStep: "Review encrypted full reply",
      privateContent: { status: "decrypted", body: "Full **assistant** reply", role: "assistant", collapsedByDefault: true },
      contextUsage: { tokens: 42000, contextWindow: 200000, percent: 21 },
    });
  });

  it("decrypts private Tool Activity detail", async () => {
    mockNativeCrypto.decryptRequestPayloadAsync.mockResolvedValueOnce(JSON.stringify({
      schemaVersion: 1,
      kind: "tool_activity",
      toolName: "bash",
      phase: "end",
      result: "TOKEN=[REDACTED]",
    }));

    const decrypted = await decryptMobileToolActivity({
      toolActivityId: "toolact_1",
      workspaceId: "wsp_default",
      sessionId: "run_1",
      toolName: "bash",
      state: "finished",
      outcome: "failed",
      summary: "bash failed",
      contentMode: "private",
      encryptedPayload,
      createdAt: "2026-06-12T00:00:00.000Z",
    }, {});

    expect(decrypted.privateContent).toMatchObject({
      status: "decrypted",
      detail: { toolName: "bash", phase: "end", result: "TOKEN=[REDACTED]" },
    });
  });

  it("shows a stable locked explanation when private Tool Activity decryption fails", async () => {
    mockNativeCrypto.decryptRequestPayloadAsync.mockRejectedValueOnce(new Error("The operation couldn’t be completed."));

    const decrypted = await decryptMobileToolActivity({
      toolActivityId: "toolact_old",
      workspaceId: "wsp_default",
      sessionId: "run_1",
      toolName: "bash",
      state: "finished",
      outcome: "failed",
      contentMode: "private",
      encryptedPayload,
      createdAt: "2026-06-12T00:00:00.000Z",
    }, {});

    expect(decrypted.privateContent).toMatchObject({
      status: "locked",
      message: "This private Tool Activity could not be decrypted with this phone's private key. Repair private encryption registration for future private Activity.",
    });
  });

  it("shows a stable locked explanation when private Status Update decryption fails", async () => {
    mockNativeCrypto.decryptRequestPayloadAsync.mockRejectedValueOnce(new Error("The operation couldn’t be completed."));

    const decrypted = await decryptMobileStatusUpdate({
      statusId: "stat_old",
      workspaceId: "wsp_default",
      message: "Assistant replied",
      state: "waiting",
      contentMode: "private",
      encryptedPayload,
      createdAt: "2026-06-12T00:00:00.000Z",
    }, {});

    expect(decrypted.privateContent).toMatchObject({
      status: "locked",
      message: "This private Status Update could not be decrypted with this phone's private key. Repair private encryption registration for future private Activity.",
    });
    expect(JSON.stringify(decrypted)).not.toContain("operation couldn");
  });

  it("records diagnostics when private Request decryption fails", async () => {
    mockNativeCrypto.decryptRequestPayloadAsync.mockRejectedValueOnce(new Error("No Private Request envelope matched this device."));

    const decrypted = await decryptMobileRequest({ ...privateRequest(), connectionID: "conn_1" }, {});

    expect(decrypted.privateContent).toMatchObject({ status: "locked" });
    expect(recordDiagnostic).toHaveBeenCalledWith("warn", "private_requests", "private_request_decrypt_failed", expect.objectContaining({
      requestId: "req_1",
      workspaceId: "wsp_default",
      connectionID: "conn_1",
      keyEnvelopeCount: 1,
      errorMessage: "No Private Request envelope matched this device.",
    }));
  });
});
