import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { NativePaywall } from "./NativePaywall";

const products = [
  { productKey: "trial_7_day" as const, productId: "trial", title: "7-day Trial", priceString: "Free" },
  { productKey: "hosted_personal_monthly" as const, productId: "monthly", title: "Hosted monthly", priceString: "$4.99/month" },
  { productKey: "hosted_personal_yearly" as const, productId: "yearly", title: "Hosted yearly", priceString: "$49.99/year" },
  { productKey: "lifetime_unlock" as const, productId: "lifetime", title: "Self-hosted Lifetime", priceString: "$19.99" },
];

describe("NativePaywall", () => {
  it("does not mount a hidden modal while not visible", () => {
    render(
      <NativePaywall
        visible={false}
        products={products}
        onBuyLifetimeUnlock={jest.fn()}
        onDismiss={jest.fn()}
        onRestorePurchases={jest.fn()}
        onStartTrial={jest.fn()}
        onSubscribeHostedPersonal={jest.fn()}
      />,
    );

    expect(screen.queryByText("Choose how to use Agent Tick")).toBeNull();
  });

  it("presents trial, hosted, and self-hosted options with restore and legal links", () => {
    const onStartTrial = jest.fn();
    const onBuyLifetimeUnlock = jest.fn();
    const onSubscribeHostedPersonal = jest.fn();
    const onRestorePurchases = jest.fn();
    const onDismiss = jest.fn();
    const onOpenTerms = jest.fn();
    const onOpenPrivacy = jest.fn();

    render(
      <NativePaywall
        visible
        products={products}
        onStartTrial={onStartTrial}
        onBuyLifetimeUnlock={onBuyLifetimeUnlock}
        onSubscribeHostedPersonal={onSubscribeHostedPersonal}
        onDismiss={onDismiss}
        onOpenPrivacy={onOpenPrivacy}
        onOpenTerms={onOpenTerms}
        onRestorePurchases={onRestorePurchases}
      />,
    );

    expect(screen.getByText("Choose how to use Agent Tick")).toBeTruthy();
    expect(screen.getByText("Start 7-day Trial")).toBeTruthy();
    expect(screen.getByText("Subscribe monthly")).toBeTruthy();
    expect(screen.getByText("Subscribe yearly")).toBeTruthy();
    expect(screen.getByText("Buy Self-hosted Lifetime")).toBeTruthy();
    expect(screen.getByText("Restore purchases")).toBeTruthy();
    expect(screen.getByText("Terms")).toBeTruthy();
    expect(screen.getByText("Privacy Policy")).toBeTruthy();

    fireEvent.press(screen.getByText("Start 7-day Trial"));
    fireEvent.press(screen.getByText("Subscribe monthly"));
    fireEvent.press(screen.getByText("Subscribe yearly"));
    fireEvent.press(screen.getByText("Buy Self-hosted Lifetime"));
    fireEvent.press(screen.getByText("Restore purchases"));
    fireEvent.press(screen.getByText("Terms"));
    fireEvent.press(screen.getByText("Privacy Policy"));
    fireEvent.press(screen.getByText("Continue read-only"));

    expect(onStartTrial).toHaveBeenCalledTimes(1);
    expect(onSubscribeHostedPersonal).toHaveBeenCalledWith("monthly");
    expect(onSubscribeHostedPersonal).toHaveBeenCalledWith("yearly");
    expect(onBuyLifetimeUnlock).toHaveBeenCalledTimes(1);
    expect(onRestorePurchases).toHaveBeenCalledTimes(1);
    expect(onOpenTerms).toHaveBeenCalledTimes(1);
    expect(onOpenPrivacy).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("disables every purchase button while purchases are unavailable", () => {
    const onStartTrial = jest.fn();
    const onBuyLifetimeUnlock = jest.fn();
    const onSubscribeHostedPersonal = jest.fn();

    render(
      <NativePaywall
        visible
        products={products}
        purchaseUnavailable
        onStartTrial={onStartTrial}
        onBuyLifetimeUnlock={onBuyLifetimeUnlock}
        onSubscribeHostedPersonal={onSubscribeHostedPersonal}
        onDismiss={jest.fn()}
        onRestorePurchases={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByText("Start 7-day Trial"));
    fireEvent.press(screen.getByText("Subscribe monthly"));
    fireEvent.press(screen.getByText("Subscribe yearly"));
    fireEvent.press(screen.getByText("Buy Self-hosted Lifetime"));

    expect(onStartTrial).not.toHaveBeenCalled();
    expect(onSubscribeHostedPersonal).not.toHaveBeenCalled();
    expect(onBuyLifetimeUnlock).not.toHaveBeenCalled();
  });

  it("keeps product marketing copy stable while using StoreKit prices", () => {
    render(
      <NativePaywall
        visible
        products={[
          { productKey: "trial_7_day", productId: "trial", title: "7 Day Trial", description: "Use the app and hosted service for 7 days", priceString: "$0.00" },
          { productKey: "hosted_personal_monthly", productId: "monthly", title: "Hosted Service - Monthly", description: "Routing for agent request via agenttick.sh", priceString: "$4.99" },
        ]}
        onBuyLifetimeUnlock={jest.fn()}
        onDismiss={jest.fn()}
        onRestorePurchases={jest.fn()}
        onStartTrial={jest.fn()}
        onSubscribeHostedPersonal={jest.fn()}
      />,
    );

    expect(screen.getByText("7-day Trial")).toBeTruthy();
    expect(screen.getAllByText("Free App Store purchase. No subscription starts.").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Free").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Hosted monthly")).toBeTruthy();
    expect(screen.getByText("Hosted routing, push notifications, updates, uptime, and hosted plus self-hosted responses while active.")).toBeTruthy();
    expect(screen.getByText("$4.99")).toBeTruthy();
    expect(screen.queryByText("7 Day Trial")).toBeNull();
    expect(screen.queryByText("Routing for agent request via agenttick.sh")).toBeNull();
  });

  it("uses localized prices from the active paywall config over stale fallback products", () => {
    render(
      <NativePaywall
        visible
        config={{
          placement: "hosted_gate",
          source: "revenuecat",
          products: [{ productKey: "hosted_personal_monthly", productId: "monthly", title: "Hosted monthly", priceString: "39 kr./md." }],
          productOrder: ["hosted_personal_monthly"],
          headline: "Hosted access",
          subtitle: "Subscribe to respond on hosted Requests.",
          primaryMode: "hosted",
          highlightedProduct: "hosted_personal_monthly",
          trialNote: "Free App Store purchase. No subscription starts.",
          footerNote: "Digital access uses App Store in-app purchases.",
        }}
        products={[{ productKey: "hosted_personal_monthly", productId: "monthly", title: "Hosted monthly", priceString: "$4.99/month" }]}
        onBuyLifetimeUnlock={jest.fn()}
        onDismiss={jest.fn()}
        onRestorePurchases={jest.fn()}
        onSubscribeHostedPersonal={jest.fn()}
      />,
    );

    expect(screen.getByText("39 kr./md.")).toBeTruthy();
    expect(screen.queryByText("$4.99/month")).toBeNull();
  });

  it("hides the trial option after an app access entitlement exists", () => {
    render(
      <NativePaywall
        visible
        products={products}
        showTrialOffer={false}
        onBuyLifetimeUnlock={jest.fn()}
        onDismiss={jest.fn()}
        onRestorePurchases={jest.fn()}
        onStartTrial={jest.fn()}
        onSubscribeHostedPersonal={jest.fn()}
      />,
    );

    expect(screen.queryByText("Start 7-day Trial")).toBeNull();
    expect(screen.getByText("Buy Self-hosted Lifetime")).toBeTruthy();
  });

  it("uses remote config copy, order, and highlighted product", () => {
    render(
      <NativePaywall
        visible
        config={{
          placement: "hosted_gate",
          source: "revenuecat",
          products,
          productOrder: ["hosted_personal_yearly", "hosted_personal_monthly", "lifetime_unlock"],
          headline: "Hosted access",
          subtitle: "Subscribe to respond on hosted Requests.",
          primaryMode: "hosted",
          highlightedProduct: "hosted_personal_yearly",
          yearlyBadge: "Best value",
          trialNote: "No trial shown here.",
          footerNote: "Digital access uses App Store in-app purchases.",
        }}
        onBuyLifetimeUnlock={jest.fn()}
        onDismiss={jest.fn()}
        onRestorePurchases={jest.fn()}
        onSubscribeHostedPersonal={jest.fn()}
      />,
    );

    expect(screen.getByText("Hosted access")).toBeTruthy();
    expect(screen.getByText("Subscribe to respond on hosted Requests.")).toBeTruthy();
    expect(screen.getByText("Best value")).toBeTruthy();
    expect(screen.queryByText("Start 7-day Trial")).toBeNull();
  });
});
