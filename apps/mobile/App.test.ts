import {
  buildQuestionnaireAnswers,
  canRespondToRequest,
  groupRequestsByProject,
  isEncryptedApprovalRequest,
  normalizeApproval,
  policyProgressMessage,
  questionnaireReady,
  requestCommandDetails,
  requestPolicySummary,
  requestResponsibilityLabel,
  requestStatusLabel,
  requestVoteHistory,
  supportsNotificationActions,
  updateQuestionnaireAnswers,
  requestProjectID,
  requestProjectLabel,
  requestRequesterLabel,
  shouldScheduleLocalNotifications,
} from "./approvalRequests";
import {
  entitlementStatusCopy,
  formatHostedDate,
  hostedPersonalActive,
  hostedUsageExpiry,
  hostedUsageExpiryWarning,
  nativeAppEntitlement,
  notificationDecision,
  notificationFallbackState,
  notificationRequestID,
  parsePairingPayload,
  trialRemainingLabel,
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

describe("native app entitlement", () => {
  it("starts a seven-day local trial without sign-in", () => {
    const state = nativeAppEntitlement({ now: new Date("2026-05-01T00:00:00.000Z") });
    expect(state.trialActive).toBe(true);
    expect(state.readOnly).toBe(false);
    expect(state.trialEndsAt).toBe("2026-05-08T00:00:00.000Z");
    expect(trialRemainingLabel(state.trialRemainingMs)).toBe("7 days left in trial");
  });

  it("makes the app read-only after trial without lifetime unlock", () => {
    const state = nativeAppEntitlement({
      now: new Date("2026-05-09T00:00:00.000Z"),
      firstOpenedAt: "2026-05-01T00:00:00.000Z",
    });
    expect(state.trialActive).toBe(false);
    expect(state.readOnly).toBe(true);
  });

  it("keeps self-host app use unlocked after lifetime purchase", () => {
    const state = nativeAppEntitlement({
      now: new Date("2026-05-09T00:00:00.000Z"),
      firstOpenedAt: "2026-05-01T00:00:00.000Z",
      lifetimeUnlocked: true,
    });
    expect(state.readOnly).toBe(false);
  });

  it("provides clear app access and paywall copy", () => {
    const trial = nativeAppEntitlement({ now: new Date("2026-05-02T00:00:00.000Z"), firstOpenedAt: "2026-05-01T00:00:00.000Z" });
    expect(entitlementStatusCopy(trial)).toMatchObject({
      title: "Trial active",
      summary: "6 days left in trial",
      paywall: "Buy Lifetime app unlock before Trial ends to keep responding from this app.",
    });

    const readOnly = nativeAppEntitlement({ now: new Date("2026-05-09T00:00:00.000Z"), firstOpenedAt: "2026-05-01T00:00:00.000Z" });
    expect(entitlementStatusCopy(readOnly)).toMatchObject({
      title: "Read-only after Trial",
      appAccess: "Responses are disabled until Lifetime app unlock is purchased or restored.",
    });

    const subscribed = nativeAppEntitlement({
      now: new Date("2026-05-20T00:00:00.000Z"),
      firstOpenedAt: "2026-05-01T00:00:00.000Z",
      lifetimeUnlocked: true,
      hostedSubscriptionActive: true,
    });
    expect(entitlementStatusCopy(subscribed)).toMatchObject({
      title: "Hosted service active",
      hostedAccess: "agenttick.sh routing, push, updates, and uptime are covered by your hosted subscription.",
    });
  });

  it("does not consume the included hosted month during the initial trial", () => {
    const trial = nativeAppEntitlement({ now: new Date("2026-05-02T00:00:00.000Z"), firstOpenedAt: "2026-05-01T00:00:00.000Z" });
    expect(hostedPersonalActive(trial)).toBe(true);
    expect(trial.includedHostedActive).toBe(false);

    const includedMonth = nativeAppEntitlement({
      now: new Date("2026-05-20T00:00:00.000Z"),
      firstOpenedAt: "2026-05-01T00:00:00.000Z",
      lifetimeUnlocked: true,
      includedHostedActivatedAt: "2026-05-15T00:00:00.000Z",
    });
    expect(hostedPersonalActive(includedMonth)).toBe(true);
    expect(includedMonth.includedHostedActive).toBe(true);
  });
});

describe("hosted usage expiry", () => {
  it("reports trial expiry and warns inside one week without renewal", () => {
    const status = {
      hostedPersonal: {
        lifecycle: "active",
        trialEndsAt: "2026-05-08T00:00:00.000Z",
        responsesEnabled: true,
        routingEnabled: true,
        pushEnabled: true,
        historyRetentionDays: 30,
      },
      activeEntitlements: {
        lifetimeUnlock: { active: false },
        hostedPersonal: { active: false },
      },
    } as const;

    expect(hostedUsageExpiry(status, new Date("2026-05-02T00:00:00.000Z"))).toMatchObject({ source: "trial", expiresAt: "2026-05-08T00:00:00.000Z", renewable: false });
    expect(hostedUsageExpiryWarning(status, new Date("2026-05-02T00:00:00.000Z"))).toMatchObject({ source: "trial" });
    expect(formatHostedDate("2026-05-08T00:00:00.000Z")).toBe("May 8, 2026");
  });

  it("does not warn when a hosted subscription is set to renew", () => {
    const status = {
      hostedPersonal: {
        lifecycle: "active",
        trialEndsAt: "2026-05-08T00:00:00.000Z",
        hostedSubscriptionEndsAt: "2026-05-20T00:00:00.000Z",
        responsesEnabled: true,
        routingEnabled: true,
        pushEnabled: true,
        historyRetentionDays: 30,
      },
      activeEntitlements: {
        lifetimeUnlock: { active: true },
        hostedPersonal: { active: true, expiresAt: "2026-05-20T00:00:00.000Z", willRenew: true },
      },
    } as const;

    expect(hostedUsageExpiry(status, new Date("2026-05-15T00:00:00.000Z"))).toMatchObject({ source: "subscription", renewable: true });
    expect(hostedUsageExpiryWarning(status, new Date("2026-05-15T00:00:00.000Z"))).toBeNull();
  });
});

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

  it("parses Clerk mode discovery QR payloads", () => {
    expect(
      parsePairingPayload(
        JSON.stringify({
          serverURL: "https://tick.example.com",
          mode: "clerk",
          authProvider: "clerk",
          organizationId: "org_123",
        }),
      ),
    ).toEqual({
      serverURL: "https://tick.example.com",
      mode: "clerk",
      authProvider: "clerk",
      organizationId: "org_123",
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
  it("opens the approval for notification action payloads without responding", () => {
    expect(notificationDecision(notificationResponse("approve", "req_123"))).toEqual({
      kind: "open",
      requestID: "req_123",
    });
    expect(notificationDecision(notificationResponse("deny", "req_123"))).toEqual({
      kind: "open",
      requestID: "req_123",
    });
  });

  it("opens the approval for normal notification taps", () => {
    expect(notificationDecision(notificationResponse("default", "req_123"))).toEqual({
      kind: "open",
      requestID: "req_123",
    });
  });

  it("accepts team/quorum push payload aliases", () => {
    expect(notificationRequestID({ requestId: "req_step" })).toBe("req_step");
    expect(
      notificationDecision({
        actionIdentifier: "default",
        notification: { request: { content: { data: { approvalRequestId: "req_quorum" } } } },
      }),
    ).toEqual({ kind: "open", requestID: "req_quorum" });
  });

  it("ignores malformed native notification payloads", () => {
    expect(notificationRequestID(null)).toBe("");
    expect(notificationRequestID(undefined)).toBe("");
    expect(notificationRequestID("req_123")).toBe("");
    expect(notificationDecision({ actionIdentifier: "default", notification: null })).toBeNull();
    expect(notificationDecision({ actionIdentifier: "approve", notification: { request: { content: { data: null } } } })).toBeNull();
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

describe("project grouping helpers", () => {
  it("groups requests by explicit project id", () => {
    const requests = [
      normalizeApproval({
        id: "req_a",
        requester: { name: "Agent", agentId: "agent", host: "box", workingDirectory: "/work/a", projectName: "Alpha", projectId: "box:/work/a" },
        title: "A",
        choices: [],
        allowFreeformReply: false,
        status: "pending",
        createdAt: "2026-04-19T12:00:00Z",
      }),
      normalizeApproval({
        id: "req_b",
        requester: { name: "Agent", agentId: "agent", host: "box", workingDirectory: "/work/a", projectName: "Alpha", projectId: "box:/work/a" },
        title: "B",
        choices: [],
        allowFreeformReply: false,
        status: "pending",
        createdAt: "2026-04-19T12:00:00Z",
      }),
      normalizeApproval({
        id: "req_c",
        requester: { name: "Agent", agentId: "agent", host: "box", workingDirectory: "/work/c" },
        title: "C",
        choices: [],
        allowFreeformReply: false,
        status: "pending",
        createdAt: "2026-04-19T12:00:00Z",
      }),
    ];

    const [first, second, third] = requests;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();
    expect(requestProjectID(first!)).toBe("box:/work/a");
    expect(requestProjectLabel(third!)).toBe("c");
    expect(groupRequestsByProject(requests)).toEqual([
      { id: "box:/work/a", label: "Alpha", requests: [first!, second!] },
      { id: "box:/work/c", label: "c", requests: [third!] },
    ]);
  });
});

describe("approval detail metadata helpers", () => {
  it("builds detailed command history rows", () => {
    const request = normalizeApproval({
      id: "req_cmd",
      requester: {
        name: "agent-tick",
        agentId: "agent",
        host: "lattice",
        workingDirectory: "/work/agent-tick",
        projectName: "agent-tick",
      },
      title: "Run tests?",
      command: "corepack pnpm test -- --runInBand",
      choices: [{ id: "approve", label: "Approve", kind: "approve" }],
      allowFreeformReply: false,
      status: "responded",
      createdAt: "2026-04-19T12:00:00Z",
      respondedAt: "2026-04-19T12:03:00Z",
    });

    expect(requestCommandDetails(request)).toEqual([
      { label: "Command", value: "corepack pnpm test -- --runInBand" },
      { label: "Project", value: "agent-tick" },
      { label: "Directory", value: "/work/agent-tick" },
      { label: "Host", value: "lattice" },
      { label: "Requested", value: "2026-04-19T12:00:00Z" },
      { label: "Responded", value: "2026-04-19T12:03:00Z" },
      { label: "Request ID", value: "req_cmd" },
    ]);
  });

  it("keeps requester and project context separate to avoid duplicate host text", () => {
    const request = normalizeApproval({
      id: "req_project",
      requester: {
        name: "agent-tick",
        agentId: "agent",
        host: "lattice",
        workingDirectory: "/work/agent-tick",
        projectName: "agent-tick",
      },
      title: "Approve?",
      choices: [{ id: "approve", label: "Approve", kind: "approve" }],
      allowFreeformReply: false,
      status: "pending",
      createdAt: "2026-04-19T12:00:00Z",
    });

    expect(requestRequesterLabel(request)).toBe("agent-tick");
    expect(requestProjectLabel(request)).toBe("agent-tick");
  });
});

describe("policy progress helpers", () => {
  it("shows current-user quorum waiting state after voting", () => {
    const request = normalizeApproval({
      id: "req_quorum",
      requester: { name: "Agent", agentId: "agent" },
      requestType: "approval",
      title: "Deploy?",
      choices: [
        { id: "approve", label: "Approve", kind: "approve" },
        { id: "deny", label: "Deny", kind: "deny" },
      ],
      allowFreeformReply: false,
      status: "pending",
      createdAt: "2026-04-19T12:00:00Z",
      metadata: { teamName: "Backend", approvalPolicySummary: "Requires 2 approvals from Backend" },
      policyProgress: {
        policyId: "pol_backend",
        state: "pending",
        currentStep: 1,
        totalSteps: 1,
        requiredApprovals: 2,
        receivedApprovals: 1,
        currentUserHasVoted: true,
        currentUserEligible: true,
        currentUserVote: {
          voteId: "vote_a",
          requestId: "req_quorum",
          step: 1,
          approverUserId: "usr_a",
          source: "device",
          choiceId: "approve",
          createdAt: "2026-04-19T12:01:00Z",
        },
        waitingFor: 1,
        votes: [
          {
            voteId: "vote_a",
            requestId: "req_quorum",
            step: 1,
            approverUserId: "usr_a",
            source: "device",
            choiceId: "approve",
            createdAt: "2026-04-19T12:01:00Z",
          },
        ],
      },
    });

    expect(requestPolicySummary(request)).toBe("Requires 2 approvals from Backend");
    expect(requestResponsibilityLabel(request)).toBe("Waiting for others");
    expect(policyProgressMessage(request)).toBe("You approved. Waiting for 1 more approval.");
    expect(canRespondToRequest(request)).toBe(false);
    expect(supportsNotificationActions(request)).toBe(false);
    expect(requestVoteHistory(request)[0]?.label).toBe("Step 1: usr_a approved via device");
  });

  it("distinguishes eligible and ineligible team approval views", () => {
    const eligible = normalizeApproval({
      id: "req_team",
      requester: { name: "Agent", agentId: "agent" },
      requestType: "approval",
      title: "Restart?",
      choices: [
        { id: "approve", label: "Approve", kind: "approve" },
        { id: "deny", label: "Deny", kind: "deny" },
      ],
      allowFreeformReply: false,
      status: "pending",
      createdAt: "2026-04-19T12:00:00Z",
      policyProgress: {
        state: "pending",
        currentStep: 1,
        totalSteps: 2,
        requiredApprovals: 1,
        receivedApprovals: 0,
        currentUserHasVoted: false,
        currentUserEligible: true,
        waitingFor: 1,
      },
    });
    const ineligible = normalizeApproval({
      ...eligible,
      id: "req_readonly",
      policyProgress: { ...eligible.policyProgress!, currentUserEligible: false },
    });

    expect(requestResponsibilityLabel(eligible)).toBe("Your approval is needed");
    expect(policyProgressMessage(eligible)).toContain("Step 1 of 2. Your approval is needed");
    expect(canRespondToRequest(eligible)).toBe(true);
    expect(requestResponsibilityLabel(ineligible)).toBe("Read-only");
    expect(policyProgressMessage(ineligible)).toContain("You are not an eligible approver");
    expect(canRespondToRequest(ineligible)).toBe(false);
  });
});

describe("request normalization and notification helpers", () => {
  it("treats encrypted placeholders as encrypted even if ciphertext is missing", () => {
    const request = normalizeApproval({
      id: "req_encrypted_placeholder",
      requester: { name: "Agent", agentId: "agent" },
      requestType: "approval",
      title: "Encrypted approval request",
      body: "Open Agent Tick to decrypt this request.",
      choices: [
        { id: "approve", label: "Approve", kind: "approve" },
        { id: "reject", label: "Reject", kind: "deny" },
      ],
      allowFreeformReply: false,
      status: "pending",
      createdAt: "2026-04-19T12:00:00Z",
    });

    expect(isEncryptedApprovalRequest(request)).toBe(true);
    expect(canRespondToRequest(request)).toBe(false);
    expect(supportsNotificationActions(request)).toBe(false);
  });

  it("preserves steer request type and disables approve/deny notification actions", () => {
    const steer = normalizeApproval({
      id: "req_steer",
      requester: { name: "Agent", agentId: "agent" },
      requestType: "steer",
      title: "Choose next step",
      choices: [
        { id: "run-tests", label: "Run tests", kind: "steer" },
        { id: "none", label: "Do nothing / skip", kind: "none" },
      ],
      allowFreeformReply: false,
      status: "pending",
      createdAt: "2026-04-19T12:00:00Z",
    });

    expect(steer.requestType).toBe("steer");
    expect(supportsNotificationActions(steer)).toBe(false);
  });

  it("disables notification actions for launch", () => {
    expect(
      supportsNotificationActions({
        id: "req_approve",
        requester: { name: "Agent", agentId: "agent" },
        requestType: "approval",
        title: "Run?",
        choices: [
          { id: "approve", label: "Approve", kind: "approve" },
          { id: "deny", label: "Deny", kind: "deny" },
        ],
        allowFreeformReply: false,
        status: "pending",
        createdAt: "2026-04-19T12:00:00Z",
      }),
    ).toBe(false);
  });

  it("does not schedule local notification copies at launch", () => {
    expect(shouldScheduleLocalNotifications("registered")).toBe(false);
    expect(shouldScheduleLocalNotifications("idle")).toBe(false);
    expect(shouldScheduleLocalNotifications("failed")).toBe(false);
    expect(shouldScheduleLocalNotifications("idle", false)).toBe(false);
  });
});

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
    ).toBe("Answered");
  });
});
