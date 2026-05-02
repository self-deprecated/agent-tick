export type Requester = {
  name: string;
  agentId: string;
  host?: string;
  workingDirectory?: string;
  projectName?: string;
  projectId?: string;
};

export type Choice = {
  id: string;
  label: string;
  kind: "approve" | "deny" | "custom" | string;
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
};

export type ApprovalRequest = {
  id: string;
  requester: Requester;
  requestType?: "approval" | "questionnaire" | "steer" | string;
  title: string;
  body?: string;
  command?: string;
  choices: Choice[];
  questions?: Question[];
  allowFreeformReply: boolean;
  risk?: string;
  expiresAt?: string;
  status: "pending" | "responded" | string;
  createdAt: string;
  response?: ApprovalResponse;
  metadata?: Record<string, string>;
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
  };
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
  return request.status;
}

export type ProjectGroup = {
  id: string;
  label: string;
  requests: ApprovalRequest[];
};

export function requestProjectID(request: ApprovalRequest) {
  const explicit = request.requester.projectId?.trim();
  if (explicit) {
    return explicit;
  }
  const host = request.requester.host?.trim() || request.requester.name?.trim() || "Agent";
  const cwd = request.requester.workingDirectory?.trim();
  return cwd ? `${host}:${cwd}` : host;
}

export function requestRequesterLabel(request: ApprovalRequest) {
  return request.requester.name || request.requester.agentId;
}

export function requestProjectLabel(request: ApprovalRequest) {
  const explicit = request.requester.projectName?.trim();
  const host = request.requester.host?.trim();
  if (explicit) {
    return host ? `${explicit} · ${host}` : explicit;
  }
  const cwd = request.requester.workingDirectory?.trim();
  if (!cwd) {
    return request.requester.host || request.requester.name || "Agent";
  }
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  const name = parts[parts.length - 1] || cwd;
  return host ? `${name} · ${host}` : name;
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
    request.requestType === "approval" &&
    (request.choices ?? []).some((choice) => choice.id === "approve") &&
    (request.choices ?? []).some((choice) => choice.id === "deny")
  );
}

export function notificationBody(request: ApprovalRequest) {
  if (request.command) {
    const host = request.requester.host || request.requester.name || "Agent";
    return `${host}: ${request.command}`;
  }
  if (isQuestionnaireRequest(request) && request.questions?.length) {
    return request.questions[0]?.question || request.body || "Questions waiting";
  }
  if (isSteerRequest(request)) {
    return request.body || "Steering requested";
  }
  return request.body || "Approval requested";
}
