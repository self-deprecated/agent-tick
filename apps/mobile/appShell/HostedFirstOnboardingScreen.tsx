import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import { styles } from "../mobileStyles";
import { hostedServerURL, normalizeServerURL, type RuntimeAuthConfig } from "../mobileAuth";
import { fetchRuntimeAuthConfigIfAvailable } from "./runtimeAuthConfigCache";

const defaultServer = hostedServerURL;

export function HostedFirstOnboardingScreen({
  error,
  onServerSelected,
}: {
  error: string;
  onServerSelected: (serverURL: string, authConfig: RuntimeAuthConfig | null) => void;
}) {
  const [customServerURL, setCustomServerURL] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const retryHosted = async () => {
    setSubmitting(true);
    setCustomError(null);
    const config = await fetchRuntimeAuthConfigIfAvailable(defaultServer);
    if (config) {
      onServerSelected(defaultServer, config);
    } else {
      setCustomError("Could not reach agenttick.sh");
    }
    setSubmitting(false);
  };

  const useSelfHostedServer = async () => {
    const nextServerURL = normalizeServerURL(customServerURL);
    setSubmitting(true);
    setCustomError(null);
    onServerSelected(nextServerURL, await fetchRuntimeAuthConfigIfAvailable(nextServerURL));
    setSubmitting(false);
  };

  return (
    <View style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.hostedOnboarding}>
        <Text style={styles.brand}>Agent Tick</Text>
        <Text style={styles.detailTitle}>Sign in to Agent Tick</Text>
        <Text style={styles.bodyText}>
          The mobile app signs in to agenttick.sh by default. Use a custom server only when you self-host Agent Tick.
        </Text>
        <Text style={styles.errorText}>{error}</Text>
        {customError ? <Text style={styles.errorText}>{customError}</Text> : null}
        <Pressable disabled={submitting} onPress={() => void retryHosted()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{submitting ? "Checking…" : "Retry sign-in"}</Text>
        </Pressable>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Self-hosted server URL</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="url"
            onChangeText={setCustomServerURL}
            placeholder="https://tick.example.com"
            style={styles.input}
            value={customServerURL}
          />
          <Pressable disabled={submitting} onPress={() => void useSelfHostedServer()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Use Self-hosted Server</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
