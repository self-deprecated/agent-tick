import { useCallback, useEffect, useRef } from "react";
import { Alert } from "react-native";
import { type PersonalBillingStatus } from "@self-deprecated/agent-tick-shared";
import { translateSource } from "@agent-tick/i18n";

import { formatHostedDate, hostedUsageExpiry, hostedUsageExpiryWarning } from "../AppLogic";

export function useHostedExpiryWarning(personalBillingStatus: PersonalBillingStatus | null) {
  const lastHostedExpiryAlertKey = useRef("");

  const showHostedExpiryAlert = useCallback((expiry: NonNullable<ReturnType<typeof hostedUsageExpiry>>) => {
    const date = formatHostedDate(expiry.expiresAt);
    const lead = expiry.source === "trial"
      ? `${translateSource("Your hosted Trial ends on")} ${date}.`
      : expiry.source === "read_only_grace"
        ? `${translateSource("Hosted read-only grace ends on")} ${date}.`
        : `${translateSource("Your hosted subscription expires on")} ${date}.`;
    const message = [lead, translateSource("Subscribe monthly or yearly to keep hosted routing, push, and responses active.")].join("\n\n");
    Alert.alert(translateSource("Hosted service ending soon"), message);
  }, []);

  const showDebugHostedExpiryWarning = useCallback(() => {
    if (!personalBillingStatus) {
      Alert.alert(translateSource("No hosted expiry loaded"), translateSource("Open App access after billing status loads, then try again."));
      return;
    }
    const expiry = hostedUsageExpiryWarning(personalBillingStatus) ?? hostedUsageExpiry(personalBillingStatus);
    if (!expiry) {
      Alert.alert(translateSource("No hosted expiry loaded"), translateSource("This account does not currently have a hosted expiry to show."));
      return;
    }
    showHostedExpiryAlert(expiry);
  }, [personalBillingStatus, showHostedExpiryAlert]);

  useEffect(() => {
    if (!personalBillingStatus) return;
    const expiry = hostedUsageExpiryWarning(personalBillingStatus);
    if (!expiry) return;
    const alertKey = `${expiry.source}:${expiry.expiresAt}`;
    if (lastHostedExpiryAlertKey.current === alertKey) return;
    lastHostedExpiryAlertKey.current = alertKey;
    showHostedExpiryAlert(expiry);
  }, [personalBillingStatus, showHostedExpiryAlert]);

  return { showDebugHostedExpiryWarning };
}
