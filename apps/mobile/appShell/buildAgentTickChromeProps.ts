import type { ComponentProps } from "react";

import type { AgentTickAppChrome } from "./AgentTickAppChrome";

type ChromeProps = ComponentProps<typeof AgentTickAppChrome>;

export type BuildAgentTickChromePropsInput = {
  accountPending: ChromeProps["accountPending"];
  accountProfile: ChromeProps["accountProfile"];
  accounts: ChromeProps["accounts"];
  connectionStatus: ChromeProps["connectionStatus"];
  hasSelectedVisibleSession: ChromeProps["hasSelectedVisibleSession"];
  needsInputBadgeCount: ChromeProps["needsInputBadgeCount"];
  menuOpen: ChromeProps["menuOpen"];
  openSessionActions: ChromeProps["openSessionActions"];
  screen: ChromeProps["screen"];
  serverURL: ChromeProps["serverURL"];
  sessionStackInteractionMode: ChromeProps["sessionStackInteractionMode"];
  setMenuOpen: ChromeProps["setMenuOpen"];
  setScreen: ChromeProps["setScreen"];
  setSelectedSessionID: ChromeProps["setSelectedSessionID"];
  setSettingsViewTarget: ChromeProps["setSettingsViewTarget"];
  toggleSessionStackInteractionMode: ChromeProps["toggleSessionStackInteractionMode"];
  visibleSessionCount: ChromeProps["visibleSessionCount"];
  workspaceName: ChromeProps["workspaceName"];
};

export function buildAgentTickChromeProps({
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
}: BuildAgentTickChromePropsInput): ChromeProps {
  return {
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
  };
}
