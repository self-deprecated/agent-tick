import { AgentTickApiError } from "@self-deprecated/agent-tick-sdk";

import {
  isTransientResponseSubmissionError,
  submitResponseWithNetworkRecovery,
} from "./useRequestResponseSubmission";
import type { MobileRequest } from "../requests";

const request = (deliveryKind: MobileRequest["deliveryKind"] = "routed_members") => ({
  id: "req_response_ack",
  deliveryKind,
}) as Pick<MobileRequest, "deliveryKind" | "id">;

describe("submitResponseWithNetworkRecovery", () => {
  it("retries a routed response when the network drops after the server may have accepted it", async () => {
    const accepted = { id: "req_response_ack", status: "responded" } as any;
    const client = {
      respondToRequest: jest.fn()
        .mockRejectedValueOnce(new TypeError("Network request failed"))
        .mockResolvedValueOnce(accepted),
      respondToAudienceRequest: jest.fn(),
    };
    const sleeps: number[] = [];

    await expect(submitResponseWithNetworkRecovery(client, request(), { choiceId: "approve" }, {
      retryDelaysMs: [12],
      sleep: async (ms) => { sleeps.push(ms); },
    })).resolves.toBe(accepted);

    expect(client.respondToRequest).toHaveBeenCalledTimes(2);
    expect(client.respondToRequest).toHaveBeenNthCalledWith(1, "req_response_ack", { choiceId: "approve" });
    expect(client.respondToRequest).toHaveBeenNthCalledWith(2, "req_response_ack", { choiceId: "approve" });
    expect(client.respondToAudienceRequest).not.toHaveBeenCalled();
    expect(sleeps).toEqual([12]);
  });

  it("retries audience responses through the audience endpoint", async () => {
    const accepted = { id: "req_response_ack", status: "pending" } as any;
    const client = {
      respondToRequest: jest.fn(),
      respondToAudienceRequest: jest.fn()
        .mockRejectedValueOnce(new SyntaxError("Unexpected token < in JSON"))
        .mockResolvedValueOnce(accepted),
    };

    await expect(submitResponseWithNetworkRecovery(client, request("audience_channel"), { choiceId: "yes" }, {
      retryDelaysMs: [0],
      sleep: async () => undefined,
    })).resolves.toBe(accepted);

    expect(client.respondToAudienceRequest).toHaveBeenCalledTimes(2);
    expect(client.respondToRequest).not.toHaveBeenCalled();
  });

  it("does not retry definitive client/API errors", async () => {
    const error = new AgentTickApiError("Response choice is not valid", 400, {}, "bad_request");
    const client = {
      respondToRequest: jest.fn().mockRejectedValue(error),
      respondToAudienceRequest: jest.fn(),
    };

    await expect(submitResponseWithNetworkRecovery(client, request(), { choiceId: "missing" }, {
      retryDelaysMs: [0],
      sleep: async () => undefined,
    })).rejects.toBe(error);

    expect(client.respondToRequest).toHaveBeenCalledTimes(1);
  });
});

describe("isTransientResponseSubmissionError", () => {
  it("treats network failures and retryable API statuses as unknown response acknowledgements", () => {
    expect(isTransientResponseSubmissionError(new TypeError("Network request failed"))).toBe(true);
    expect(isTransientResponseSubmissionError(new SyntaxError("Unexpected end of JSON input"))).toBe(true);
    expect(isTransientResponseSubmissionError(new AgentTickApiError("timeout", 408, {}))).toBe(true);
    expect(isTransientResponseSubmissionError(new AgentTickApiError("rate limited", 429, {}))).toBe(true);
    expect(isTransientResponseSubmissionError(new AgentTickApiError("bad gateway", 502, {}))).toBe(true);
    expect(isTransientResponseSubmissionError(new AgentTickApiError("bad request", 400, {}))).toBe(false);
  });
});
