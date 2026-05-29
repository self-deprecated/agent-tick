import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import { AgentTickClient, type MeResponse, type WorkspaceMemberRecord } from "@self-deprecated/agent-tick-sdk";

import type { RuntimeAuthConfig } from "../mobileAuth";

type UseMobileWorkspacesInput = {
  activeClerkSessionID: string | null;
  currentAuthToken: () => Promise<string>;
  runtimeAuthConfig: RuntimeAuthConfig | null;
  serverURL: string;
  settingsLoaded: boolean;
  setCurrentAccountProfile: Dispatch<SetStateAction<MeResponse | null>>;
  setSelectedWorkspaceID: Dispatch<SetStateAction<string>>;
  setWorkspaces: Dispatch<SetStateAction<WorkspaceMemberRecord[]>>;
};

export function useMobileWorkspaces({
  activeClerkSessionID,
  currentAuthToken,
  runtimeAuthConfig,
  serverURL,
  settingsLoaded,
  setCurrentAccountProfile,
  setSelectedWorkspaceID,
  setWorkspaces,
}: UseMobileWorkspacesInput) {
  const refreshWorkspaces = useCallback(async () => {
    if (runtimeAuthConfig?.authProvider !== "clerk") {
      setCurrentAccountProfile(null);
      setWorkspaces([]);
      return;
    }
    try {
      const workspaceClient = new AgentTickClient({
        baseUrl: serverURL,
        tokenProvider: async () => (await currentAuthToken()) || null,
      });
      const [me, memberships] = await Promise.all([
        workspaceClient.getMe(),
        workspaceClient.listWorkspaces(),
      ]);
      setCurrentAccountProfile(me);
      setWorkspaces(memberships);
      setSelectedWorkspaceID((current) => {
        if (current && memberships.some((membership) => membership.workspaceId === current)) {
          return current;
        }
        return memberships[0]?.workspaceId ?? "";
      });
    } catch {
      setCurrentAccountProfile(null);
      setWorkspaces([]);
    }
  }, [currentAuthToken, runtimeAuthConfig?.authProvider, serverURL]);

  useEffect(() => {
    if (!settingsLoaded || runtimeAuthConfig?.authProvider !== "clerk") {
      return;
    }
    void refreshWorkspaces();
  }, [activeClerkSessionID, refreshWorkspaces, runtimeAuthConfig?.authProvider, settingsLoaded]);
}
