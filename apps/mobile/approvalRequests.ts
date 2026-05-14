export type Requester = {
  name: string;
  agentId: string;
  host?: string;
  workingDirectory?: string;
  projectName?: string;
  projectId?: string;
};

export type ChoiceFlag =
  | "favorite"
  | "safest"
  | "fastest"
  | "thorough"
  | "reversible"
  | "experimental"
  | "blocked"
  | "needs_context"
  | "destructive"
  | "external_effect"
  | "security_sensitive"
  | "costly"
  | "production"
  | "time_sensitive"
  | "audit_relevant";

export type Choice = {
  id: string;
  label: string;
  kind: "approve" | "deny" | "custom" | string;
  flags?: ChoiceFlag[];
  tags?: string[];
};

export type QuestionOption = {
  label: string;
};

export type Question = {
  header: string;
  question: string;
  options: QuestionOption[];
  multiSelect: boolean;
};

export type ApprovalResponse = {
  choiceId?: string;
  message?: string;
  answers?: Record<string, string[]>;
  encryptedPayloadAcknowledged?: boolean;
};

export type ApprovalVoteRecord = {
  voteId: string;
  requestId: string;
  policyId?: string;
  step: number;
  approverUserId: string;
  source: string;
  choiceId: string;
  message?: string;
  answers?: Record<string, string[]>;
  createdAt: string;
};

export type ApprovalPolicyProgress = {
  policyId?: string;
  state: "pending" | "approved" | "denied" | "expired" | "abandoned" | string;
  currentStep: number;
  totalSteps: number;
  requiredApprovals: number;
  receivedApprovals: number;
  currentUserHasVoted: boolean;
  currentUserEligible?: boolean;
  currentUserVote?: ApprovalVoteRecord;
  waitingFor: number;
  eligibleApproverIds?: string[];
  votes?: ApprovalVoteRecord[];
};

export type EncryptedApprovalPayload = {
  version: number;
  algorithm: string;
  keyId?: string;
  nonce: string;
  ciphertext: string;
  aad?: string;
};

export type ApprovalRequest = {
  id: string;
  userId?: string;
  requester: Requester;
  requestType?: "approval" | "questionnaire" | "steer" | string;
  title: string;
  body?: string;
  command?: string;
  encryptedPayload?: EncryptedApprovalPayload;
  choices: Choice[];
  questions?: Question[];
  allowFreeformReply: boolean;
  risk?: string;
  expiresAt?: string;
  status: "pending" | "responded" | "expired" | "abandoned" | string;
  createdAt: string;
  respondedAt?: string;
  response?: ApprovalResponse;
  metadata?: Record<string, string>;
  policyProgress?: ApprovalPolicyProgress;
};

export function normalizeApprovals(value: unknown): ApprovalRequest[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => normalizeApproval(entry));
}

export function normalizeApproval(value: unknown): ApprovalRequest {
  const request = (value ?? {}) as ApprovalRequest;
  const response = request.response
    ? {
        ...request.response,
        answers: normalizeAnswers(request.response.answers),
      }
    : undefined;
  return {
    ...request,
    requestType: normalizeRequestType(request.requestType),
    choices: Array.isArray(request.choices) ? request.choices : [],
    questions: Array.isArray(request.questions) ? request.questions : [],
    response,
    policyProgress: normalizePolicyProgress(request.policyProgress),
  };
}

function normalizePolicyProgress(value: unknown): ApprovalPolicyProgress | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const progress = value as ApprovalPolicyProgress;
  return {
    ...progress,
    currentStep: numberOrDefault(progress.currentStep, 1),
    totalSteps: numberOrDefault(progress.totalSteps, 1),
    requiredApprovals: numberOrDefault(progress.requiredApprovals, 0),
    receivedApprovals: numberOrDefault(progress.receivedApprovals, 0),
    waitingFor: numberOrDefault(progress.waitingFor, 0),
    currentUserHasVoted: progress.currentUserHasVoted === true,
    currentUserEligible:
      typeof progress.currentUserEligible === "boolean"
        ? progress.currentUserEligible
        : undefined,
    currentUserVote: progress.currentUserVote
      ? normalizeVote(progress.currentUserVote)
      : undefined,
    eligibleApproverIds: Array.isArray(progress.eligibleApproverIds)
      ? progress.eligibleApproverIds.filter((id): id is string => typeof id === "string")
      : [],
    votes: Array.isArray(progress.votes) ? progress.votes.map(normalizeVote) : [],
  };
}

function normalizeVote(value: ApprovalVoteRecord): ApprovalVoteRecord {
  return {
    ...value,
    step: numberOrDefault(value.step, 1),
    answers: normalizeAnswers(value.answers),
  };
}

