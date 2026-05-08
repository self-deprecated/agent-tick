import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ClerkSignInScreen, clerkAuthErrorMessage } from "./ClerkSignInScreen";

const mockSignInCreate = jest.fn();
const mockSignInFinalize = jest.fn();
const mockSignUpCreate = jest.fn();
const mockSignUpSendEmailCode = jest.fn();
const mockSignUpVerifyEmailCode = jest.fn();
const mockSignUpFinalize = jest.fn();

const mockSignInResource = {
  status: "needs_identifier",
  create: mockSignInCreate,
  finalize: mockSignInFinalize,
};
const mockSignUpResource = {
  status: "missing_requirements",
  create: mockSignUpCreate,
  finalize: mockSignUpFinalize,
  verifications: {
    sendEmailCode: mockSignUpSendEmailCode,
    verifyEmailCode: mockSignUpVerifyEmailCode,
  },
};

jest.mock("@clerk/expo", () => ({
  useSignIn: () => ({
    errors: null,
    fetchStatus: "idle",
    signIn: mockSignInResource,
  }),
  useSignUp: () => ({
    errors: null,
    fetchStatus: "idle",
    signUp: mockSignUpResource,
  }),
}));

describe("ClerkSignInScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignInResource.status = "needs_identifier";
    mockSignUpResource.status = "missing_requirements";
  });

  it("finalizes a completed Clerk sign-in session", async () => {
    mockSignInCreate.mockImplementation(async () => {
      mockSignInResource.status = "complete";
      return { error: null };
    });
    mockSignInFinalize.mockResolvedValue({ error: null });

    render(<ClerkSignInScreen serverURL="https://tick.example.com" />);
    fireEvent.changeText(screen.getByPlaceholderText("Email"), "ada@example.com");
    fireEvent.changeText(screen.getByPlaceholderText("Password"), "correct horse battery staple");
    fireEvent.press(screen.getByText("Sign in"));

    await waitFor(() => expect(mockSignInFinalize).toHaveBeenCalledWith());
    expect(mockSignInCreate).toHaveBeenCalledWith({
      identifier: "ada@example.com",
      password: "correct horse battery staple",
    });
  });

  it("supports email-code verification when creating a Clerk account", async () => {
    mockSignUpCreate.mockResolvedValue({ error: null });
    mockSignUpSendEmailCode.mockResolvedValue({ error: null });
    mockSignUpVerifyEmailCode.mockImplementation(async () => {
      mockSignUpResource.status = "complete";
      return { error: null };
    });
    mockSignUpFinalize.mockResolvedValue({ error: null });

    render(<ClerkSignInScreen serverURL="https://tick.example.com" />);
    fireEvent.press(screen.getByText("Create account instead"));
    fireEvent.changeText(screen.getByPlaceholderText("Email"), "grace@example.com");
    fireEvent.changeText(screen.getByPlaceholderText("Password"), "correct horse battery staple");
    fireEvent.press(screen.getByText("Create account"));

    await waitFor(() => expect(mockSignUpSendEmailCode).toHaveBeenCalledWith());
    fireEvent.changeText(screen.getByPlaceholderText("Verification code"), "123456");
    fireEvent.press(screen.getByText("Verify email"));

    await waitFor(() => expect(mockSignUpFinalize).toHaveBeenCalledWith());
    expect(mockSignUpCreate).toHaveBeenCalledWith({
      emailAddress: "grace@example.com",
      password: "correct horse battery staple",
    });
    expect(mockSignUpVerifyEmailCode).toHaveBeenCalledWith({ code: "123456" });
  });
});

describe("clerkAuthErrorMessage", () => {
  it("prefers Clerk API long messages", () => {
    expect(
      clerkAuthErrorMessage(
        { errors: [{ message: "short", longMessage: "Use a stronger password." }] },
        "fallback",
      ),
    ).toBe("Use a stronger password.");
  });
});
