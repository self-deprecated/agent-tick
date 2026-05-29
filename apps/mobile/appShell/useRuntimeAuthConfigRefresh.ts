import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { MeResponse, WorkspaceMemberRecord } from "@self-deprecated/agent-tick-sdk";

import { recordDiagnostic } from "../diagnostics";
import { fetchRuntimeAuthConfig, normalizeServerURL, type RuntimeAuthConfig } from "../mobileAuth";
import type { ConnectionStatus } from "../SettingsScreen";
import { cachedRuntimeAuthConfig, writeRuntimeAuthConfigCache } from "./runtimeAuthConfigCache";

export function useRuntimeAuthConfigRefresh({
  serverURL,
  settingsLoaded,
  runtimeAuthConfig,
  onRuntimeAuthConfig,
  setRuntimeAuthConfig,
  setToken,
  setDeviceID,
  setWorkspaces,
  setCurrentAccountProfile,
  setSelectedWorkspaceID,
  setConnectionStatus,
}: {
  serverURL: string;
  settingsLoaded: boolean;
  runtimeAuthConfig: RuntimeAuthConfig | null;
  onRuntimeAuthConfig?: (serverURL: string, authConfig: RuntimeAuthConfig | null) => void;
  setRuntimeAuthConfig: Dispatch<SetStateAction<RuntimeAuthConfig | null>>;
  setToken: Dispatch<SetStateAction<string>>;
  setDeviceID: Dispatch<SetStateAction<string>>;
  setWorkspaces: Dispatch<SetStateAction<WorkspaceMemberRecord[]>>;
  setCurrentAccountProfile: Dispatch<SetStateAction<MeResponse | null>>;
  setSelectedWorkspaceID: Dispatch<SetStateAction<string>>;
  setConnectionStatus: Dispatch<SetStateAction<ConnectionStatus>>;
}) {
  const runtimeAuthConfigRef = useRef<RuntimeAuthConfig | null>(runtimeAuthConfig);

  useEffect(() => {
    runtimeAuthConfigRef.current = runtimeAuthConfig;
  }, [runtimeAuthConfig]);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    let cancelled = false;
    const loadRuntimeAuthConfig = async () => {
      try {
        const nextConfig = await fetchRuntimeAuthConfig(serverURL);
        await writeRuntimeAuthConfigCache(serverURL, nextConfig);
        if (cancelled) return;
        setRuntimeAuthConfig(nextConfig);
        onRuntimeAuthConfig?.(serverURL, nextConfig);
        if (nextConfig.authProvider === "clerk") {
          setToken((currentToken) => {
            if (currentToken) setDeviceID("");
            return "";
          });
        } else {
          setWorkspaces([]);
          setCurrentAccountProfile(null);
          setSelectedWorkspaceID("");
        }
      } catch (err) {
        const cachedConfig = await cachedRuntimeAuthConfig(serverURL);
        if (cancelled) return;
        if (cachedConfig) {
          recordDiagnostic("warn", "auth", "runtime_auth_config_cache_fallback", { serverURL: normalizeServerURL(serverURL), message: err instanceof Error ? err.message : String(err) });
          setRuntimeAuthConfig(cachedConfig);
          setConnectionStatus("disconnected");
          onRuntimeAuthConfig?.(serverURL, cachedConfig);
          return;
        }
        recordDiagnostic("warn", "auth", "runtime_auth_config_unavailable", { serverURL: normalizeServerURL(serverURL), message: err instanceof Error ? err.message : String(err) });
        setConnectionStatus("disconnected");
        if (!runtimeAuthConfigRef.current) {
          setRuntimeAuthConfig(null);
          onRuntimeAuthConfig?.(serverURL, null);
        }
      }
    };
    void loadRuntimeAuthConfig();
    return () => {
      cancelled = true;
    };
  }, [onRuntimeAuthConfig, serverURL, settingsLoaded]);
}
