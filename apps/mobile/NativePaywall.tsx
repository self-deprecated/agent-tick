import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { translateSource } from "@agent-tick/i18n";
import type { PaywallConfig, ProductKey, StoreProduct } from "./purchases";

export type NativePaywallProps = {
  visible: boolean;
  config?: PaywallConfig | null;
  products?: StoreProduct[];
  purchaseUnavailable?: boolean;
  purchaseUnavailableMessage?: string;
  showTrialOffer?: boolean;
  onStartTrial?: () => void;
  onBuyLifetimeUnlock: () => void;
  onSubscribeHostedPersonal?: (period: "monthly" | "yearly") => void;
  onDismiss: () => void;
  onRestorePurchases: () => void;
  onOpenTerms?: () => void;
  onOpenPrivacy?: () => void;
  onViewAppAccess?: () => void;
};

const fallbackOrder: ProductKey[] = ["trial_7_day", "hosted_personal_monthly", "hosted_personal_yearly", "lifetime_unlock"];

export function NativePaywall({
  visible,
  config,
  products = config?.products ?? [],
  purchaseUnavailable = false,
  purchaseUnavailableMessage,
  showTrialOffer = true,
  onStartTrial,
  onBuyLifetimeUnlock,
  onSubscribeHostedPersonal,
  onDismiss,
  onRestorePurchases,
  onOpenTerms,
  onOpenPrivacy,
  onViewAppAccess,
}: NativePaywallProps) {
  if (!visible) return null;

  const tr = translateSource;
  const productOrder = config?.productOrder?.length ? config.productOrder : fallbackOrder;
  const displayProducts = config?.products?.length ? config.products : products;
  const productCards = productOrder.flatMap((productKey) => {
    if (productKey === "trial_7_day" && !showTrialOffer) return [];
    const product = displayProducts.find((candidate) => candidate.productKey === productKey) ?? fallbackProduct(productKey);
    return product ? [{ productKey, product }] : [];
  });

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.eyebrow}>{tr(config?.source === "revenuecat" ? "App access" : "App access")}</Text>
            <Text style={styles.title}>{tr(config?.headline ?? "Choose how to use Agent Tick")}</Text>
            <Text style={styles.body}>{tr(config?.subtitle ?? "Route coding-agent Requests to your phone. Start free, self-host forever, or let us host it.")}</Text>

            <View style={styles.optionList}>
              {productCards.map(({ productKey, product }) => (
                <ProductCard
                  badge={badgeForProduct(productKey, config)}
                  disabled={purchaseUnavailable}
                  highlighted={config?.highlightedProduct === productKey || (!config?.highlightedProduct && productKey === "trial_7_day")}
                  key={productKey}
                  product={product}
                  productKey={productKey}
                  onBuyLifetimeUnlock={onBuyLifetimeUnlock}
                  onStartTrial={onStartTrial}
                  onSubscribeHostedPersonal={onSubscribeHostedPersonal}
                />
              ))}
            </View>

            {purchaseUnavailable ? (
              <Text style={styles.hint}>{purchaseUnavailableMessage || tr("Purchases are still loading. Try again in a moment or open App access for details.")}</Text>
            ) : null}

            <View style={styles.disclosureBox}>
              <Text style={styles.disclosureText}>{tr(config?.trialNote ?? trialNoteCopy())}</Text>
              <Text style={styles.disclosureText}>{tr(Platform.OS === "android" ? "Hosted subscriptions auto-renew until canceled in your Google Play account settings." : "Hosted subscriptions auto-renew until canceled in your App Store account settings.")}</Text>
              <Text style={styles.disclosureText}>{tr(config?.footerNote ?? footerNoteCopy())}</Text>
            </View>

            <View style={styles.actionRow}>
              <Pressable accessibilityRole="button" onPress={onRestorePurchases} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>{tr("Restore purchases")}</Text>
              </Pressable>
              {onViewAppAccess ? (
                <Pressable accessibilityRole="button" onPress={onViewAppAccess} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>{tr("View App access")}</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.legalRow}>
              {onOpenTerms ? (
                <Pressable accessibilityRole="link" onPress={onOpenTerms} style={styles.legalButton}>
                  <Text style={styles.legalText}>{tr("Terms")}</Text>
                </Pressable>
              ) : null}
              {onOpenPrivacy ? (
                <Pressable accessibilityRole="link" onPress={onOpenPrivacy} style={styles.legalButton}>
                  <Text style={styles.legalText}>{tr("Privacy Policy")}</Text>
                </Pressable>
              ) : null}
            </View>

            <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.dismissButton}>
              <Text style={styles.dismissText}>{tr("Continue read-only")}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ProductCard({
  badge,
  disabled,
  highlighted,
  product,
  productKey,
  onBuyLifetimeUnlock,
  onStartTrial,
  onSubscribeHostedPersonal,
}: {
  badge?: string;
  disabled?: boolean;
  highlighted?: boolean;
  product: StoreProduct;
  productKey: ProductKey;
  onBuyLifetimeUnlock: () => void;
  onStartTrial?: () => void;
  onSubscribeHostedPersonal?: (period: "monthly" | "yearly") => void;
}) {
  const tr = translateSource;
  const action = actionForProduct(productKey, { onBuyLifetimeUnlock, onStartTrial, onSubscribeHostedPersonal });
  const actionDisabled = disabled || !action.onPress;
  return (
    <View style={[styles.productCard, highlighted ? styles.productCardHighlighted : null]}>
      <View style={styles.productHeader}>
        <View style={styles.productTitleStack}>
          <Text style={styles.productTitle}>{tr(titleForProduct(productKey))}</Text>
          <Text style={styles.productMeta}>{tr(descriptionForProduct(productKey))}</Text>
        </View>
        {badge ? <Text style={styles.badge}>{tr(badge)}</Text> : null}
      </View>
      <Text style={styles.price}>{priceForProduct(productKey, product)}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: actionDisabled }}
        disabled={actionDisabled}
        onPress={action.onPress}
        style={[styles.primaryButton, highlighted ? styles.primaryButtonHighlighted : null, actionDisabled ? styles.disabledButton : null]}
      >
        <Text style={styles.primaryButtonText}>{tr(action.label)}</Text>
      </Pressable>
    </View>
  );
}

