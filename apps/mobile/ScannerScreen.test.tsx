import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

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

import { ScannerScreen } from "./scanner/ScannerScreen";

describe("ScannerScreen", () => {
  it("asks for camera access before rendering the scanner", () => {
    const onRequestPermission = jest.fn();
    const onCancel = jest.fn();

    render(<ScannerScreen cameraPermission={null} onCancel={onCancel} onRequestPermission={onRequestPermission} onScan={jest.fn()} scanning={false} />);

    fireEvent.press(screen.getByText("Enable Camera"));
    fireEvent.press(screen.getByText("Cancel"));

    expect(screen.getByText("Camera Access")).toBeTruthy();
    expect(onRequestPermission).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders the QR scanner when camera permission is granted", () => {
    render(<ScannerScreen cameraPermission={{ granted: true } as any} onCancel={jest.fn()} onRequestPermission={jest.fn()} onScan={jest.fn()} scanning={false} />);

    expect(screen.UNSAFE_getByType("CameraView" as any)).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });
});
