import { translateSource } from "@agent-tick/i18n";
import type { RequestRecord, RespondRequest } from "@self-deprecated/agent-tick-sdk";
import type { Choice, EncryptedRequestPayload, ResponseRecord } from "@self-deprecated/agent-tick-shared";

export type MobileRequest = RequestRecord;
export type RequestResponse = RespondRequest & { encryptedPayloadAcknowledged?: boolean };
export type RequestChoice = Choice;
export type RequestSourceGroup = {
  id: string;
  label: string;
  requests: MobileRequest[];
};

export function normalizeRequests(value: unknown): MobileRequest[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normalizeRequest(entry));
}

export function normalizeRequest(value: unknown): MobileRequest {
  const request = (value ?? {}) as MobileRequest;
  const response = request.response
    ? { ...request.response, answers: normalizeAnswers(request.response.answers) }
    : undefined;
  const responses = Array.isArray(request.responses) ? request.responses.map(normalizeResponseRecord) : undefined;
  const quorum = request.quorum
    ? {
        ...request.quorum,
        requiredResponseCount: numberOrDefault(request.quorum.requiredResponseCount, 1),
        receivedResponseCount: numberOrDefault(request.quorum.receivedResponseCount, 0),
        waitingFor: numberOrDefault(request.quorum.waitingFor, 0),
        recipients: Array.isArray(request.quorum.recipients) ? request.quorum.recipients : [],
        responses: Array.isArray(request.quorum.responses) ? request.quorum.responses.map(normalizeResponseRecord) : [],
      }
    : undefined;

  return {
    ...request,
    requestType: normalizeRequestType(request.requestType),
    choices: Array.isArray(request.choices) ? request.choices : [],
    questions: Array.isArray(request.questions) ? request.questions : [],
    response,
    responses,
    quorum,
  };
}

function normalizeResponseRecord(value: ResponseRecord): ResponseRecord {
  return {
    ...value,
    answers: normalizeAnswers(value.answers),
  };
}

function numberOrDefault(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeRequestType(value: unknown) {
  if (value === "steering" || value === "sanction" || value === "questionnaire") return value;
  if (value === "steer") return "steering";
  return "sanction";
}

export function normalizeAnswers(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).map(([question, answers]) => [
      question,
      Array.isArray(answers) ? answers.filter((answer): answer is string => typeof answer === "string") : [],
    ]),
  );
}

export function buildQuestionnaireAnswers(
  request: MobileRequest,
  current: Record<string, string[]> = {},
) {
  const answers: Record<string, string[]> = {};
  for (const question of request.questions ?? []) {
    const selected = current[question.question] ?? [];
    answers[question.question] = selected.filter((answer) =>
      question.options.some((option) => option.label === answer),
    );
  }
  return answers;
}

export function updateQuestionnaireAnswers(
  current: Record<string, string[]>,
  question: string,
  option: string,
  multiSelect: boolean,
) {
  if (!multiSelect) return { ...current, [question]: [option] };
  const selected = current[question] ?? [];
  const next = selected.includes(option)
    ? selected.filter((value) => value !== option)
    : [...selected, option];
  return { ...current, [question]: next };
}

export function questionnaireReady(
  request: MobileRequest,
  answers: Record<string, string[]>,
) {
  return (request.questions ?? []).every((question) => {
    const selected = answers[question.question] ?? [];
    if (selected.length === 0) return false;
    if (!question.multiSelect && selected.length !== 1) return false;
    return true;
  });
}

export function requestStatusLabel(request: MobileRequest) {
  const status = request.response?.choiceId
    ?? (isQuestionnaireRequest(request) && request.response?.answers ? "answered" : undefined)
    ?? (request.quorum && request.quorum.waitingFor <= 0 && request.status === "responded" ? "responded" : undefined)
    ?? request.status;
  return translateStatus(status);
}

function translateStatus(status: string) {
  switch (status) {
    case "pending":
      return translateSource("Pending");
    case "abandoned":
      return translateSource("Abandoned");
    case "resolved":
      return translateSource("Resolved");
    case "expired":
      return translateSource("Expired");
    case "responded":
    case "answered":
      return translateSource("Responded");
    case "approve":
      return translateSource("Approved");
    case "deny":
      return translateSource("Denied");
    default:
      return status;
  }
}

export function requestSourceID(request: MobileRequest) {
  const metadataSource = request.metadata?.sourceId?.trim() || request.metadata?.clientId?.trim();
  if (metadataSource) return metadataSource;
  const clientName = request.requester.clientName?.trim();
  const host = request.requester.host?.trim() || request.requester.name?.trim() || "Agent";
  const cwd = request.requester.workingDirectory?.trim();
  if (clientName) return `${host}:${clientName}`;
  return cwd ? `${host}:${cwd}` : host;
}

export function requestRequesterLabel(request: MobileRequest) {
  return request.requester.name || request.metadata?.ownerUserId || "Agent";
}

export function requestAgentLabel(request: MobileRequest) {
  return request.requester.agentTokenId || request.metadata?.agentTokenLabel || request.requester.name || "Agent";
}

export function requestRoutingLabel(request: MobileRequest) {
  return request.testLabel || metadataLabel(request, ["routingRuleName", "routingRuleId"]);
}

export function requestOwnerLabel(request: MobileRequest) {
  return metadataLabel(request, ["ownerName", "ownerUserId", "userId"]);
}

