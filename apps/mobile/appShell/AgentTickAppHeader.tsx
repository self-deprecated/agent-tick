import { StatusBar } from "expo-status-bar";
import { Pressable, Text, View } from "react-native";

import { translateSource } from "@agent-tick/i18n";

import type { Screen } from "../AppLogic";
import { styles } from "../mobileStyles";
import { ConnectionBadge, type ConnectionStatus } from "../SettingsScreen";

export type AgentTickAppHeaderProps = {
  screen: Screen;
  connectionStatus: ConnectionStatus;
  visibleSessionCount: number;
  hasSelectedVisibleSession: boolean;
  needsInputBadgeCount: number;
  sessionStackInteractionMode: "overview" | "stack";
  onBrandPress: () => void;
  onToggleSessionStackInteractionMode: () => void;
  onOpenSessionActions: () => void;
  onOpenMenu: () => void;
};

export function AgentTickAppHeader({
  screen,
  connectionStatus,
  visibleSessionCount,
  hasSelectedVisibleSession,
  needsInputBadgeCount,
  sessionStackInteractionMode,
  onBrandPress,
  onToggleSessionStackInteractionMode,
  onOpenSessionActions,
  onOpenMenu,
}: AgentTickAppHeaderProps) {
  const viewingFocusedSession = screen === "requests" && hasSelectedVisibleSession && visibleSessionCount > 1;
  const showNeedsInputBadge = viewingFocusedSession && needsInputBadgeCount > 0;
  const brandAccessibilityLabel = viewingFocusedSession
    ? translateSource("Go to Session Stack")
    : translateSource("Go to dashboard");
  return (
    <>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View>
          <Pressable
            accessibilityLabel={brandAccessibilityLabel}
            accessibilityRole="button"
            onPress={onBrandPress}
            style={styles.brandButton}
          >
            <View style={styles.brandTitleRow}>
              <Text style={styles.brand}>Agent Tick</Text>
              {showNeedsInputBadge ? (
                <View style={styles.brandNeedsInputBadge}>
                  <Text style={styles.brandNeedsInputBadgeText}>{needsInputBadgeCount}</Text>
                </View>
              ) : null}
            </View>
          </Pressable>
          <ConnectionBadge status={connectionStatus} />
        </View>
        <View style={styles.headerActions}>
          {screen === "requests" && visibleSessionCount > 1 && !hasSelectedVisibleSession ? (
            <Pressable
              accessibilityLabel={translateSource(sessionStackInteractionMode === "overview" ? "Switch to Stack Mode" : "Switch to Overview Mode")}
              accessibilityRole="button"
              onPress={onToggleSessionStackInteractionMode}
              style={[styles.iconButton, styles.stackActionButton, styles.stackModeButton]}
            >
              <Text style={styles.stackModeButtonIcon}>{sessionStackInteractionMode === "overview" ? "👆" : "👁"}</Text>
            </Pressable>
          ) : null}
          {screen === "requests" && visibleSessionCount > 0 ? (
            <Pressable
              accessibilityLabel={hasSelectedVisibleSession ? translateSource("Open Session actions") : translateSource("Open Session Stack actions")}
              accessibilityRole="button"
              onPress={onOpenSessionActions}
              style={[styles.iconButton, styles.stackActionButton]}
            >
              {!hasSelectedVisibleSession ? <Text style={styles.stackActionButtonCount}>{visibleSessionCount}</Text> : null}
              <Text style={styles.stackActionButtonText}>⋯</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityLabel="Open menu" onPress={onOpenMenu} style={styles.iconButton}>
            <Text style={styles.menuIconText}>☰</Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}
