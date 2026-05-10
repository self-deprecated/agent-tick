import { AuthView } from "@clerk/expo/native";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { fetchRuntimeAuthConfig, normalizeServerURL, type RuntimeAuthConfig } from "./mobileAuth";

type ClerkSignInScreenProps = {
  serverURL: string;
  onServerSelected?: (serverURL: string, authConfig: RuntimeAuthConfig | null) => void;
};

export function ClerkSignInScreen({ serverURL, onServerSelected }: ClerkSignInScreenProps) {
  const [customServerURL, setCustomServerURL] = useState("");
  const [selfHostedOpen, setSelfHostedOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const useSelfHostedServer = async () => {
    const nextServerURL = normalizeServerURL(customServerURL);
    setSubmitting(true);
    setError(null);
    try {
      const config = await fetchRuntimeAuthConfig(nextServerURL);
      onServerSelected?.(nextServerURL, config);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read server auth config");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.nativeHeader}>
        <Text style={styles.title}>Sign in to Agent Tick</Text>
        <Text style={styles.subtitle}>{serverURL}</Text>
        {selfHostedOpen ? (
          <View style={styles.selfHostedForm}>
            <Text style={styles.bodyText}>Self-hosting Agent Tick?</Text>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Server URL</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                inputMode="url"
                onChangeText={setCustomServerURL}
                placeholder="https://tick.example.com"
                style={styles.input}
                value={customServerURL}
              />
            </View>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <View style={styles.buttonRow}>
              <Pressable disabled={submitting} onPress={() => void useSelfHostedServer()} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>{submitting ? "Checking…" : "Continue"}</Text>
              </Pressable>
              <Pressable disabled={submitting} onPress={() => setSelfHostedOpen(false)} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
            </View>
            {submitting ? <ActivityIndicator /> : null}
          </View>
        ) : (
          <Pressable onPress={() => setSelfHostedOpen(true)} style={styles.linkButton}>
            <Text style={styles.linkButtonText}>Use a self-hosted server instead</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.nativeAuthFrame}>
        <AuthView mode="signInOrUp" isDismissable={false} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: "#f6f0e5",
    flex: 1,
    paddingTop: Constants.statusBarHeight,
  },
  nativeHeader: {
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 12,
  },
  nativeAuthFrame: {
    flex: 1,
    overflow: "hidden",
  },
  selfHostedForm: {
    gap: 10,
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    color: "#545044",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    color: "#202124",
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 12,
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
  bodyText: {
    color: "#202124",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 21,
    textAlign: "center",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#202124",
    borderRadius: 8,
    flex: 1,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#202124",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: "#202124",
    fontSize: 15,
    fontWeight: "900",
  },
  linkButton: {
    alignItems: "center",
    alignSelf: "center",
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  linkButtonText: {
    color: "#202124",
    fontSize: 15,
    fontWeight: "900",
    textDecorationLine: "underline",
  },
  errorText: {
    color: "#9b1c1c",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});
