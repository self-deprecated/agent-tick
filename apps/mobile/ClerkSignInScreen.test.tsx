import React from "react";
import { render, screen } from "@testing-library/react-native";

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
  it("renders Clerk native AuthView", () => {
    render(<ClerkSignInScreen serverURL="https://tick.example.com" />);

    expect(screen.getByText("Sign in to Agent Tick")).toBeTruthy();
    expect(screen.getByText("https://tick.example.com")).toBeTruthy();
    expect(screen.getByText("Native Clerk AuthView signInOrUp false")).toBeTruthy();
  });
});
