import { ActivityIndicator, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import { styles } from "../mobileStyles";

export function LoadingScreen() {
  return (
    <View style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.emptyState}>
        <ActivityIndicator />
        <Text style={styles.subtitle}>Loading Agent Tick…</Text>
      </View>
    </View>
  );
}
