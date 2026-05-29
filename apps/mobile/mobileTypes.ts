import type { SessionDetail, SessionSummary } from "@self-deprecated/agent-tick-sdk";

export type AccountPendingState =
  | { status: "checking"; count: 0 }
  | { status: "ready"; count: number }
  | { status: "needs-sign-in"; count: 0 }
  | { status: "error"; count: 0 };

export type MobileSessionSummary = SessionSummary & {
  mobileSessionKey?: string;
  connectionID?: string;
  connectionLabel?: string;
  connectionServerURL?: string;
  workspaceID?: string | null;
};

export type MobileSessionDetail = SessionDetail & {
  connectionID?: string;
  connectionLabel?: string;
  connectionServerURL?: string;
  workspaceID?: string | null;
};
