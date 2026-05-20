import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { translateSource } from "@agent-tick/i18n";

export type NativePaywallProps = {
  visible: boolean;
  lifetimePrice?: string;
  needsSignIn?: boolean;
  purchaseUnavailable?: boolean;
  purchaseUnavailableMessage?: string;
  onBuyLifetimeUnlock: () => void;
  onDismiss: () => void;
  onRestorePurchases: () => void;
  onSignInToBuy?: () => void;
  onViewAppAccess?: () => void;
};

export function NativePaywall({
  visible,
  lifetimePrice = "$19.99",
  needsSignIn = false,
  purchaseUnavailable = false,
  purchaseUnavailableMessage,
  onBuyLifetimeUnlock,
  onDismiss,
  onRestorePurchases,
  onSignInToBuy,
  onViewAppAccess,
}: NativePaywallProps) {
  const tr = translateSource;
  const primaryDisabled = !needsSignIn && purchaseUnavailable;
  const primaryText = needsSignIn
    ? tr("Sign in to buy")
    : lifetimePrice
      ? `${tr("Buy Lifetime unlock")} · ${lifetimePrice}`
      : tr("Buy Lifetime unlock");
  const primaryAction = needsSignIn ? onSignInToBuy : onBuyLifetimeUnlock;

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>{tr("Trial ended")}</Text>
          <Text style={styles.title}>{tr("Unlock Agent Tick")}</Text>
          <Text style={styles.body}>{tr("Buy Lifetime app unlock to keep responding from this app and use self-hosted Agent Tick forever.")}</Text>

          <View style={styles.featureList}>
            <Text style={styles.feature}>{tr("• Respond to approval requests again")}</Text>
            <Text style={styles.feature}>{tr("• Use self-hosted Agent Tick servers forever")}</Text>
            <Text style={styles.feature}>{tr("• Restore app access on your signed-in devices")}</Text>
          </View>

          {needsSignIn ? (
            <Text style={styles.hint}>{tr("Sign in to an Agent Tick account before buying so purchases can be restored and protected from duplicates.")}</Text>
          ) : purchaseUnavailable ? (
            <Text style={styles.hint}>{purchaseUnavailableMessage || tr("Purchases are still loading. Try again in a moment or open App access for details.")}</Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: primaryDisabled }}
            disabled={primaryDisabled}
            onPress={primaryAction}
            style={[styles.primaryButton, primaryDisabled ? styles.disabledButton : null]}
          >
            <Text style={styles.primaryButtonText}>{primaryText}</Text>
          </Pressable>

          <View style={styles.actionRow}>
            <Pressable accessibilityRole="button" disabled={needsSignIn} onPress={onRestorePurchases} style={[styles.secondaryButton, needsSignIn ? styles.secondaryButtonDisabled : null]}>
              <Text style={[styles.secondaryButtonText, needsSignIn ? styles.secondaryButtonTextDisabled : null]}>{tr("Restore purchases")}</Text>
            </Pressable>
            {onViewAppAccess ? (
              <Pressable accessibilityRole="button" onPress={onViewAppAccess} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>{tr("View App access")}</Text>
              </Pressable>
            ) : null}
          </View>

          <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.dismissButton}>
            <Text style={styles.dismissText}>{tr("Continue read-only")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(32, 33, 36, 0.48)",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 28,
    maxWidth: 440,
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    width: "100%",
  },
  eyebrow: {
    color: "#b45309",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  title: {
    color: "#202124",
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 10,
  },
  body: {
    color: "#3c4043",
    fontSize: 16,
    lineHeight: 23,
  },
  featureList: {
    backgroundColor: "#f8fafd",
    borderRadius: 18,
    gap: 8,
    marginTop: 18,
    padding: 14,
  },
  feature: {
    color: "#202124",
    fontSize: 14,
    lineHeight: 20,
  },
  hint: {
    color: "#5f6368",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 14,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#202124",
    borderRadius: 999,
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  disabledButton: {
    backgroundColor: "#dadce0",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
    marginTop: 12,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#dadce0",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonDisabled: {
    backgroundColor: "#f1f3f4",
    borderColor: "#f1f3f4",
  },
  secondaryButtonText: {
    color: "#202124",
    fontSize: 14,
    fontWeight: "700",
  },
  secondaryButtonTextDisabled: {
    color: "#9aa0a6",
  },
  dismissButton: {
    alignItems: "center",
    marginTop: 14,
    padding: 8,
  },
  dismissText: {
    color: "#5f6368",
    fontSize: 14,
    fontWeight: "700",
  },
});
