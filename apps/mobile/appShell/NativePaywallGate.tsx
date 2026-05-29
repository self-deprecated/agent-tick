import { NativePaywall } from "../NativePaywall";
import type { PaywallConfig, StoreProduct } from "../purchases";

export type NativePaywallGateProps = {
  visible: boolean;
  config: PaywallConfig | null;
  products: StoreProduct[];
  onStartTrial: () => void;
  onBuyLifetimeUnlock: () => void;
  onSubscribeHostedPersonal: (period: "monthly" | "yearly") => void;
  onDismiss: () => void;
  onRestorePurchases: () => void;
  onOpenTerms: () => void;
  onOpenPrivacy: () => void;
  onViewAppAccess: () => void;
  purchaseUnavailable: boolean;
  showTrialOffer: boolean;
  purchaseUnavailableMessage?: string;
};

export function NativePaywallGate({
  visible,
  config,
  products,
  onStartTrial,
  onBuyLifetimeUnlock,
  onSubscribeHostedPersonal,
  onDismiss,
  onRestorePurchases,
  onOpenTerms,
  onOpenPrivacy,
  onViewAppAccess,
  purchaseUnavailable,
  showTrialOffer,
  purchaseUnavailableMessage,
}: NativePaywallGateProps) {
  return visible ? (
    <NativePaywall
      config={config}
      products={products}
      onStartTrial={onStartTrial}
      onBuyLifetimeUnlock={onBuyLifetimeUnlock}
      onSubscribeHostedPersonal={onSubscribeHostedPersonal}
      onDismiss={onDismiss}
      onRestorePurchases={onRestorePurchases}
      onOpenTerms={onOpenTerms}
      onOpenPrivacy={onOpenPrivacy}
      onViewAppAccess={onViewAppAccess}
      purchaseUnavailable={purchaseUnavailable}
      showTrialOffer={showTrialOffer}
      purchaseUnavailableMessage={purchaseUnavailableMessage}
      visible
    />
  ) : null;
}
