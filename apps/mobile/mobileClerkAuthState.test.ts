import { didObserveClerkSignedOutForAccountAdd, effectiveNativeClerkSignedIn, shouldTreatCurrentSessionAsClerk } from "./mobileClerkAuthState";

describe("mobile Clerk auth state", () => {
  it("ignores stale native signed-in events while adding another account before sign-out is observed", () => {
    expect(effectiveNativeClerkSignedIn({
      nativeSessionSignedIn: false,
      nativeAuthEventType: "signedIn",
      addingClerkAccount: true,
    })).toBe(false);
  });

  it("keeps ignoring native signed-in events while adding another account until the native session refreshes", () => {
    expect(effectiveNativeClerkSignedIn({
      nativeSessionSignedIn: false,
      nativeAuthEventType: "signedIn",
      addingClerkAccount: true,
    })).toBe(false);
    expect(effectiveNativeClerkSignedIn({
      nativeSessionSignedIn: true,
      nativeAuthEventType: null,
      addingClerkAccount: true,
    })).toBe(true);
  });

  it("only opens the add-account sign-in view after Clerk and native session state are signed out", () => {
    expect(didObserveClerkSignedOutForAccountAdd({
      addingClerkAccount: true,
      isClerkSignedIn: false,
      nativeSessionSignedIn: false,
    })).toBe(true);
    expect(didObserveClerkSignedOutForAccountAdd({
      addingClerkAccount: true,
      isClerkSignedIn: false,
      nativeSessionSignedIn: true,
    })).toBe(false);
  });

  it("does not infer Clerk cleanup semantics from a token alone", () => {
    expect(shouldTreatCurrentSessionAsClerk({
      runtimeAuthProvider: "local",
      currentAccountAuthProvider: undefined,
      hasClerkSessionToken: true,
    })).toBe(false);
    expect(shouldTreatCurrentSessionAsClerk({
      runtimeAuthProvider: null,
      currentAccountAuthProvider: undefined,
      hasClerkSessionToken: true,
    })).toBe(false);
  });

  it("allows Clerk cleanup when runtime discovery or account provenance proves Clerk mode", () => {
    expect(shouldTreatCurrentSessionAsClerk({
      runtimeAuthProvider: "clerk",
      currentAccountAuthProvider: undefined,
      hasClerkSessionToken: false,
    })).toBe(true);
    expect(shouldTreatCurrentSessionAsClerk({
      runtimeAuthProvider: null,
      currentAccountAuthProvider: "clerk",
      hasClerkSessionToken: false,
    })).toBe(true);
    expect(shouldTreatCurrentSessionAsClerk({
      runtimeAuthProvider: null,
      currentAccountAuthProvider: undefined,
      activeSavedAccountAuthProvider: "clerk",
      hasClerkSessionToken: true,
    })).toBe(true);
  });
});
