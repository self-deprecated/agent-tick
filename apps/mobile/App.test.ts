import {
  buildQuestionnaireAnswers,
  questionnaireReady,
  requestStatusLabel,
  updateQuestionnaireAnswers,
} from "./approvalRequests";
import {
  notificationDecision,
  notificationFallbackState,
  parsePairingPayload,
} from "./AppLogic";

function notificationResponse(actionIdentifier: string, approvalRequestID?: unknown) {
  return {
    actionIdentifier,
    notification: {
      request: {
        content: {
          data: { approvalRequestID },
        },
      },
    },
  };
}

describe("parsePairingPayload", () => {
  it("parses Agent Tick QR JSON payloads", () => {
    expect(
      parsePairingPayload(
        JSON.stringify({
          serverURL: "https://tick.example.com",
          pairingCode: "pair_abc123",
        }),
      ),
    ).toEqual({
      serverURL: "https://tick.example.com",
      pairingCode: "pair_abc123",
    });
  });

  it("accepts raw pairing codes", () => {
    expect(parsePairingPayload("pair_abc123")).toEqual({
      pairingCode: "pair_abc123",
    });
  });

  it("ignores unrelated QR payloads", () => {
    expect(parsePairingPayload("https://example.com")).toEqual({});
  });
});

describe("notificationDecision", () => {
  it("maps approve actions to approval responses", () => {
    expect(notificationDecision(notificationResponse("approve", "req_123"))).toEqual({
      kind: "respond",
      requestID: "req_123",
      choiceID: "approve",
    });
  });

  it("maps deny actions to approval responses", () => {
    expect(notificationDecision(notificationResponse("deny", "req_123"))).toEqual({
      kind: "respond",
      requestID: "req_123",
      choiceID: "deny",
    });
  });

  it("opens the approval for normal notification taps", () => {
    expect(notificationDecision(notificationResponse("default", "req_123"))).toEqual({
      kind: "open",
      requestID: "req_123",
    });
  });

  it("ignores notifications without approval ids", () => {
    expect(notificationDecision(notificationResponse("approve"))).toBeNull();
  });
});

describe("notificationFallbackState", () => {
  it("selects and opens an approval after action response failure", () => {
    expect(notificationFallbackState("req_123")).toEqual({
      notificationTargetID: "req_123",
      selectedID: "req_123",
      screen: "approvals",
    });
  });
});

const questionnaireRequest = {
  id: "req_questions",
  requester: { name: "Claude", agentId: "claude-code" },
  requestType: "questionnaire",
  title: "Pre-flight questions",
  choices: [],
  questions: [
    {
      header: "Environment",
      question: "Which environment?",
      multiSelect: false,
      options: [{ label: "dev" }, { label: "prod" }],
    },
    {
      header: "Checks",
      question: "Which checks should run?",
      multiSelect: true,
      options: [{ label: "lint" }, { label: "test" }],
    },
  ],
  allowFreeformReply: false,
  status: "pending",
  createdAt: "2026-04-19T12:00:00Z",
};

describe("questionnaire helpers", () => {
  it("keeps only answers that still exist on the request", () => {
    expect(
      buildQuestionnaireAnswers(questionnaireRequest, {
        "Which environment?": ["prod"],
        "Which checks should run?": ["lint", "missing"],
      }),
    ).toEqual({
      "Which environment?": ["prod"],
      "Which checks should run?": ["lint"],
    });
  });

  it("updates single-select and multi-select answers", () => {
    let answers = updateQuestionnaireAnswers({}, "Which environment?", "dev", false);
    answers = updateQuestionnaireAnswers(
      answers,
      "Which checks should run?",
      "lint",
      true,
    );
    answers = updateQuestionnaireAnswers(
      answers,
      "Which checks should run?",
      "test",
      true,
    );
    answers = updateQuestionnaireAnswers(
      answers,
      "Which checks should run?",
      "lint",
      true,
    );

    expect(answers).toEqual({
      "Which environment?": ["dev"],
      "Which checks should run?": ["test"],
    });
  });

  it("knows when a questionnaire is ready and labels answered history rows", () => {
    expect(
      questionnaireReady(questionnaireRequest, {
        "Which environment?": ["prod"],
        "Which checks should run?": ["lint"],
      }),
    ).toBe(true);
    expect(questionnaireReady(questionnaireRequest, {})).toBe(false);
    expect(
      requestStatusLabel({
        ...questionnaireRequest,
        response: { answers: { "Which environment?": ["prod"] } },
      }),
    ).toBe("answered");
  });
});
