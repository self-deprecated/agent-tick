import { useState } from "react";
import type { StatusUpdateRecord } from "@self-deprecated/agent-tick-sdk";

import type { MobileRequest } from "../requests";
import type { MobileSessionDetail, MobileSessionSummary } from "../mobileTypes";

export function useMobileActivityState() {
  const [requests, setRequests] = useState<MobileRequest[]>([]);
  const [statusUpdates, setStatusUpdates] = useState<StatusUpdateRecord[]>([]);
  const [sessionSummaries, setSessionSummaries] = useState<MobileSessionSummary[]>([]);
  const [selectedSessionID, setSelectedSessionID] = useState<string | null>(null);
  const [sessionDetails, setSessionDetails] = useState<Record<string, MobileSessionDetail | undefined>>({});
  const [respondingRequestKeys, setRespondingRequestKeys] = useState<Record<string, boolean | undefined>>({});
  const [history, setHistory] = useState<MobileRequest[]>([]);
  const [historySessions, setHistorySessions] = useState<MobileSessionSummary[]>([]);
  const [historySessionDetails, setHistorySessionDetails] = useState<Record<string, MobileSessionDetail | undefined>>({});
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [selectedSourceID, setSelectedSourceID] = useState<string | null>(null);

  return {
    requests,
    setRequests,
    statusUpdates,
    setStatusUpdates,
    sessionSummaries,
    setSessionSummaries,
    selectedSessionID,
    setSelectedSessionID,
    sessionDetails,
    setSessionDetails,
    respondingRequestKeys,
    setRespondingRequestKeys,
    history,
    setHistory,
    historySessions,
    setHistorySessions,
    historySessionDetails,
    setHistorySessionDetails,
    selectedID,
    setSelectedID,
    selectedSourceID,
    setSelectedSourceID,
  };
}
