import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const { ClerkSignInScreen } = require("./ClerkSignInScreen") as typeof import("./ClerkSignInScreen");

describe("ClerkSignInScreen", () => {
  beforeEach(() => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          mode: "single",
          authProvider: "local",
          publicURL: "https://selfhost.example.com",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows a landing page before the hosted Clerk sign-in", () => {
    render(<ClerkSignInScreen serverURL="https://app.agenttick.sh" />);

    expect(screen.getByText("Agent Tick")).toBeTruthy();
    expect(screen.getByText("https://app.agenttick.sh")).toBeTruthy();
    expect(screen.getByText("Sign in to agenttick.sh")).toBeTruthy();
    expect(screen.getByText("Use a self-hosted server instead")).toBeTruthy();
    expect(screen.queryByText("Native Clerk AuthView signInOrUp false")).toBeNull();
  });

  it("opens the hosted Clerk sign-in after tapping the hosted sign-in button", () => {
    render(<ClerkSignInScreen serverURL="https://app.agenttick.sh" />);

    fireEvent.press(screen.getByText("Sign in to agenttick.sh"));

    expect(screen.getByText("Sign in to Agent Tick")).toBeTruthy();
    expect(screen.getByText("‹ Back")).toBeTruthy();
    expect(screen.getByText("Native Clerk AuthView signInOrUp true")).toBeTruthy();
  });

  it("can open directly to hosted Clerk sign-in", () => {
    render(<ClerkSignInScreen serverURL="https://app.agenttick.sh" initialShowAuthView />);

    expect(screen.getByText("Sign in to Agent Tick")).toBeTruthy();
    expect(screen.getByText("Native Clerk AuthView signInOrUp true")).toBeTruthy();
    expect(screen.queryByText("Sign in to agenttick.sh")).toBeNull();
  });

  it("can leave the hosted Clerk sign-in screen", () => {
    render(<ClerkSignInScreen serverURL="https://app.agenttick.sh" initialShowAuthView />);

    fireEvent.press(screen.getByText("‹ Back"));

    expect(screen.getByText("Sign in to agenttick.sh")).toBeTruthy();
    expect(screen.queryByText("Native Clerk AuthView signInOrUp true")).toBeNull();
  });

  it("reports a self-hosted server to the app shell", async () => {
    const onServerSelected = jest.fn();
    render(<ClerkSignInScreen serverURL="https://app.agenttick.sh" onServerSelected={onServerSelected} />);

    fireEvent.press(screen.getByText("Use a self-hosted server instead"));
    fireEvent.changeText(screen.getByPlaceholderText("https://tick.example.com"), "https://selfhost.example.com/");
    fireEvent.press(screen.getByText("Continue"));

    await waitFor(() => {
      expect(onServerSelected).toHaveBeenCalledWith(
        "https://selfhost.example.com",
        expect.objectContaining({ authProvider: "local" }),
      );
    });
  });

  it("can prefill only the self-hosted server field", () => {
    render(<ClerkSignInScreen serverURL="https://app.agenttick.sh" selfHostedInitialURL="http://localhost:8787" />);

    expect(screen.getByText("https://app.agenttick.sh")).toBeTruthy();
    fireEvent.press(screen.getByText("Use a self-hosted server instead"));
    expect(screen.getByDisplayValue("http://localhost:8787")).toBeTruthy();
  });
});
