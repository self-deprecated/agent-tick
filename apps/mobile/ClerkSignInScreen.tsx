import { AuthView } from "@clerk/expo/native";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { fetchRuntimeAuthConfig, normalizeServerURL, serverURLPolicyError, type RuntimeAuthConfig } from "./mobileAuth";
import { knownServerLabel, type KnownServer } from "./knownServers";
import { ServerPicker } from "./appShell/ServerPicker";
import { useKnownServers, isKnownInsecureServer } from "./appShell/useKnownServers";

type ClerkSignInScreenProps = {
  serverURL: string;
  selfHostedInitialURL?: string;
  initialShowAuthView?: boolean;
  authMode?: "signIn" | "signUp" | "signInOrUp";
  addAccountHint?: boolean;
  onAuthViewOpen?: () => void;
  onCancel?: () => void;
  onSignInSelected?: () => void;
  onServerSelected?: (serverURL: string, authConfig: RuntimeAuthConfig | null) => void;
};

function signInTargetLabel(serverURL: string, knownServer?: KnownServer): string {
  return knownServerLabel(knownServer ?? { url: serverURL });
}

export function ClerkSignInScreen({ serverURL, selfHostedInitialURL = "", initialShowAuthView = false, authMode = "signInOrUp", addAccountHint = false, onAuthViewOpen, onCancel, onSignInSelected, onServerSelected }: ClerkSignInScreenProps) {
  const { knownServers, verify, record, remove } = useKnownServers();
  const [selectedServerURL, setSelectedServerURL] = useState(normalizeServerURL(serverURL));
  const [showAuthView, setShowAuthView] = useState(initialShowAuthView);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedServerURL(normalizeServerURL(serverURL));
  }, [serverURL]);

  useEffect(() => {
    if (initialShowAuthView) onAuthViewOpen?.();
  }, [initialShowAuthView, onAuthViewOpen]);

  const openAuthView = () => {
    onAuthViewOpen?.();
    if (onSignInSelected) {
      onSignInSelected();
      return;
    }
    setShowAuthView(true);
  };

  const selectedKnownServer = knownServers.find((server) => server.url === normalizeServerURL(selectedServerURL));
  const selectedLabel = signInTargetLabel(selectedServerURL, selectedKnownServer);
  const currentServerURL = normalizeServerURL(serverURL);

  const signInToSelected = async () => {
    const targetServerURL = normalizeServerURL(selectedServerURL);
    setError(null);

    // Selecting the server this screen is already bound to opens Clerk native
    // auth directly. Any other server must re-bootstrap so the ClerkProvider
    // can mount with that server's publishable key (or fall back to token flow).
    if (targetServerURL === currentServerURL) {
      openAuthView();
      return;
    }

    const allowInsecure = await isKnownInsecureServer(targetServerURL);
    const policyError = serverURLPolicyError(targetServerURL, { allowInsecure });
    if (policyError) {
      setError(policyError);
      return;
    }

    setSubmitting(true);
    try {
      const config = await fetchRuntimeAuthConfig(targetServerURL, fetch, { allowInsecure });
      await record(targetServerURL, { authProvider: config.authProvider });
      onServerSelected?.(targetServerURL, config);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read server auth config");
    } finally {
      setSubmitting(false);
    }
  };

  const recordServer = async (nextServerURL: string, options: { authProvider: RuntimeAuthConfig["authProvider"]; insecureConfirmed?: boolean }) => {
    await record(nextServerURL, options);
    setSelectedServerURL(nextServerURL);
  };

  if (showAuthView) {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.shell}>
        <StatusBar style="dark" />
        <View style={styles.nativeHeader}>
          <Pressable onPress={() => { if (onCancel) onCancel(); else setShowAuthView(false); }} style={styles.backButton}>
            <Text style={styles.secondaryButtonText}>‹ Back</Text>
          </Pressable>
          <Text style={styles.title}>{addAccountHint ? "Add another account" : "Sign in to Agent Tick"}</Text>
          <Text style={styles.subtitle}>{serverURL}</Text>
          {addAccountHint ? <Text style={styles.bodyText}>Clerk native sign-in cannot start a second session while another session is active. Sign out first, then sign in with the account you want to add.</Text> : null}
        </View>
        <View style={styles.nativeAuthFrame}>
          <AuthView mode={authMode} isDismissable={Boolean(onCancel)} />
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.landingContent}>
        <View style={styles.hero}>
          <Text style={styles.title}>Agent Tick</Text>
          <Text style={styles.subtitle}>{selectedKnownServer?.url ?? selectedServerURL}</Text>
          <Text style={styles.bodyText}>Sign in to the hosted Agent Tick service, or pick a self-hosted server. Agent Tick checks the server after you press sign in and adapts to the sign-in method it advertises.</Text>
        </View>
        <Pressable accessibilityLabel={`Sign in to ${selectedLabel}`} disabled={submitting} onPress={() => void signInToSelected()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{submitting ? "Checking…" : `Sign in to ${selectedLabel}`}</Text>
        </Pressable>
        {submitting ? <ActivityIndicator /> : null}
      </View>
      <View style={styles.selfHostedPanel}>
        <ServerPicker
          knownServers={knownServers}
          selectedServerURL={selectedServerURL}
          onSelectServer={setSelectedServerURL}
          onVerifyServer={verify}
          onRecordServer={recordServer}
          onRemoveServer={(url) => void remove(url)}
          initialDraftURL={selfHostedInitialURL}
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: "#f6f0e5",
    flex: 1,
    paddingTop: Constants.statusBarHeight,
  },
  nativeHeader: {
    gap: 8,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 12,
  },
  nativeAuthFrame: {
    flex: 1,
    overflow: "hidden",
  },
  backButton: {
    alignSelf: "flex-start",
    minHeight: 36,
    justifyContent: "center",
  },
  landingContent: {
    flex: 1,
    gap: 28,
    justifyContent: "center",
    padding: 24,
  },
  hero: {
    gap: 10,
  },
  selfHostedPanel: {
    borderTopColor: "#ded6c6",
    borderTopWidth: 1,
    padding: 20,
    gap: 10,
  },
  title: {
    color: "#202124",
    fontSize: 32,
    fontWeight: "900",
    textAlign: "center",
  },
  subtitle: {
    color: "#6f6558",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  bodyText: {
    color: "#202124",
    fontSize: 16,
    lineHeight: 23,
    textAlign: "center",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#202124",
    borderRadius: 8,
    minHeight: 52,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  secondaryButtonText: {
    color: "#202124",
    fontSize: 15,
    fontWeight: "900",
  },
  errorText: {
    color: "#9b1c1c",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});
