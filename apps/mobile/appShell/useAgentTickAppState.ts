import type { RuntimeAuthConfig } from "../mobileAuth";
import { useAgentTickNavigationState } from "./useAgentTickNavigationState";
import { useMobileActivityState } from "./useMobileActivityState";
import { useMobileAppStatusState } from "./useMobileAppStatusState";
import { useMobileBillingState } from "./useMobileBillingState";
import { useMobileConnectionAccountState } from "./useMobileConnectionAccountState";
import { useMobileRuntimeRefs } from "./useMobileRuntimeRefs";
import { useNotificationTargetState } from "./useNotificationTargetState";

type UseAgentTickAppStateInput = {
  defaultServer: string;
  initialAuthConfig?: RuntimeAuthConfig | null;
  initialServerURL?: string;
};

export function useAgentTickAppState({
  defaultServer,
  initialAuthConfig,
  initialServerURL,
}: UseAgentTickAppStateInput) {
  const navigationState = useAgentTickNavigationState();
  const connectionAccountState = useMobileConnectionAccountState({
    defaultServer,
    initialAuthConfig,
    initialServerURL,
  });
  const activityState = useMobileActivityState();
  const notificationTargetState = useNotificationTargetState();
  const appStatusState = useMobileAppStatusState();
  const billingState = useMobileBillingState();
  const runtimeRefs = useMobileRuntimeRefs();

  return {
    navigationState,
    connectionAccountState,
    activityState,
    notificationTargetState,
    appStatusState,
    billingState,
    runtimeRefs,
  };
}