function numberOrDefault(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeRequestType(value: unknown) {
  if (value === "questionnaire" || value === "steer") {
    return value;
  }
  return "approval";
}

export function normalizeAnswers(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([question, answers]) => [
      question,
      Array.isArray(answers) ? answers.filter((answer): answer is string => typeof answer === "string") : [],
    ]),
  );
}

export function buildQuestionnaireAnswers(
  request: ApprovalRequest,
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
  if (!multiSelect) {
    return { ...current, [question]: [option] };
  }
  const selected = current[question] ?? [];
  const next = selected.includes(option)
    ? selected.filter((value) => value !== option)
    : [...selected, option];
  return { ...current, [question]: next };
}

export function questionnaireReady(
  request: ApprovalRequest,
  answers: Record<string, string[]>,
) {
  return (request.questions ?? []).every((question) => {
    const selected = answers[question.question] ?? [];
    if (selected.length === 0) {
      return false;
    }
    if (!question.multiSelect && selected.length !== 1) {
      return false;
    }
    return true;
  });
}

export function requestStatusLabel(request: ApprovalRequest) {
  if (request.response?.choiceId) {
    return request.response.choiceId;
  }
  if (isQuestionnaireRequest(request) && request.response?.answers) {
    return "answered";
  }
  if (request.policyProgress?.state && request.policyProgress.state !== "pending") {
    return request.policyProgress.state;
  }
  return request.status;
}

export type ProjectGroup = {
  id: string;
  label: string;
  requests: ApprovalRequest[];
};

export function requestProjectID(request: ApprovalRequest) {
  const metadataProject = request.metadata?.projectId?.trim();
  if (metadataProject) {
    return metadataProject;
  }
  const explicit = request.requester.projectId?.trim();
  if (explicit) {
    return explicit;
  }
  const host = request.requester.host?.trim() || request.requester.name?.trim() || "Agent";
  const cwd = request.requester.workingDirectory?.trim();
  return cwd ? `${host}:${cwd}` : host;
}

export function requestRequesterLabel(request: ApprovalRequest) {
  return request.requester.name || request.requester.agentId || request.metadata?.ownerUserId || "Agent";
}

export function requestAgentLabel(request: ApprovalRequest) {
  return request.requester.agentId || request.metadata?.agentId || request.requester.name || "Agent";
}

export function requestTargetTeamLabel(request: ApprovalRequest) {
  return metadataLabel(request, ["teamName", "targetTeam", "team", "teamId"]);
}

export function requestOwnerLabel(request: ApprovalRequest) {
  return metadataLabel(request, ["ownerName", "ownerUserId", "userId"]);
}

export function requestPolicySummary(request: ApprovalRequest) {
  const explicit = metadataLabel(request, ["approvalPolicySummary", "policySummary"]);
  if (explicit) {
    return explicit;
  }
  const progress = request.policyProgress;
  if (!progress) {
    return metadataLabel(request, ["approvalPolicy", "effectiveApprovalPolicy"]);
  }
  const step = progress.totalSteps > 1 ? `Step ${progress.currentStep} of ${progress.totalSteps}: ` : "";
  const quorum = progress.requiredApprovals > 1
    ? `${progress.requiredApprovals} approvals required`
    : "1 approval required";
  return `${step}${quorum}`;
}

export function policyProgressMessage(request: ApprovalRequest) {
  const progress = request.policyProgress;
  if (!progress) {
    return "";
  }
  if (progress.state === "approved") {
    return "Policy approved. The request is complete.";
  }
  if (progress.state === "denied") {
    return "Policy denied. The request is complete.";
  }
  if (progress.state === "expired") {
    return "This request expired before the policy was satisfied.";
  }
  if (progress.state === "abandoned") {
    return "This request was abandoned before the policy was satisfied.";
  }

  const step = progress.totalSteps > 1 ? `Step ${progress.currentStep} of ${progress.totalSteps}. ` : "";
  const waiting = waitingForText(progress);
  if (progress.currentUserHasVoted) {
    return `${step}You ${votePastTense(progress.currentUserVote?.choiceId)}. ${waiting}`.trim();
  }
  if (progress.currentUserEligible === false) {
    return `${step}You are not an eligible approver for this step. ${waiting}`.trim();
  }
  if (progress.currentUserEligible === true) {
    return `${step}Your approval is needed. ${waiting}`.trim();
  }
  return `${step}${waiting}`.trim();
}

export function requestResponsibilityLabel(request: ApprovalRequest) {
  const progress = request.policyProgress;
  if (!progress || request.status !== "pending") {
    return "";
  }
  if (progress.currentUserHasVoted) {
    return "Waiting for others";
  }
  if (progress.currentUserEligible === false) {
    return "Read-only";
  }
  if (progress.currentUserEligible === true) {
    return "Your approval is needed";
  }
  return "Pending";
}

export function isEncryptedApprovalRequest(request: ApprovalRequest) {
  return Boolean(
    request.encryptedPayload ||
    request.metadata?.encrypted === "true" ||
    (request.title === "Encrypted approval request" && request.body === "Open Agent Tick to decrypt this request.")
  );
}

