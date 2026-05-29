import type { ComponentProps } from "react";

import type { Screen } from "../AppLogic";
import { AgentTickHistoryRoute } from "./AgentTickHistoryRoute";
import { AgentTickScannerRoute } from "./AgentTickScannerRoute";
import { AgentTickSessionDashboardRoute } from "./AgentTickSessionDashboardRoute";
import { AgentTickSettingsRoute } from "./AgentTickSettingsRoute";

type AgentTickMainRouteProps = {
  screen: Screen;
  settingsRouteProps: ComponentProps<typeof AgentTickSettingsRoute>;
  scannerRouteProps: ComponentProps<typeof AgentTickScannerRoute>;
  historyRouteProps: ComponentProps<typeof AgentTickHistoryRoute>;
  sessionDashboardRouteProps: ComponentProps<typeof AgentTickSessionDashboardRoute>;
};

export function AgentTickMainRoute({
  screen,
  settingsRouteProps,
  scannerRouteProps,
  historyRouteProps,
  sessionDashboardRouteProps,
}: AgentTickMainRouteProps) {
  switch (screen) {
    case "settings":
      return <AgentTickSettingsRoute {...settingsRouteProps} />;
    case "scanner":
      return <AgentTickScannerRoute {...scannerRouteProps} />;
    case "history":
      return <AgentTickHistoryRoute {...historyRouteProps} />;
    default:
      return <AgentTickSessionDashboardRoute {...sessionDashboardRouteProps} />;
  }
}
