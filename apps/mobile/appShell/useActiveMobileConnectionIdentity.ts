import type { MeResponse } from "@self-deprecated/agent-tick-sdk";

import { savedMobileAccountID, type RuntimeAuthConfig } from "../mobileAuth";
import { jwtStringClaim } from "./clerkSessionHelpers";

type UseActiveMobileConnectionIdentityInput = {
  clerkSessionID?: string | null;
  clerkSessionToken?: string | null;
  currentAccountProfile: Pick<MeResponse, "userId"> | null;
  runtimeAuthConfig: Pick<RuntimeAuthConfig, "authProvider"> | null;
  serverURL: string;
};

export function useActiveMobileConnectionIdentity({
  clerkSessionID,
  clerkSessionToken,
  currentAccountProfile,
  runtimeAuthConfig,
  serverURL,
}: UseActiveMobileConnectionIdentityInput) {
  const activeClerkSessionID = clerkSessionID ?? (clerkSessionToken ? jwtStringClaim(clerkSessionToken, "sid") : null);
  const activeConnectionID = runtimeAuthConfig?.authProvider === "clerk" && currentAccountProfile?.userId
    ? savedMobileAccountID({ serverURL, authProvider: "clerk", userID: currentAccountProfile.userId, clerkSessionID: activeClerkSessionID || undefined })
    : "";

  return { activeClerkSessionID, activeConnectionID };
}
