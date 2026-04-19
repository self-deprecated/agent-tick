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
