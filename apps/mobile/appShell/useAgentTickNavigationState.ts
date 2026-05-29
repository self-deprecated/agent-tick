import { useState } from "react";

import type { Screen } from "../AppLogic";

export function useAgentTickNavigationState() {
  const [screen, setScreen] = useState<Screen>("requests");
  const [settingsHomeSignal, setSettingsHomeSignal] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  return {
    screen,
    setScreen,
    settingsHomeSignal,
    setSettingsHomeSignal,
    menuOpen,
    setMenuOpen,
  };
}
