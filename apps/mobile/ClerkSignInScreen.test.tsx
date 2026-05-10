import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("@clerk/expo/native", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return {
    AuthView: ({ mode, isDismissable }: { mode: string; isDismissable: boolean }) => React.createElement(
      Text,
      null,
      `Native Clerk AuthView ${mode} ${String(isDismissable)}`,
    ),
  };
});

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

  it("defaults to the hosted Clerk sign-in and shows a self-hosted switch", () => {
    render(<ClerkSignInScreen serverURL="https://agenttick.sh" />);

    expect(screen.getByText("Sign in to Agent Tick")).toBeTruthy();
    expect(screen.getByText("https://agenttick.sh")).toBeTruthy();
    expect(screen.getByText("Native Clerk AuthView signInOrUp false")).toBeTruthy();
    expect(screen.getByText("Use a self-hosted server instead")).toBeTruthy();
  });

  it("reports a self-hosted server to the app shell", async () => {
    const onServerSelected = jest.fn();
    render(<ClerkSignInScreen serverURL="https://agenttick.sh" onServerSelected={onServerSelected} />);

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
});
