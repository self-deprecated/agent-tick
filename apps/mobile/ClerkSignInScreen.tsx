import { useSignIn, useSignUp } from "@clerk/expo";
import { useState } from "react";
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";

type ClerkAuthMode = "signIn" | "signUp";

export function ClerkSignInScreen({ serverURL }: { serverURL: string }) {
  const { fetchStatus: signInFetchStatus, signIn } = useSignIn();
  const { fetchStatus: signUpFetchStatus, signUp } = useSignUp();
  const [mode, setMode] = useState<ClerkAuthMode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clerkFetching = mode === "signIn" ? signInFetchStatus === "fetching" : signUpFetchStatus === "fetching";
  const canSubmit = !clerkFetching && !submitting;
  const title = mode === "signIn" ? "Sign in with Clerk" : "Create an account";
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

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "signIn") {
        if (!signIn) throw new Error("Clerk is still loading");
        const result = await signIn.create({ identifier: email.trim(), password });
        if (result.error) throw result.error;
        if (signIn.status === "complete") {
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
        if (signUp.status === "complete") {
          const finalizeResult = await signUp.finalize();
          if (finalizeResult.error) throw finalizeResult.error;
          return;
        }
        setError(nextClerkStepMessage("sign-up", signUp.status));
        return;
      }

      const result = await signUp.create({ emailAddress: email.trim(), password });
      if (result.error) throw result.error;
      if (signUp.status === "complete") {
        const finalizeResult = await signUp.finalize();
        if (finalizeResult.error) throw finalizeResult.error;
        return;
      }
      const sendResult = await signUp.verifications.sendEmailCode();
      if (sendResult.error) throw sendResult.error;
      setPendingVerification(true);
    } catch (err) {
      setError(clerkAuthErrorMessage(err, mode === "signIn" ? "Could not sign in with Clerk" : "Could not create a Clerk account"));
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
  return `Additional Clerk ${flow} step required: ${status ?? "unknown"}`;
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
