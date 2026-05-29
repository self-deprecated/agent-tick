import { ActivityIndicator, Text, View } from "react-native";

import { translateSource } from "@agent-tick/i18n";

import { styles } from "../mobileStyles";
import type { MobileSessionSummary } from "../mobileTypes";

export function SessionDetailLoading({ summary }: { summary: MobileSessionSummary }) {
  return (
    <View style={styles.waitingPane}>
      <ActivityIndicator color="#202124" />
      <Text style={styles.waitingTitle}>{summary.title}</Text>
      <Text style={styles.emptyText}>{translateSource("Loading Session detail…")}</Text>
    </View>
  );
}
