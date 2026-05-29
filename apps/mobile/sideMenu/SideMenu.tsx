import { useEffect, useRef, useState } from "react";
import { Animated, Modal, Pressable, Text, View } from "react-native";
import { type MeResponse } from "@self-deprecated/agent-tick-sdk";

import { type Screen } from "../AppLogic";
import { translateSource } from "@agent-tick/i18n";
import { recordDiagnostic } from "../diagnostics";
import { normalizeServerURL, type SavedMobileAccount } from "../mobileAuth";
import { styles } from "../mobileStyles";
import type { AccountPendingState } from "../mobileTypes";
import type { ConnectionStatus } from "../SettingsScreen";

type SideMenuProps = {
  accountPending: Record<string, AccountPendingState>;
  accountProfile: MeResponse | null;
  connectionStatus: ConnectionStatus;
  currentScreen: Screen;
  onClose: () => void;
  onNavigate: (screen: Screen) => void;
  workspaceName?: string;
  accounts: SavedMobileAccount[];
  serverURL: string;
  visible: boolean;
};

const SIDE_MENU_ANIMATION_MS = 220;
const SIDE_MENU_CLOSE_FALLBACK_MS = SIDE_MENU_ANIMATION_MS + 80;

export function SideMenu({
  accountPending,
  accountProfile,
  connectionStatus,
  currentScreen,
  onClose,
  onNavigate,
  workspaceName,
  accounts,
  serverURL,
  visible,
}: SideMenuProps) {
  const accountLabel = accountProfile?.email || accountProfile?.userId || "No hosted bootstrap session";
  const signInLabel = accountProfile?.signInMethod ? `${accountProfile.signInMethod} bootstrap` : "Bootstrap session";
  const [rendered, setRendered] = useState(visible);
  const menuProgress = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) setRendered(true);
  }, [visible]);

  useEffect(() => {
    if (!rendered) return;
    let cancelled = false;
    const animation = Animated.timing(menuProgress, {
      duration: SIDE_MENU_ANIMATION_MS,
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
    });
    const fallbackTimer = !visible
      ? setTimeout(() => {
          if (!cancelled) {
            recordDiagnostic("warn", "navigation", "side_menu_close_fallback");
            setRendered(false);
          }
        }, SIDE_MENU_CLOSE_FALLBACK_MS)
      : null;

    animation.start(({ finished }) => {
      if (cancelled) return;
      if (finished && !visible) setRendered(false);
    });

    return () => {
      cancelled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      animation.stop?.();
    };
  }, [menuProgress, rendered, visible]);

  const slideX = menuProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [380, 0],
  });
  const backdropOpacity = menuProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <Modal animationType="none" transparent visible={rendered} onRequestClose={onClose}>
      <View style={styles.menuOverlay}>
        <Animated.View style={[styles.menuBackdrop, { opacity: backdropOpacity }]}>
          <Pressable accessibilityLabel="Close menu" onPress={onClose} style={styles.menuBackdropPressable} />
        </Animated.View>
        <Animated.View style={[styles.sideMenu, { transform: [{ translateX: slideX }] }]}>
          <View style={styles.sideMenuHeader}>
            <View style={styles.sideMenuTitleRow}>
              <Text style={styles.sideMenuTitle}>{translateSource("Menu")}</Text>
              <Pressable accessibilityLabel="Close menu" onPress={onClose} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>×</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.accountsSection}>
            <Text style={styles.menuSectionLabel}>{translateSource("Connections")}</Text>
            <View style={styles.accountsList}>
              {accounts.length === 0 ? (
                <AccountMenuItem
                  colorKey={accountProfile?.userId || accountProfile?.email || accountLabel}
                  label={accountLabel}
                  meta={[signInLabel, workspaceName ? `Workspace: ${workspaceName}` : undefined].filter(Boolean).join(" · ")}
                  onPress={() => {
                    onNavigate("requests");
                    onClose();
                  }}
                />
              ) : null}
              {accounts.map((account) => (
                <AccountMenuItem
                  account={account}
                  key={account.id}
                  onPress={() => {
                    onNavigate("requests");
                    onClose();
                  }}
                  pending={accountPending[account.id]}
                />
              ))}
            </View>
          </View>

          <View style={styles.menuItems}>
            <SideMenuItem
              active={currentScreen === "requests"}
              icon="✓"
              label={translateSource("Requests")}
              onPress={() => onNavigate("requests")}
            />
            <SideMenuItem
              active={currentScreen === "history"}
              icon="🕘"
              label={translateSource("History")}
              onPress={() => onNavigate("history")}
            />
            <SideMenuItem
              active={currentScreen === "settings"}
              icon="⚙"
              label={translateSource("Settings")}
              onPress={() => onNavigate("settings")}
            />
          </View>

          <View style={styles.sideMenuFooter}>
            <Text numberOfLines={2} style={styles.serverLabel}>{normalizeServerURL(serverURL)}</Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function SideMenuItem({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.menuItem, active ? styles.menuItemActive : null]}
    >
      <Text style={[styles.menuItemIcon, active ? styles.menuItemTextActive : null]}>{icon}</Text>
      <Text style={[styles.menuItemText, active ? styles.menuItemTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

function AccountMenuItem({
  account,
  active = false,
  colorKey,
  label,
  meta,
  onPress,
  pending,
}: {
  account?: SavedMobileAccount;
  active?: boolean;
  colorKey?: string;
  label?: string;
  meta?: string;
  onPress: () => void;
  pending?: AccountPendingState;
}) {
  const accountLabel = label || (account ? savedAccountMenuLabel(account) : translateSource("Account"));
  const pendingLabel = accountPendingLabel(pending);
  const dotColor = account ? accountColor(account) : accountColorForKey(colorKey || accountLabel);
  return (
    <Pressable accessibilityLabel={`Open ${accountLabel}`} onPress={onPress} style={[styles.accountMenuItem, active ? styles.accountMenuItemActive : null]}>
      <View style={[styles.accountColorDot, { backgroundColor: dotColor }]} />
      <View style={styles.accountMenuTextWrap}>
        <View style={styles.accountMenuTitleRow}>
          <Text numberOfLines={1} style={styles.accountMenuName}>{accountLabel}</Text>

        </View>
        {meta ? <Text numberOfLines={1} style={styles.accountMenuMeta}>{meta}</Text> : null}
        {pendingLabel ? <Text numberOfLines={1} style={styles.accountMenuStatus}>{pendingLabel}</Text> : null}
      </View>
    </Pressable>
  );
}

function accountPendingLabel(pending?: AccountPendingState) {
  if (pending?.status === "needs-sign-in") return translateSource("Needs sign-in");
  if (pending?.status === "error") return translateSource("Unable to check");
  return null;
}

function savedAccountMenuLabel(account: SavedMobileAccount) {
  return account.email || account.label || account.userID || account.deviceID || hostLabel(account.serverURL);
}

function accountColor(account: SavedMobileAccount) {
  return accountColorForKey(account.userID || account.email || account.id);
}

function accountColorForKey(key: string) {
  const palette = ["#2563eb", "#7c3aed", "#059669", "#dc2626", "#d97706", "#0891b2", "#be185d", "#4f46e5"];
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = ((hash << 5) - hash + key.charCodeAt(index)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function hostLabel(serverURL: string) {
  try {
    return new URL(serverURL).host;
  } catch {
    return serverURL;
  }
}
