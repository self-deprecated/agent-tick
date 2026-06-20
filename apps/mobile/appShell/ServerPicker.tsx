import { useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { isHostedServerURL, knownServerAuthProviderBadge, knownServerLabel, type KnownServer } from "../knownServers";
import { coerceServerURLInput, httpVariantOf, isInsecureServerURL, normalizeServerURL, serverURLPolicyError } from "../mobileAuth";
import type { RuntimeAuthConfig } from "../mobileAuth";

export type ServerPickerProps = {
  knownServers: KnownServer[];
  selectedServerURL: string;
  onSelectServer: (serverURL: string) => void;
  /**
   * Probes a single URL to confirm it answers as an Agent Tick server.
   * Scheme-agnostic (the picker gates insecure connections itself). Reject on
   * any failure. Use useKnownServers().verify as the typical implementation.
   */
  onVerifyServer: (serverURL: string) => Promise<RuntimeAuthConfig>;
  /**
   * Persists a verified server. Receives the confirmed auth config and an
   * insecure flag when the user accepted a plain-http warning.
   */
  onRecordServer: (serverURL: string, options: { authProvider: RuntimeAuthConfig["authProvider"]; insecureConfirmed?: boolean }) => void | Promise<void>;
  onRemoveServer?: (serverURL: string) => void;
  /** Hides the inline "add another server" form (e.g. when space is tight). */
  hideAddForm?: boolean;
  /** Optional value to seed the "add another server" input (e.g. a build-time hint). */
  initialDraftURL?: string;
  testID?: string;
};

export function ServerPicker({
  knownServers,
  selectedServerURL,
  onSelectServer,
  onVerifyServer,
  onRecordServer,
  onRemoveServer,
  hideAddForm = false,
  initialDraftURL = "",
  testID,
}: ServerPickerProps) {
  const [addingServer, setAddingServer] = useState(false);
  const [draftURL, setDraftURL] = useState(initialDraftURL);
  const [checking, setChecking] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const selectedNormalized = normalizeServerURL(selectedServerURL);

  const recordAndClose = async (
    serverURL: string,
    config: RuntimeAuthConfig,
    insecureConfirmed: boolean,
  ) => {
    await onRecordServer(serverURL, { authProvider: config.authProvider, ...(insecureConfirmed ? { insecureConfirmed } : {}) });
    setDraftURL("");
    setAddingServer(false);
  };

  const confirmInsecure = (serverURL: string): Promise<boolean> =>
    new Promise((resolve) => {
      Alert.alert(
        "Connection is not secure",
        `${serverURL} only allows a plain HTTP connection, which can expose your sign-in to anyone on your network. Continue only if you trust this server.`,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Continue", style: "destructive", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });

  const attemptServer = async (rawURL: string) => {
    const coerced = coerceServerURLInput(rawURL);
    if (!coerced) {
      setAddError("Enter a server address.");
      return;
    }
    const policyError = serverURLPolicyError(coerced);
    if (policyError) {
      setAddError(policyError);
      return;
    }
    setChecking(true);
    setAddError(null);
    try {
      // 1. Try the primary (usually https) URL.
      try {
        const config = await onVerifyServer(coerced);
        await recordAndClose(coerced, config, false);
        return;
      } catch {
        // Fall through to the http fallback below.
      }

      // 2. If the primary was https and failed, retry its http variant.
      const httpFallback = httpVariantOf(coerced);
      if (!httpFallback) throw new Error(`Could not reach ${coerced} or it is not an Agent Tick server.`);
      let fallbackConfig: RuntimeAuthConfig;
      try {
        fallbackConfig = await onVerifyServer(httpFallback);
      } catch {
        throw new Error(`Could not reach ${coerced} or it is not an Agent Tick server.`);
      }

      // 3. Loopback http needs no confirmation; anything else does.
      if (!isInsecureServerURL(httpFallback)) {
        await recordAndClose(httpFallback, fallbackConfig, false);
        return;
      }
      const accepted = await confirmInsecure(httpFallback);
      if (!accepted) {
        // Treat as cancel: keep the form open, no error.
        return;
      }
      await recordAndClose(httpFallback, fallbackConfig, true);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Could not add server");
    } finally {
      setChecking(false);
    }
  };

  const cancelAddServer = () => {
    setAddingServer(false);
    setDraftURL("");
    setAddError(null);
  };

  const confirmForget = (server: KnownServer) => {
    Alert.alert(
      "Forget server?",
      `Remove ${knownServerLabel(server)} from your remembered servers? You can add it again any time.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Forget", style: "destructive", onPress: () => onRemoveServer?.(server.url) },
      ],
    );
  };

  return (
    <View style={styles.group} testID={testID}>
      <Text style={styles.label}>Server</Text>
      <View style={styles.serverList} accessibilityLabel="Known Agent Tick servers">
        {knownServers.map((server) => {
          const isSelected = server.url === selectedNormalized;
          const removable = !isHostedServerURL(server.url) && Boolean(onRemoveServer);
          const badge = knownServerAuthProviderBadge(server);
          return (
            <Pressable
              key={server.url}
              accessibilityLabel={`Select server ${knownServerLabel(server)}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelectServer(server.url)}
              style={[styles.serverRow, isSelected ? styles.serverRowSelected : null]}
            >
              <Text style={styles.radio}>{isSelected ? "●" : "○"}</Text>
              <View style={styles.serverMeta}>
                <Text style={styles.serverLabel}>{knownServerLabel(server)}</Text>
                <Text style={styles.serverURL}>{server.url}</Text>
                {badge ? <Text style={styles.serverBadge}>{badge}</Text> : null}
              </View>
              {removable ? (
                <Pressable
                  accessibilityLabel={`Forget server ${knownServerLabel(server)}`}
                  hitSlop={8}
                  onPress={() => confirmForget(server)}
                  style={styles.removeButton}
                >
                  <Text style={styles.removeText}>Forget</Text>
                </Pressable>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {hideAddForm ? null : addingServer ? (
        <View style={styles.addForm}>
          <TextInput
            accessibilityLabel="New self-hosted server URL"
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="url"
            onChangeText={setDraftURL}
            placeholder="tick.example.com (https:// is added for you)"
            returnKeyType="go"
            style={styles.input}
            value={draftURL}
            onSubmitEditing={() => void attemptServer(draftURL)}
          />
          {addError ? <Text style={styles.errorText}>{addError}</Text> : null}
          <View style={styles.buttonRow}>
            <Pressable
              accessibilityLabel="Add self-hosted server"
              disabled={checking || !draftURL.trim()}
              onPress={() => void attemptServer(draftURL)}
              style={[styles.primaryButton, checking || !draftURL.trim() ? styles.primaryButtonDisabled : null]}
            >
              <Text style={styles.primaryButtonText}>{checking ? "Checking…" : "Add server"}</Text>
            </Pressable>
            <Pressable accessibilityLabel="Cancel adding a server" disabled={checking} onPress={cancelAddServer} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
          </View>
          {checking ? <ActivityIndicator /> : null}
        </View>
      ) : (
        <Pressable accessibilityLabel="Add another Agent Tick server" onPress={() => setAddingServer(true)} style={styles.linkButton}>
          <Text style={styles.linkButtonText}>Add another server</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: 8,
  },
  label: {
    color: "#545044",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  serverList: {
    gap: 8,
  },
  serverRow: {
    alignItems: "center",
    borderColor: "#ded6c6",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#ffffff",
  },
  serverRowSelected: {
    borderColor: "#202124",
    borderWidth: 2,
    backgroundColor: "#fffdf7",
  },
  radio: {
    color: "#202124",
    fontSize: 16,
    fontWeight: "900",
  },
  serverMeta: {
    flex: 1,
    gap: 2,
  },
  serverLabel: {
    color: "#202124",
    fontSize: 15,
    fontWeight: "800",
  },
  serverURL: {
    color: "#6f6558",
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  serverBadge: {
    color: "#545044",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  removeButton: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  removeText: {
    color: "#9b1c1c",
    fontSize: 13,
    fontWeight: "800",
  },
  addForm: {
    gap: 10,
    marginTop: 4,
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
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
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
    minHeight: 40,
    justifyContent: "center",
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
  },
});
