import { useCallback } from "react";
import { Alert } from "react-native";
import type { AgentTickClient } from "@self-deprecated/agent-tick-sdk";

import type { AvailabilityState, ConnectionStatus } from "../SettingsScreen";

type LoadActivity = (options?: { visible?: boolean }) => Promise<void>;

export function useMobileConnectionActions({
  interruptRealtime,
  load,
  sdk,
  setAvailability,
  setConnectionStatus,
}: {
  interruptRealtime: () => void;
  load: LoadActivity;
  sdk: AgentTickClient;
  setAvailability: (state: AvailabilityState) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
}) {
  const checkConnection = useCallback(async () => {
    interruptRealtime();
    setConnectionStatus("checking");
    await load({ visible: true });
  }, [interruptRealtime, load, setConnectionStatus]);

  const updateAvailability = useCallback(async (state: AvailabilityState) => {
    setAvailability(state);
    try {
      const record = await sdk.setAvailability({ state });
      if (record.state) {
        setAvailability(record.state as AvailabilityState);
      }
    } catch (err) {
      Alert.alert(
        "Availability update failed",
        err instanceof Error ? err.message : "Could not update availability",
      );
    }
  }, [sdk, setAvailability]);

  return { checkConnection, updateAvailability };
}
