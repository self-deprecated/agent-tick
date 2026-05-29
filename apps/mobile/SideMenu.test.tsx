import React from "react";
import { act, render } from "@testing-library/react-native";
import { Animated } from "react-native";

jest.mock("@clerk/expo", () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ getToken: jest.fn(), isSignedIn: false, signOut: jest.fn() }),
  useSignIn: () => ({ fetchStatus: "idle", signIn: { create: jest.fn(), finalize: jest.fn(), status: "needs_identifier" } }),
}));

jest.mock("expo-camera", () => ({
  CameraView: "CameraView",
  useCameraPermissions: () => [null, jest.fn()],
}));
jest.mock("expo-constants", () => ({ expoConfig: { extra: { eas: {} } }, statusBarHeight: 0 }));
jest.mock("expo-notifications", () => ({
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: "granted" })),
  scheduleNotificationAsync: jest.fn(async () => "notification-id"),
  setNotificationCategoryAsync: jest.fn(async () => null),
  setNotificationHandler: jest.fn(),
}));
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));

import { SideMenu } from "./App";

describe("SideMenu overlay", () => {
  it("unmounts after close even if the native animation callback is interrupted", () => {
    jest.useFakeTimers();
    const timingSpy = jest.spyOn(Animated, "timing").mockReturnValue({
      start: jest.fn(),
      stop: jest.fn(),
      reset: jest.fn(),
    } as unknown as ReturnType<typeof Animated.timing>);
    const props = {
      accountPending: {},
      accountProfile: null,
      accounts: [],
      connectionStatus: "connected" as const,
      currentScreen: "requests" as const,
      onClose: jest.fn(),
      onNavigate: jest.fn(),
      serverURL: "https://app.agenttick.sh",
      visible: true,
    };

    const { queryByText, rerender } = render(<SideMenu {...props} />);
    expect(queryByText("Menu")).toBeTruthy();

    rerender(<SideMenu {...props} visible={false} />);
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(queryByText("Menu")).toBeNull();
    timingSpy.mockRestore();
    jest.useRealTimers();
  });
});