export function canRespondToRequest(request: ApprovalRequest) {
  if (isEncryptedApprovalRequest(request)) {
    return false;
  }
  if (request.status !== "pending" || request.response) {
    return false;
  }
  if (isQuestionnaireRequest(request)) {
    return true;
  }
  const progress = request.policyProgress;
  if (!progress) {
    return true;
  }
  return progress.state === "pending" && progress.currentUserEligible !== false && !progress.currentUserHasVoted;
}

export function requestCommandDetails(request: ApprovalRequest) {
  const rows: Array<{ label: string; value: string }> = [];
  if (request.command?.trim()) rows.push({ label: "Command", value: request.command.trim() });
  const project = requestProjectLabel(request);
  if (project) rows.push({ label: "Project", value: project });
  if (request.requester.workingDirectory?.trim()) rows.push({ label: "Directory", value: request.requester.workingDirectory.trim() });
  if (request.requester.host?.trim()) rows.push({ label: "Host", value: request.requester.host.trim() });
  if (request.createdAt) rows.push({ label: "Requested", value: request.createdAt });
  if (request.respondedAt) rows.push({ label: "Responded", value: request.respondedAt });
  rows.push({ label: "Request ID", value: request.id });
  return rows;
}

export function requestVoteHistory(request: ApprovalRequest) {
  return (request.policyProgress?.votes ?? []).map((vote) => ({
    id: vote.voteId || `${vote.approverUserId}-${vote.step}-${vote.createdAt}`,
    label: voteHistoryLabel(vote),
    message: vote.message,
  }));
}

function waitingForText(progress: ApprovalPolicyProgress) {
  if (progress.waitingFor <= 0) {
    return progress.totalSteps > 1 ? "Waiting for the next step." : "Quorum is satisfied.";
  }
  return `Waiting for ${progress.waitingFor} more ${progress.waitingFor === 1 ? "approval" : "approvals"}.`;
}

function votePastTense(choiceID?: string) {
  if (choiceID === "approve") {
    return "approved";
  }
  if (choiceID === "deny") {
    return "denied";
  }
  if (choiceID) {
    return `voted ${choiceID}`;
  }
  return "voted";
}

function voteHistoryLabel(vote: ApprovalVoteRecord) {
  const source = vote.source ? ` via ${vote.source}` : "";
  return `Step ${vote.step}: ${vote.approverUserId} ${votePastTense(vote.choiceId)}${source}`;
}

function metadataLabel(request: ApprovalRequest, keys: string[]) {
  for (const key of keys) {
    const value = request.metadata?.[key]?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

export function requestProjectLabel(request: ApprovalRequest) {
  const metadataProject = request.metadata?.projectName?.trim();
  if (metadataProject) {
    return metadataProject;
  }
  const explicit = request.requester.projectName?.trim();
  if (explicit) {
    return explicit;
  }
  const cwd = request.requester.workingDirectory?.trim();
  if (!cwd) {
    return request.requester.host || request.requester.name || "Agent";
  }
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  const name = parts[parts.length - 1] || cwd;
  return name;
}

export function groupRequestsByProject(requests: ApprovalRequest[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const request of requests) {
    const id = requestProjectID(request);
    const existing = groups.get(id);
    if (existing) {
      existing.requests.push(request);
      continue;
    }
    groups.set(id, { id, label: requestProjectLabel(request), requests: [request] });
  }
  return Array.from(groups.values());
}

export function isQuestionnaireRequest(request: ApprovalRequest) {
  return request.requestType === "questionnaire";
}

export function isSteerRequest(request: ApprovalRequest) {
  return request.requestType === "steer";
}

export function supportsNotificationActions(request: ApprovalRequest) {
  return (
    canRespondToRequest(request) &&
    request.requestType === "approval" &&
    (request.choices ?? []).some((choice) => choice.id === "approve") &&
    (request.choices ?? []).some((choice) => choice.id === "deny")
  );
}

export function shouldScheduleLocalNotifications(pushStatus: string, notificationsEnabled = true) {
  return notificationsEnabled && pushStatus !== "registered";
}

export function notificationBody(request: ApprovalRequest) {
  const responsibility = requestResponsibilityLabel(request);
  const prefix = responsibility ? `${responsibility}: ` : "";
  if (request.command) {
    const host = request.requester.host || request.requester.name || "Agent";
    return `${prefix}${host}: ${request.command}`;
  }
  if (isQuestionnaireRequest(request) && request.questions?.length) {
    return `${prefix}${request.questions[0]?.question || request.body || "Questions waiting"}`;
  }
  if (isSteerRequest(request)) {
    return `${prefix}${request.body || "Steering requested"}`;
  }
  return `${prefix}${request.body || "Approval requested"}`;
}