function actionForProduct(productKey: ProductKey, actions: Pick<NativePaywallProps, "onStartTrial" | "onBuyLifetimeUnlock" | "onSubscribeHostedPersonal">): { label: string; onPress?: () => void } {
  switch (productKey) {
    case "trial_7_day":
      return { label: "Start 7-day Trial", onPress: actions.onStartTrial };
    case "lifetime_unlock":
      return { label: "Buy Self-hosted Lifetime", onPress: actions.onBuyLifetimeUnlock };
    case "hosted_personal_monthly":
      return { label: "Subscribe monthly", onPress: actions.onSubscribeHostedPersonal ? () => actions.onSubscribeHostedPersonal?.("monthly") : undefined };
    case "hosted_personal_yearly":
      return { label: "Subscribe yearly", onPress: actions.onSubscribeHostedPersonal ? () => actions.onSubscribeHostedPersonal?.("yearly") : undefined };
  }
}

function descriptionForProduct(productKey: ProductKey): string {
  switch (productKey) {
    case "trial_7_day":
      return translateSource(trialNoteCopy());
    case "lifetime_unlock":
      return translateSource("Use the first-party app with self-hosted Agent Tick servers forever.");
    case "hosted_personal_monthly":
      return translateSource("Hosted routing, push notifications, updates, uptime, and hosted plus self-hosted responses while active.");
    case "hosted_personal_yearly":
      return translateSource("Annual hosted routing, push notifications, updates, uptime, and hosted plus self-hosted responses while active.");
  }
}

