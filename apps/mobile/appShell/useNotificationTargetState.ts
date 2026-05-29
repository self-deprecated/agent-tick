import { useState } from "react";

export function useNotificationTargetState() {
  const [notificationTargetID, setNotificationTargetID] = useState<string | null>(
    null,
  );
  const [notificationTargetSessionID, setNotificationTargetSessionID] = useState<string | null>(null);
  const [notificationTargetRequestID, setNotificationTargetRequestID] = useState<string | null>(null);
  const [notificationTargetStatusUpdateID, setNotificationTargetStatusUpdateID] = useState<string | null>(null);

  return {
    notificationTargetID,
    setNotificationTargetID,
    notificationTargetSessionID,
    setNotificationTargetSessionID,
    notificationTargetRequestID,
    setNotificationTargetRequestID,
    notificationTargetStatusUpdateID,
    setNotificationTargetStatusUpdateID,
  };
}
