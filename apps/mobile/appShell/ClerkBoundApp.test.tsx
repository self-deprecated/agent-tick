import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

jest.mock("@clerk/expo", () => ({
  useAuth: jest.fn(() => ({
    getToken: jest.fn(async () => null),
    isLoaded: true,
    isSignedIn: false,
    sessionId: null,
    signOut: jest.fn(async () => undefined),
  })),
  useClerk: jest.fn(() => ({ client: { sessions: [] } })),
  useNativeAuthEvents: jest.fn(() => ({ nativeAuthState: { type: "signedOut" } })),
  useNativeSession: jest.fn(() => ({ isSignedIn: false, refresh: jest.fn(async () => undefined) })),
}));

const { ClerkBoundApp } = require("./ClerkBoundApp") as typeof import("./ClerkBoundApp");

describe("ClerkBoundApp", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("keeps a self-hosted Clerk server as the sign-in target", async () => {
    render(
      <ClerkBoundApp
        activeLocale="en"
        initialAuthConfig={{
          authProvider: "clerk",
          clerkPublishableKey: "pk_test_selfhost",
          mode: "clerk",
        }}
        initialServerURL="https://at.example.com"
        localePreference="system"
        onLocalePreferenceChange={jest.fn()}
        onRuntimeAuthConfig={jest.fn()}
        renderAgentTickApp={() => <Text>Agent Tick app</Text>}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("https://at.example.com")).toBeTruthy();
    });
    expect(screen.getByText("Sign in to at.example.com")).toBeTruthy();
    // The hosted server is pinned in the picker, but the bound self-hosted
    // server remains the active sign-in target.
    expect(screen.getByText("agenttick.sh")).toBeTruthy();
    expect(screen.getByLabelText("Sign in to at.example.com")).toBeTruthy();
  });
});
