import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import { styles } from "../mobileStyles";
import { knownServerLabel, type KnownServer } from "../knownServers";
import { hostedServerURL, normalizeServerURL, type RuntimeAuthConfig } from "../mobileAuth";
import { fetchRuntimeAuthConfigIfAvailable } from "./runtimeAuthConfigCache";
import { ServerPicker } from "./ServerPicker";
import { useKnownServers, isKnownInsecureServer } from "./useKnownServers";

export function HostedFirstOnboardingScreen({
  error,
  onServerSelected,
}: {
  error: string;
  onServerSelected: (serverURL: string, authConfig: RuntimeAuthConfig | null) => void;
}) {
  const { knownServers, verify, record, remove } = useKnownServers();
  const [selectedServerURL, setSelectedServerURL] = useState(hostedServerURL);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const selected = knownServers.find((server) => server.url === normalizeServerURL(selectedServerURL)) as KnownServer | undefined;
  const selectedLabel = knownServerLabel(selected ?? { url: selectedServerURL });
  const signInProgress = submitting ? "Checking…" : `Sign in to ${selectedLabel}`;

  const signInToSelected = async () => {
    const serverURL = normalizeServerURL(selectedServerURL);
    setSubmitting(true);
    setSubmitError(null);
    const allowInsecure = await isKnownInsecureServer(serverURL);
    const config = await fetchRuntimeAuthConfigIfAvailable(serverURL, { allowInsecure });
    if (config) {
      await record(serverURL, { authProvider: config.authProvider });
      onServerSelected(serverURL, config);
    } else {
      setSubmitError(`Could not reach ${serverURL}. Check the address or your connection.`);
    }
    setSubmitting(false);
  };

  const recordServer = async (serverURL: string, options: { authProvider: RuntimeAuthConfig["authProvider"]; insecureConfirmed?: boolean }) => {
    await record(serverURL, options);
    setSelectedServerURL(serverURL);
  };

  return (
    <View style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.hostedOnboarding}>
        <Text style={styles.brand}>Agent Tick</Text>
        <Text style={styles.detailTitle}>Sign in to Agent Tick</Text>
        <Text style={styles.bodyText}>
          The mobile app signs in to agenttick.sh by default. Pick a remembered server, or add your own self-hosted Agent Tick server.
        </Text>
        <Text style={styles.errorText}>{error}</Text>
        {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
        <ServerPicker
          knownServers={knownServers}
          selectedServerURL={selectedServerURL}
          onSelectServer={setSelectedServerURL}
          onVerifyServer={verify}
          onRecordServer={recordServer}
          onRemoveServer={(url) => void remove(url)}
        />
        <Pressable disabled={submitting} onPress={() => void signInToSelected()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{signInProgress}</Text>
        </Pressable>
        {submitting ? <ActivityIndicator /> : null}
      </View>
    </View>
  );
}
