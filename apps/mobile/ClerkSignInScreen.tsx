import { useSignIn, useSignUp, useSSO, type StartSSOFlowParams } from "@clerk/expo";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";

type ClerkAuthMode = "signIn" | "signUp";
type OAuthSSOStrategy = Exclude<StartSSOFlowParams["strategy"], "enterprise_sso">;
type SSOProvider = {
  label: string;
  strategy: OAuthSSOStrategy;
};

WebBrowser.maybeCompleteAuthSession();

export const ssoRedirectUrl = "agenttick://sso-callback";

function makeSsoRedirectUrl(): string {
  try {
    return AuthSession.makeRedirectUri({
      scheme: "agenttick",
      path: "sso-callback",
    });
  } catch {
    return ssoRedirectUrl;
  }
}

export const ssoProviders = [
  { label: "Continue with Google", strategy: "oauth_google" },
  { label: "Continue with GitHub", strategy: "oauth_github" },
  { label: "Continue with Apple", strategy: "oauth_apple" },
] satisfies SSOProvider[];

export function ClerkSignInScreen({ serverURL }: { serverURL: string }) {
  const { fetchStatus: signInFetchStatus, signIn } = useSignIn();
  const { fetchStatus: signUpFetchStatus, signUp } = useSignUp();
  const { startSSOFlow } = useSSO();
  const [mode, setMode] = useState<ClerkAuthMode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ssoSubmitting, setSsoSubmitting] = useState<OAuthSSOStrategy | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clerkLoaded = mode === "signIn" ? Boolean(signIn) : Boolean(signUp);
  const ssoLoaded = Boolean(signIn && signUp);
  const clerkFetching = mode === "signIn" ? signInFetchStatus === "fetching" : signUpFetchStatus === "fetching";
  const canSubmit = clerkLoaded && !clerkFetching && !submitting && !ssoSubmitting;
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  const title = mode === "signIn" ? "Sign in to Agent Tick" : "Create an Agent Tick account";
  const submitLabel = submitting
    ? pendingVerification
      ? "Verifying…"
      : mode === "signIn"
        ? "Signing in…"
        : "Creating…"
    : pendingVerification
      ? "Verify email"
      : mode === "signIn"
        ? "Sign in"
        : "Create account";

  const switchMode = (nextMode: ClerkAuthMode) => {
    setMode(nextMode);
    setError(null);
    setPendingVerification(false);
    setVerificationCode("");
  };

  const submitSSO = async (strategy: OAuthSSOStrategy) => {
    if (submitting || ssoSubmitting) return;
    if (!ssoLoaded) {
      setError("Sign-in is still loading. Try again in a moment.");
      return;
    }
    setError(null);
    setSsoSubmitting(strategy);
    try {
      const redirectUrl = makeSsoRedirectUrl();
      const result = await startSSOFlow({ strategy, redirectUrl });
      if (result.createdSessionId && result.setActive) {
        await result.setActive({ session: result.createdSessionId });
        return;
      }
      setError(ssoResultMessage(result, redirectUrl));
    } catch (err) {
      setError(clerkAuthErrorMessage(err, "Could not continue with the selected sign-in provider"));
    } finally {
      void WebBrowser.dismissBrowser();
      setSsoSubmitting(null);
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "signIn") {
        if (!signIn) throw new Error("Clerk is still loading");
        const result = await signIn.create({ identifier: email.trim(), password });
        if (result.error) throw result.error;
        if ((result as { status?: string }).status === "complete" || signIn.status === "complete") {
          const finalizeResult = await signIn.finalize();
          if (finalizeResult.error) throw finalizeResult.error;
          return;
        }
        setError(nextClerkStepMessage("sign-in", signIn.status));
        return;
      }

      if (!signUp) throw new Error("Clerk is still loading");
      if (pendingVerification) {
        const result = await signUp.verifications.verifyEmailCode({ code: verificationCode.trim() });
        if (result.error) throw result.error;
        if ((result as { status?: string }).status === "complete" || signUp.status === "complete") {
          const finalizeResult = await signUp.finalize();
          if (finalizeResult.error) throw finalizeResult.error;
          return;
        }
        setError(nextClerkStepMessage("sign-up", signUp.status));
        return;
      }

      const result = await signUp.create({ emailAddress: email.trim(), password });
      if (result.error) throw result.error;
      if ((result as { status?: string }).status === "complete" || signUp.status === "complete") {
        const finalizeResult = await signUp.finalize();
        if (finalizeResult.error) throw finalizeResult.error;
        return;
      }
      const sendResult = await signUp.verifications.sendEmailCode();
      if (sendResult.error) throw sendResult.error;
      setPendingVerification(true);
    } catch (err) {
      setError(clerkAuthErrorMessage(err, mode === "signIn" ? "Could not sign in to Agent Tick" : "Could not create an Agent Tick account"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.emptyState}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{serverURL}</Text>
        {pendingVerification ? (
          <>
            <Text style={styles.helperText}>Enter the verification code Clerk emailed to {email.trim()}.</Text>
            <TextInput
              value={verificationCode}
              onChangeText={setVerificationCode}
              autoCapitalize="none"
              keyboardType="number-pad"
              placeholder="Verification code"
              style={styles.input}
            />
          </>
        ) : (
          <>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="Email"
              style={styles.input}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry
              style={styles.input}
            />
          </>
        )}
        <View style={styles.ssoGroup}>
          {ssoProviders.map((provider) => (
            <Pressable
              key={provider.strategy}
              style={styles.ssoButton}
              onPress={() => void submitSSO(provider.strategy)}
              disabled={Boolean(!ssoLoaded || submitting || ssoSubmitting)}
            >
              <Text style={styles.ssoButtonText}>{ssoSubmitting === provider.strategy ? "Opening…" : !ssoLoaded ? "Loading sign-in…" : provider.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <Pressable style={styles.primaryButton} onPress={() => void submit()} disabled={!canSubmit}>
          <Text style={styles.primaryButtonText}>{submitLabel}</Text>
        </Pressable>
        {mode === "signIn" ? (
          <Pressable onPress={() => switchMode("signUp")} style={styles.linkButton}>
            <Text style={styles.linkButtonText}>Create account instead</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => switchMode("signIn")} style={styles.linkButton}>
            <Text style={styles.linkButtonText}>Sign in instead</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

export function clerkAuthErrorMessage(err: unknown, fallback: string): string {
  const clerkErrors = (err as { errors?: Array<{ longMessage?: string; message?: string }> } | null)?.errors;
  const firstClerkError = Array.isArray(clerkErrors) ? clerkErrors[0] : undefined;
  if (firstClerkError?.longMessage) return firstClerkError.longMessage;
  if (firstClerkError?.message) return firstClerkError.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function nextClerkStepMessage(flow: "sign-in" | "sign-up", status: string | null): string {
  return `Additional ${flow} step required: ${status ?? "unknown"}`;
}

function ssoResultMessage(
  result: Awaited<ReturnType<ReturnType<typeof useSSO>["startSSOFlow"]>>,
  redirectUrl: string,
): string {
  const resultType = result.authSessionResult?.type;
  if (resultType === "cancel" || resultType === "dismiss") return "Provider sign-in was canceled.";
  if (resultType === "locked") return "Another sign-in window is already open.";
  const signInStatus = result.signIn?.status ?? "unknown";
  const signUpStatus = result.signUp?.status ?? "unknown";
  const verificationStatus = result.signIn?.firstFactorVerification?.status ?? "unknown";
  return `Provider sign-in did not create a session. Redirect: ${redirectUrl}. Browser result: ${resultType ?? "none"}. Sign-in: ${signInStatus}. Sign-up: ${signUpStatus}. Verification: ${verificationStatus}.`;
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: "#f6f0e5",
    flex: 1,
  },
  emptyState: {
    alignItems: "center",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#202124",
    fontSize: 28,
    fontWeight: "900",
    textAlign: "center",
  },
  subtitle: {
    color: "#6f6558",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  helperText: {
    color: "#4f463b",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  input: {
    backgroundColor: "#fffaf2",
    borderColor: "#d7ccbb",
    borderRadius: 12,
    borderWidth: 1,
    color: "#202124",
    maxWidth: 420,
    paddingHorizontal: 14,
    paddingVertical: 12,
    width: "100%",
  },
  ssoGroup: {
    gap: 8,
    maxWidth: 420,
    width: "100%",
  },
  ssoButton: {
    alignItems: "center",
    backgroundColor: "#fffaf2",
    borderColor: "#d7ccbb",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 13,
    width: "100%",
  },
  ssoButtonText: {
    color: "#202124",
    fontSize: 15,
    fontWeight: "800",
  },
  dividerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    maxWidth: 420,
    width: "100%",
  },
  dividerLine: {
    backgroundColor: "#d7ccbb",
    flex: 1,
    height: 1,
  },
  dividerText: {
    color: "#6f6558",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  errorText: {
    color: "#9b1c1c",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#202124",
    borderRadius: 999,
    marginTop: 8,
    maxWidth: 420,
    paddingHorizontal: 24,
    paddingVertical: 14,
    width: "100%",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
  },
  linkButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  linkButtonText: {
    color: "#202124",
    fontSize: 14,
    fontWeight: "800",
  },
});
