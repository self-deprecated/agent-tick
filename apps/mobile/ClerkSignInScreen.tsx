import { AuthView } from "@clerk/expo/native";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

export function ClerkSignInScreen({ serverURL }: { serverURL: string }) {
  return (
    <View style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.nativeHeader}>
        <Text style={styles.title}>Sign in to Agent Tick</Text>
        <Text style={styles.subtitle}>{serverURL}</Text>
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
});
