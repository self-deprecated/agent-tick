import type { AgentTickClient, SessionDetail, StatusUpdateRecord, ToolActivityRecord } from "@self-deprecated/agent-tick-sdk";
import type { ActivityItem, Choice, EncryptedRequestPayload, EncryptedStatusUpdatePayload, EncryptedToolActivityPayload } from "@self-deprecated/agent-tick-shared";

import { recordDiagnostic } from "./diagnostics";
import DefaultAgentTickPrivateCryptoModule from "./modules/agent-tick-private-crypto";
import type { AgentTickPrivateCryptoModuleAPI } from "./modules/agent-tick-private-crypto";
import type { MobileRequest } from "./requests";

type PrivateRequestPlaintext = {
  title: string;
  body?: string;
  command?: string;
  choices?: Choice[];
  session?: unknown;
  requestType?: string;
};

export type PrivateRequestContentState =
  | { status: "decrypted" }
  | { status: "unsupported"; message: string }
  | { status: "locked"; message: string }
  | { status: "error"; message: string };

export type PrivateRequestDeviceKeyRegistrationResult =
  | { status: "registered"; publicKey: string }
  | { status: "unsupported"; message: string }
  | { status: "skipped"; message: string };

export type PrivateRequestLocalInstallKeyStatus =
  | { status: "ready"; alias: string; algorithm: "p256-ecdh-hkdf-sha256"; publicKey: string }
  | { status: "unsupported"; message: string }
  | { status: "error"; message: string };

export const privateRequestInstallationKeyAlias = "agent-tick.private-request.installation.v1";

let AgentTickPrivateCryptoModule: AgentTickPrivateCryptoModuleAPI | null = DefaultAgentTickPrivateCryptoModule;

export function setPrivateRequestCryptoModuleForTesting(module: AgentTickPrivateCryptoModuleAPI | null): void {
  AgentTickPrivateCryptoModule = module;
}

export function privateRequestCryptoAvailable(): boolean {
  return Boolean(AgentTickPrivateCryptoModule);
}

export async function privateRequestLocalInstallKeyStatus(): Promise<PrivateRequestLocalInstallKeyStatus> {
  if (!AgentTickPrivateCryptoModule) {
    return { status: "unsupported", message: "Private Requests require a development or production build with native encryption support." };
  }
  const available = await AgentTickPrivateCryptoModule.isAvailableAsync().catch(() => false);
  if (!available) {
    return { status: "unsupported", message: "Private Request encryption is not available on this device." };
  }
  try {
    const keyPair = await AgentTickPrivateCryptoModule.ensureKeyPairAsync(privateRequestInstallationKeyAlias);
    return { status: "ready", alias: privateRequestInstallationKeyAlias, algorithm: keyPair.algorithm, publicKey: keyPair.publicKey };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Could not prepare this phone's private encryption key." };
  }
}

export async function ensurePrivateRequestDeviceKeyRegistered(
  client: Pick<AgentTickClient, "listDevicePublicKeys" | "registerDevicePublicKey">,
  deviceId: string | null | undefined,
): Promise<PrivateRequestDeviceKeyRegistrationResult> {
  if (!deviceId) return { status: "skipped", message: "No Approval Device is registered yet." };
  const localKey = await privateRequestLocalInstallKeyStatus();
  if (localKey.status === "unsupported") return { status: "unsupported", message: localKey.message };
  if (localKey.status === "error") return { status: "unsupported", message: localKey.message };
  const keyPair = { algorithm: localKey.algorithm, publicKey: localKey.publicKey };
  const existingKeys = await client.listDevicePublicKeys(deviceId).catch(() => []);
  if (!existingKeys.some((key) => key.algorithm === keyPair.algorithm && key.publicKey === keyPair.publicKey)) {
    await client.registerDevicePublicKey(deviceId, keyPair);
  }
  return { status: "registered", publicKey: keyPair.publicKey };
}

export type PrivateRequestDecryptContext = {
  activeDeviceID?: string;
  savedAccounts?: Array<{ id: string; deviceID?: string }>;
};

export async function decryptMobileRequests(
  requests: MobileRequest[],
  context: PrivateRequestDecryptContext = {},
): Promise<MobileRequest[]> {
  void context;
  return Promise.all(requests.map((request) => decryptMobileRequest(request)));
}

