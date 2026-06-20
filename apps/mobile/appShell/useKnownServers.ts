import { useCallback, useEffect, useState } from "react";

import { fetchRuntimeAuthConfig, type RuntimeAuthConfig } from "../mobileAuth";
import { type KnownServer, type RecordKnownServerOptions, isKnownInsecureServer, loadKnownServers, recordKnownServer, removeKnownServer } from "../knownServers";

export type UseKnownServersResult = {
  knownServers: KnownServer[];
  loaded: boolean;
  /** Records a server (without verifying it). Use for already-verified URLs. */
  record: (url: string, options?: RecordKnownServerOptions) => Promise<KnownServer[]>;
  /**
   * Probes a URL to confirm it answers as an Agent Tick server, without any
   * HTTPS-policy gate (the caller decides whether an insecure result needs a
   * confirmation). Rejects with a user-facing message on policy failure,
   * network error, or an invalid auth config.
   */
  verify: (url: string) => Promise<RuntimeAuthConfig>;
  remove: (url: string) => Promise<KnownServer[]>;
  reload: () => Promise<KnownServer[]>;
};

/**
 * Loads the remembered server list from storage and keeps a local copy in
 * sync as servers are recorded or removed. Each sign-in surface uses this so
 * the dropdown stays consistent without threading the list through props.
 */
export function useKnownServers(): UseKnownServersResult {
  const [knownServers, setKnownServers] = useState<KnownServer[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadKnownServers().then((servers) => {
      if (cancelled) return;
      setKnownServers(servers);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const record = useCallback(async (url: string, options?: RecordKnownServerOptions) => {
    const next = await recordKnownServer(url, options);
    setKnownServers(next);
    return next;
  }, []);

  const verify = useCallback(async (url: string) => {
    // allowInsecure lets the picker probe a plain-http fallback candidate; the
    // caller is responsible for confirming before recording it.
    try {
      return await fetchRuntimeAuthConfig(url, fetch, { allowInsecure: true });
    } catch {
      throw new Error(`Could not reach ${url} or it is not an Agent Tick server.`);
    }
  }, []);

  const remove = useCallback(async (url: string) => {
    const next = await removeKnownServer(url);
    setKnownServers(next);
    return next;
  }, []);

  const reload = useCallback(async () => {
    const next = await loadKnownServers();
    setKnownServers(next);
    return next;
  }, []);

  return { knownServers, loaded, record, verify, remove, reload };
}

export { isKnownInsecureServer };
