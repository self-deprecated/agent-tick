import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockSignInCreate = jest.fn();
const mockSignInFinalize = jest.fn();
const mockSignUpCreate = jest.fn();
const mockSignUpSendEmailCode = jest.fn();
const mockSignUpVerifyEmailCode = jest.fn();
const mockSignUpFinalize = jest.fn();
const mockOpenAuthSessionAsync = jest.fn();
const mockSetActive = jest.fn();

const mockSignInResource = {
  status: "needs_identifier",
  create: mockSignInCreate,
  finalize: mockSignInFinalize,
  reload: jest.fn(),
  createdSessionId: null as string | null,
  firstFactorVerification: {
    externalVerificationRedirectURL: "https://clerk.example/sso/start",
    status: "unverified",
  },
};
const mockSignUpResource = {
  status: "missing_requirements",
  create: mockSignUpCreate,
  finalize: mockSignUpFinalize,
  createdSessionId: null as string | null,
  verifications: {
    sendEmailCode: mockSignUpSendEmailCode,
    verifyEmailCode: mockSignUpVerifyEmailCode,
  },
};

jest.mock("expo-web-browser", () => ({
  maybeCompleteAuthSession: jest.fn(),
  warmUpAsync: jest.fn(),
  coolDownAsync: jest.fn(),
  dismissBrowser: jest.fn(),
  openAuthSessionAsync: mockOpenAuthSessionAsync,
}));

jest.mock("@clerk/expo/native", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return {
    AuthView: () => React.createElement(Text, null, "Native Clerk AuthView"),
  };
});

jest.mock("@clerk/expo", () => ({
  useClerk: () => ({ setActive: mockSetActive }),
  useSignIn: () => ({
    errors: null,
    fetchStatus: "idle",
    isLoaded: true,
    signIn: mockSignInResource,
  }),
  useSignUp: () => ({
    errors: null,
    fetchStatus: "idle",
    isLoaded: true,
    signUp: mockSignUpResource,
  }),
}));

const { ClerkSignInScreen, clerkAuthErrorMessage, ssoProviders, ssoRedirectUrl } = require("./ClerkSignInScreen") as typeof import("./ClerkSignInScreen");

describe("ClerkSignInScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignInResource.status = "needs_identifier";
    mockSignInResource.createdSessionId = null;
    mockSignInResource.firstFactorVerification.status = "unverified";
    mockSignInResource.firstFactorVerification.externalVerificationRedirectURL = "https://clerk.example/sso/start";
    mockSignUpResource.status = "missing_requirements";
    mockSignUpResource.createdSessionId = null;
  });

  it("renders Clerk native AuthView by default", () => {
    render(<ClerkSignInScreen serverURL="https://tick.example.com" />);

    expect(screen.getByText("Native Clerk AuthView")).toBeTruthy();
    expect(screen.getByText("Use classic sign-in instead")).toBeTruthy();
  });

  it("finalizes a completed Clerk sign-in session", async () => {
    mockSignInCreate.mockImplementation(async () => {
      mockSignInResource.status = "complete";
      return { error: null };
    });
    mockSignInFinalize.mockResolvedValue({ error: null });

    render(<ClerkSignInScreen serverURL="https://tick.example.com" preferNativeAuth={false} />);
    fireEvent.changeText(screen.getByPlaceholderText("Email"), "ada@example.com");
    fireEvent.changeText(screen.getByPlaceholderText("Password"), "correct horse battery staple");
    fireEvent.press(screen.getByText("Sign in"));

    await waitFor(() => expect(mockSignInFinalize).toHaveBeenCalledWith());
    expect(mockSignInCreate).toHaveBeenCalledWith({
      identifier: "ada@example.com",
      password: "correct horse battery staple",
    });
  });

  it("activates completed Clerk SSO sessions", async () => {
    mockSignInResource.createdSessionId = "sess_sso";
    mockSignInCreate.mockResolvedValue({
      firstFactorVerification: { externalVerificationRedirectURL: "https://clerk.example/sso/start" },
    });
    mockOpenAuthSessionAsync.mockResolvedValue({ type: "success", url: "agenttick://sso-callback?rotating_token_nonce=nonce" });

    render(<ClerkSignInScreen serverURL="https://tick.example.com" preferNativeAuth={false} />);
    fireEvent.press(screen.getByText("Continue with Google"));

    await waitFor(() => expect(mockSetActive).toHaveBeenCalledWith({ session: "sess_sso" }));
    expect(mockSignInCreate).toHaveBeenCalledWith({ strategy: "oauth_google", redirectUrl: ssoRedirectUrl });
    expect(mockOpenAuthSessionAsync).toHaveBeenCalledWith("https://clerk.example/sso/start", ssoRedirectUrl);
  });

  it("offers supported mobile OAuth providers without enterprise identifier requirements", async () => {
    expect(ssoProviders.map((provider) => provider.strategy)).toEqual([
      "oauth_google",
      "oauth_github",
      "oauth_apple",
    ]);
    expect(ssoProviders.map((provider) => provider.strategy as string)).not.toContain("enterprise_sso");

    mockSignInResource.createdSessionId = "sess_sso";
    mockSignInCreate.mockResolvedValue({
      firstFactorVerification: { externalVerificationRedirectURL: "https://clerk.example/sso/start" },
    });
    mockOpenAuthSessionAsync.mockResolvedValue({ type: "success", url: "agenttick://sso-callback?rotating_token_nonce=nonce" });

    for (const provider of ssoProviders) {
      const view = render(<ClerkSignInScreen serverURL="https://tick.example.com" preferNativeAuth={false} />);
      fireEvent.press(screen.getByText(provider.label));
      await waitFor(() => expect(mockSignInCreate).toHaveBeenLastCalledWith({ strategy: provider.strategy, redirectUrl: ssoRedirectUrl }));
      view.unmount();
    }
  });

  it("shows provider cancellation errors", async () => {
    mockSignInCreate.mockResolvedValue({
      firstFactorVerification: { externalVerificationRedirectURL: "https://clerk.example/sso/start" },
    });
    mockOpenAuthSessionAsync.mockResolvedValue({ type: "cancel" });

    render(<ClerkSignInScreen serverURL="https://tick.example.com" preferNativeAuth={false} />);
    fireEvent.press(screen.getByText("Continue with GitHub"));

    await waitFor(() => expect(screen.getByText("Provider sign-in was canceled.")).toBeTruthy());
  });

  it("supports email-code verification when creating a Clerk account", async () => {
    mockSignUpCreate.mockResolvedValue({ error: null });
    mockSignUpSendEmailCode.mockResolvedValue({ error: null });
    mockSignUpVerifyEmailCode.mockImplementation(async () => {
      mockSignUpResource.status = "complete";
      return { error: null };
    });
    mockSignUpFinalize.mockResolvedValue({ error: null });

    render(<ClerkSignInScreen serverURL="https://tick.example.com" preferNativeAuth={false} />);
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
