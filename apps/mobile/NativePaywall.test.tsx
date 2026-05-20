import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { NativePaywall } from "./NativePaywall";

describe("NativePaywall", () => {
  it("presents lifetime unlock as the primary app-access purchase", () => {
    const onBuyLifetimeUnlock = jest.fn();
    const onRestorePurchases = jest.fn();
    const onDismiss = jest.fn();

    render(
      <NativePaywall
        visible
        lifetimePrice="$19.99"
        onBuyLifetimeUnlock={onBuyLifetimeUnlock}
        onDismiss={onDismiss}
        onRestorePurchases={onRestorePurchases}
      />,
    );

    expect(screen.getByText("Trial ended")).toBeTruthy();
    expect(screen.getByText("Unlock Agent Tick")).toBeTruthy();
    expect(screen.getByText("Buy Lifetime unlock · $19.99")).toBeTruthy();
    expect(screen.getByText("Restore purchases")).toBeTruthy();

    fireEvent.press(screen.getByText("Buy Lifetime unlock · $19.99"));
    fireEvent.press(screen.getByText("Restore purchases"));
    fireEvent.press(screen.getByText("Continue read-only"));

    expect(onBuyLifetimeUnlock).toHaveBeenCalledTimes(1);
    expect(onRestorePurchases).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("asks users to sign in before buying or restoring", () => {
    const onSignInToBuy = jest.fn();
    const onRestorePurchases = jest.fn();

    render(
      <NativePaywall
        visible
        needsSignIn
        onBuyLifetimeUnlock={jest.fn()}
        onDismiss={jest.fn()}
        onRestorePurchases={onRestorePurchases}
        onSignInToBuy={onSignInToBuy}
      />,
    );

    fireEvent.press(screen.getByText("Sign in to buy"));
    fireEvent.press(screen.getByText("Restore purchases"));

    expect(onSignInToBuy).toHaveBeenCalledTimes(1);
    expect(onRestorePurchases).not.toHaveBeenCalled();
  });
});