export async function decryptMobileRequest(
  request: MobileRequest,
  context: PrivateRequestDecryptContext = {},
): Promise<MobileRequest> {
  void context;
  if (request.contentMode !== "private") return request;
  if (!request.encryptedPayload) {
    return privateRequestWithState(request, { status: "error", message: "This Private Request is missing its encrypted payload." });
  }
  if (!AgentTickPrivateCryptoModule) {
    return privateRequestWithState(request, { status: "unsupported", message: "Private Requests require a development or production build with native encryption support." });
  }
  try {
    const plaintextJson = await AgentTickPrivateCryptoModule.decryptRequestPayloadAsync(
      privateRequestInstallationKeyAlias,
      JSON.stringify(request.encryptedPayload satisfies EncryptedRequestPayload),
    );
    const plaintext = parsePrivateRequestPlaintext(plaintextJson);
    return {
      ...request,
      title: plaintext.title,
      ...(plaintext.body ? { body: plaintext.body } : { body: undefined }),
      ...(plaintext.command ? { command: plaintext.command } : { command: undefined }),
      choices: plaintext.choices?.length ? plaintext.choices : request.choices,
      ...(plaintext.session && typeof plaintext.session === "object" ? { session: plaintext.session as MobileRequest["session"] } : {}),
      privateContent: { status: "decrypted" },
    };
  } catch (error) {
    recordPrivateDecryptFailure("private_request_decrypt_failed", error, {
      requestId: request.id,
      workspaceId: request.workspaceId,
      connectionID: request.connectionID,
      keyEnvelopeCount: request.encryptedPayload.keyEnvelopes.length,
    });
    return privateRequestWithState(request, {
      status: "locked",
      message: lockedPrivateRequestMessage(),
    });
  }
}

function lockedPrivateRequestMessage(): string {
  return "This Private Request could not be decrypted with this phone's private key. Repair private encryption registration for future private Activity.";
}

function privateRequestWithState(request: MobileRequest, privateContent: Exclude<PrivateRequestContentState, { status: "decrypted" }>): MobileRequest {
  return {
    ...request,
    title: request.title || "Private Request",
    body: privateContent.message,
    command: undefined,
    privateContent,
  };
}

function parsePrivateRequestPlaintext(value: string): PrivateRequestPlaintext {
  const parsed = JSON.parse(value) as Partial<PrivateRequestPlaintext>;
  if (!parsed || typeof parsed !== "object" || typeof parsed.title !== "string" || parsed.title.length === 0) {
    throw new Error("Private Request plaintext is invalid.");
  }
  return {
    title: parsed.title,
    ...(typeof parsed.body === "string" ? { body: parsed.body } : {}),
    ...(typeof parsed.command === "string" ? { command: parsed.command } : {}),
    choices: Array.isArray(parsed.choices) ? parsed.choices.filter(isChoice) : [],
    ...(parsed.session && typeof parsed.session === "object" ? { session: parsed.session } : {}),
    ...(typeof parsed.requestType === "string" ? { requestType: parsed.requestType } : {}),
  };
}

function isChoice(value: unknown): value is Choice {
  if (!value || typeof value !== "object") return false;
  const choice = value as Partial<Choice>;
  return typeof choice.id === "string" && choice.id.length > 0 && typeof choice.label === "string" && choice.label.length > 0;
}


type PrivateStatusUpdatePlaintext = {
  schemaVersion: 1;
  kind: "status_update";
  message?: string;
  body?: string;
  nextStep?: string;
  role?: "assistant" | "user" | "system";
  presentation?: {
    collapsedByDefault?: boolean;
    contentFormat?: "markdown" | "text";
  };
};

export type PrivateStatusUpdateContentState =
  | { status: "decrypted"; body?: string; preview?: string; role?: "assistant" | "user" | "system"; collapsedByDefault?: boolean; contentFormat?: "markdown" | "text" }
  | { status: "unsupported"; message: string }
  | { status: "locked"; message: string }
  | { status: "error"; message: string };

export type PrivateToolActivityContentState =
  | { status: "decrypted"; detail?: Record<string, unknown> }
  | { status: "unsupported"; message: string }
  | { status: "locked"; message: string }
  | { status: "error"; message: string };

