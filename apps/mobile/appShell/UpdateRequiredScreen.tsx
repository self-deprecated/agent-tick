import { Linking, Pressable, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import type { MobileUpdateStatus } from "../AppLogic";
import { styles } from "../mobileStyles";

export type UpdateRequiredStatus = Extract<MobileUpdateStatus, { supported: false }>;

export function UpdateRequiredScreen({ status, serverURL }: { status: UpdateRequiredStatus; serverURL: string }) {
  return (
    <View style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.emptyState}>
        <Text style={styles.title}>Update Agent Tick</Text>
        <Text style={styles.subtitle}>{status.message}</Text>
        <Text style={styles.subtitle}>
          {status.currentVersion ? `Installed: ${status.currentVersion} · ` : ""}Minimum supported: {status.minimumSupportedVersion}
        </Text>
        <Text style={styles.subtitle}>Server: {serverURL}</Text>
        {status.updateURL ? (
          <Pressable onPress={() => void Linking.openURL(status.updateURL!)} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Open update</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
