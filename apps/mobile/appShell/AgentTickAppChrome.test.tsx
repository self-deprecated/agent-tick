import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { AgentTickAppChrome } from "./AgentTickAppChrome";

type ChromeProps = ComponentProps<typeof AgentTickAppChrome>;

function renderChrome(overrides: Partial<ChromeProps> = {}) {
  const props: ChromeProps = {
    accountPending: {},
    accountProfile: null,
    accounts: [],
    connectionStatus: "connected",
    hasSelectedVisibleSession: false,
    needsInputBadgeCount: 0,
    menuOpen: false,
    openSessionActions: jest.fn(),
    screen: "requests",
    serverURL: "https://agenttick.test",
    sessionStackInteractionMode: "stack",
    setMenuOpen: jest.fn(),
    setScreen: jest.fn(),
    setSelectedSessionID: jest.fn(),
    setSettingsViewTarget: jest.fn(),
    toggleSessionStackInteractionMode: jest.fn(),
    visibleSessionCount: 0,
    ...overrides,
  };
  render(<AgentTickAppChrome {...props} />);
  return props;
}

describe("AgentTickAppChrome", () => {
  it("uses the Agent Tick brand button to exit a focused Session back to the Stack", () => {
    const props = renderChrome({ hasSelectedVisibleSession: true, needsInputBadgeCount: 3, visibleSessionCount: 2 });

    expect(screen.getByText("3")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Go to Session Stack"));

    expect(props.setSelectedSessionID).toHaveBeenCalledWith(null);
    expect(props.setScreen).toHaveBeenCalledWith("requests");
    expect(props.setMenuOpen).toHaveBeenCalledWith(false);
  });

  it("does not clear the focused Session when it is the only visible Session", () => {
    const props = renderChrome({ hasSelectedVisibleSession: true, needsInputBadgeCount: 3, visibleSessionCount: 1 });

    expect(screen.queryByText("3")).toBeNull();
    fireEvent.press(screen.getByLabelText("Go to dashboard"));

    expect(props.setSelectedSessionID).not.toHaveBeenCalled();
    expect(props.setScreen).toHaveBeenCalledWith("requests");
  });
});