export type MobileStatusUpdate = StatusUpdateRecord & {
  connectionID?: string;
  privateContent?: PrivateStatusUpdateContentState;
};

export type MobileToolActivity = ToolActivityRecord & {
  privateContent?: PrivateToolActivityContentState;
};

export async function decryptMobileStatusUpdates(
  statuses: StatusUpdateRecord[],
  context: PrivateRequestDecryptContext = {},
): Promise<MobileStatusUpdate[]> {
  void context;
  return Promise.all(statuses.map((status) => decryptMobileStatusUpdate(status as MobileStatusUpdate)));
}

export async function decryptMobileSessionDetail(
  detail: SessionDetail,
  context: PrivateRequestDecryptContext = {},
): Promise<SessionDetail> {
  const timeline = await Promise.all(detail.timeline.map(async (item): Promise<ActivityItem> => {
    if (item.kind === "request") return { ...item, request: await decryptMobileRequest(item.request as MobileRequest, context) as typeof item.request };
    if (item.kind === "status_update") return { ...item, statusUpdate: await decryptMobileStatusUpdate(item.statusUpdate as MobileStatusUpdate, context) };
    if (item.kind === "tool_activity") return { ...item, toolActivity: await decryptMobileToolActivity(item.toolActivity as MobileToolActivity, context) };
    return item;
  }));
  return { ...detail, timeline };
}

export async function decryptMobileStatusUpdate(
  status: MobileStatusUpdate,
  context: PrivateRequestDecryptContext = {},
): Promise<MobileStatusUpdate> {
  void context;
  if (status.contentMode !== "private") return status;
  if (!status.encryptedPayload) {
    return privateStatusWithState(status, { status: "error", message: "This private Status Update is missing its encrypted payload." });
  }
  if (!AgentTickPrivateCryptoModule) {
    return privateStatusWithState(status, { status: "unsupported", message: "Private Status Updates require a development or production build with native encryption support." });
  }
  try {
    const plaintextJson = await AgentTickPrivateCryptoModule.decryptRequestPayloadAsync(
      privateRequestInstallationKeyAlias,
      JSON.stringify(status.encryptedPayload satisfies EncryptedStatusUpdatePayload),
    );
    const plaintext = parsePrivateStatusUpdatePlaintext(plaintextJson);
    return {
      ...status,
      message: plaintext.message || status.message,
      ...(plaintext.nextStep ? { nextStep: plaintext.nextStep } : {}),
      privateContent: {
        status: "decrypted",
        ...(plaintext.body ? { body: plaintext.body } : {}),
        ...(plaintext.message ? { preview: plaintext.message } : {}),
        ...(plaintext.role ? { role: plaintext.role } : {}),
        ...(plaintext.presentation?.collapsedByDefault !== undefined ? { collapsedByDefault: plaintext.presentation.collapsedByDefault } : {}),
        ...(plaintext.presentation?.contentFormat ? { contentFormat: plaintext.presentation.contentFormat } : {}),
      },
    };
  } catch (error) {
    recordPrivateDecryptFailure("private_status_update_decrypt_failed", error, {
      statusId: status.statusId,
      workspaceId: status.workspaceId,
      sessionId: status.sessionId,
      connectionID: status.connectionID,
      keyEnvelopeCount: status.encryptedPayload.keyEnvelopes.length,
    });
    return privateStatusWithState(status, {
      status: "locked",
      message: lockedPrivateStatusUpdateMessage(),
    });
  }
}

