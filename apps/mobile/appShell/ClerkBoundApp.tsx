import { useAuth, useClerk, useNativeAuthEvents, useNativeSession } from "@clerk/expo";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import { ClerkSignInScreen } from "../ClerkSignInScreen";
import { recordDiagnostic, setDiagnosticContext } from "../diagnostics";
import { effectiveNativeClerkSignedIn } from "../mobileClerkAuthState";
import { hostedServerURL } from "../mobileAuth";
import { loadStoredMobileConnections } from "../mobileConnections";
import { selfHostedInitialURL } from "./appBootstrapHelpers";
import { LoadingScreen } from "./LoadingScreen";
import { activateClerkSession, clearClerkBootstrapState, clerkAuthDiagnostics, clerkSessionExists, hashDiagnosticID, jwtStringClaim } from "./clerkSessionHelpers";
import type { AgentTickAppClerkControls, AgentTickAppProps } from "./AgentTickAppProps";

const defaultServer = hostedServerURL;

export function ClerkBoundApp({ renderAgentTickApp, ...props }: AgentTickAppProps & {
  renderAgentTickApp: (key: string, props: AgentTickAppProps & AgentTickAppClerkControls) => ReactElement;
}) {
  const { getToken, isLoaded, isSignedIn, sessionId, signOut } = useAuth({ treatPendingAsSignedOut: false });
  const clerk = useClerk();
  const nativeSession = useNativeSession();
  const nativeAuthEvents = useNativeAuthEvents();
  const [clerkSessionToken, setClerkSessionToken] = useState<string | null>(null);
  const [clerkSessionTokenSessionID, setClerkSessionTokenSessionID] = useState<string | null>(null);
  const [signedOutManually, setSignedOutManually] = useState(false);
  const [signOutInProgress, setSignOutInProgress] = useState(false);
  const [addingClerkAccount, setAddingClerkAccount] = useState(false);
  const [openSignInAfterSignOut, setOpenSignInAfterSignOut] = useState(false);
  const [authViewOpened, setAuthViewOpened] = useState(false);
  const [authViewHandoffSettled, setAuthViewHandoffSettled] = useState(false);
  const [activeMobileAccountID, setActiveMobileAccountID] = useState<string | null>(null);
  const [storedConnectionCount, setStoredConnectionCount] = useState<number | null>(null);
  const [tokenRefreshNonce, setTokenRefreshNonce] = useState(0);
  const addAccountInitialSessionID = useRef<string | null>(null);
  const authViewHandoffStarted = useRef("");
  const refreshedNativeSignInEvent = useRef("");

  const nativeSessionSignedIn = Boolean(nativeSession.isSignedIn);
  const nativeAuthStateType = nativeAuthEvents.nativeAuthState?.type;
  const nativeAuthStateSessionId = nativeAuthEvents.nativeAuthState?.sessionId;
  const nativeSignedIn = effectiveNativeClerkSignedIn({
    nativeSessionSignedIn,
    nativeAuthEventType: nativeAuthStateType,
    addingClerkAccount,
  });
  const activeClerkSessionToken = !sessionId || clerkSessionTokenSessionID === sessionId ? clerkSessionToken : null;
  const hasClerkLogin = !signedOutManually && Boolean(isSignedIn && activeClerkSessionToken);

  const refreshStoredConnectionCount = useCallback(async () => {
    const connections = await loadStoredMobileConnections().catch(() => []);
    setStoredConnectionCount(connections.length);
  }, []);

  useEffect(() => {
    void refreshStoredConnectionCount();
  }, [refreshStoredConnectionCount, signedOutManually, hasClerkLogin]);

  useEffect(() => {
    setDiagnosticContext({
      appLayer: "clerk-bound",
      isClerkLoaded: isLoaded,
      isClerkSignedIn: isSignedIn,
      isNativeClerkSignedIn: nativeSignedIn,
      signedOutManually,
      signOutInProgress,
      addingClerkAccount,
      openSignInAfterSignOut,
      activeMobileAccountID: activeMobileAccountID || undefined,
      hasClerkSessionToken: Boolean(activeClerkSessionToken),
      hasClerkLogin,
      ...clerkAuthDiagnostics(clerk, sessionId ?? null, activeClerkSessionToken),
    });
    recordDiagnostic("info", "auth_state", "clerk_bound_render");
  }, [activeClerkSessionToken, activeMobileAccountID, addingClerkAccount, hasClerkLogin, isLoaded, isSignedIn, nativeSignedIn, openSignInAfterSignOut, sessionId, signOutInProgress, signedOutManually]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn || signedOutManually) {
      setClerkSessionToken(null);
      setClerkSessionTokenSessionID(null);
      return;
    }
    let cancelled = false;
    const refreshToken = async () => {
      const token = await getToken().catch(() => null);
      if (!cancelled) {
        setClerkSessionToken(token ?? null);
        setClerkSessionTokenSessionID(token ? sessionId ?? jwtStringClaim(token, "sid") : null);
      }
    };
    void refreshToken();
    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, sessionId, signedOutManually, tokenRefreshNonce]);

  useEffect(() => {
    if (!isLoaded || isSignedIn || signedOutManually) return;
    const interval = setInterval(() => {
      void nativeSession.refresh();
    }, 1000);
    return () => clearInterval(interval);
  }, [isLoaded, isSignedIn, nativeSession, signedOutManually]);

  useEffect(() => {
    if (!addingClerkAccount || nativeAuthStateType !== "signedIn") return;
    const refreshKey = `${nativeAuthStateType}:${nativeAuthStateSessionId ?? "unknown"}`;
    if (refreshedNativeSignInEvent.current === refreshKey) return;
    refreshedNativeSignInEvent.current = refreshKey;
    void nativeSession.refresh();
    setTokenRefreshNonce((value) => value + 1);
  }, [addingClerkAccount, nativeAuthStateSessionId, nativeAuthStateType, nativeSession]);

  useEffect(() => {
    if (!addingClerkAccount || !sessionId || !isSignedIn) return;
    if (addAccountInitialSessionID.current === sessionId) return;
    setClerkSessionToken(null);
    setClerkSessionTokenSessionID(null);
    setAddingClerkAccount(false);
    setOpenSignInAfterSignOut(false);
    setSignedOutManually(false);
    setTokenRefreshNonce((value) => value + 1);
  }, [addingClerkAccount, isSignedIn, sessionId]);

  const handleAddClerkAccount = useCallback(async () => {
    recordDiagnostic("info", "button", "add_clerk_account_start", clerkAuthDiagnostics(clerk, sessionId ?? null, activeClerkSessionToken));
    addAccountInitialSessionID.current = sessionId ?? null;
    setAddingClerkAccount(true);
    setOpenSignInAfterSignOut(true);
    setSignedOutManually(false);
    setClerkSessionToken(null);
    setClerkSessionTokenSessionID(null);
    await clearClerkBootstrapState(signOut, clerk);
    setTokenRefreshNonce((value) => value + 1);
  }, [activeClerkSessionToken, clerk, sessionId, signOut]);

  const handleAuthViewOpen = useCallback(() => {
    setSignedOutManually(false);
    setAuthViewOpened(true);
    setAuthViewHandoffSettled(false);
  }, []);

  const handleCancelAddClerkAccount = useCallback(() => {
    recordDiagnostic("info", "auth", "add_clerk_account_cancelled");
    addAccountInitialSessionID.current = null;
    setAddingClerkAccount(false);
    setOpenSignInAfterSignOut(false);
    setAuthViewOpened(false);
    setAuthViewHandoffSettled(false);
    setSignedOutManually(false);
    setTokenRefreshNonce((value) => value + 1);
  }, []);

  const handleForgetClerkSession = useCallback(async (options?: { reopenSignIn?: boolean }) => {
    const reopenSignIn = Boolean(options?.reopenSignIn);
    recordDiagnostic("info", "button", "forget_clerk_session", { reopenSignIn });
    setSignedOutManually(true);
    setSignOutInProgress(false);
    setAddingClerkAccount(false);
    setOpenSignInAfterSignOut(reopenSignIn);
    setAuthViewOpened(false);
    setAuthViewHandoffSettled(false);
    authViewHandoffStarted.current = "";
    setActiveMobileAccountID(null);
    setClerkSessionToken(null);
    setClerkSessionTokenSessionID(null);
    await clearClerkBootstrapState(signOut, clerk);
    await refreshStoredConnectionCount();
  }, [clerk, refreshStoredConnectionCount, signOut]);

  useEffect(() => {
    if (!hasClerkLogin) {
      authViewHandoffStarted.current = "";
      if (!authViewOpened) setAuthViewHandoffSettled(false);
      return;
    }
    if (!authViewOpened) return;
    const handoffKey = sessionId ?? "active";
    if (authViewHandoffStarted.current === handoffKey) return;
    authViewHandoffStarted.current = handoffKey;
    setAuthViewHandoffSettled(false);
    recordDiagnostic("info", "auth_state", "auth_view_handoff_wait", { sessionIDHash: hashDiagnosticID(sessionId) });
    const timer = setTimeout(() => {
      setAuthViewHandoffSettled(true);
      setAuthViewOpened(false);
      recordDiagnostic("info", "auth_state", "auth_view_handoff_settled", { sessionIDHash: hashDiagnosticID(sessionId) });
    }, 650);
    return () => clearTimeout(timer);
  }, [authViewOpened, hasClerkLogin, sessionId]);

  const provideClerkToken = useCallback(async () => {
    const token = await getToken().catch(() => null);
    if (token) {
      const tokenSessionID = sessionId ?? jwtStringClaim(token, "sid");
      setClerkSessionToken((current) => (current === token ? current : token));
      setClerkSessionTokenSessionID((current) => (current === tokenSessionID ? current : tokenSessionID));
    }
    return token ?? activeClerkSessionToken;
  }, [activeClerkSessionToken, getToken, sessionId]);

  if (!isLoaded || signOutInProgress) {
    return <LoadingScreen />;
  }
  if (addingClerkAccount) {
    return (
      <ClerkSignInScreen
        key={`add-account:${addAccountInitialSessionID.current ?? "signed-out"}`}
        serverURL={defaultServer}
        selfHostedInitialURL={selfHostedInitialURL(props.initialServerURL)}
        initialShowAuthView={openSignInAfterSignOut}
        authMode="signIn"
        addAccountHint={Boolean(addAccountInitialSessionID.current)}
        onAuthViewOpen={handleAuthViewOpen}
        onCancel={handleCancelAddClerkAccount}
        onServerSelected={props.onRuntimeAuthConfig}
      />
    );
  }
  if (isSignedIn && !activeClerkSessionToken && !signedOutManually) {
    return <LoadingScreen />;
  }
  if (hasClerkLogin && authViewOpened && !authViewHandoffSettled) {
    return <LoadingScreen />;
  }
  if (!hasClerkLogin) {
    if (storedConnectionCount === null) return <LoadingScreen />;
    if (storedConnectionCount > 0 && !openSignInAfterSignOut) {
      return renderAgentTickApp("stored-connections", {
        ...props,
        clerkSignedIn: false,
        clerkSessionID: null,
        clerkSessionToken: null,
        clerkTokenProvider: async () => null,
        onAddClerkAccount: handleAddClerkAccount,
        onForgetClerkSession: handleForgetClerkSession,
      });
    }
    return (
      <ClerkSignInScreen
        serverURL={defaultServer}
        selfHostedInitialURL={selfHostedInitialURL(props.initialServerURL)}
        initialShowAuthView={openSignInAfterSignOut}
        onAuthViewOpen={handleAuthViewOpen}
        onServerSelected={props.onRuntimeAuthConfig}
      />
    );
  }
  return renderAgentTickApp(activeMobileAccountID ?? `clerk:${sessionId ?? "active"}`, {
    ...props,
    clerkSignedIn: Boolean(isSignedIn),
    clerkSessionID: sessionId ?? null,
    clerkSessionToken: activeClerkSessionToken,
    clerkTokenProvider: provideClerkToken,
    clerkDebugState: {
      activeMobileAccountID: activeMobileAccountID || undefined,
      addingClerkAccount,
      authViewOpened,
      authViewHandoffSettled,
      signedOutManually,
      signOutInProgress,
      isClerkLoaded: isLoaded,
      isClerkSignedIn: isSignedIn,
      isNativeClerkSignedIn: nativeSignedIn,
      hasClerkSessionToken: Boolean(activeClerkSessionToken),
      ...clerkAuthDiagnostics(clerk, sessionId ?? null, activeClerkSessionToken),
    },
    onAddClerkAccount: () => void handleAddClerkAccount(),
    onForgetClerkSession: (options) => void handleForgetClerkSession(options),
    onSelectSavedClerkAccount: async (account) => {
      recordDiagnostic("info", "auth", "saved_account_switch_attempt", { targetSignInMethod: account.signInMethod, hasTargetEmail: Boolean(account.email), hasTargetUser: Boolean(account.userID), hasClerkSessionID: Boolean(account.clerkSessionID) });
      if (!account.clerkSessionID || !clerkSessionExists(clerk, account.clerkSessionID)) {
        recordDiagnostic("warn", "auth", "saved_account_clerk_session_missing", { targetSignInMethod: account.signInMethod, hasTargetEmail: Boolean(account.email) });
        return "missing";
      }
      await activateClerkSession(clerk, account.clerkSessionID);
      setActiveMobileAccountID(account.id);
      setSignedOutManually(false);
      setOpenSignInAfterSignOut(false);
      setClerkSessionToken(null);
      setClerkSessionTokenSessionID(null);
      setTokenRefreshNonce((value) => value + 1);
      return "selected";
    },
  });
}

