import { AgentTickApiError } from "@self-deprecated/agent-tick-sdk";

import { grantHostedDevResponseAccess } from "./useMobileSettingsActionsController";

describe("grantHostedDevResponseAccess", () => {
  it("uses the hosted billing test grant when the server allows test billing", async () => {
    const sdk = {
      updatePersonalBilling: jest.fn().mockResolvedValue({}),
    };

    await expect(grantHostedDevResponseAccess(sdk)).resolves.toBeUndefined();

    expect(sdk.updatePersonalBilling).toHaveBeenCalledWith({ event: "subscribe_monthly" });
  });

  it("does not hide hosted grant failures", async () => {
    const error = new AgentTickApiError("test mode required", 403, {}, "billing_test_mode_required");
    const sdk = {
      updatePersonalBilling: jest.fn().mockRejectedValue(error),
    };

    await expect(grantHostedDevResponseAccess(sdk)).rejects.toBe(error);
  });
});
