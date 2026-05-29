import { useEffect, type Dispatch, type SetStateAction } from "react";
import { AgentTickClient, type MeResponse } from "@self-deprecated/agent-tick-sdk";

import { diagnosticEvents, recordDiagnostic } from "../diagnostics";
import { mobileConnectionCredentialKey, normalizeServerURL, type RuntimeAuthConfig } from "../mobileAuth";
import { setSecretValue } from "../mobileSecretStorage";
import { hashDiagnosticID } from "./clerkSessionHelpers";
import { apiStatus } from "./mobileActivityHelpers";

export function useMobileConnectionCredential({
  activeClerkSessionID,
  activeConnectionID,
  clerkSessionToken,
  currentAccountProfile,
  runtimeAuthConfig,
  serverURL,
  setConnectionTokens,
  setDiagnosticsEventCount,
}: {
  activeClerkSessionID: string | null;
  activeConnectionID: string;
  clerkSessionToken?: string | null;
  currentAccountProfile: MeResponse | null;
  runtimeAuthConfig: RuntimeAuthConfig | null;
  serverURL: string;
  setConnectionTokens: Dispatch<SetStateAction<Record<string, string>>>;
  setDiagnosticsEventCount: Dispatch<SetStateAction<number>>;
}) {
  useEffect(() => {
    if (runtimeAuthConfig?.authProvider !== "clerk" || !clerkSessionToken || !currentAccountProfile?.userId || !activeConnectionID) return;
    let cancelled = false;
    const mintConnectionCredential = async () => {
      try {
        const activeServerURL = normalizeServerURL(serverURL);
        const response = await new AgentTickClient({ baseUrl: activeServerURL }).createMobileSession({ clerkToken: clerkSessionToken });
        if (cancelled) return;
        await setSecretValue(mobileConnectionCredentialKey(activeConnectionID), response.token);
        if (cancelled) return;
        setConnectionTokens((current) => (current[activeConnectionID] === response.token ? current : { ...current, [activeConnectionID]: response.token }));
        recordDiagnostic("info", "auth", "mobile_connection_token_saved", {
          connectionIDHash: hashDiagnosticID(activeConnectionID),
          userIDHash: hashDiagnosticID(response.userId),
          workspaceIDHash: hashDiagnosticID(response.workspaceId),
        });
        setDiagnosticsEventCount(diagnosticEvents().length);
      } catch (err) {
        recordDiagnostic("warn", "auth", "mobile_connection_token_failed", { message: err instanceof Error ? err.message : String(err), status: apiStatus(err) });
        setDiagnosticsEventCount(diagnosticEvents().length);
      }
    };
    void mintConnectionCredential();
    return () => {
      cancelled = true;
    };
  }, [activeConnectionID, activeClerkSessionID, clerkSessionToken, currentAccountProfile?.userId, runtimeAuthConfig?.authProvider, serverURL]);
}