function badgeForProduct(productKey: ProductKey, config?: PaywallConfig | null): string | undefined {
  if (productKey === "lifetime_unlock") return config?.lifetimeBadge;
  if (productKey === "hosted_personal_yearly") return config?.yearlyBadge;
  if (productKey === "trial_7_day") return "Free";
  return undefined;
}

function trialNoteCopy(): string {
  return Platform.OS === "android"
    ? "Free 7-day trial. No Google Play purchase starts."
    : "Free App Store purchase. No subscription starts.";
}

function footerNoteCopy(): string {
  return Platform.OS === "android"
    ? "Paid digital access uses Google Play purchases."
    : "Digital access uses App Store in-app purchases.";
}

function fallbackProduct(productKey: ProductKey): StoreProduct {
  return { productKey, productId: productKey, title: titleForProduct(productKey), priceString: fallbackPrice(productKey) };
}

function titleForProduct(productKey: ProductKey): string {
  switch (productKey) {
    case "trial_7_day":
      return translateSource("7-day Trial");
    case "lifetime_unlock":
      return translateSource("Self-hosted Lifetime");
    case "hosted_personal_monthly":
      return translateSource("Hosted monthly");
    case "hosted_personal_yearly":
      return translateSource("Hosted yearly");
  }
}

function priceForProduct(productKey: ProductKey, product: StoreProduct): string {
  if (productKey === "trial_7_day") return translateSource("Free");
  return product.priceString ?? fallbackPrice(productKey);
}

function fallbackPrice(productKey: ProductKey): string {
  switch (productKey) {
    case "trial_7_day":
      return translateSource("Free");
    case "lifetime_unlock":
      return translateSource("One-time purchase");
    case "hosted_personal_monthly":
      return translateSource("Monthly");
    case "hosted_personal_yearly":
      return translateSource("Yearly");
  }
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
    maxHeight: "92%",
    maxWidth: 480,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    width: "100%",
  },
  scrollContent: {
    padding: 24,
  },
  eyebrow: {
    color: "#1a73e8",
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
  optionList: {
    gap: 12,
    marginTop: 18,
  },
  productCard: {
    backgroundColor: "#f8fafd",
    borderColor: "#e8eaed",
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  productCardHighlighted: {
    backgroundColor: "#eef4ff",
    borderColor: "#1a73e8",
  },
  productHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  productTitleStack: {
    flex: 1,
    gap: 4,
  },
  productTitle: {
    color: "#202124",
    fontSize: 16,
    fontWeight: "800",
  },
  productMeta: {
    color: "#5f6368",
    fontSize: 13,
    lineHeight: 18,
  },
  badge: {
    backgroundColor: "#d7e8ff",
    borderRadius: 999,
    color: "#174ea6",
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  price: {
    color: "#202124",
    fontSize: 20,
    fontWeight: "900",
    marginTop: 12,
  },
  hint: {
    color: "#5f6368",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 14,
  },
  disclosureBox: {
    backgroundColor: "#fff8e1",
    borderRadius: 16,
    gap: 6,
    marginTop: 14,
    padding: 12,
  },
  disclosureText: {
    color: "#5f6368",
    fontSize: 12,
    lineHeight: 17,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#202124",
    borderRadius: 999,
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonHighlighted: {
    backgroundColor: "#1a73e8",
  },
  disabledButton: {
    backgroundColor: "#dadce0",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
    marginTop: 14,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#dadce0",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: "#202124",
    fontSize: 14,
    fontWeight: "700",
  },
  legalRow: {
    flexDirection: "row",
    gap: 16,
    justifyContent: "center",
    marginTop: 12,
  },
  legalButton: {
    padding: 6,
  },
  legalText: {
    color: "#1a73e8",
    fontSize: 13,
    fontWeight: "800",
  },
  dismissButton: {
    alignItems: "center",
    marginTop: 8,
    padding: 8,
  },
  dismissText: {
    color: "#5f6368",
    fontSize: 14,
    fontWeight: "700",
  },
});