export function requestQuorumSummary(request: MobileRequest) {
  const explicit = metadataLabel(request, ["routingRuleSummary", "quorumSummary"]);
  if (explicit) return explicit;
  const quorum = request.quorum;
  if (!quorum) return metadataLabel(request, ["routingRuleName", "routingRuleId"]);
  const required = quorum.requiredResponseCount > 1
    ? `${quorum.requiredResponseCount} responses required`
    : "1 response required";
  const received = quorum.receivedResponseCount > 0
    ? ` (${quorum.receivedResponseCount} received)`
    : "";
  return `${required}${received}`;
}

export function quorumProgressMessage(request: MobileRequest) {
  const quorum = request.quorum;
  if (!quorum) return "";
  if (request.status === "responded") return "Required responses are complete.";
  if (request.status === "expired") return "This Request expired before enough Responses arrived.";
  if (request.status === "abandoned" || request.status === "resolved") return "This Request was closed before enough Responses arrived.";

  const waiting = waitingForText(quorum.waitingFor);
  if (quorum.currentUserResponded) return `You responded. ${waiting}`.trim();
  if (quorum.currentUserEligible === false) return `You are not a routed recipient for this Request. ${waiting}`.trim();
  if (quorum.currentUserEligible === true) return `Your response is needed. ${waiting}`.trim();
  return waiting;
}

export function requestResponsibilityLabel(request: MobileRequest) {
  const quorum = request.quorum;
  if (!quorum || request.status !== "pending") return "";
  if (quorum.currentUserResponded) return translateSource("Waiting for others");
  if (quorum.currentUserEligible === false) return translateSource("Read-only");
  if (quorum.currentUserEligible === true) return translateSource("Your response is needed");
  return translateSource("Pending");
}

export function isEncryptedRequest(request: MobileRequest) {
  return Boolean(
    request.encryptedPayload ||
    request.metadata?.encrypted === "true" ||
    (request.title === "Encrypted request" && request.body === "Open Agent Tick to decrypt this request.")
  );
}

export function canRespondToRequest(request: MobileRequest) {
  if (isEncryptedRequest(request)) return false;
  if (request.status !== "pending" || request.response) return false;
  if (isQuestionnaireRequest(request)) return true;
  const quorum = request.quorum;
  if (!quorum) return true;
  return quorum.currentUserEligible !== false && !quorum.currentUserResponded;
}

export function requestCommandDetails(request: MobileRequest) {
  const rows: Array<{ label: string; value: string }> = [];
  if (request.command?.trim()) rows.push({ label: "Command", value: request.command.trim() });
  const source = requestSourceLabel(request);
  if (source) rows.push({ label: translateSource("Source"), value: source });
  if (request.requester.workingDirectory?.trim()) rows.push({ label: "Directory", value: request.requester.workingDirectory.trim() });
  if (request.requester.host?.trim()) rows.push({ label: "Host", value: request.requester.host.trim() });
  if (request.createdAt) rows.push({ label: "Requested", value: request.createdAt });
  if (request.respondedAt) rows.push({ label: "Responded", value: request.respondedAt });
  rows.push({ label: "Request ID", value: request.id });
  return rows;
}

export function requestResponseHistory(request: MobileRequest) {
  const responses = request.quorum?.responses ?? request.responses ?? [];
  return responses.map((response) => ({
    id: response.responseId || `${response.userId}-${response.createdAt}`,
    label: responseHistoryLabel(response),
    message: response.message,
  }));
}

function waitingForText(waitingFor: number) {
  if (waitingFor <= 0) return "Required responses are complete.";
  return `Waiting for ${waitingFor} more ${waitingFor === 1 ? "response" : "responses"}.`;
}

function responsePastTense(choiceID?: string) {
  if (choiceID === "approve") return "approved";
  if (choiceID === "deny") return "denied";
  if (choiceID) return `responded ${choiceID}`;
  return "responded";
}

function responseHistoryLabel(response: ResponseRecord) {
  const source = response.source ? ` via ${response.source}` : "";
  return `${response.userId} ${responsePastTense(response.choiceId)}${source}`;
}

function metadataLabel(request: MobileRequest, keys: string[]) {
  for (const key of keys) {
    const value = request.metadata?.[key]?.trim();
    if (value) return value;
  }
  return "";
}

export function requestSourceLabel(request: MobileRequest) {
  const metadataSource = request.metadata?.sourceName?.trim() || request.metadata?.clientName?.trim();
  if (metadataSource) return metadataSource;
  const explicit = request.requester.clientName?.trim();
  if (explicit) return explicit;
  const cwd = request.requester.workingDirectory?.trim();
  if (!cwd) return request.requester.host || request.requester.name || "Agent";
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

export function groupRequestsBySource(requests: MobileRequest[]): RequestSourceGroup[] {
  const groups = new Map<string, RequestSourceGroup>();
  for (const request of requests) {
    const id = requestSourceID(request);
    const existing = groups.get(id);
    if (existing) {
      existing.requests.push(request);
      continue;
    }
    groups.set(id, { id, label: requestSourceLabel(request), requests: [request] });
  }
  return Array.from(groups.values());
}

export function isQuestionnaireRequest(request: MobileRequest) {
  return request.requestType === "questionnaire";
}

export function isSteeringRequest(request: MobileRequest) {
  return request.requestType === "steering";
}

export function supportsNotificationActions(_request: MobileRequest) {
  return false;
}

export function shouldScheduleLocalNotifications(_pushStatus: string, _notificationsEnabled = true) {
  return false;
}

export function notificationBody(_request: MobileRequest) {
  return "Agent Tick needs your attention.";
}

export type { EncryptedRequestPayload };
