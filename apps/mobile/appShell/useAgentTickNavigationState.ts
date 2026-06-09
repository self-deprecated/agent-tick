import { useState } from "react";

import type { Screen } from "../AppLogic";

export type SettingsViewTarget = { view: "home" | "notifications"; signal: number };

export function useAgentTickNavigationState() {
  const [screen, setScreen] = useState<Screen>("requests");
  const [settingsViewTarget, setSettingsViewTarget] = useState<SettingsViewTarget>({ view: "home", signal: 0 });
  const [menuOpen, setMenuOpen] = useState(false);

  return {
    screen,
    setScreen,
    settingsViewTarget,
    setSettingsViewTarget,
    menuOpen,
    setMenuOpen,
  };
}