export async function decryptMobileToolActivity(
  toolActivity: MobileToolActivity,
  context: PrivateRequestDecryptContext = {},
): Promise<MobileToolActivity> {
  void context;
  if (toolActivity.contentMode !== "private") return toolActivity;
  if (!toolActivity.encryptedPayload) {
    return privateToolActivityWithState(toolActivity, { status: "error", message: "This private Tool Activity is missing its encrypted payload." });
  }
  if (!AgentTickPrivateCryptoModule) {
    return privateToolActivityWithState(toolActivity, { status: "unsupported", message: "Private Tool Activity requires a development or production build with native encryption support." });
  }
  try {
    const plaintextJson = await AgentTickPrivateCryptoModule.decryptRequestPayloadAsync(
      privateRequestInstallationKeyAlias,
      JSON.stringify(toolActivity.encryptedPayload satisfies EncryptedToolActivityPayload),
    );
    const plaintext = parsePrivateToolActivityPlaintext(plaintextJson);
    return {
      ...toolActivity,
      privateContent: {
        status: "decrypted",
        detail: plaintext.detail,
      },
    };
  } catch (error) {
    recordPrivateDecryptFailure("private_tool_activity_decrypt_failed", error, {
      toolActivityId: toolActivity.toolActivityId,
      workspaceId: toolActivity.workspaceId,
      sessionId: toolActivity.sessionId,
      keyEnvelopeCount: toolActivity.encryptedPayload.keyEnvelopes.length,
    });
    return privateToolActivityWithState(toolActivity, {
      status: "locked",
      message: lockedPrivateToolActivityMessage(),
    });
  }
}

function recordPrivateDecryptFailure(message: string, error: unknown, metadata: Record<string, unknown>): void {
  recordDiagnostic("warn", "private_requests", message, {
    ...metadata,
    errorMessage: error instanceof Error ? error.message : String(error),
  });
}

function lockedPrivateStatusUpdateMessage(): string {
  return "This private Status Update could not be decrypted with this phone's private key. Repair private encryption registration for future private Activity.";
}

function lockedPrivateToolActivityMessage(): string {
  return "This private Tool Activity could not be decrypted with this phone's private key. Repair private encryption registration for future private Activity.";
}

function privateStatusWithState(status: MobileStatusUpdate, privateContent: Exclude<PrivateStatusUpdateContentState, { status: "decrypted" }>): MobileStatusUpdate {
  return {
    ...status,
    privateContent,
  };
}

function privateToolActivityWithState(toolActivity: MobileToolActivity, privateContent: Exclude<PrivateToolActivityContentState, { status: "decrypted" }>): MobileToolActivity {
  return {
    ...toolActivity,
    privateContent,
  };
}

function parsePrivateStatusUpdatePlaintext(value: string): PrivateStatusUpdatePlaintext {
  const parsed = JSON.parse(value) as Partial<PrivateStatusUpdatePlaintext>;
  if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== 1 || parsed.kind !== "status_update") {
    throw new Error("Private Status Update plaintext is invalid.");
  }
  return {
    schemaVersion: 1,
    kind: "status_update",
    ...(typeof parsed.message === "string" ? { message: parsed.message } : {}),
    ...(typeof parsed.body === "string" ? { body: parsed.body } : {}),
    ...(typeof parsed.nextStep === "string" ? { nextStep: parsed.nextStep } : {}),
    ...(parsed.role === "assistant" || parsed.role === "user" || parsed.role === "system" ? { role: parsed.role } : {}),
    ...(parsed.presentation && typeof parsed.presentation === "object" ? {
      presentation: {
        ...(typeof parsed.presentation.collapsedByDefault === "boolean" ? { collapsedByDefault: parsed.presentation.collapsedByDefault } : {}),
        ...(parsed.presentation.contentFormat === "markdown" || parsed.presentation.contentFormat === "text" ? { contentFormat: parsed.presentation.contentFormat } : {}),
      },
    } : {}),
  };
}

type PrivateToolActivityPlaintext = {
  schemaVersion: 1;
  kind: "tool_activity";
  detail?: Record<string, unknown>;
};

function parsePrivateToolActivityPlaintext(value: string): PrivateToolActivityPlaintext {
  const parsed = JSON.parse(value) as Partial<PrivateToolActivityPlaintext>;
  if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== 1 || parsed.kind !== "tool_activity") {
    throw new Error("Private Tool Activity plaintext is invalid.");
  }
  const { schemaVersion: _schemaVersion, kind: _kind, detail: nestedDetail, ...rest } = parsed as Record<string, unknown>;
  const detail = nestedDetail && typeof nestedDetail === "object" && !Array.isArray(nestedDetail)
    ? nestedDetail as Record<string, unknown>
    : rest;
  return {
    schemaVersion: 1,
    kind: "tool_activity",
    ...(Object.keys(detail).length ? { detail } : {}),
  };
}
