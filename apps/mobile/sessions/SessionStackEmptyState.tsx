import { translateSource } from "@agent-tick/i18n";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { styles } from "../mobileStyles";

export function SessionStackEmptyState({ archivedSessionCount = 0, loading, onRefresh }: { archivedSessionCount?: number; loading: boolean; onRefresh: () => void }) {
  const archived = archivedSessionCount > 0;
  return (
    <View style={styles.waitingPane}>
      {loading ? <ActivityIndicator color="#202124" /> : null}
      <Text style={styles.waitingTitle}>{archived ? translateSource("Session Stack cleared") : translateSource("Waiting for Agent Activity")}</Text>
      <Text style={styles.waitingSubtitle}>{archived ? translateSource("New Activity will reappear here as Session Lanes.") : translateSource("New Session Lanes will appear here when an agent sends a Request or Status Update.")}</Text>
      <Pressable onPress={onRefresh} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>{translateSource("Refresh")}</Text>
      </Pressable>
    </View>
  );
}
