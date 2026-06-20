import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { KeyboardAvoidingView, Platform } from "react-native";

const { ClerkSignInScreen } = require("./ClerkSignInScreen") as typeof import("./ClerkSignInScreen");
const { knownServersStorageKey } = require("./knownServers") as typeof import("./knownServers");
const { hostedServerURL } = require("./mobileAuth") as typeof import("./mobileAuth");

function mockAuthConfig(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("ClerkSignInScreen", () => {
  beforeEach(() => {
    // Return a fresh Response per call: the picker verifies the server on add,
    // then the sign-in path fetches again, so the body is consumed twice.
    jest.spyOn(global, "fetch").mockImplementation(async () => mockAuthConfig({ mode: "single", authProvider: "local", publicURL: "https://selfhost.example.com" }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows the server picker and remembers a previously added self-hosted server", async () => {
    await AsyncStorage.setItem(knownServersStorageKey, JSON.stringify([
      { url: "https://dev.example.com", authProvider: "clerk", lastUsedAt: "2026-06-01T00:00:00.000Z" },
    ]));

    render(<ClerkSignInScreen serverURL="https://app.agenttick.sh" />);

    expect(screen.getByText("Agent Tick")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("agenttick.sh")).toBeTruthy());
    expect(screen.getByText("dev.example.com")).toBeTruthy();
    expect(screen.getByText("Sign in to agenttick.sh")).toBeTruthy();
  });

  it("opens hosted Clerk sign-in after tapping the hosted sign-in button", () => {
    render(<ClerkSignInScreen serverURL="https://app.agenttick.sh" />);

    fireEvent.press(screen.getByText("Sign in to agenttick.sh"));

    expect(screen.getByText("Sign in to Agent Tick")).toBeTruthy();
    expect(screen.getByText("‹ Back")).toBeTruthy();
    expect(screen.getByText("Native Clerk AuthView signInOrUp false")).toBeTruthy();
  });

  it("can delegate hosted sign-in before mounting Clerk native auth", () => {
    const onSignInSelected = jest.fn();
    render(<ClerkSignInScreen serverURL="https://app.agenttick.sh" onSignInSelected={onSignInSelected} />);

    fireEvent.press(screen.getByText("Sign in to agenttick.sh"));

    expect(onSignInSelected).toHaveBeenCalled();
    expect(screen.queryByText("Native Clerk AuthView signInOrUp false")).toBeNull();
  });

  it("opens directly to hosted Clerk sign-in when requested", () => {
    render(<ClerkSignInScreen serverURL="https://app.agenttick.sh" initialShowAuthView />);

    expect(screen.getByText("Sign in to Agent Tick")).toBeTruthy();
    expect(screen.getByText("Native Clerk AuthView signInOrUp false")).toBeTruthy();
    expect(screen.queryByText("Sign in to agenttick.sh")).toBeNull();
  });

  it("reports add-account cancellation instead of dropping to the intro screen", () => {
    const onCancel = jest.fn();
    render(<ClerkSignInScreen serverURL="https://app.agenttick.sh" initialShowAuthView onCancel={onCancel} />);

    fireEvent.press(screen.getByText("‹ Back"));

    expect(onCancel).toHaveBeenCalled();
    expect(screen.queryByText("Sign in to agenttick.sh")).toBeNull();
  });

  it("keeps the sign-in screen keyboard-aware", () => {
    render(<ClerkSignInScreen serverURL="https://app.agenttick.sh" />);

    expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe(Platform.OS === "ios" ? "padding" : "height");
  });

  it("checks a self-hosted server after adding it and pressing sign in", async () => {
    jest.spyOn(global, "fetch").mockImplementation(async () => mockAuthConfig({ mode: "single", authProvider: "local", publicURL: "https://selfhost.example.com" }));
    const onServerSelected = jest.fn();
    render(<ClerkSignInScreen serverURL={hostedServerURL} onServerSelected={onServerSelected} />);

    fireEvent.press(screen.getByLabelText("Add another Agent Tick server"));
    fireEvent.changeText(screen.getByLabelText("New self-hosted server URL"), "https://selfhost.example.com/");
    fireEvent.press(screen.getByLabelText("Add self-hosted server"));

    await waitFor(() => {
      expect(screen.getByText("Sign in to selfhost.example.com")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Sign in to selfhost.example.com"));

    await waitFor(() => {
      expect(onServerSelected).toHaveBeenCalledWith(
        "https://selfhost.example.com",
        expect.objectContaining({ authProvider: "local" }),
      );
    });

    // The server is remembered for next time.
    expect(JSON.parse((await AsyncStorage.getItem(knownServersStorageKey)) ?? "[]")).toEqual(
      expect.arrayContaining([expect.objectContaining({ url: "https://selfhost.example.com", authProvider: "local" })]),
    );
  });

  it("checks the server a second Clerk account would sign in to and re-bootstraps", async () => {
    jest.spyOn(global, "fetch").mockImplementation(async () => mockAuthConfig({ mode: "clerk", authProvider: "clerk", clerkPublishableKey: "pk_test_dev" }));
    const onServerSelected = jest.fn();
    render(<ClerkSignInScreen serverURL={hostedServerURL} onServerSelected={onServerSelected} />);

    fireEvent.press(screen.getByLabelText("Add another Agent Tick server"));
    fireEvent.changeText(screen.getByLabelText("New self-hosted server URL"), "https://dev.example.com");
    fireEvent.press(screen.getByLabelText("Add self-hosted server"));

    await waitFor(() => expect(screen.getByText("Sign in to dev.example.com")).toBeTruthy());
    fireEvent.press(screen.getByText("Sign in to dev.example.com"));

    await waitFor(() => {
      expect(onServerSelected).toHaveBeenCalledWith(
        "https://dev.example.com",
        expect.objectContaining({ authProvider: "clerk", clerkPublishableKey: "pk_test_dev" }),
      );
    });
  });

  it("rejects a URL that is not an Agent Tick server and keeps the entry", async () => {
    jest.spyOn(global, "fetch").mockImplementation(async () => new Response("<html>not agent tick</html>", { status: 404 }));
    const onServerSelected = jest.fn();
    render(<ClerkSignInScreen serverURL={hostedServerURL} onServerSelected={onServerSelected} />);

    fireEvent.press(screen.getByLabelText("Add another Agent Tick server"));
    fireEvent.changeText(screen.getByLabelText("New self-hosted server URL"), "google.com");
    fireEvent.press(screen.getByLabelText("Add self-hosted server"));

    await waitFor(() => expect(screen.getByText(/is not an Agent Tick server/)).toBeTruthy());
    // Not recorded, not selected, and the entry stays so the user can correct it.
    expect(screen.getByLabelText("New self-hosted server URL")).toBeTruthy();
    const stored = JSON.parse((await AsyncStorage.getItem(knownServersStorageKey)) ?? "[]");
    expect(stored.find((s: { url: string }) => s.url === "https://google.com")).toBeUndefined();
    expect(onServerSelected).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });
});
