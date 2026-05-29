export function effectiveNativeClerkSignedIn({
  nativeSessionSignedIn,
  nativeAuthEventType,
  addingClerkAccount,
}: {
  nativeSessionSignedIn: boolean;
  nativeAuthEventType?: string | null;
  addingClerkAccount: boolean;
}): boolean {
  const nativeAuthEventSignedIn = nativeAuthEventType === "signedIn";
  if (addingClerkAccount) return nativeSessionSignedIn;
  return nativeSessionSignedIn || nativeAuthEventSignedIn;
}

export function didObserveClerkSignedOutForAccountAdd({
  addingClerkAccount,
  isClerkSignedIn,
  nativeSessionSignedIn,
}: {
  addingClerkAccount: boolean;
  isClerkSignedIn: boolean;
  nativeSessionSignedIn: boolean;
}): boolean {
  return addingClerkAccount && !isClerkSignedIn && !nativeSessionSignedIn;
}

export function shouldTreatCurrentSessionAsClerk({
  runtimeAuthProvider,
  currentAccountAuthProvider,
  activeSavedAccountAuthProvider,
  hasClerkSessionToken,
}: {
  runtimeAuthProvider?: string | null;
  currentAccountAuthProvider?: string | null;
  activeSavedAccountAuthProvider?: string | null;
  hasClerkSessionToken: boolean;
}): boolean {
  if (runtimeAuthProvider === "clerk") return true;
  if (currentAccountAuthProvider === "clerk") return true;
  if (activeSavedAccountAuthProvider === "clerk") return true;
  return false;
}
