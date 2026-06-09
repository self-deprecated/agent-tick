import type { Dispatch, SetStateAction } from "react";
import type { MeResponse } from "@self-deprecated/agent-tick-sdk";

import type { Screen } from "../AppLogic";
import { recordDiagnostic } from "../diagnostics";
import type { SavedMobileAccount } from "../mobileAuth";
import type { AccountPendingState } from "../mobileTypes";
import type { ConnectionStatus } from "../SettingsScreen";
import { SideMenu } from "../sideMenu/SideMenu";
import { AgentTickAppHeader, type AgentTickAppHeaderProps } from "./AgentTickAppHeader";
import type { SettingsViewTarget } from "./useAgentTickNavigationState";

type AgentTickAppChromeProps = {
  accountPending: Record<string, AccountPendingState>;
  accountProfile: MeResponse | null;
  accounts: SavedMobileAccount[];
  connectionStatus: ConnectionStatus;
  hasSelectedVisibleSession: boolean;
  needsInputBadgeCount: number;
  menuOpen: boolean;
  openSessionActions: () => void;
  screen: Screen;
  serverURL: string;
  sessionStackInteractionMode: AgentTickAppHeaderProps["sessionStackInteractionMode"];
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setSelectedSessionID: Dispatch<SetStateAction<string | null>>;
  setSettingsViewTarget: Dispatch<SetStateAction<SettingsViewTarget>>;
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
  needsInputBadgeCount,
  menuOpen,
  openSessionActions,
  screen,
  serverURL,
  sessionStackInteractionMode,
  setMenuOpen,
  setScreen,
  setSelectedSessionID,
  setSettingsViewTarget,
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
        needsInputBadgeCount={needsInputBadgeCount}
        sessionStackInteractionMode={sessionStackInteractionMode}
        onBrandPress={() => {
          const exitsSessionFocus = screen === "requests" && hasSelectedVisibleSession && visibleSessionCount > 1;
          recordDiagnostic("info", "navigation", "brand_pressed", { from: screen, to: "requests", exitsSessionFocus });
          if (exitsSessionFocus) setSelectedSessionID(null);
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
          if (screen === "settings") setSettingsViewTarget((target) => ({ view: "home", signal: target.signal + 1 }));
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
          if (nextScreen === "settings") setSettingsViewTarget((target) => ({ view: "home", signal: target.signal + 1 }));
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
