import type { ComponentProps } from "react";

import { HistoryScreen } from "../history/HistoryScreen";

type MaybePromise<T> = T | Promise<T>;

type AgentTickHistoryRouteProps = {
  error: ComponentProps<typeof HistoryScreen>["error"];
  history: ComponentProps<typeof HistoryScreen>["history"];
  historyLoading: ComponentProps<typeof HistoryScreen>["loading"];
  historySessionDetails: NonNullable<ComponentProps<typeof HistoryScreen>["sessionDetails"]>;
  historySessions: NonNullable<ComponentProps<typeof HistoryScreen>["sessionArchives"]>;
  loadHistory: () => MaybePromise<void>;
};

export function AgentTickHistoryRoute({
  error,
  history,
  historyLoading,
  historySessionDetails,
  historySessions,
  loadHistory,
}: AgentTickHistoryRouteProps) {
  return (
    <HistoryScreen
      error={error}
      history={history}
      sessionArchives={historySessions}
      sessionDetails={historySessionDetails}
      loading={historyLoading}
      onRefresh={() => void loadHistory()}
    />
  );
}
