import type { Dispatch, SetStateAction } from "react";
import type { MeResponse } from "@self-deprecated/agent-tick-sdk";

import type { Screen } from "../AppLogic";
import { recordDiagnostic } from "../diagnostics";
import type { SavedMobileAccount } from "../mobileAuth";
import type { AccountPendingState } from "../mobileTypes";
import type { ConnectionStatus } from "../SettingsScreen";
import { SideMenu } from "../sideMenu/SideMenu";
import { AgentTickAppHeader, type AgentTickAppHeaderProps } from "./AgentTickAppHeader";

type AgentTickAppChromeProps = {
  accountPending: Record<string, AccountPendingState>;
  accountProfile: MeResponse | null;
  accounts: SavedMobileAccount[];
  connectionStatus: ConnectionStatus;
  hasSelectedVisibleSession: boolean;
  menuOpen: boolean;
  openSessionActions: () => void;
  screen: Screen;
  serverURL: string;
  sessionStackInteractionMode: AgentTickAppHeaderProps["sessionStackInteractionMode"];
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setSettingsHomeSignal: Dispatch<SetStateAction<number>>;
  toggleSessionStackInteractionMode: () => void;
  visibleSessionCount: number;
  workspaceName?: string;
};

export function AgentTickAppChrome({
  accountPending,
  accountProfile,
  accounts,
  connectionStatus,
  hasSelectedVisibleSession,
  menuOpen,
  openSessionActions,
  screen,
  serverURL,
  sessionStackInteractionMode,
  setMenuOpen,
  setScreen,
  setSettingsHomeSignal,
  toggleSessionStackInteractionMode,
  visibleSessionCount,
  workspaceName,
}: AgentTickAppChromeProps) {
  return (
    <>
      <AgentTickAppHeader
        screen={screen}
        connectionStatus={connectionStatus}
        visibleSessionCount={visibleSessionCount}
        hasSelectedVisibleSession={hasSelectedVisibleSession}
        sessionStackInteractionMode={sessionStackInteractionMode}
        onBrandPress={() => {
          recordDiagnostic("info", "navigation", "brand_pressed", { from: screen, to: "requests" });
          setScreen("requests");
          setMenuOpen(false);
        }}
        onToggleSessionStackInteractionMode={() => {
          recordDiagnostic("info", "button", "toggle_session_stack_interaction_mode", { from: sessionStackInteractionMode, visibleSessionCount });
          toggleSessionStackInteractionMode();
        }}
        onOpenSessionActions={() => {
          recordDiagnostic("info", "button", hasSelectedVisibleSession ? "open_session_actions" : "open_session_stack_actions", { visibleSessionCount, selectedSession: hasSelectedVisibleSession });
          openSessionActions();
        }}
        onOpenMenu={() => {
          recordDiagnostic("info", "button", "open_menu");
          if (screen === "settings") setSettingsHomeSignal((value) => value + 1);
          setMenuOpen(true);
        }}
      />

      <SideMenu
        accountProfile={accountProfile}
        connectionStatus={connectionStatus}
        accountPending={accountPending}
        currentScreen={screen}
        onClose={() => setMenuOpen(false)}
        onNavigate={(nextScreen) => {
          recordDiagnostic("info", "navigation", "menu_item_selected", { to: nextScreen });
          if (nextScreen === "settings") setSettingsHomeSignal((value) => value + 1);
          setScreen(nextScreen);
          setMenuOpen(false);
        }}
        workspaceName={workspaceName}
        accounts={accounts}
        serverURL={serverURL}
        visible={menuOpen}
      />
    </>
  );
}
