import { useRef } from "react";

import type { ChoiceInteractionMode, OptionPlacement } from "../requestsScreen/RequestsScreen";

export const choiceInteractionMode: ChoiceInteractionMode = "click-to-submit";
export const optionPlacement: OptionPlacement = "inline-after-content";
export const confirmBeforeSubmit = true;

export function useMobileRuntimeRefs() {
  const seenRequestIDs = useRef<Set<string>>(new Set());
  const didPrimeNotifications = useRef(false);
  const lastClerkPushRegistrationKey = useRef("");

  return {
    seenRequestIDs,
    didPrimeNotifications,
    lastClerkPushRegistrationKey,
  };
}
