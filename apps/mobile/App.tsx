import AsyncStorage from "@react-native-async-storage/async-storage";
import { ClerkProvider, useAuth, useNativeAuthEvents, useNativeSession } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TurboModuleRegistry,
  View,
  type TurboModule,
} from "react-native";
import {
  notificationDecision,
  notificationFallbackState,
  notificationRequestID,
  parsePairingPayload,
  type PairingPayload,
  type Screen,
} from "./AppLogic";
import {
  buildQuestionnaireAnswers,
  canRespondToRequest,
  groupRequestsByProject,
  isEncryptedApprovalRequest,
  isQuestionnaireRequest,
  normalizeApproval,
  normalizeApprovals,
  notificationBody,
  policyProgressMessage,
  questionnaireReady,
  requestCommandDetails,
  requestAgentLabel,
  requestOwnerLabel,
  requestPolicySummary,
  requestProjectID,
  requestProjectLabel,
  requestRequesterLabel,
  requestResponsibilityLabel,
  requestStatusLabel,
  requestTargetTeamLabel,
  requestVoteHistory,
  supportsNotificationActions,
  updateQuestionnaireAnswers,
  shouldScheduleLocalNotifications,
  type ApprovalRequest,
  type Choice,
} from "./approvalRequests";
import { ConnectionBadge, SettingsScreen } from "./SettingsScreen";
import type { ConnectionStatus, NotificationStatus, PushStatus } from "./SettingsScreen";
import { AgentTickClient, type AgentStatusUpdate, type MeResponse, type OrganizationMembership } from "@agent-tick/sdk";
import { decryptApprovalPayload } from "@agent-tick/shared";
import { ClerkSignInScreen } from "./ClerkSignInScreen";
import {
  fetchRuntimeAuthConfig,
  mobileAccountsStorageKey,
  mobileAccountSessionTokenKey,
  mobileSessionStorageKeyList,
  mobileSessionStorageKeys,
  hostedServerURL,
  normalizeSavedMobileAccounts,
  normalizeServerURL,
  savedMobileAccountID,
  selfHostedServerURLPreset,
  serverURLStorageKey,
  upsertSavedMobileAccount,
  type RuntimeAuthConfig,
  type SavedMobileAccount,
} from "./mobileAuth";
import { mobileEventStreamsAvailable, subscribeToMobileEventStream, type MobileEventStreamSubscription } from "./mobileEvents";
import {
  diagnosticEvents,
  diagnosticsEnabled as readDiagnosticsEnabled,
  flushDiagnostics,
  initializeDiagnostics,
  recordDiagnostic,
  sendDiagnosticSnapshot,
  setDiagnosticContext,
  setDiagnosticsEnabled as saveDiagnosticsEnabled,
} from "./diagnostics";

type AvailabilityState = "available" | "busy" | "do-not-disturb" | "off-call";
type AccountPendingState =
  | { status: "checking"; count: 0 }
  | { status: "ready"; count: number }
  | { status: "needs-sign-in"; count: 0 }
  | { status: "error"; count: 0 };

const defaultServer = hostedServerURL;
const approvalCategoryID = "approval-request";
const approvalChannelID = "approval-requests";
const agentTickMobileSessionJwtKey = "__agent_tick_mobile_session_jwt";
const mobileInstallationIDStorageKey = "agent-tick.mobileInstallationID";

function dismissedAgentStatusStorageKey(serverURL: string, organizationID: string): string {
  const orgScope = organizationID.trim() || "default";
  return `agent-tick.dismissedStatusID.${encodeURIComponent(normalizeServerURL(serverURL))}.${encodeURIComponent(orgScope)}`;
}

type NativeClerkModule = TurboModule & {
  getClientToken?: () => Promise<string | null>;
  getSession?: () => Promise<unknown>;
  signOut?: () => Promise<void>;
};

function getNativeClerkModule(): NativeClerkModule | null {
  try {
    return TurboModuleRegistry.get<NativeClerkModule>("ClerkExpo");
  } catch {
    return null;
  }
}

async function getNativeClerkClientToken(): Promise<string | null> {
  return (await getNativeClerkModule()?.getClientToken?.().catch(() => null)) ?? null;
}

type ClerkTokenProvider = () => Promise<string | null>;

type AgentTickAppProps = {
  initialServerURL?: string;
  initialAuthConfig?: RuntimeAuthConfig | null;
  clerkTokenProvider?: ClerkTokenProvider;
  clerkSessionToken?: string | null;
  clerkSignedIn?: boolean;
  clerkDebugState?: Record<string, unknown>;
  onRuntimeAuthConfig?: (serverURL: string, config: RuntimeAuthConfig | null) => void;
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function App() {
  const [bootstrap, setBootstrap] = useState<{
    serverURL: string;
    authConfig: RuntimeAuthConfig | null;
    loaded: boolean;
  }>({ serverURL: defaultServer, authConfig: null, loaded: false });

  useEffect(() => {
    let cancelled = false;
    const loadBootstrap = async () => {
      const savedServerURL = normalizeServerURL((await AsyncStorage.getItem(serverURLStorageKey)) ?? defaultServer);
      const savedAuthConfig = await fetchRuntimeAuthConfigIfAvailable(savedServerURL);
      const shouldKeepSavedServer =
        savedServerURL === defaultServer ||
        (savedAuthConfig?.authProvider !== "clerk" && (await hasSavedLocalSession(savedServerURL)));
      const serverURL = shouldKeepSavedServer ? savedServerURL : defaultServer;
      const authConfig = serverURL === savedServerURL
        ? savedAuthConfig
        : await fetchRuntimeAuthConfigIfAvailable(serverURL);
      if (!cancelled) setBootstrap({ serverURL, authConfig, loaded: true });
    };
    void loadBootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRuntimeAuthConfig = useCallback((serverURL: string, authConfig: RuntimeAuthConfig | null) => {
    const normalizedServerURL = normalizeServerURL(serverURL);
    void AsyncStorage.setItem(serverURLStorageKey, normalizedServerURL);
    setBootstrap({ serverURL: normalizedServerURL, authConfig, loaded: true });
  }, []);

  if (!bootstrap.loaded) {
    return <LoadingScreen />;
  }

  if (bootstrap.authConfig?.authProvider === "clerk" && bootstrap.authConfig.clerkPublishableKey) {
    return (
      <ClerkProvider publishableKey={bootstrap.authConfig.clerkPublishableKey}>
        <ClerkBoundApp
          initialServerURL={bootstrap.serverURL}
          initialAuthConfig={bootstrap.authConfig}
          onRuntimeAuthConfig={handleRuntimeAuthConfig}
        />
      </ClerkProvider>
    );
  }

  if (normalizeServerURL(bootstrap.serverURL) === defaultServer) {
    return (
      <HostedFirstOnboardingScreen
        error={bootstrap.authConfig ? "agenttick.sh did not advertise Clerk sign-in." : "Could not reach agenttick.sh."}
        onServerSelected={handleRuntimeAuthConfig}
      />
    );
  }

  return (
    <AgentTickApp
      initialServerURL={bootstrap.serverURL}
      initialAuthConfig={bootstrap.authConfig}
      onRuntimeAuthConfig={handleRuntimeAuthConfig}
    />
  );
}

function ClerkBoundApp(props: AgentTickAppProps) {
  const { getToken, isLoaded, isSignedIn, signOut } = useAuth();
  const nativeSession = useNativeSession();
  const nativeAuthEvents = useNativeAuthEvents();
  const [clerkLoginToken, setClerkLoginToken] = useState<string | null>(null);
  const [mobileSessionToken, setMobileSessionToken] = useState<string | null>(null);
  const [signedOutManually, setSignedOutManually] = useState(false);
  const [signOutInProgress, setSignOutInProgress] = useState(false);
  const [addingClerkAccount, setAddingClerkAccount] = useState(false);
  const [addAccountSawSignedOut, setAddAccountSawSignedOut] = useState(false);
  const [openSignInAfterSignOut, setOpenSignInAfterSignOut] = useState(false);
  const [usingSavedMobileAccount, setUsingSavedMobileAccount] = useState(false);
  const [activeMobileAccountID, setActiveMobileAccountID] = useState<string | null>(null);
  const refreshedMobileSessionFromClerk = useRef(false);
  const wasNativeSignedIn = useRef(false);

  const nativeSignedIn = nativeSession.isSignedIn || nativeAuthEvents.nativeAuthState?.type === "signedIn";
  const hasClerkLogin = !signedOutManually && Boolean(isSignedIn || nativeSignedIn || clerkLoginToken || mobileSessionToken);

  useEffect(() => {
    setDiagnosticContext({
      appLayer: "clerk-bound",
      isClerkLoaded: isLoaded,
      isClerkSignedIn: isSignedIn,
      isNativeClerkSignedIn: nativeSignedIn,
      signedOutManually,
      signOutInProgress,
      addingClerkAccount,
      addAccountSawSignedOut,
      openSignInAfterSignOut,
      usingSavedMobileAccount,
      activeMobileAccountID: activeMobileAccountID || undefined,
      hasClerkLoginToken: Boolean(clerkLoginToken),
      hasMobileSessionToken: Boolean(mobileSessionToken),
      hasClerkLogin,
    });
    recordDiagnostic("info", "auth_state", "clerk_bound_render");
  }, [activeMobileAccountID, addAccountSawSignedOut, addingClerkAccount, clerkLoginToken, hasClerkLogin, isLoaded, isSignedIn, mobileSessionToken, nativeSignedIn, openSignInAfterSignOut, signOutInProgress, signedOutManually, usingSavedMobileAccount]);

  useEffect(() => {
    if (signedOutManually && !wasNativeSignedIn.current && (isSignedIn || nativeSignedIn)) setSignedOutManually(false);
    wasNativeSignedIn.current = Boolean(isSignedIn || nativeSignedIn);
  }, [isSignedIn, nativeSignedIn, signedOutManually]);

  useEffect(() => {
    if (mobileSessionToken || !readDiagnosticsEnabled()) return;
    let cancelled = false;
    const flushWithSavedAccount = async () => {
      if (diagnosticEvents().length === 0) return;
      const savedAccountJSON = await AsyncStorage.getItem(mobileAccountsStorageKey);
      let parsedAccounts: unknown = [];
      try {
        parsedAccounts = savedAccountJSON ? JSON.parse(savedAccountJSON) : [];
      } catch {
        parsedAccounts = [];
      }
      const accounts = normalizeSavedMobileAccounts(parsedAccounts);
      for (const account of accounts) {
        if (account.authProvider !== "clerk") continue;
        const savedToken = await getStoredMobileSessionToken(mobileAccountSessionTokenKey(account.id));
        if (!savedToken || cancelled) continue;
        const client = new AgentTickClient({ baseUrl: props.initialServerURL ?? defaultServer, tokenProvider: () => savedToken });
        try {
          await flushDiagnostics(client, diagnosticsSnapshot({
            serverURL: props.initialServerURL ?? defaultServer,
            authMode: "clerk",
            connectionStatus: "checking",
            pushStatus: "idle",
            notificationStatus: "checking",
            currentScreen: "settings",
          }));
          return;
        } catch {
          // Try the next saved account token.
        }
      }
    };
    void flushWithSavedAccount();
    return () => {
      cancelled = true;
    };
  }, [addAccountSawSignedOut, addingClerkAccount, isLoaded, isSignedIn, mobileSessionToken, nativeSignedIn, props.initialServerURL, signOutInProgress]);

  useEffect(() => {
    if (!isLoaded || addingClerkAccount || isSignedIn || mobileSessionToken || signedOutManually) return;
    let cancelled = false;
    const restoreMobileSession = async () => {
      const savedSession = await getStoredMobileSessionToken(agentTickMobileSessionJwtKey);
      if (cancelled || !savedSession) return;
      setUsingSavedMobileAccount(false);
      setActiveMobileAccountID(null);
      setMobileSessionToken(savedSession);
    };
    void restoreMobileSession();
    return () => {
      cancelled = true;
    };
  }, [addingClerkAccount, isLoaded, isSignedIn, mobileSessionToken, signedOutManually]);

  useEffect(() => {
    if (!isLoaded || isSignedIn || nativeSignedIn || signedOutManually || mobileSessionToken || clerkLoginToken) return;
    const interval = setInterval(() => {
      void nativeSession.refresh();
    }, 1000);
    return () => clearInterval(interval);
  }, [clerkLoginToken, isLoaded, isSignedIn, mobileSessionToken, nativeSession, nativeSignedIn, signedOutManually]);

  useEffect(() => {
    if (!addingClerkAccount || isSignedIn || nativeSignedIn) return;
    setAddAccountSawSignedOut(true);
    setSignOutInProgress(false);
  }, [addingClerkAccount, isSignedIn, nativeSignedIn]);

  useEffect(() => {
    if (!isLoaded || signedOutManually || clerkLoginToken || (usingSavedMobileAccount && mobileSessionToken)) return;
    if (addingClerkAccount && !addAccountSawSignedOut) return;
    let cancelled = false;
    const resolveClerkLoginToken = async () => {
      const sessionToken = await getToken();
      if (cancelled || sessionToken) {
        if (sessionToken) {
          recordDiagnostic("info", "auth", "clerk_login_token_from_use_auth", { addingClerkAccount });
          setClerkLoginToken(sessionToken);
        }
        return;
      }
      if (!nativeSignedIn) {
        if (addingClerkAccount) recordDiagnostic("info", "auth", "wait_for_native_clerk_sign_in_while_adding_account");
        return;
      }
      if (addingClerkAccount && !addAccountSawSignedOut) {
        recordDiagnostic("info", "auth", "skip_stale_native_clerk_token_while_adding_account");
        return;
      }
      const nativeClientToken = await getNativeClerkClientToken();
      if (!cancelled && nativeClientToken) {
        recordDiagnostic("info", "auth", "clerk_login_token_from_native_client", { addingClerkAccount });
        setClerkLoginToken(nativeClientToken);
      }
    };
    void resolveClerkLoginToken();
    return () => {
      cancelled = true;
    };
  }, [addAccountSawSignedOut, addingClerkAccount, clerkLoginToken, getToken, isLoaded, mobileSessionToken, nativeSignedIn, signedOutManually, usingSavedMobileAccount]);

  useEffect(() => {
    if (signedOutManually || !clerkLoginToken) return;
    if (usingSavedMobileAccount && mobileSessionToken) return;
    if (mobileSessionToken && refreshedMobileSessionFromClerk.current) return;
    let cancelled = false;
    const createAgentTickSession = async () => {
      const client = new AgentTickClient({ baseUrl: props.initialServerURL ?? defaultServer });
      recordDiagnostic("info", "auth", "create_mobile_session_start", { addingClerkAccount });
      const session = await client.createMobileSession({ clerkToken: clerkLoginToken });
      if (cancelled) return;
      recordDiagnostic("info", "auth", "create_mobile_session_success", { userID: session.userId, organizationID: session.organizationId, role: session.role, addingClerkAccount });
      refreshedMobileSessionFromClerk.current = true;
      setUsingSavedMobileAccount(false);
      setAddingClerkAccount(false);
      setAddAccountSawSignedOut(false);
      setClerkLoginToken(null);
      setMobileSessionToken(session.token);
      const accountID = savedMobileAccountID({
        serverURL: props.initialServerURL ?? defaultServer,
        authProvider: "clerk",
        userID: session.userId,
      });
      setActiveMobileAccountID(accountID);
      const accountTokenKey = mobileAccountSessionTokenKey(accountID);
      void saveStoredMobileSessionToken(accountTokenKey, session.token);
      void saveStoredMobileSessionToken(agentTickMobileSessionJwtKey, session.token);
      void getNativeClerkModule()?.signOut?.().catch(() => undefined);
      void signOut().catch(() => undefined);
    };
    void createAgentTickSession().catch((error) => {
      recordDiagnostic("error", "auth", "create_mobile_session_failed", { message: error instanceof Error ? error.message : String(error), addingClerkAccount });
      refreshedMobileSessionFromClerk.current = true;
      if (!mobileSessionToken) setClerkLoginToken(null);
    });
    return () => {
      cancelled = true;
    };
  }, [clerkLoginToken, mobileSessionToken, props.initialServerURL, signOut, signedOutManually, usingSavedMobileAccount]);

  const handleAddClerkAccount = useCallback(async () => {
    recordDiagnostic("info", "button", "add_clerk_account_start");
    setSignOutInProgress(true);
    setAddingClerkAccount(true);
    setAddAccountSawSignedOut(false);
    setOpenSignInAfterSignOut(true);
    refreshedMobileSessionFromClerk.current = false;
    setUsingSavedMobileAccount(false);
    setActiveMobileAccountID(null);
    setClerkLoginToken(null);
    setMobileSessionToken(null);
    await clearStoredMobileSessionToken(agentTickMobileSessionJwtKey);
    try {
      await getNativeClerkModule()?.signOut?.();
      await signOut();
    } finally {
      recordDiagnostic("info", "auth", "add_clerk_account_signed_out");
      setSignedOutManually(false);
      setAddAccountSawSignedOut(true);
      setSignOutInProgress(false);
    }
  }, [signOut]);

  const handleForgetClerkSession = useCallback(async (options?: { reopenSignIn?: boolean }) => {
    const reopenSignIn = Boolean(options?.reopenSignIn);
    recordDiagnostic("info", "button", "forget_clerk_session", { reopenSignIn });
    setSignOutInProgress(true);
    setAddingClerkAccount(false);
    setAddAccountSawSignedOut(false);
    setOpenSignInAfterSignOut(false);
    refreshedMobileSessionFromClerk.current = false;
    setUsingSavedMobileAccount(false);
    setActiveMobileAccountID(null);
    setClerkLoginToken(null);
    setMobileSessionToken(null);
    await clearStoredMobileSessionToken(agentTickMobileSessionJwtKey);
    try {
      await getNativeClerkModule()?.signOut?.();
      await signOut();
    } finally {
      setSignedOutManually(true);
      setOpenSignInAfterSignOut(reopenSignIn);
      setSignOutInProgress(false);
    }
  }, [signOut]);

  if (!isLoaded || signOutInProgress) {
    return <LoadingScreen />;
  }
  if (addingClerkAccount && !addAccountSawSignedOut) {
    return <LoadingScreen />;
  }
  if (addingClerkAccount) {
    return (
      <ClerkSignInScreen
        serverURL={defaultServer}
        selfHostedInitialURL={selfHostedInitialURL(props.initialServerURL)}
        initialShowAuthView={openSignInAfterSignOut}
        onServerSelected={props.onRuntimeAuthConfig}
      />
    );
  }
  if (!hasClerkLogin) {
    return (
      <ClerkSignInScreen
        serverURL={defaultServer}
        selfHostedInitialURL={selfHostedInitialURL(props.initialServerURL)}
        initialShowAuthView={openSignInAfterSignOut}
        onServerSelected={props.onRuntimeAuthConfig}
      />
    );
  }
  if (!mobileSessionToken) {
    return <LoadingScreen />;
  }
  return (
    <AgentTickApp
      key={activeMobileAccountID ?? `session:${mobileSessionToken.slice(-16)}`}
      {...props}
      clerkSignedIn={true}
      clerkSessionToken={mobileSessionToken}
      clerkTokenProvider={async () => mobileSessionToken}
      clerkDebugState={{
        activeMobileAccountID: activeMobileAccountID || undefined,
        usingSavedMobileAccount,
        addingClerkAccount,
        addAccountSawSignedOut,
        signedOutManually,
        signOutInProgress,
        isClerkLoaded: isLoaded,
        isClerkSignedIn: isSignedIn,
        isNativeClerkSignedIn: nativeSignedIn,
        hasMobileSessionToken: Boolean(mobileSessionToken),
        hasClerkLoginToken: Boolean(clerkLoginToken),
      }}
      onAddClerkAccount={() => void handleAddClerkAccount()}
      onForgetClerkSession={(options) => void handleForgetClerkSession(options)}
      onSelectSavedClerkAccount={async (account) => {
        recordDiagnostic("info", "auth", "saved_account_token_lookup_start", { targetSignInMethod: account.signInMethod, hasTargetEmail: Boolean(account.email), hasTargetUser: Boolean(account.userID) });
        const savedToken = await getStoredMobileSessionToken(mobileAccountSessionTokenKey(account.id));
        if (!savedToken) {
          recordDiagnostic("warn", "auth", "saved_account_token_missing", { targetSignInMethod: account.signInMethod, hasTargetEmail: Boolean(account.email), hasTargetUser: Boolean(account.userID) });
          return "missing";
        }
        const tokenSubject = mobileSessionTokenSubject(savedToken);
        const tokenMatchesAccount = !account.userID || tokenSubject === account.userID;
        recordDiagnostic("info", "auth", "saved_account_token_loaded", { targetSignInMethod: account.signInMethod, hasTargetEmail: Boolean(account.email), hasTargetUser: Boolean(account.userID), tokenMatchesAccount, tokenSubjectMatchesTarget: tokenSubject === account.userID });
        if (!tokenMatchesAccount) {
          await clearStoredMobileSessionToken(mobileAccountSessionTokenKey(account.id));
          recordDiagnostic("warn", "auth", "saved_account_token_mismatch", { targetSignInMethod: account.signInMethod, hasTargetEmail: Boolean(account.email), hasTargetUser: Boolean(account.userID) });
          return "missing";
        }
        refreshedMobileSessionFromClerk.current = true;
        setUsingSavedMobileAccount(true);
        setActiveMobileAccountID(account.id);
        setSignedOutManually(false);
        setOpenSignInAfterSignOut(false);
        setClerkLoginToken(null);
        setMobileSessionToken(savedToken);
        await saveStoredMobileSessionToken(agentTickMobileSessionJwtKey, savedToken);
        recordDiagnostic("info", "auth", "saved_account_session_activated", { targetSignInMethod: account.signInMethod, hasTargetEmail: Boolean(account.email), hasTargetUser: Boolean(account.userID) });
        return "selected";
      }}
    />
  );
}

function LoadingScreen() {
  return (
    <View style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.emptyState}>
        <ActivityIndicator />
        <Text style={styles.subtitle}>Loading Agent Tick…</Text>
      </View>
    </View>
  );
}

async function fetchRuntimeAuthConfigIfAvailable(serverURL: string) {
  try {
    return await fetchRuntimeAuthConfig(serverURL);
  } catch {
    return null;
  }
}

async function hasSavedLocalSession(serverURL: string) {
  const keys = mobileSessionStorageKeys(serverURL);
  const entries = await AsyncStorage.multiGet([keys.token, keys.deviceID]);
  return entries.some(([, value]) => Boolean(value));
}

async function getStoredMobileSessionToken(key: string): Promise<string | null> {
  const token = await AsyncStorage.getItem(key);
  return token || null;
}

async function saveStoredMobileSessionToken(key: string, token: string): Promise<void> {
  await AsyncStorage.setItem(key, token);
}

async function clearStoredMobileSessionToken(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}

function mobileSessionTokenSubject(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  const atobFn = (globalThis as { atob?: (value: string) => string }).atob;
  if (!atobFn) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const parsed = JSON.parse(atobFn(padded)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const subject = (parsed as { sub?: unknown }).sub;
    return typeof subject === "string" && subject ? subject : null;
  } catch {
    return null;
  }
}

function selfHostedInitialURL(serverURL?: string) {
  const normalized = normalizeServerURL(serverURL ?? "");
  if (normalized !== defaultServer) return normalized;
  return selfHostedServerURLPreset;
}

function HostedFirstOnboardingScreen({
  error,
  onServerSelected,
}: {
  error: string;
  onServerSelected: (serverURL: string, authConfig: RuntimeAuthConfig | null) => void;
}) {
  const [customServerURL, setCustomServerURL] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const retryHosted = async () => {
    setSubmitting(true);
    setCustomError(null);
    const config = await fetchRuntimeAuthConfigIfAvailable(defaultServer);
    if (config) {
      onServerSelected(defaultServer, config);
    } else {
      setCustomError("Could not reach agenttick.sh");
    }
    setSubmitting(false);
  };

  const useSelfHostedServer = async () => {
    const nextServerURL = normalizeServerURL(customServerURL);
    setSubmitting(true);
    setCustomError(null);
    onServerSelected(nextServerURL, await fetchRuntimeAuthConfigIfAvailable(nextServerURL));
    setSubmitting(false);
  };

  return (
    <View style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.hostedOnboarding}>
        <Text style={styles.brand}>Agent Tick</Text>
        <Text style={styles.detailTitle}>Sign in to Agent Tick</Text>
        <Text style={styles.bodyText}>
          The mobile app signs in to agenttick.sh by default. Use a custom server only when you self-host Agent Tick.
        </Text>
        <Text style={styles.errorText}>{error}</Text>
        {customError ? <Text style={styles.errorText}>{customError}</Text> : null}
        <Pressable disabled={submitting} onPress={() => void retryHosted()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{submitting ? "Checking…" : "Retry sign-in"}</Text>
        </Pressable>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Self-hosted server URL</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="url"
            onChangeText={setCustomServerURL}
            placeholder="https://tick.example.com"
            style={styles.input}
            value={customServerURL}
          />
          <Pressable disabled={submitting} onPress={() => void useSelfHostedServer()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Use Self-hosted Server</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function AgentTickApp({
  initialServerURL,
  initialAuthConfig,
  clerkSessionToken,
  clerkTokenProvider,
  clerkDebugState,
  onRuntimeAuthConfig,
  onAddClerkAccount,
  onForgetClerkSession,
  onSelectSavedClerkAccount,
}: AgentTickAppProps & {
  onAddClerkAccount?: () => void;
  onForgetClerkSession?: (options?: { reopenSignIn?: boolean }) => void;
  onSelectSavedClerkAccount?: (account: SavedMobileAccount) => Promise<"selected" | "reauth_started" | "missing">;
}) {
  const [screen, setScreen] = useState<Screen>("approvals");
  const [menuOpen, setMenuOpen] = useState(false);
  const [serverURL, setServerURL] = useState(initialServerURL ?? defaultServer);
  const [runtimeAuthConfig, setRuntimeAuthConfig] = useState<RuntimeAuthConfig | null>(initialAuthConfig ?? null);
  const [token, setToken] = useState("");
  const [deviceID, setDeviceID] = useState("");
  const [e2eeKey, setE2eeKey] = useState("");
  const [e2eeFocusToken, setE2eeFocusToken] = useState(0);
  const [pairingCode, setPairingCode] = useState("");
  const [organizations, setOrganizations] = useState<OrganizationMembership[]>([]);
  const [currentAccountProfile, setCurrentAccountProfile] = useState<MeResponse | null>(null);
  const [selectedOrganizationID, setSelectedOrganizationID] = useState("");
  const [savedAccounts, setSavedAccounts] = useState<SavedMobileAccount[]>([]);
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [statusUpdates, setStatusUpdates] = useState<AgentStatusUpdate[]>([]);
  const [dismissedStatusID, setDismissedStatusID] = useState<string | null>(null);
  const [dismissedStatusScope, setDismissedStatusScope] = useState("");
  const [history, setHistory] = useState<ApprovalRequest[]>([]);
  const [accountPending, setAccountPending] = useState<Record<string, AccountPendingState>>({});
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [selectedProjectID, setSelectedProjectID] = useState<string | null>(null);
  const [notificationTargetID, setNotificationTargetID] = useState<string | null>(
    null,
  );
  const [reply, setReply] = useState("");
  const [questionnaireAnswers, setQuestionnaireAnswers] = useState<
    Record<string, string[]>
  >({});
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [loadedSessionServerURL, setLoadedSessionServerURL] = useState("");
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("checking");
  const [notificationStatus, setNotificationStatus] =
    useState<NotificationStatus>("checking");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [pushStatus, setPushStatus] = useState<PushStatus>("idle");
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false);
  const [diagnosticsEventCount, setDiagnosticsEventCount] = useState(0);
  const [diagnosticsLastSentAt, setDiagnosticsLastSentAt] = useState("");
  const [realtimeUnavailable, setRealtimeUnavailable] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityState>("available");
  const [error, setError] = useState<string | null>(null);
  const [scannerLocked, setScannerLocked] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const seenRequestIDs = useRef<Set<string>>(new Set());
  const didPrimeNotifications = useRef(false);
  const pairingInFlight = useRef(false);
  const previousScreenRef = useRef<Screen>(screen);
  const lastClerkPushRegistrationKey = useRef("");

  const dismissedStatusScopeKey = `${normalizeServerURL(serverURL)}:${selectedOrganizationID || "default"}`;
  const visibleDismissedStatusID = dismissedStatusScope === dismissedStatusScopeKey ? dismissedStatusID : statusUpdates[0]?.statusId ?? null;
  const projectGroups = useMemo(() => groupRequestsByProject(requests), [requests]);
  const visibleRequests = useMemo(
    () => filterRequestsByProject(requests, selectedProjectID),
    [requests, selectedProjectID],
  );
  const selectedOrganization = organizations.find((organization) => organization.organizationId === selectedOrganizationID);
  const currentAccountContext = useMemo(() => ({
    authProvider: runtimeAuthConfig?.authProvider,
    currentAccountProfile,
    deviceID,
    selectedOrganizationID,
    serverURL,
  }), [currentAccountProfile, deviceID, runtimeAuthConfig?.authProvider, selectedOrganizationID, serverURL]);
  const otherAccounts = useMemo(
    () => savedAccounts.filter((account) => !isCurrentSavedAccount(account, currentAccountContext)),
    [currentAccountContext, savedAccounts],
  );
  const otherAccountPendingTotal = useMemo(
    () => otherAccounts.reduce((total, account) => {
      const pending = accountPending[account.id];
      return total + (pending?.status === "ready" ? pending.count : 0);
    }, 0),
    [accountPending, otherAccounts],
  );
  const selected = useMemo(
    () => visibleRequests.find((request) => request.id === selectedID) ?? visibleRequests[0],
    [selectedID, visibleRequests],
  );

  useEffect(() => {
    setReply("");
    if (!selected || !isQuestionnaireRequest(selected)) {
      setQuestionnaireAnswers({});
      return;
    }
    setQuestionnaireAnswers(buildQuestionnaireAnswers(selected));
  }, [selected?.id]);

  const currentAuthToken = useCallback(async () => {
    if (runtimeAuthConfig?.authProvider === "clerk") {
      return (await clerkTokenProvider?.()) ?? "";
    }
    return token;
  }, [clerkTokenProvider, runtimeAuthConfig?.authProvider, token]);

  const sdk = useMemo(
    () =>
      new AgentTickClient({
        baseUrl: serverURL,
        tokenProvider: async () => (await currentAuthToken()) || null,
        organizationIdProvider: () => selectedOrganizationID || null,
      }),
    [currentAuthToken, selectedOrganizationID, serverURL],
  );
  const hasRequestAuth = runtimeAuthConfig?.authProvider === "clerk" ? Boolean(selectedOrganizationID) : Boolean(token);

  useEffect(() => {
    setRealtimeUnavailable(false);
  }, [selectedOrganizationID, serverURL]);

  useEffect(() => {
    setDiagnosticContext({
      authProvider: runtimeAuthConfig?.authProvider,
      currentScreen: screen,
      connectionStatus,
      pushStatus,
      notificationStatus,
      notificationsEnabled,
      settingsLoaded,
      hasRequestAuth,
      hasToken: Boolean(token),
      hasDeviceID: Boolean(deviceID),
      deviceID: deviceID || undefined,
      selectedOrganizationID: selectedOrganizationID || undefined,
      currentUserID: currentAccountProfile?.userId,
      currentUserEmail: currentAccountProfile?.email,
      currentSignInMethod: currentAccountProfile?.signInMethod,
      currentAccountSource: currentAccountProfile?.source,
      savedAccountCount: savedAccounts.length,
      savedAccountIDs: savedAccounts.map((account) => account.id),
      ...(clerkDebugState ?? {}),
      organizationCount: organizations.length,
      requestCount: requests.length,
      pendingRequestCount: requests.filter((request) => request.status === "pending").length,
      selectedRequestID: selectedID || undefined,
      selectedProjectID: selectedProjectID || undefined,
      errorMessage: error ?? undefined,
    });
  }, [clerkDebugState, connectionStatus, currentAccountProfile?.email, currentAccountProfile?.signInMethod, currentAccountProfile?.source, currentAccountProfile?.userId, deviceID, error, hasRequestAuth, notificationStatus, notificationsEnabled, organizations.length, pushStatus, requests, runtimeAuthConfig?.authProvider, savedAccounts, screen, selectedID, selectedOrganizationID, selectedProjectID, settingsLoaded, token]);

  useEffect(() => {
    const previousScreen = previousScreenRef.current;
    if (previousScreen === screen) return;
    previousScreenRef.current = screen;
    recordDiagnostic("info", "navigation", "screen_changed", {
      from: previousScreen,
      to: screen,
      pendingRequestCount: requests.length,
      hasSelectedRequest: Boolean(selectedID),
      hasSelectedProject: Boolean(selectedProjectID),
      hasSelectedOrganization: Boolean(selectedOrganizationID),
      connectionStatus,
    });
    setDiagnosticsEventCount(diagnosticEvents().length);
  }, [connectionStatus, requests.length, screen, selectedID, selectedOrganizationID, selectedProjectID]);

  useEffect(() => {
    let cancelled = false;

    const restoreSettings = async () => {
      try {
        const savedServerURL = (await AsyncStorage.getItem(serverURLStorageKey)) ?? defaultServer;
        const savedAccountJSON = await AsyncStorage.getItem(mobileAccountsStorageKey);
        const savedE2EEKey = await AsyncStorage.getItem("agent-tick.e2eeKey");
        let parsedAccounts: unknown = [];
        try {
          parsedAccounts = savedAccountJSON ? JSON.parse(savedAccountJSON) : [];
        } catch {
          parsedAccounts = [];
        }
        if (!cancelled) {
          setSavedAccounts(normalizeSavedMobileAccounts(parsedAccounts));
          setE2eeKey(savedE2EEKey ?? "");
          setServerURL(savedServerURL);
        }
      } finally {
        if (!cancelled) {
          setSettingsLoaded(true);
        }
      }
    };

    void restoreSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    let cancelled = false;
    const activeServerURL = normalizeServerURL(serverURL);
    const restoreSessionForServer = async () => {
      const scopedKeys = mobileSessionStorageKeys(activeServerURL);
      const entries = await AsyncStorage.multiGet([
        scopedKeys.token,
        scopedKeys.deviceID,
        scopedKeys.organizationID,
        scopedKeys.pushStatus,
        scopedKeys.notificationsEnabled,
      ]);
      if (cancelled || normalizeServerURL(serverURL) !== activeServerURL) {
        return;
      }
      const entryValue = (key: string) => entries.find(([entryKey]) => entryKey === key)?.[1];
      setToken(entryValue(scopedKeys.token) ?? "");
      setDeviceID(entryValue(scopedKeys.deviceID) ?? "");
      setSelectedOrganizationID(runtimeAuthConfig?.authProvider === "clerk" ? "" : entryValue(scopedKeys.organizationID) ?? "");
      const savedPushStatus = entryValue(scopedKeys.pushStatus);
      setPushStatus(isPushStatus(savedPushStatus) ? savedPushStatus : "idle");
      setNotificationsEnabled(entryValue(scopedKeys.notificationsEnabled) !== "false");
      setLoadedSessionServerURL(activeServerURL);
    };

    if (loadedSessionServerURL !== activeServerURL) {
      void restoreSessionForServer();
    }

    return () => {
      cancelled = true;
    };
  }, [loadedSessionServerURL, runtimeAuthConfig?.authProvider, serverURL, settingsLoaded]);

  useEffect(() => {
    void initializeDiagnostics().then((enabled) => {
      setDiagnosticsEnabled(enabled);
      setDiagnosticsEventCount(diagnosticEvents().length);
    });
    void refreshNotificationStatus(setNotificationStatus);
    if (Platform.OS === "android") {
      void Notifications.setNotificationChannelAsync(approvalChannelID, {
        name: "Approval requests",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        sound: "default",
      }).catch(() => undefined);
    }
    void Notifications.setNotificationCategoryAsync(approvalCategoryID, [
      {
        identifier: "approve",
        buttonTitle: "Approve",
        options: { opensAppToForeground: false },
      },
      {
        identifier: "deny",
        buttonTitle: "Deny",
        options: { opensAppToForeground: false, isDestructive: true },
      },
    ]).catch(() => undefined);
  }, []);

  const loadRef = useRef<((options?: { visible?: boolean }) => Promise<void>) | null>(null);
  const realtimeSubscriptionRef = useRef<MobileEventStreamSubscription | null>(null);
  const [realtimeRestartToken, setRealtimeRestartToken] = useState(0);
  const interruptRealtime = useCallback(() => {
    realtimeSubscriptionRef.current?.close();
    realtimeSubscriptionRef.current = null;
    setRealtimeRestartToken((value) => value + 1);
  }, []);

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const id = notificationRequestID(notification.request.content.data);
      if (id) {
        seenRequestIDs.current.add(id);
        recordDiagnostic("info", "notifications", "received", { requestId: id });
      }
      interruptRealtime();
      void loadRef.current?.({ visible: false });
    });

    return () => subscription.remove();
  }, [interruptRealtime]);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    let cancelled = false;
    const loadRuntimeAuthConfig = async () => {
      try {
        const nextConfig = await fetchRuntimeAuthConfig(serverURL);
        if (cancelled) return;
        setRuntimeAuthConfig(nextConfig);
        onRuntimeAuthConfig?.(serverURL, nextConfig);
        if (nextConfig.authProvider === "clerk") {
          setToken((currentToken) => {
            if (currentToken) setDeviceID("");
            return "";
          });
        } else {
          setOrganizations([]);
          setCurrentAccountProfile(null);
          setSelectedOrganizationID("");
        }
      } catch {
        if (!cancelled) {
          setRuntimeAuthConfig(null);
          onRuntimeAuthConfig?.(serverURL, null);
        }
      }
    };
    void loadRuntimeAuthConfig();
    return () => {
      cancelled = true;
    };
  }, [onRuntimeAuthConfig, serverURL, settingsLoaded]);

  useEffect(() => {
    const activeServerURL = normalizeServerURL(serverURL);
    if (!settingsLoaded || loadedSessionServerURL !== activeServerURL) {
      return;
    }

    const scopedKeys = mobileSessionStorageKeys(activeServerURL);
    void AsyncStorage.multiSet([
      [serverURLStorageKey, activeServerURL],
      [scopedKeys.token, token],
      [scopedKeys.deviceID, deviceID],
      [scopedKeys.organizationID, runtimeAuthConfig?.authProvider === "clerk" ? "" : selectedOrganizationID],
      [scopedKeys.pushStatus, pushStatus],
      [scopedKeys.notificationsEnabled, notificationsEnabled ? "true" : "false"],
    ]);
    const shouldSaveAccount = runtimeAuthConfig?.authProvider === "clerk" ? Boolean(currentAccountProfile?.userId && clerkSessionToken) : Boolean(token || deviceID);
    if (shouldSaveAccount) {
      setSavedAccounts((current) => {
        const next = upsertSavedMobileAccount(current, {
          serverURL: activeServerURL,
          authProvider: runtimeAuthConfig?.authProvider ?? "local",
          userID: currentAccountProfile?.userId,
          email: currentAccountProfile?.email,
          signInMethod: currentAccountProfile?.signInMethod,
          organizationID: runtimeAuthConfig?.authProvider === "clerk" ? undefined : selectedOrganizationID || undefined,
          deviceID: deviceID || undefined,
          label: runtimeAuthConfig?.authProvider === "clerk" && currentAccountProfile?.signInMethod ? `${currentAccountProfile.signInMethod} account` : "",
        });
        const savedAccount = next[0];
        if (savedAccount && runtimeAuthConfig?.authProvider === "clerk" && clerkSessionToken && currentAccountProfile?.source !== "mobile-saved-account") {
          void saveStoredMobileSessionToken(mobileAccountSessionTokenKey(savedAccount.id), clerkSessionToken);
        }
        void AsyncStorage.setItem(mobileAccountsStorageKey, JSON.stringify(next));
        return next;
      });
    }
  }, [clerkSessionToken, currentAccountProfile?.email, currentAccountProfile?.signInMethod, currentAccountProfile?.userId, deviceID, loadedSessionServerURL, notificationsEnabled, pushStatus, runtimeAuthConfig?.authProvider, selectedOrganizationID, serverURL, settingsLoaded, token]);

  useEffect(() => {
    if (runtimeAuthConfig?.authProvider !== "clerk" || !clerkSessionToken) return;
    setCurrentAccountProfile((current) => (current?.source === "mobile-saved-account" ? current : null));
    setSelectedOrganizationID("");
    setDeviceID("");
    setPushStatus("idle");
    lastClerkPushRegistrationKey.current = "";
    setRequests([]);
    setHistory([]);
    setSelectedID(null);
    setConnectionStatus("checking");
  }, [clerkSessionToken, runtimeAuthConfig?.authProvider]);

  useEffect(() => {
    if (!settingsLoaded) return;
    void AsyncStorage.setItem("agent-tick.e2eeKey", e2eeKey);
  }, [e2eeKey, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    let cancelled = false;
    const scope = dismissedStatusScopeKey;
    const restoreDismissedStatus = async () => {
      const stored = await AsyncStorage.getItem(dismissedAgentStatusStorageKey(serverURL, selectedOrganizationID));
      if (cancelled || dismissedStatusScopeKey !== scope) return;
      setDismissedStatusID(stored || null);
      setDismissedStatusScope(scope);
    };
    void restoreDismissedStatus();
    return () => {
      cancelled = true;
    };
  }, [dismissedStatusScopeKey, selectedOrganizationID, serverURL, settingsLoaded]);

  const dismissStatusUpdate = useCallback((statusID: string) => {
    const scope = dismissedStatusScopeKey;
    setDismissedStatusID(statusID);
    setDismissedStatusScope(scope);
    void AsyncStorage.setItem(dismissedAgentStatusStorageKey(serverURL, selectedOrganizationID), statusID);
  }, [dismissedStatusScopeKey, selectedOrganizationID, serverURL]);

  const removeSavedAccount = useCallback((account: SavedMobileAccount) => {
    setSavedAccounts((current) => {
      const next = current.filter((candidate) => candidate.id !== account.id);
      void AsyncStorage.setItem(mobileAccountsStorageKey, JSON.stringify(next));
      return next;
    });
    void clearStoredMobileSessionToken(mobileAccountSessionTokenKey(account.id));
    recordDiagnostic("info", "auth", "saved_account_removed", { authProvider: account.authProvider, signInMethod: account.signInMethod, hasEmail: Boolean(account.email) });
  }, []);

  const switchSavedAccount = useCallback((account: SavedMobileAccount) => {
    setAccountPending((current) => {
      const { [account.id]: _switchedAccount, ...remaining } = current;
      return remaining;
    });
    interruptRealtime();
    const switchAccount = async () => {
      if (account.authProvider === "clerk") {
        recordDiagnostic("info", "auth", "saved_account_switch_attempt", {
          targetAuthProvider: account.authProvider,
          targetSignInMethod: account.signInMethod,
          hasTargetEmail: Boolean(account.email),
          hasTargetUser: Boolean(account.userID),
        });
        const switchResult = await onSelectSavedClerkAccount?.(account);
        if (switchResult !== "selected") {
          const message = "That saved account does not have an active session on this device anymore. Remove it, or use Add another account to sign in again.";
          recordDiagnostic("warn", "auth", "saved_account_switch_missing_session", { targetSignInMethod: account.signInMethod, hasTargetEmail: Boolean(account.email) });
          setError(message);
          Alert.alert("Account switch failed", message);
          return;
        }
        recordDiagnostic("info", "auth", "saved_account_switch_selected", { targetSignInMethod: account.signInMethod, hasTargetEmail: Boolean(account.email) });
        setConnectionStatus("checking");
        setDeviceID("");
        setPushStatus("idle");
        lastClerkPushRegistrationKey.current = "";
        setSelectedOrganizationID("");
        setRequests([]);
        setHistory([]);
        setSelectedID(null);
        setCurrentAccountProfile(account.userID ? {
          userId: account.userID,
          ...(account.email ? { email: account.email } : {}),
          ...(account.signInMethod ? { signInMethod: account.signInMethod } : {}),
          authProvider: "clerk",
          source: "mobile-saved-account",
        } : null);
      } else {
        setConnectionStatus("checking");
        setCurrentAccountProfile(null);
      }
      setServerURL(account.serverURL);
      if (account.authProvider !== "clerk") setSelectedOrganizationID(account.organizationID ?? "");
      setLoadedSessionServerURL("");
      setScreen("approvals");
    };
    void switchAccount();
  }, [interruptRealtime, onSelectSavedClerkAccount]);

  const checkSavedAccountPending = useCallback(async (account: SavedMobileAccount): Promise<AccountPendingState> => {
    try {
      const token = account.authProvider === "clerk"
        ? await getStoredMobileSessionToken(mobileAccountSessionTokenKey(account.id))
        : await getStoredMobileSessionToken(mobileSessionStorageKeys(account.serverURL).token);
      if (!token) return { status: "needs-sign-in", count: 0 };

      if (account.authProvider === "clerk") {
        const accountClient = new AgentTickClient({
          baseUrl: account.serverURL,
          tokenProvider: () => token,
        });
        const memberships = await accountClient.listOrganizations();
        const counts = await Promise.all(memberships.map(async (membership) => {
          const organizationClient = new AgentTickClient({
            baseUrl: account.serverURL,
            tokenProvider: () => token,
            organizationIdProvider: () => membership.organizationId,
          });
          const approvals = await organizationClient.listApprovalRequests();
          return normalizeApprovals(approvals).filter((request) => request.status === "pending").length;
        }));
        return { status: "ready", count: counts.reduce((total, count) => total + count, 0) };
      }

      const scopedKeys = mobileSessionStorageKeys(account.serverURL);
      const organizationID = account.organizationID || (await AsyncStorage.getItem(scopedKeys.organizationID)) || "";
      const accountClient = new AgentTickClient({
        baseUrl: account.serverURL,
        tokenProvider: () => token,
        organizationIdProvider: () => organizationID || null,
      });
      const approvals = await accountClient.listApprovalRequests();
      return { status: "ready", count: normalizeApprovals(approvals).filter((request) => request.status === "pending").length };
    } catch {
      return { status: "error", count: 0 };
    }
  }, []);

  const refreshOtherAccountPending = useCallback(async () => {
    const accountsToCheck = savedAccounts.filter((account) => !isCurrentSavedAccount(account, currentAccountContext));
    if (accountsToCheck.length === 0) {
      setAccountPending({});
      return;
    }
    setAccountPending((current) => {
      const next: Record<string, AccountPendingState> = {};
      for (const account of accountsToCheck) {
        next[account.id] = current[account.id] ?? { status: "checking", count: 0 };
      }
      return next;
    });
    await Promise.all(accountsToCheck.map(async (account) => {
      const state = await checkSavedAccountPending(account);
      setAccountPending((current) => ({ ...current, [account.id]: state }));
    }));
  }, [checkSavedAccountPending, currentAccountContext, savedAccounts]);

  useEffect(() => {
    if (!menuOpen) return;
    void refreshOtherAccountPending();
  }, [menuOpen, refreshOtherAccountPending]);

  useEffect(() => {
    if (!settingsLoaded || savedAccounts.length < 2) return;
    void refreshOtherAccountPending();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refreshOtherAccountPending();
    }, 120000);
    return () => clearInterval(timer);
  }, [refreshOtherAccountPending, savedAccounts.length, settingsLoaded]);

  const refreshOrganizations = useCallback(async () => {
    if (runtimeAuthConfig?.authProvider !== "clerk") {
      setCurrentAccountProfile(null);
      setOrganizations([]);
      return;
    }
    try {
      const organizationClient = new AgentTickClient({
        baseUrl: serverURL,
        tokenProvider: async () => (await currentAuthToken()) || null,
      });
      const [me, memberships] = await Promise.all([
        organizationClient.getMe(),
        organizationClient.listOrganizations(),
      ]);
      setCurrentAccountProfile(me);
      setOrganizations(memberships);
      setSelectedOrganizationID((current) => {
        if (current && memberships.some((membership) => membership.organizationId === current)) {
          return current;
        }
        return memberships[0]?.organizationId ?? "";
      });
    } catch {
      setCurrentAccountProfile(null);
      setOrganizations([]);
    }
  }, [clerkSessionToken, currentAuthToken, runtimeAuthConfig?.authProvider, serverURL]);

  useEffect(() => {
    if (!settingsLoaded || runtimeAuthConfig?.authProvider !== "clerk") {
      return;
    }
    void refreshOrganizations();
  }, [clerkSessionToken, refreshOrganizations, runtimeAuthConfig?.authProvider, settingsLoaded]);

  const load = useCallback(async (options?: { visible?: boolean }) => {
    if (runtimeAuthConfig?.authProvider === "clerk" && !selectedOrganizationID) {
      setConnectionStatus("checking");
      return;
    }
    const visible = options?.visible ?? false;
    if (visible) {
      setLoading(true);
    }
    setError(null);
    try {
      const [pending, latestStatuses] = await Promise.all([
        sdk.listApprovalRequests(),
        sdk.listStatusUpdates({ limit: 5 }).catch(() => [] as AgentStatusUpdate[]),
      ]);
      const pendingRequests = normalizeApprovals(pending).filter((request) => request.status === "pending");
      recordDiagnostic("info", "requests", "loaded", {
        pendingRequestCount: pendingRequests.length,
        encryptedRequestCount: pendingRequests.filter(isEncryptedApprovalRequest).length,
        encryptedPayloadCount: pendingRequests.filter((request) => Boolean(request.encryptedPayload)).length,
        selectedRequestIsEncrypted: pendingRequests.some((request) => request.id === selectedID && isEncryptedApprovalRequest(request)),
      });
      setDiagnosticsEventCount(diagnosticEvents().length);
      setStatusUpdates(latestStatuses);
      await notifyForNewRequests(
        pendingRequests,
        seenRequestIDs,
        didPrimeNotifications,
        shouldScheduleLocalNotifications(pushStatus, notificationsEnabled),
      );
      setRequests(pendingRequests);
      setConnectionStatus("connected");
      const activeProjectID = pendingRequests.some(
        (request) => selectedProjectID && requestProjectID(request) === selectedProjectID,
      )
        ? selectedProjectID
        : null;
      if (selectedProjectID && !activeProjectID) {
        setSelectedProjectID(null);
      }
      const selectableRequests = filterRequestsByProject(pendingRequests, activeProjectID);
      setSelectedID((current) =>
        selectApprovalID(selectableRequests, notificationTargetID, current),
      );
      if (
        notificationTargetID &&
        pendingRequests.some((request) => request.id === notificationTargetID)
      ) {
        setNotificationTargetID(null);
      }
    } catch (err) {
      setConnectionStatus("disconnected");
      const message = err instanceof Error ? err.message : "Failed to load requests";
      recordDiagnostic("warn", "requests", "load_failed", { message });
      setDiagnosticsEventCount(diagnosticEvents().length);
      setError(null);
    } finally {
      if (visible) {
        setLoading(false);
      }
    }
  }, [notificationTargetID, notificationsEnabled, pushStatus, runtimeAuthConfig?.authProvider, sdk, selectedOrganizationID, selectedProjectID]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (!settingsLoaded || !hasRequestAuth) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        interruptRealtime();
        void load({ visible: false });
      }
    });
    return () => subscription.remove();
  }, [hasRequestAuth, interruptRealtime, load, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    void load({ visible: false });
    if (hasRequestAuth && mobileEventStreamsAvailable() && !realtimeUnavailable) {
      return;
    }

    const timer = setInterval(() => void load({ visible: false }), hasRequestAuth ? 15_000 : 5_000);
    return () => clearInterval(timer);
  }, [hasRequestAuth, load, realtimeUnavailable, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded || !hasRequestAuth) {
      return;
    }
    const heartbeat = () => {
      void sdk.sendHeartbeat({ deviceId: deviceID, client: "mobile" }).catch(() => undefined);
    };
    heartbeat();
    const timer = setInterval(heartbeat, 60_000);
    return () => clearInterval(timer);
  }, [deviceID, runtimeAuthConfig?.authProvider, sdk, settingsLoaded, token]);

  useEffect(() => {
    if (!settingsLoaded || !hasRequestAuth || !diagnosticsEnabled) {
      return;
    }
    void flushDiagnostics(sdk, diagnosticsSnapshot({
      serverURL,
      authMode: runtimeAuthConfig?.authProvider,
      connectionStatus,
      pushStatus,
      notificationStatus,
      notificationsEnabled,
      currentScreen: screen,
      lastErrorMessage: error ?? undefined,
    })).then((accepted) => {
      if (accepted > 0) setDiagnosticsLastSentAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      setDiagnosticsEventCount(diagnosticEvents().length);
    }).catch(() => undefined);
  }, [connectionStatus, diagnosticsEnabled, error, hasRequestAuth, notificationStatus, notificationsEnabled, pushStatus, runtimeAuthConfig?.authProvider, screen, sdk, serverURL, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded || !hasRequestAuth || realtimeUnavailable || !mobileEventStreamsAvailable()) {
      return;
    }

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const clearRefreshTimer = () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void load({ visible: false });
      }, 100);
    };

    const subscription = subscribeToMobileEventStream({
      client: sdk,
      onAuditEvent: scheduleRefresh,
      onStatusChange: (status) => {
        if (status === "open") setConnectionStatus("connected");
        if (status === "connecting" || status === "reconnecting") setConnectionStatus("checking");
      },
      onError: (eventError) => {
        setConnectionStatus("disconnected");
        if (apiStatus(eventError) === 404) {
          setRealtimeUnavailable(true);
          recordDiagnostic("warn", "realtime", "long_poll_unavailable", { status: 404 });
          setDiagnosticsEventCount(diagnosticEvents().length);
        }
      },
    });

    realtimeSubscriptionRef.current = subscription;

    return () => {
      clearRefreshTimer();
      subscription.close();
      if (realtimeSubscriptionRef.current === subscription) realtimeSubscriptionRef.current = null;
    };
  }, [hasRequestAuth, load, realtimeRestartToken, realtimeUnavailable, sdk, settingsLoaded]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setError(null);
    try {
      const allRequests = await sdk.listApprovalRequests();
      setHistory(normalizeApprovals(allRequests));
      setConnectionStatus("connected");
    } catch (err) {
      setConnectionStatus("disconnected");
      const message = err instanceof Error ? err.message : "Failed to load history";
      recordDiagnostic("warn", "requests", "history_load_failed", { message });
      setDiagnosticsEventCount(diagnosticEvents().length);
      setError(message);
    } finally {
      setHistoryLoading(false);
    }
  }, [sdk]);

  useEffect(() => {
    if (screen === "history") {
      void loadHistory();
    }
  }, [loadHistory, screen]);

  const removePendingRequest = useCallback((requestID: string) => {
    setRequests((current) => {
      const next = current.filter((request) => request.id !== requestID);
      setSelectedID(next[0]?.id ?? null);
      return next;
    });
  }, []);

  const updatePendingRequest = useCallback((updated: ApprovalRequest) => {
    setRequests((current) => {
      const exists = current.some((request) => request.id === updated.id);
      if (!exists) {
        return [updated, ...current];
      }
      return current.map((request) => (request.id === updated.id ? updated : request));
    });
    setSelectedID(updated.id);
  }, []);

  const applyResponseResult = useCallback(
    (requestID: string, updated: ApprovalRequest) => {
      if (updated.status === "pending" && !updated.response) {
        updatePendingRequest(updated);
        return;
      }
      removePendingRequest(requestID);
    },
    [removePendingRequest, updatePendingRequest],
  );

  const submitResponse = async (
    request: ApprovalRequest,
    payload: { choiceId?: string; message?: string; answers?: Record<string, string[]>; encryptedPayloadAcknowledged?: boolean },
  ) => {
    interruptRealtime();
    try {
      const updated = normalizeApproval(await sdk.respondToApproval(request.id, payload));
      applyResponseResult(request.id, updated);
      setReply("");
      setQuestionnaireAnswers({});
      void load({ visible: false });
    } catch (err) {
      recordDiagnostic("warn", "requests", "response_failed", { message: err instanceof Error ? err.message : String(err), status: apiStatus(err) });
      setDiagnosticsEventCount(diagnosticEvents().length);
      if (apiStatus(err) === 409) {
        void load({ visible: false });
        return;
      }
      Alert.alert(
        "Response failed",
        err instanceof Error ? err.message : "Could not send response",
      );
    }
  };

  const respond = async (request: ApprovalRequest, choice: Choice) =>
    submitResponse(request, { choiceId: choice.id, message: reply, ...(request.encryptedPayload ? { encryptedPayloadAcknowledged: true } : {}) });

  const submitQuestionnaire = async (request: ApprovalRequest) =>
    submitResponse(request, { answers: questionnaireAnswers, ...(request.encryptedPayload ? { encryptedPayloadAcknowledged: true } : {}) });

  const respondByID = useCallback(
    async (requestID: string, choiceID: string) => {
      interruptRealtime();
      try {
        const updated = normalizeApproval(await sdk.respondToApproval(requestID, { choiceId: choiceID }));
        applyResponseResult(requestID, updated);
        void load({ visible: false });
      } catch (err) {
        if (apiStatus(err) === 409) {
          void load({ visible: false });
          return;
        }
        recordDiagnostic("warn", "notifications", "action_response_failed", { message: err instanceof Error ? err.message : String(err), status: apiStatus(err) });
        setDiagnosticsEventCount(diagnosticEvents().length);
        setNotificationTargetID(requestID);
        setSelectedID(requestID);
        setScreen("approvals");
      }
    },
    [applyResponseResult, interruptRealtime, load, sdk],
  );

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const decision = notificationDecision(response);
        if (!decision) {
          return;
        }
        if (decision.kind === "respond") {
          void respondByID(decision.requestID, decision.choiceID);
          return;
        }
        const fallback = notificationFallbackState(decision.requestID);
        setNotificationTargetID(fallback.notificationTargetID);
        setSelectedID(fallback.selectedID);
        setScreen(fallback.screen);
        interruptRealtime();
        void loadRef.current?.({ visible: false });
      },
    );

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        const decision = response ? notificationDecision(response) : null;
        if (decision) {
          const fallback = notificationFallbackState(decision.requestID);
          setNotificationTargetID(fallback.notificationTargetID);
          setSelectedID(fallback.selectedID);
          setScreen(fallback.screen);
          interruptRealtime();
          void loadRef.current?.({ visible: false });
        }
      })
      .catch(() => undefined);

    return () => subscription.remove();
  }, [interruptRealtime, respondByID]);

  const checkConnection = async () => {
    interruptRealtime();
    setConnectionStatus("checking");
    await load({ visible: true });
  };

  const updateAvailability = async (state: AvailabilityState) => {
    setAvailability(state);
    try {
      const record = await sdk.setAvailability({ state });
      if (record.state) {
        setAvailability(record.state as AvailabilityState);
      }
    } catch (err) {
      Alert.alert(
        "Availability update failed",
        err instanceof Error ? err.message : "Could not update availability",
      );
    }
  };

  const requestNotifications = async () => {
    setNotificationsEnabled(true);
    setNotificationStatus("checking");
    const permissions = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: false,
        allowSound: true,
      },
    });
    setNotificationStatus(toNotificationStatus(permissions));
  };

  const clearRemotePushToken = async () => {
    if (!deviceID) return;
    const activeToken = await currentAuthToken();
    if (!activeToken) return;
    const pushClient = runtimeAuthConfig?.authProvider === "clerk"
      ? sdk
      : new AgentTickClient({ baseUrl: normalizeServerURL(serverURL), tokenProvider: () => activeToken });
    await pushClient.updateDevicePushToken(deviceID, { token: "" });
  };

  const toggleNotifications = async (enabled: boolean) => {
    if (!enabled) {
      setNotificationsEnabled(false);
      lastClerkPushRegistrationKey.current = "";
      await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
      if (pushStatus === "registered") {
        await clearRemotePushToken().catch((err) => {
          recordDiagnostic("warn", "notifications", "push_unregister_failed", { message: err instanceof Error ? err.message : String(err) });
          setDiagnosticsEventCount(diagnosticEvents().length);
        });
      }
      setPushStatus("idle");
      recordDiagnostic("info", "notifications", "disabled");
      setDiagnosticsEventCount(diagnosticEvents().length);
      return;
    }

    await requestNotifications();
    const permissions = await Notifications.getPermissionsAsync();
    if (!permissions.granted) return;
    await registerPushToken(undefined, undefined, undefined, true);
  };

  const sendTestNotification = async () => {
    if (!notificationsEnabled) {
      Alert.alert("Notifications are off", "Turn on notifications in Agent Tick first.");
      return;
    }
    const permissions = await Notifications.getPermissionsAsync();
    setNotificationStatus(toNotificationStatus(permissions));
    if (!permissions.granted) {
      Alert.alert("Notifications are off", "Enable notifications first.");
      return;
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Agent Tick",
        body: "Notifications are working.",
        sound: true,
      },
      trigger: null,
    });
  };

  const pairDevice = async () => {
    await pairWithCode(pairingCode.trim());
  };

  const pairWithCode = async (
    code: string,
    serverOverride?: string,
    alreadyLocked = false,
  ) => {
    if (!code) {
      Alert.alert("Pairing code required", "Enter the code from agent-tick pair.");
      return;
    }
    if (!alreadyLocked && pairingInFlight.current) {
      return;
    }

    if (!alreadyLocked) {
      pairingInFlight.current = true;
    }
    const activeServerURL = (serverOverride || serverURL).replace(/\/$/, "");

    try {
      const pairingClient = new AgentTickClient({ baseUrl: activeServerURL });
      const credential = await pairingClient.pairDevice({
        token: code,
        deviceName: `${Platform.OS} phone`,
      });

      if (serverOverride) {
        setServerURL(serverOverride);
      }
      setDeviceID(credential.deviceId);
      setToken(credential.token);
      setPushStatus("idle");
      setPairingCode("");
      await loadWithCredentials(activeServerURL, credential.token);
      Alert.alert("Paired", "This device can now receive approval requests.");
      setScreen("approvals");
    } catch (err) {
      Alert.alert(
        "Pairing failed",
        err instanceof Error ? err.message : "Could not pair this device",
      );
    } finally {
      pairingInFlight.current = false;
      setScannerLocked(false);
    }
  };

  const loadWithCredentials = async (activeServerURL: string, activeToken: string) => {
    const credentialClient = new AgentTickClient({
      baseUrl: activeServerURL,
      tokenProvider: () => activeToken,
    });
    const pending = normalizeApprovals(await credentialClient.listApprovalRequests()).filter(
      (request) => request.status === "pending",
    );
    await notifyForNewRequests(
      pending,
      seenRequestIDs,
      didPrimeNotifications,
      shouldScheduleLocalNotifications(pushStatus, notificationsEnabled),
    );
    setRequests(pending);
    setConnectionStatus("connected");
    setSelectedID((current) =>
      selectApprovalID(pending, notificationTargetID, current),
    );
  };

  const registerPushToken = async (
    overrideDeviceID?: string,
    overrideToken?: string,
    overrideServerURL?: string,
    overrideNotificationsEnabled = notificationsEnabled,
  ) => {
    if (!overrideNotificationsEnabled) {
      Alert.alert("Notifications are off", "Turn on notifications before registering push notifications.");
      return;
    }
    const activeDeviceID = overrideDeviceID ?? deviceID;
    const activeToken = overrideToken ?? token;
    if (runtimeAuthConfig?.authProvider !== "clerk" && (!activeDeviceID || !activeToken)) {
      Alert.alert("Pair first", "Pair this device before registering push notifications.");
      return;
    }

    try {
      const permissions = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: false,
          allowSound: true,
        },
      });
      setNotificationStatus(toNotificationStatus(permissions));
      if (!permissions.granted) {
        setPushStatus("failed");
        recordDiagnostic("warn", "notifications", "push_permission_denied");
        setDiagnosticsEventCount(diagnosticEvents().length);
        return;
      }

      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync(approvalChannelID, {
          name: "Approval requests",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          sound: "default",
        });
      }
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      if (!isUsableProjectID(projectId)) {
        setPushStatus("unsupported");
        Alert.alert(
          "Development build required",
          "Remote push needs a real EAS project id. Pairing still works; use local notifications until an EAS development build is configured.",
        );
        return;
      }
      const pushToken = await Notifications.getExpoPushTokenAsync(
        { projectId },
      );
      const installationId = await mobileInstallationID();
      const trimmed = (overrideServerURL || serverURL).replace(/\/$/, "");
      const pushClient = runtimeAuthConfig?.authProvider === "clerk"
        ? sdk
        : new AgentTickClient({ baseUrl: trimmed, tokenProvider: () => activeToken });
      if (runtimeAuthConfig?.authProvider === "clerk") {
        const responseBody = await pushClient.registerDevice({
          deviceName: `${Platform.OS} phone`,
          platform: Platform.OS,
          installationId,
          expoPushToken: pushToken.data,
        });
        setDeviceID(responseBody.deviceId);
      } else if (activeDeviceID) {
        await pushClient.updateDevicePushToken(activeDeviceID, { token: pushToken.data });
      } else {
        const responseBody = await pushClient.registerDevice({
          deviceName: `${Platform.OS} phone`,
          platform: Platform.OS,
          installationId,
          expoPushToken: pushToken.data,
        });
        setDeviceID(responseBody.deviceId);
      }
      setPushStatus("registered");
      recordDiagnostic("info", "notifications", "push_registered");
      setDiagnosticsEventCount(diagnosticEvents().length);
    } catch (err) {
      setPushStatus("failed");
      recordDiagnostic("error", "notifications", "push_registration_failed", { message: err instanceof Error ? err.message : String(err) });
      setDiagnosticsEventCount(diagnosticEvents().length);
      Alert.alert(
        "Push registration failed",
        err instanceof Error ? err.message : "Could not register push notifications",
      );
    }
  };

  useEffect(() => {
    if (runtimeAuthConfig?.authProvider !== "clerk") return;
    if (!settingsLoaded || !notificationsEnabled || !currentAccountProfile?.userId || !selectedOrganizationID) return;
    if (notificationStatus !== "granted" && pushStatus !== "registered") return;
    if (pushStatus === "failed" || pushStatus === "unsupported") return;
    const registrationKey = `${normalizeServerURL(serverURL)}:${currentAccountProfile.userId}`;
    if (lastClerkPushRegistrationKey.current === registrationKey) return;
    lastClerkPushRegistrationKey.current = registrationKey;
    void registerPushToken().catch(() => {
      lastClerkPushRegistrationKey.current = "";
    });
  }, [currentAccountProfile?.userId, notificationStatus, notificationsEnabled, pushStatus, runtimeAuthConfig?.authProvider, selectedOrganizationID, serverURL, settingsLoaded]);

  const clearStoredSessionForServer = useCallback(async (activeServerURL = serverURL) => {
    await AsyncStorage.multiRemove(mobileSessionStorageKeyList(activeServerURL));
  }, [serverURL]);

  const bestEffortUnregisterDevice = useCallback(async (options: {
    activeDeviceID?: string;
    activeServerURL?: string;
    activeToken?: string;
    authProvider?: string | null;
  } = {}) => {
    const activeDeviceID = options.activeDeviceID ?? deviceID;
    if (!activeDeviceID) return;
    const activeAuthProvider = options.authProvider ?? runtimeAuthConfig?.authProvider;
    const trimmed = normalizeServerURL(options.activeServerURL ?? serverURL);
    try {
      const cleanupToken = activeAuthProvider === "clerk" ? await currentAuthToken() : (options.activeToken ?? token);
      if (!cleanupToken) return;
      const cleanupClient = new AgentTickClient({
        baseUrl: trimmed,
        tokenProvider: () => cleanupToken,
      });
      await cleanupClient.unregisterDevice(activeDeviceID);
    } catch {
      // Best-effort cleanup only; local credentials are still cleared.
    }
  }, [currentAuthToken, deviceID, runtimeAuthConfig?.authProvider, serverURL, token]);

  const forgetDevice = useCallback(async (options?: { reopenSignIn?: boolean }) => {
    await bestEffortUnregisterDevice();
    await clearStoredSessionForServer();
    setDeviceID("");
    setToken("");
    setPushStatus("idle");
    setOrganizations([]);
    setCurrentAccountProfile(null);
    setSelectedOrganizationID("");
    setRequests([]);
    setHistory([]);
    setConnectionStatus("disconnected");
    if (runtimeAuthConfig?.authProvider === "clerk") onForgetClerkSession?.(options);
  }, [bestEffortUnregisterDevice, clearStoredSessionForServer, onForgetClerkSession, runtimeAuthConfig?.authProvider]);

  const useHostedSignIn = useCallback(async () => {
    if (deviceID) {
      void bestEffortUnregisterDevice();
    }
    await clearStoredSessionForServer();
    setLoadedSessionServerURL("");
    setDeviceID("");
    setToken("");
    setPushStatus("idle");
    setOrganizations([]);
    setCurrentAccountProfile(null);
    setSelectedOrganizationID("");
    setRequests([]);
    setHistory([]);
    setSelectedID(null);
    setConnectionStatus("checking");
    const config = await fetchRuntimeAuthConfigIfAvailable(defaultServer);
    onRuntimeAuthConfig?.(defaultServer, config);
  }, [bestEffortUnregisterDevice, clearStoredSessionForServer, deviceID, onRuntimeAuthConfig]);

  const selectOrganization = useCallback((organizationID: string) => {
    if (organizationID === selectedOrganizationID) return;
    setSelectedOrganizationID(organizationID);
    setRequests([]);
    setHistory([]);
    setSelectedID(null);
  }, [selectedOrganizationID]);

  const handleServerURLChange = useCallback((value: string) => {
    const previousServerURL = normalizeServerURL(serverURL);
    const nextServerURL = normalizeServerURL(value);
    if (previousServerURL !== nextServerURL) {
      if (deviceID) {
        void bestEffortUnregisterDevice({
          activeDeviceID: deviceID,
          activeServerURL: previousServerURL,
          activeToken: token,
          authProvider: runtimeAuthConfig?.authProvider,
        });
      }
      void clearStoredSessionForServer(previousServerURL);
      setLoadedSessionServerURL("");
      setDeviceID("");
      setToken("");
      setPushStatus("idle");
      setOrganizations([]);
      setCurrentAccountProfile(null);
      setSelectedOrganizationID("");
      setRequests([]);
      setHistory([]);
      setSelectedID(null);
      setConnectionStatus("checking");
    }
    setServerURL(nextServerURL);
  }, [bestEffortUnregisterDevice, clearStoredSessionForServer, deviceID, runtimeAuthConfig?.authProvider, serverURL, token]);

  const toggleDiagnostics = useCallback(async (enabled: boolean) => {
    await saveDiagnosticsEnabled(enabled);
    setDiagnosticsEnabled(enabled);
    recordDiagnostic("info", "diagnostics", enabled ? "enabled" : "disabled");
    setDiagnosticsEventCount(diagnosticEvents().length);
  }, []);

  const sendDiagnostics = useCallback(async () => {
    try {
      const accepted = await sendDiagnosticSnapshot(sdk, diagnosticsSnapshot({
        serverURL,
        authMode: runtimeAuthConfig?.authProvider,
        connectionStatus,
        pushStatus,
        notificationStatus,
        notificationsEnabled,
        currentScreen: screen,
        lastErrorMessage: error ?? undefined,
      }));
      setDiagnosticsLastSentAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      setDiagnosticsEventCount(diagnosticEvents().length);
      Alert.alert("Diagnostics sent", `Sent ${accepted} diagnostic event${accepted === 1 ? "" : "s"}.`);
    } catch (err) {
      Alert.alert("Diagnostics failed", err instanceof Error ? err.message : "Could not send diagnostics");
    }
  }, [connectionStatus, error, notificationStatus, notificationsEnabled, pushStatus, runtimeAuthConfig?.authProvider, screen, sdk, serverURL]);

  const handlePairingScan = async (result: BarcodeScanningResult) => {
    if (pairingInFlight.current) {
      return;
    }
    pairingInFlight.current = true;
    setScannerLocked(true);
    const payload = parsePairingPayload(result.data);
    if (payload.serverURL) {
      handleServerURLChange(payload.serverURL);
    }
    if (payload.organizationId) {
      setSelectedOrganizationID(payload.organizationId);
    }
    if (payload.pairingCode) {
      setPairingCode(payload.pairingCode);
      await pairWithCode(payload.pairingCode, payload.serverURL, true);
      return;
    }
    if (payload.serverURL && payload.authProvider === "clerk") {
      try {
        const config = await fetchRuntimeAuthConfig(payload.serverURL);
        setRuntimeAuthConfig(config);
        onRuntimeAuthConfig?.(payload.serverURL, config);
        if (payload.organizationId) setSelectedOrganizationID(payload.organizationId);
        Alert.alert("Server saved", "Sign in with Clerk to use this Agent Tick server.");
        setScreen("approvals");
      } catch (err) {
        Alert.alert("Server discovery failed", err instanceof Error ? err.message : "Could not read server auth config");
      } finally {
        pairingInFlight.current = false;
        setScannerLocked(false);
      }
      return;
    }
    pairingInFlight.current = false;
    setScannerLocked(false);
    Alert.alert("Invalid QR code", "This does not look like an Agent Tick pairing code.");
  };

  return (
    <View style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>Agent Tick</Text>
          <ConnectionBadge status={connectionStatus} />
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="Open menu"
            onPress={() => {
              recordDiagnostic("info", "button", "open_menu");
              setMenuOpen(true);
            }}
            style={styles.iconButton}
          >
            <Text style={styles.menuIconText}>☰</Text>
            {otherAccountPendingTotal > 0 ? (
              <View style={styles.headerBadge}>
                <Text style={styles.headerBadgeText}>{badgeLabel(otherAccountPendingTotal)}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      <SideMenu
        accountProfile={currentAccountProfile}
        connectionStatus={connectionStatus}
        accountPending={accountPending}
        currentScreen={screen}
        onAccountSelect={switchSavedAccount}
        onClose={() => setMenuOpen(false)}
        onNavigate={(nextScreen) => {
          recordDiagnostic("info", "navigation", "menu_item_selected", { to: nextScreen });
          setScreen(nextScreen);
          setMenuOpen(false);
        }}
        organizationName={selectedOrganization?.name ?? selectedOrganizationID}
        otherAccounts={otherAccounts}
        serverURL={serverURL}
        visible={menuOpen}
      />

      {screen === "settings" ? (
        <SettingsScreen
          accounts={savedAccounts}
          availability={availability}
          connectionStatus={connectionStatus}
          error={error}
          e2eeFocusToken={e2eeFocusToken}
          e2eeKey={e2eeKey}
          loading={loading}
          notificationStatus={notificationStatus}
          notificationsEnabled={notificationsEnabled}
          onAvailabilityChange={(state) => void updateAvailability(state as AvailabilityState)}
          onCheck={() => void checkConnection()}
          onDiagnosticsEnabledChange={(enabled) => void toggleDiagnostics(enabled)}
          onDiagnosticEvent={(area, message, metadata) => recordDiagnostic("info", area, message, metadata)}
          onForgetDevice={() => void forgetDevice()}
          onSignInAnotherClerkAccount={onAddClerkAccount}
          onPairDevice={() => void pairDevice()}
          onNotificationsEnabledChange={(enabled) => void toggleNotifications(enabled)}
          onRegisterPush={() => void registerPushToken()}
          onRequestNotifications={() => void requestNotifications()}
          onSavedAccountRemove={removeSavedAccount}
          onSavedAccountSelect={switchSavedAccount}
          onSendDiagnosticSnapshot={() => void sendDiagnostics()}
          onSendTestNotification={() => void sendTestNotification()}
          onScanPairing={() => {
            pairingInFlight.current = false;
            setScannerLocked(false);
            setScreen("scanner");
          }}
          onUseHosted={() => void useHostedSignIn()}
          pairingCode={pairingCode}
          pushStatus={pushStatus}
          diagnosticsEnabled={diagnosticsEnabled}
          diagnosticsEventCount={diagnosticsEventCount}
          diagnosticsLastSentAt={diagnosticsLastSentAt}
          authProvider={runtimeAuthConfig?.authProvider}
          currentAccountProfile={currentAccountProfile}
          deviceID={deviceID}
          organizations={organizations}
          selectedOrganizationID={selectedOrganizationID}
          serverURL={serverURL}
          setPairingCode={setPairingCode}
          setSelectedOrganizationID={selectOrganization}
          setE2eeKey={setE2eeKey}
          setServerURL={handleServerURLChange}
          setToken={setToken}
          token={token}
        />
      ) : screen === "scanner" ? (
        <ScannerScreen
          cameraPermission={cameraPermission}
          scanning={scannerLocked}
          onCancel={() => setScreen("settings")}
          onRequestPermission={() => void requestCameraPermission()}
          onScan={(result) => void handlePairingScan(result)}
        />
      ) : screen === "history" ? (
        <HistoryScreen
          e2eeKey={e2eeKey}
          error={error}
          history={history}
          loading={historyLoading}
          onRefresh={() => void loadHistory()}
        />
      ) : (
        <ApprovalsScreen
          error={error}
          loading={loading}
          onOpenSettings={() => {
            setE2eeFocusToken((value) => value + 1);
            setScreen("settings");
          }}
          onRefresh={() => void load({ visible: true })}
          onRespond={(request, choice) => void respond(request, choice)}
          onSubmitQuestionnaire={(request) => void submitQuestionnaire(request)}
          projectGroups={projectGroups}
          e2eeKey={e2eeKey}
          questionnaireAnswers={questionnaireAnswers}
          reply={reply}
          requests={visibleRequests}
          selectedProjectID={selectedProjectID}
          statusUpdates={statusUpdates}
          dismissedStatusID={visibleDismissedStatusID}
          onDismissStatus={dismissStatusUpdate}
          setProjectID={(projectID) => {
            setSelectedProjectID(projectID);
            setSelectedID(filterRequestsByProject(requests, projectID)[0]?.id ?? null);
          }}
          setQuestionnaireAnswer={(question, option, multiSelect) =>
            setQuestionnaireAnswers((current) =>
              updateQuestionnaireAnswers(current, question, option, multiSelect),
            )
          }
          selected={selected}
          selectedID={selectedID}
          setReply={setReply}
          setSelectedID={setSelectedID}
        />
      )}
    </View>
  );
}

type SideMenuProps = {
  accountPending: Record<string, AccountPendingState>;
  accountProfile: MeResponse | null;
  connectionStatus: ConnectionStatus;
  currentScreen: Screen;
  onAccountSelect: (account: SavedMobileAccount) => void;
  onClose: () => void;
  onNavigate: (screen: Screen) => void;
  organizationName?: string;
  otherAccounts: SavedMobileAccount[];
  serverURL: string;
  visible: boolean;
};

function SideMenu({
  accountPending,
  accountProfile,
  connectionStatus,
  currentScreen,
  onAccountSelect,
  onClose,
  onNavigate,
  organizationName,
  otherAccounts,
  serverURL,
  visible,
}: SideMenuProps) {
  const accountLabel = accountProfile?.email || accountProfile?.userId || "Not signed in";
  const signInLabel = accountProfile?.signInMethod ? `${accountProfile.signInMethod} account` : "Mobile session";
  const [rendered, setRendered] = useState(visible);
  const menuProgress = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) setRendered(true);
  }, [visible]);

  useEffect(() => {
    if (!rendered) return;
    Animated.timing(menuProgress, {
      duration: 220,
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) setRendered(false);
    });
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
              <Text style={styles.sideMenuTitle}>Menu</Text>
              <Pressable accessibilityLabel="Close menu" onPress={onClose} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>×</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.accountsSection}>
            <Text style={styles.menuSectionLabel}>Accounts</Text>
            <View style={styles.accountsList}>
              <AccountMenuItem
                active
                colorKey={accountProfile?.userId || accountProfile?.email || accountLabel}
                label={accountLabel}
                meta={[signInLabel, organizationName ? `Org: ${organizationName}` : undefined].filter(Boolean).join(" · ")}
                onPress={() => {
                  onNavigate("approvals");
                }}
              />
              {otherAccounts.map((account) => (
                <AccountMenuItem
                  account={account}
                  key={account.id}
                  onPress={() => {
                    onAccountSelect(account);
                    onClose();
                  }}
                  pending={accountPending[account.id]}
                />
              ))}
            </View>
          </View>

          <View style={styles.menuItems}>
            <SideMenuItem
              active={currentScreen === "approvals"}
              icon="✓"
              label="Approvals"
              onPress={() => onNavigate("approvals")}
            />
            <SideMenuItem
              active={currentScreen === "history"}
              icon="🕘"
              label="History"
              onPress={() => onNavigate("history")}
            />
            <SideMenuItem
              active={currentScreen === "settings"}
              icon="⚙"
              label="Settings"
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
  const accountLabel = label || (account ? savedAccountMenuLabel(account) : "Account");
  const pendingLabel = active ? "Current account" : accountPendingLabel(pending);
  const pendingCount = pending?.status === "ready" ? pending.count : 0;
  const dotColor = account ? accountColor(account) : accountColorForKey(colorKey || accountLabel);
  return (
    <Pressable accessibilityLabel={active ? `Open ${accountLabel}` : `Switch to ${accountLabel}`} onPress={onPress} style={[styles.accountMenuItem, active ? styles.accountMenuItemActive : null]}>
      <View style={[styles.accountColorDot, { backgroundColor: dotColor }]} />
      <View style={styles.accountMenuTextWrap}>
        <View style={styles.accountMenuTitleRow}>
          <Text numberOfLines={1} style={styles.accountMenuName}>{accountLabel}</Text>
          {active ? <Text style={styles.currentAccountPill}>Current</Text> : null}
        </View>
        {meta ? <Text numberOfLines={1} style={styles.accountMenuMeta}>{meta}</Text> : null}
        {pendingLabel ? <Text numberOfLines={1} style={styles.accountMenuStatus}>{pendingLabel}</Text> : null}
      </View>
      {pendingCount > 0 ? (
        <View style={styles.accountPendingBadge}>
          <Text style={styles.accountPendingBadgeText}>{badgeLabel(pendingCount)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function accountPendingLabel(pending?: AccountPendingState) {
  if (!pending || pending.status === "checking") return "Checking pending approvals…";
  if (pending.status === "needs-sign-in") return "Needs sign-in";
  if (pending.status === "error") return "Unable to check";
  if (pending.count === 0) return "No pending approvals";
  return `${pending.count} pending approval${pending.count === 1 ? "" : "s"}`;
}

function savedAccountMenuLabel(account: SavedMobileAccount) {
  return account.email || account.label || account.userID || account.deviceID || hostLabel(account.serverURL);
}

function badgeLabel(count: number) {
  return count > 99 ? "99+" : String(count);
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

function isCurrentSavedAccount(
  account: SavedMobileAccount,
  current: {
    authProvider?: string;
    currentAccountProfile?: Pick<MeResponse, "userId" | "email"> | null;
    deviceID: string;
    selectedOrganizationID?: string;
    serverURL: string;
  },
) {
  if (account.authProvider !== current.authProvider || normalizeServerURL(account.serverURL) !== normalizeServerURL(current.serverURL)) return false;
  if (account.authProvider === "clerk") {
    if (account.userID && current.currentAccountProfile?.userId) return account.userID === current.currentAccountProfile.userId;
    if (account.email && current.currentAccountProfile?.email) return account.email.trim().toLowerCase() === current.currentAccountProfile.email.trim().toLowerCase();
    return false;
  }
  if (account.deviceID && current.deviceID) return account.deviceID === current.deviceID;
  return Boolean(account.organizationID && account.organizationID === current.selectedOrganizationID);
}

function hostLabel(serverURL: string) {
  try {
    return new URL(serverURL).host;
  } catch {
    return serverURL;
  }
}

function filterRequestsByProject(
  requests: ApprovalRequest[],
  projectID: string | null,
) {
  if (!projectID) {
    return requests;
  }
  return requests.filter((request) => requestProjectID(request) === projectID);
}

function selectApprovalID(
  requests: ApprovalRequest[],
  notificationTargetID: string | null,
  currentID: string | null,
) {
  if (
    notificationTargetID &&
    requests.some((request) => request.id === notificationTargetID)
  ) {
    return notificationTargetID;
  }
  if (currentID && requests.some((request) => request.id === currentID)) {
    return currentID;
  }
  return requests[0]?.id ?? null;
}

async function mobileInstallationID(): Promise<string> {
  const existing = await AsyncStorage.getItem(mobileInstallationIDStorageKey);
  if (existing) return existing;
  const next = `install_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  await AsyncStorage.setItem(mobileInstallationIDStorageKey, next);
  return next;
}

function isUsableProjectID(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "00000000-0000-0000-0000-000000000000" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function apiStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function diagnosticsSnapshot(input: {
  serverURL: string;
  authMode?: string;
  connectionStatus: ConnectionStatus;
  pushStatus: PushStatus;
  notificationStatus: NotificationStatus;
  notificationsEnabled?: boolean;
  currentScreen?: Screen;
  lastErrorMessage?: string;
}) {
  return {
    appVersion: Constants.expoConfig?.version,
    platform: Platform.OS,
    serverURL: input.serverURL,
    authMode: input.authMode,
    connectionStatus: input.connectionStatus,
    pushStatus: input.pushStatus,
    notificationStatus: input.notificationStatus,
    notificationsEnabled: input.notificationsEnabled,
    currentScreen: input.currentScreen,
    ...(input.lastErrorMessage ? { lastErrorMessage: input.lastErrorMessage } : {}),
  };
}

async function refreshNotificationStatus(
  setNotificationStatus: (status: NotificationStatus) => void,
) {
  try {
    const permissions = await Notifications.getPermissionsAsync();
    setNotificationStatus(toNotificationStatus(permissions));
  } catch {
    setNotificationStatus("undetermined");
  }
}

function toNotificationStatus(
  permissions: Notifications.NotificationPermissionsStatus,
): NotificationStatus {
  if (permissions.granted) {
    return "granted";
  }
  if (permissions.status === "denied") {
    return "denied";
  }
  return "undetermined";
}

function isPushStatus(value: unknown): value is PushStatus {
  return (
    value === "idle" ||
    value === "registered" ||
    value === "unsupported" ||
    value === "failed"
  );
}

async function notifyForNewRequests(
  pending: ApprovalRequest[],
  seenRequestIDs: React.MutableRefObject<Set<string>>,
  didPrimeNotifications: React.MutableRefObject<boolean>,
  useLocalNotifications: boolean,
) {
  const pendingIDs = new Set(pending.map((request) => request.id));

  if (!didPrimeNotifications.current) {
    seenRequestIDs.current = pendingIDs;
    didPrimeNotifications.current = true;
    return;
  }

  const newRequests = pending.filter(
    (request) => !seenRequestIDs.current.has(request.id),
  );
  seenRequestIDs.current = pendingIDs;

  if (!useLocalNotifications) {
    return;
  }

  let permissions: Notifications.NotificationPermissionsStatus;
  try {
    permissions = await Notifications.getPermissionsAsync();
  } catch {
    return;
  }
  if (!permissions.granted) {
    return;
  }

  for (const request of newRequests) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: request.command ? "Run Command?" : request.title,
          body: notificationBody(request),
          categoryIdentifier: supportsNotificationActions(request) ? approvalCategoryID : undefined,
          data: { approvalRequestID: request.id },
          sound: true,
        },
        ...(Platform.OS === "android" ? { channelId: approvalChannelID } : {}),
        trigger: null,
      });
    } catch {
      // Local notifications are opportunistic; polling/event-stream refresh still shows the request.
    }
  }
}

function formatRequestTime(value?: string) {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function LatestStatusCard({ statusUpdates, compact = false, dismissedStatusID, onDismiss }: { statusUpdates: AgentStatusUpdate[]; compact?: boolean; dismissedStatusID?: string | null; onDismiss?: (statusID: string) => void }) {
  const latest = statusUpdates[0];
  if (!latest || latest.statusId === dismissedStatusID) return null;
  const project = latest.projectName || latest.workingDirectory || latest.threadId;
  return (
    <View style={[styles.statusCard, compact ? styles.statusCardCompact : null]}>
      <View style={styles.statusCardHeader}>
        <Text style={styles.statusLabel}>Latest agent status</Text>
        <View style={styles.statusHeaderActions}>
          <Text style={styles.statusState}>{latest.state}</Text>
          {onDismiss ? (
            <Pressable accessibilityLabel="Dismiss latest agent status" onPress={() => onDismiss(latest.statusId)}>
              <Text style={styles.statusDismiss}>×</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Text style={styles.statusMessage}>{latest.message}</Text>
      {latest.nextStep ? <Text style={styles.statusNext}>Next: {latest.nextStep}</Text> : null}
      <Text numberOfLines={1} style={styles.statusMeta}>
        {latest.agentName} · {project} · {formatRequestTime(latest.createdAt)}
      </Text>
    </View>
  );
}

export function ApprovalsScreen({
  e2eeKey,
  error,
  loading,
  onOpenSettings,
  onRefresh,
  onRespond,
  onSubmitQuestionnaire,
  projectGroups,
  questionnaireAnswers,
  reply,
  requests,
  selectedProjectID,
  statusUpdates,
  dismissedStatusID,
  onDismissStatus,
  setProjectID,
  setQuestionnaireAnswer,
  selected,
  selectedID,
  setReply,
  setSelectedID,
}: {
  e2eeKey?: string;
  error: string | null;
  loading: boolean;
  onOpenSettings?: () => void;
  onRefresh: () => void;
  onRespond: (request: ApprovalRequest, choice: Choice) => void;
  onSubmitQuestionnaire: (request: ApprovalRequest) => void;
  projectGroups: ReturnType<typeof groupRequestsByProject>;
  questionnaireAnswers: Record<string, string[]>;
  reply: string;
  requests: ApprovalRequest[];
  selectedProjectID: string | null;
  statusUpdates: AgentStatusUpdate[];
  dismissedStatusID?: string | null;
  onDismissStatus?: (statusID: string) => void;
  setProjectID: (projectID: string | null) => void;
  setQuestionnaireAnswer: (
    question: string,
    option: string,
    multiSelect: boolean,
  ) => void;
  selected?: ApprovalRequest;
  selectedID: string | null;
  setReply: (value: string) => void;
  setSelectedID: (value: string) => void;
}) {
  if (!selected) {
    return (
      <View style={styles.waitingPane}>
        {loading ? <ActivityIndicator color="#202124" /> : null}
        <Text style={styles.waitingTitle}>Waiting</Text>
        <LatestStatusCard statusUpdates={statusUpdates} compact dismissedStatusID={dismissedStatusID} onDismiss={onDismissStatus} />
        <Pressable onPress={onRefresh} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Refresh</Text>
        </Pressable>
      </View>
    );
  }

  const responsibility = requestResponsibilityLabel(selected);
  const encrypted = isEncryptedApprovalRequest(selected);
  const decrypted = useMemo(() => decryptedApprovalPlaintext(selected, e2eeKey), [e2eeKey, selected.id, selected.encryptedPayload]);
  const encryptedLocked = encrypted && !decrypted;
  const canRespond = !encryptedLocked && (encrypted ? true : canRespondToRequest(selected));
  const dismissChoice = encryptedDismissChoice(selected);

  return (
    <View style={styles.approvalsPane}>
      {projectGroups.length > 1 ? (
        <View style={styles.requestStrip}>
          <Pressable
            onPress={() => setProjectID(null)}
            style={[
              styles.requestPill,
              selectedProjectID === null ? styles.requestPillActive : null,
            ]}
          >
            <Text numberOfLines={1} style={styles.requestPillText}>
              All ({projectGroups.reduce((sum, group) => sum + group.requests.length, 0)})
            </Text>
          </Pressable>
          {projectGroups.map((group) => (
            <Pressable
              key={group.id}
              onPress={() => setProjectID(group.id)}
              style={[
                styles.requestPill,
                selectedProjectID === group.id ? styles.requestPillActive : null,
              ]}
            >
              <Text numberOfLines={1} style={styles.requestPillText}>
                {group.label} ({group.requests.length})
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {requests.length > 1 ? (
        <View style={styles.requestStrip}>
          {requests.map((request) => (
            <Pressable
              key={request.id}
              onPress={() => setSelectedID(request.id)}
              style={[
                styles.requestPill,
                selectedID === request.id ? styles.requestPillActive : null,
              ]}
            >
              <Text numberOfLines={1} style={styles.requestPillText}>
                {request.title}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.approvalContent}
        style={styles.approvalScroll}
      >
        <LatestStatusCard statusUpdates={statusUpdates} dismissedStatusID={dismissedStatusID} onDismiss={onDismissStatus} />
        <Text style={styles.detailTitle}>{decrypted?.title ?? selected.title}</Text>
        {responsibility ? (
          <Text style={styles.responsibilityBadge}>{responsibility}</Text>
        ) : null}
        <View style={styles.detailFacts}>
          {selected.risk ? (
            <Text
              style={[
                styles.riskBadge,
                selected.risk === "high" ? styles.riskHigh : null,
                selected.risk === "medium" ? styles.riskMedium : null,
                selected.risk === "low" ? styles.riskLow : null,
              ]}
            >
              {selected.risk}
            </Text>
          ) : null}
          {selected.expiresAt ? (
            <Text style={styles.factText}>
              Expires {formatRequestTime(selected.expiresAt)}
            </Text>
          ) : null}
        </View>
        {encryptedLocked ? <Text style={styles.errorText}>{encryptedLockMessage(selected, e2eeKey)}</Text> : null}
        {encryptedLocked ? null : (decrypted?.body ?? selected.body) ? <Text style={styles.bodyText}>{decrypted?.body ?? selected.body}</Text> : null}
        {(decrypted?.command ?? selected.command) ? (
          <Text selectable style={styles.commandText}>
            {decrypted?.command ?? selected.command}
          </Text>
        ) : null}
        <RequestContextPanel request={selected} />
        <PolicyProgressPanel request={selected} />
        {selected.requester.workingDirectory ? (
          <Text selectable numberOfLines={2} style={styles.cwdText}>
            {selected.requester.workingDirectory}
          </Text>
        ) : null}
        {selected.metadata?.context ? (
          <View style={styles.contextPanel}>
            <Text style={styles.contextTitle}>
              {selected.metadata.contextFile || "Context"}
            </Text>
            <Text selectable style={styles.contextText}>
              {selected.metadata.context}
            </Text>
          </View>
        ) : null}
        {isQuestionnaireRequest(selected) ? (
          <View style={styles.questionnairePanel}>
            {(selected.questions ?? []).map((question) => {
              const selectedAnswers = questionnaireAnswers[question.question] ?? [];
              return (
                <View key={question.question} style={styles.questionCard}>
                  <Text style={styles.questionHeader}>{question.header}</Text>
                  <Text style={styles.questionText}>{question.question}</Text>
                  <Text style={styles.questionHint}>
                    {question.multiSelect ? "Select all that apply" : "Select one"}
                  </Text>
                  <View style={styles.questionOptions}>
                    {question.options.map((option) => {
                      const active = selectedAnswers.includes(option.label);
                      return (
                        <Pressable
                          key={option.label}
                          onPress={() =>
                            setQuestionnaireAnswer(
                              question.question,
                              option.label,
                              question.multiSelect,
                            )
                          }
                          style={[
                            styles.optionButton,
                            active ? styles.optionButtonActive : null,
                          ]}
                        >
                          <View
                            style={[
                              styles.optionMarker,
                              question.multiSelect ? styles.optionMarkerMulti : null,
                              active ? styles.optionMarkerActive : null,
                            ]}
                          >
                            {active ? <View style={styles.optionMarkerDot} /> : null}
                          </View>
                          <Text
                            style={[
                              styles.optionLabel,
                              active ? styles.optionLabelActive : null,
                            ]}
                          >
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}
        {selected.allowFreeformReply ? (
          <TextInput
            multiline
            onChangeText={setReply}
            placeholder="Optional message"
            style={styles.reply}
            value={reply}
          />
        ) : null}
      </ScrollView>

      {encryptedLocked ? (
        <View style={styles.encryptedActions}>
          <View style={styles.encryptedActionPanel}>
            <Text style={styles.actionHint}>Decrypt this request before approving or rejecting it.</Text>
            <Pressable onPress={() => onRespond(selected, dismissChoice)} style={[styles.choiceButton, styles.denyButton]}>
              <Text style={styles.choiceText}>Dismiss encrypted request</Text>
            </Pressable>
            {onOpenSettings ? (
              <Pressable onPress={onOpenSettings} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Add E2EE Key in Settings</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
        {isQuestionnaireRequest(selected) ? (
          <Pressable
            disabled={!questionnaireReady(selected, questionnaireAnswers)}
            onPress={() => onSubmitQuestionnaire(selected)}
            style={[
              styles.choiceButton,
              styles.submitButton,
              !questionnaireReady(selected, questionnaireAnswers)
                ? styles.choiceButtonDisabled
                : null,
            ]}
          >
            <Text style={styles.choiceText}>Submit Answers</Text>
          </Pressable>
        ) : canRespond ? (
          (selected.choices ?? []).map((choice, index) => (
            <Pressable
              key={`${choice.id}:${index}`}
              onPress={() => onRespond(selected, choice)}
              style={[
                styles.choiceButton,
                choice.kind === "approve" ? styles.approveButton : null,
                choice.kind === "deny" ? styles.denyButton : null,
              ]}
            >
              <Text style={styles.choiceText}>{choice.label}</Text>
            </Pressable>
          ))
        ) : (
          <Text style={styles.actionHint}>
            {policyProgressMessage(selected) || "This request is read-only."}
          </Text>
        )}
        </View>
      )}
    </View>
  );
}

function encryptedDismissChoice(request: ApprovalRequest): Choice {
  return (request.choices ?? []).find((choice) => choice.kind === "deny" || choice.id === "reject" || choice.id === "deny") ?? { id: "reject", label: "Dismiss", kind: "deny" };
}

function encryptedLockMessage(request: ApprovalRequest, key?: string) {
  if (!request.encryptedPayload) return "Encrypted request metadata is present, but this server response did not include ciphertext. Refresh after the server is upgraded, or ask the requester to resend.";
  if (!key?.trim()) return "Encrypted request. Add your E2EE key in Settings to decrypt.";
  return "Encrypted request. The configured E2EE key could not decrypt this request.";
}

function decryptedApprovalPlaintext(request: ApprovalRequest, key?: string) {
  if (!request.encryptedPayload || !key?.trim()) return null;
  try {
    return decryptApprovalPayload(request.encryptedPayload, key);
  } catch {
    return null;
  }
}

function RequestContextPanel({ request }: { request: ApprovalRequest }) {
  const team = requestTargetTeamLabel(request);
  const owner = requestOwnerLabel(request);
  const policy = requestPolicySummary(request);
  return (
    <View style={styles.contextSummaryPanel}>
      <Text style={styles.contextSummaryTitle}>Routing</Text>
      <ContextRow label="Agent" value={requestAgentLabel(request)} />
      <ContextRow label="Requester" value={requestRequesterLabel(request)} />
      <ContextRow label="Project" value={requestProjectLabel(request)} />
      {owner ? <ContextRow label="Owner" value={owner} /> : null}
      {team ? <ContextRow label="Team" value={team} /> : null}
      {policy ? <ContextRow label="Policy" value={policy} /> : null}
    </View>
  );
}

function PolicyProgressPanel({ request }: { request: ApprovalRequest }) {
  const progress = request.policyProgress;
  const message = policyProgressMessage(request);
  const votes = requestVoteHistory(request);
  if (!progress && votes.length === 0) {
    return null;
  }
  return (
    <View style={styles.policyPanel}>
      <Text style={styles.policyTitle}>Approval progress</Text>
      {message ? <Text style={styles.policyMessage}>{message}</Text> : null}
      {progress ? (
        <Text style={styles.policyMeta}>
          {progress.receivedApprovals}/{progress.requiredApprovals} approvals · step {progress.currentStep}/{progress.totalSteps}
        </Text>
      ) : null}
      {votes.length > 0 ? (
        <View style={styles.voteList}>
          {votes.map((vote) => (
            <View key={vote.id} style={styles.voteRow}>
              <Text style={styles.voteText}>{vote.label}</Text>
              {vote.message ? <Text style={styles.voteMessage}>{vote.message}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.contextSummaryRow}>
      <Text style={styles.contextSummaryLabel}>{label}</Text>
      <Text selectable style={styles.contextSummaryValue}>{value}</Text>
    </View>
  );
}

export function HistoryScreen({
  e2eeKey,
  error,
  history,
  loading,
  onRefresh,
}: {
  e2eeKey?: string;
  error: string | null;
  history: ApprovalRequest[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [selectedHistoryID, setSelectedHistoryID] = useState<string | null>(null);
  const selectedHistoryIndex = history.findIndex((request) => request.id === selectedHistoryID);
  const selectedHistory = selectedHistoryIndex >= 0 ? history[selectedHistoryIndex] : undefined;
  const previousHistory = selectedHistoryIndex > 0 ? history[selectedHistoryIndex - 1] : undefined;
  const nextHistory = selectedHistoryIndex >= 0 && selectedHistoryIndex < history.length - 1 ? history[selectedHistoryIndex + 1] : undefined;

  if (selectedHistory) {
    return (
      <HistoryDetailScreen
        e2eeKey={e2eeKey}
        onBack={() => setSelectedHistoryID(null)}
        onNext={nextHistory ? () => setSelectedHistoryID(nextHistory.id) : undefined}
        onPrevious={previousHistory ? () => setSelectedHistoryID(previousHistory.id) : undefined}
        request={selectedHistory}
      />
    );
  }

  return (
    <View style={styles.historyPane}>
      <View style={styles.historyHeader}>
        <Text style={styles.sectionHeading}>History</Text>
        <Pressable onPress={onRefresh} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>{loading ? "..." : "Refresh"}</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <ScrollView contentContainerStyle={styles.historyList}>
        {history.length === 0 ? (
          <Text style={styles.emptyText}>No approval history yet.</Text>
        ) : (
          history.map((request) => (
            <Pressable
              accessibilityLabel={`Open history item ${request.title}`}
              accessibilityRole="button"
              key={request.id}
              onPress={() => setSelectedHistoryID(request.id)}
              style={styles.historyRow}
            >
              <View style={styles.historyRowTop}>
                <Text numberOfLines={2} style={styles.historyTitle}>
                  {request.title}
                </Text>
                <Text
                  style={[
                    styles.historyStatus,
                    requestStatusLabel(request) === "approve"
                      ? styles.historyStatusApprove
                      : null,
                    requestStatusLabel(request) === "deny"
                      ? styles.historyStatusDeny
                      : null,
                  ]}
                >
                  {requestStatusLabel(request)}
                </Text>
              </View>
              <Text numberOfLines={1} style={styles.historyMeta}>
                {historyKindLabel(request)} · {request.requester.host || request.requester.name || "Agent"} · Tap for details
              </Text>
              {request.command ? (
                <View style={styles.historyCommandPanel}>
                  {requestCommandDetails(request).slice(0, 2).map((detail) => (
                    <View key={detail.label} style={styles.historyCommandRow}>
                      <Text style={styles.historyCommandLabel}>{detail.label}</Text>
                      <Text selectable numberOfLines={detail.label === "Command" ? 3 : 1} style={styles.historyCommandValue}>
                        {detail.value}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {requestVoteHistory(request).length > 0 ? (
                <View style={styles.historyVotes}>
                  {requestVoteHistory(request).slice(0, 2).map((vote) => (
                    <Text key={vote.id} style={styles.historyVoteText}>
                      {vote.label}
                    </Text>
                  ))}
                </View>
              ) : null}
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function HistoryDetailScreen({
  e2eeKey,
  onBack,
  onNext,
  onPrevious,
  request,
}: {
  e2eeKey?: string;
  onBack: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  request: ApprovalRequest;
}) {
  const decrypted = decryptedApprovalPlaintext(request, e2eeKey);
  const encryptedLocked = isEncryptedApprovalRequest(request) && !decrypted;
  const title = decrypted?.title ?? request.title;
  const body = decrypted?.body ?? request.body;
  const command = decrypted?.command ?? request.command;
  const responseAnswers = request.response?.answers ?? request.policyProgress?.currentUserVote?.answers;

  return (
    <View style={styles.historyPane}>
      <View style={styles.historyHeader}>
        <Pressable accessibilityLabel="Back to history" onPress={onBack} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>Back</Text>
        </Pressable>
        <Text style={styles.historyStatus}>{requestStatusLabel(request)}</Text>
      </View>
      <View style={styles.historyDetailNav}>
        <Pressable
          accessibilityLabel="Previous history item"
          accessibilityRole="button"
          disabled={!onPrevious}
          onPress={onPrevious}
          style={[styles.historyNavButton, !onPrevious ? styles.historyNavButtonDisabled : null]}
        >
          <Text style={[styles.historyNavButtonText, !onPrevious ? styles.historyNavButtonTextDisabled : null]}>‹ Previous</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Next history item"
          accessibilityRole="button"
          disabled={!onNext}
          onPress={onNext}
          style={[styles.historyNavButton, !onNext ? styles.historyNavButtonDisabled : null]}
        >
          <Text style={[styles.historyNavButtonText, !onNext ? styles.historyNavButtonTextDisabled : null]}>Next ›</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.historyDetailContent}>
        <Text style={styles.historyDetailType}>{historyKindLabel(request)}</Text>
        <Text selectable style={styles.detailTitle}>{title}</Text>
        <Text style={styles.detailMeta}>
          {requestRequesterLabel(request)} · {formatRequestTime(request.createdAt)}
        </Text>
        {encryptedLocked ? <Text style={styles.errorText}>{encryptedLockMessage(request, e2eeKey)}</Text> : null}
        {!encryptedLocked && body ? <Text selectable style={styles.bodyText}>{body}</Text> : null}
        {!encryptedLocked && command ? (
          <Text selectable style={styles.commandText}>{command}</Text>
        ) : null}
        <RequestContextPanel request={request} />
        <PolicyProgressPanel request={request} />
        {request.questions && request.questions.length > 0 ? (
          <View style={styles.questionnairePanel}>
            <Text style={styles.contextSummaryTitle}>Questions</Text>
            {request.questions.map((question) => (
              <View key={question.question} style={styles.questionCard}>
                <Text style={styles.questionHeader}>{question.header}</Text>
                <Text selectable style={styles.questionText}>{question.question}</Text>
                {(responseAnswers?.[question.question] ?? []).length ? (
                  <Text selectable style={styles.historyAnswerText}>
                    Answer: {(responseAnswers?.[question.question] ?? []).join(", ")}
                  </Text>
                ) : null}
                <Text style={styles.questionHint}>
                  Options: {question.options.map((option) => option.label).join(", ")}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {request.response?.message ? (
          <View style={styles.contextPanel}>
            <Text style={styles.contextTitle}>Response message</Text>
            <Text selectable style={styles.contextText}>{request.response.message}</Text>
          </View>
        ) : null}
        {request.metadata?.context ? (
          <View style={styles.contextPanel}>
            <Text style={styles.contextTitle}>{request.metadata.contextFile || "Context"}</Text>
            <Text selectable style={styles.contextText}>{request.metadata.context}</Text>
          </View>
        ) : null}
        <View style={styles.historyCommandPanel}>
          {requestCommandDetails(request).map((detail) => (
            <View key={detail.label} style={styles.historyCommandRow}>
              <Text style={styles.historyCommandLabel}>{detail.label}</Text>
              <Text selectable style={styles.historyCommandValue}>{detail.value}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function historyKindLabel(request: ApprovalRequest) {
  if (isQuestionnaireRequest(request)) return "Question";
  if (request.requestType === "steer") return "Steering";
  return "Approval request";
}

function ScannerScreen({
  cameraPermission,
  onCancel,
  onRequestPermission,
  onScan,
  scanning,
}: {
  cameraPermission: ReturnType<typeof useCameraPermissions>[0];
  onCancel: () => void;
  onRequestPermission: () => void;
  onScan: (result: BarcodeScanningResult) => void;
  scanning: boolean;
}) {
  if (!cameraPermission?.granted) {
    return (
      <View style={styles.waitingPane}>
        <Text style={styles.waitingTitle}>Camera Access</Text>
        <Pressable onPress={onRequestPermission} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Enable Camera</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.scannerPane}>
      <CameraView
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={scanning ? undefined : onScan}
        style={styles.scanner}
      />
      <View style={styles.scannerFooter}>
        <Pressable onPress={onCancel} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: "#f7f2e8",
    paddingTop: Constants.statusBarHeight,
  },
  emptyState: {
    alignItems: "stretch",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#202124",
    fontSize: 28,
    fontWeight: "900",
    textAlign: "center",
  },
  subtitle: {
    color: "#6d6657",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
    marginBottom: 8,
    textAlign: "center",
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    color: "#202124",
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  hostedOnboarding: {
    gap: 14,
    padding: 24,
  },
  fieldGroup: {
    gap: 8,
    marginTop: 12,
  },
  label: {
    color: "#545044",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
  },
  brand: {
    color: "#202124",
    fontSize: 28,
    fontWeight: "800",
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "#202124",
    borderRadius: 8,
    height: 46,
    justifyContent: "center",
    minWidth: 64,
    paddingHorizontal: 12,
    position: "relative",
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },
  menuIconText: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 28,
  },
  headerBadge: {
    alignItems: "center",
    backgroundColor: "#d97706",
    borderColor: "#f7f2e8",
    borderRadius: 12,
    borderWidth: 2,
    height: 24,
    justifyContent: "center",
    minWidth: 24,
    paddingHorizontal: 6,
    position: "absolute",
    right: -8,
    top: -8,
    zIndex: 2,
  },
  headerBadgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "900",
    includeFontPadding: false,
    lineHeight: 13,
    textAlign: "center",
  },
  menuOverlay: {
    flex: 1,
  },
  menuBackdrop: {
    backgroundColor: "rgba(32, 33, 36, 0.38)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  menuBackdropPressable: {
    flex: 1,
  },
  sideMenu: {
    backgroundColor: "#f7f2e8",
    borderLeftColor: "#ded6c6",
    borderLeftWidth: 1,
    bottom: 0,
    maxWidth: 360,
    paddingBottom: 20,
    paddingHorizontal: 18,
    paddingTop: Constants.statusBarHeight + 18,
    position: "absolute",
    right: 0,
    top: 0,
    width: "82%",
  },
  sideMenuHeader: {
    gap: 14,
  },
  sideMenuTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sideMenuTitle: {
    color: "#202124",
    fontSize: 26,
    fontWeight: "900",
  },
  closeButton: {
    alignItems: "center",
    borderColor: "#202124",
    borderRadius: 10,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  closeButtonText: {
    color: "#202124",
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 30,
  },
  accountsSection: {
    backgroundColor: "#efe8da",
    borderColor: "#ded6c6",
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    marginTop: 18,
    padding: 10,
  },
  accountsList: {
    gap: 6,
  },
  menuSectionLabel: {
    color: "#7a725f",
    fontSize: 12,
    fontWeight: "900",
    paddingHorizontal: 4,
    textTransform: "uppercase",
  },
  accountMenuItem: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#ded6c6",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 62,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  accountMenuItemActive: {
    borderColor: "#202124",
    borderWidth: 2,
  },
  accountColorDot: {
    borderRadius: 7,
    height: 14,
    width: 14,
  },
  accountMenuTextWrap: {
    flex: 1,
  },
  accountMenuTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  accountMenuName: {
    color: "#202124",
    flex: 1,
    fontSize: 15,
    fontWeight: "900",
  },
  currentAccountPill: {
    backgroundColor: "#202124",
    borderRadius: 8,
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 2,
    textTransform: "uppercase",
  },
  accountMenuMeta: {
    color: "#6d6657",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  accountMenuStatus: {
    color: "#7a725f",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  accountPendingBadge: {
    alignItems: "center",
    backgroundColor: "#d97706",
    borderRadius: 12,
    justifyContent: "center",
    minWidth: 24,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  accountPendingBadgeText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },
  menuItems: {
    gap: 8,
    marginTop: 22,
  },
  menuItem: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#ded6c6",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  menuItemActive: {
    backgroundColor: "#202124",
    borderColor: "#202124",
  },
  menuItemIcon: {
    color: "#202124",
    fontSize: 20,
    fontWeight: "900",
    width: 26,
  },
  menuItemText: {
    color: "#202124",
    fontSize: 16,
    fontWeight: "900",
  },
  menuItemTextActive: {
    color: "#ffffff",
  },
  sideMenuFooter: {
    borderTopColor: "#ded6c6",
    borderTopWidth: 1,
    marginTop: "auto",
    paddingTop: 14,
  },
  serverLabel: {
    color: "#6d6657",
    fontSize: 12,
    fontWeight: "700",
  },
  scannerPane: {
    flex: 1,
  },
  scanner: {
    flex: 1,
  },
  scannerFooter: {
    backgroundColor: "#f7f2e8",
    padding: 20,
  },
  iconButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  waitingPane: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  waitingTitle: {
    color: "#202124",
    fontSize: 28,
    fontWeight: "800",
    marginTop: 12,
  },
  approvalsPane: {
    flex: 1,
  },
  historyPane: {
    flex: 1,
    paddingHorizontal: 20,
  },
  historyHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sectionHeading: {
    color: "#202124",
    fontSize: 24,
    fontWeight: "900",
  },
  smallButton: {
    alignItems: "center",
    borderColor: "#202124",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
    minWidth: 88,
    paddingHorizontal: 12,
  },
  smallButtonText: {
    color: "#202124",
    fontSize: 14,
    fontWeight: "900",
  },
  historyList: {
    gap: 10,
    paddingBottom: 22,
  },
  historyDetailContent: {
    paddingBottom: 24,
  },
  historyDetailType: {
    color: "#6d6657",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  historyDetailNav: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  historyNavButton: {
    alignItems: "center",
    backgroundColor: "#202124",
    borderRadius: 8,
    flex: 1,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  historyNavButtonDisabled: {
    backgroundColor: "#e3dbc9",
  },
  historyNavButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  historyNavButtonTextDisabled: {
    color: "#8e8778",
  },
  historyRow: {
    backgroundColor: "#ffffff",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  historyRowTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  historyTitle: {
    color: "#202124",
    flex: 1,
    fontSize: 16,
    fontWeight: "900",
  },
  historyStatus: {
    color: "#5f5a4f",
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  historyStatusApprove: {
    color: "#1f6f5b",
  },
  historyStatusDeny: {
    color: "#a33b2f",
  },
  historyMeta: {
    color: "#6d6657",
    fontSize: 13,
    fontWeight: "700",
  },
  historyCommandPanel: {
    backgroundColor: "#f7f1e4",
    borderColor: "#e3dbc9",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 10,
  },
  historyCommandRow: {
    gap: 3,
  },
  historyCommandLabel: {
    color: "#6d6657",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  historyCommandValue: {
    color: "#202124",
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 19,
  },
  historyVotes: {
    borderTopColor: "#e3dbc9",
    borderTopWidth: 1,
    gap: 4,
    marginTop: 4,
    paddingTop: 8,
  },
  historyVoteText: {
    color: "#5f5a4f",
    fontSize: 12,
    fontWeight: "800",
  },
  emptyText: {
    color: "#6d6657",
    paddingVertical: 16,
    textAlign: "center",
  },
  requestStrip: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  requestPill: {
    backgroundColor: "#ffffff",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 160,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  requestPillActive: {
    borderColor: "#1f6f5b",
  },
  requestPillText: {
    color: "#202124",
    fontSize: 13,
    fontWeight: "800",
  },
  approvalScroll: {
    flex: 1,
  },
  approvalContent: {
    paddingHorizontal: 20,
    paddingBottom: 22,
  },
  statusCard: {
    backgroundColor: "#edf7f3",
    borderColor: "#b8dacd",
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
    marginBottom: 16,
    padding: 12,
  },
  statusCardCompact: {
    marginTop: 18,
    maxWidth: 360,
    width: "100%",
  },
  statusCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statusLabel: {
    color: "#184f42",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  statusHeaderActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  statusDismiss: {
    color: "#6d6657",
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 24,
  },
  statusState: {
    color: "#1f6f5b",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  statusMessage: {
    color: "#202124",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 22,
  },
  statusNext: {
    color: "#375f52",
    fontSize: 14,
    fontWeight: "700",
  },
  statusMeta: {
    color: "#5f5a4f",
    fontSize: 12,
    fontWeight: "700",
  },
  detailTitle: {
    color: "#202124",
    fontSize: 30,
    fontWeight: "900",
    lineHeight: 36,
  },
  detailMeta: {
    color: "#6d6657",
    fontSize: 15,
    fontWeight: "700",
    marginTop: 8,
  },
  responsibilityBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#edf7f3",
    borderColor: "#1f6f5b",
    borderRadius: 999,
    borderWidth: 1,
    color: "#184f42",
    fontSize: 13,
    fontWeight: "900",
    marginTop: 12,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  detailFacts: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  riskBadge: {
    borderRadius: 8,
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
    textTransform: "uppercase",
  },
  riskHigh: {
    backgroundColor: "#a33b2f",
  },
  riskMedium: {
    backgroundColor: "#8a681f",
  },
  riskLow: {
    backgroundColor: "#1f6f5b",
  },
  factText: {
    color: "#5f5a4f",
    fontSize: 14,
    fontWeight: "800",
  },
  cwdText: {
    color: "#6d6657",
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 12,
  },
  bodyText: {
    color: "#202124",
    fontSize: 17,
    lineHeight: 25,
    marginTop: 22,
  },
  commandText: {
    backgroundColor: "#202124",
    borderRadius: 8,
    color: "#f8f5ed",
    fontFamily: "monospace",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 18,
    padding: 14,
  },
  contextSummaryPanel: {
    backgroundColor: "#ffffff",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    marginTop: 16,
    padding: 12,
  },
  contextSummaryTitle: {
    color: "#545044",
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  contextSummaryRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  contextSummaryLabel: {
    color: "#6d6657",
    fontSize: 13,
    fontWeight: "900",
    minWidth: 78,
  },
  contextSummaryValue: {
    color: "#202124",
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "right",
  },
  policyPanel: {
    backgroundColor: "#fffaf0",
    borderColor: "#d8c391",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    marginTop: 14,
    padding: 12,
  },
  policyTitle: {
    color: "#5f4724",
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  policyMessage: {
    color: "#202124",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 22,
  },
  policyMeta: {
    color: "#6d6657",
    fontSize: 13,
    fontWeight: "800",
  },
  voteList: {
    gap: 6,
    marginTop: 2,
  },
  voteRow: {
    backgroundColor: "#ffffff",
    borderRadius: 6,
    padding: 8,
  },
  voteText: {
    color: "#202124",
    fontSize: 13,
    fontWeight: "800",
  },
  voteMessage: {
    color: "#6d6657",
    fontSize: 13,
    marginTop: 3,
  },
  contextPanel: {
    backgroundColor: "#ffffff",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 18,
    padding: 12,
  },
  contextTitle: {
    color: "#545044",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 8,
  },
  contextText: {
    color: "#202124",
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 19,
  },
  questionnairePanel: {
    gap: 14,
    marginTop: 18,
  },
  questionCard: {
    backgroundColor: "#ffffff",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  questionHeader: {
    color: "#6d6657",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  questionText: {
    color: "#202124",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 24,
  },
  questionHint: {
    color: "#5f5a4f",
    fontSize: 13,
    fontWeight: "700",
  },
  historyAnswerText: {
    color: "#184f42",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 21,
  },
  questionOptions: {
    gap: 8,
  },
  optionButton: {
    alignItems: "center",
    backgroundColor: "#f8f5ed",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionButtonActive: {
    backgroundColor: "#edf7f3",
    borderColor: "#1f6f5b",
  },
  optionMarker: {
    alignItems: "center",
    borderColor: "#8e8778",
    borderRadius: 999,
    borderWidth: 2,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  optionMarkerMulti: {
    borderRadius: 5,
  },
  optionMarkerActive: {
    borderColor: "#1f6f5b",
  },
  optionMarkerDot: {
    backgroundColor: "#1f6f5b",
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  optionLabel: {
    color: "#202124",
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
  },
  optionLabelActive: {
    color: "#184f42",
  },
  reply: {
    backgroundColor: "#ffffff",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    color: "#202124",
    fontSize: 16,
    marginTop: 18,
    minHeight: 92,
    padding: 12,
    textAlignVertical: "top",
  },
  actions: {
    backgroundColor: "#f7f2e8",
    borderTopColor: "#e3dbc9",
    borderTopWidth: 1,
    gap: 10,
    padding: 20,
  },
  choiceButton: {
    alignItems: "center",
    backgroundColor: "#3c4043",
    borderRadius: 8,
    minHeight: 52,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  approveButton: {
    backgroundColor: "#1f6f5b",
  },
  denyButton: {
    backgroundColor: "#a33b2f",
  },
  submitButton: {
    backgroundColor: "#202124",
  },
  choiceButtonDisabled: {
    backgroundColor: "#8e8778",
  },
  encryptedActions: {
    backgroundColor: "#f7f2e8",
    borderTopColor: "#e3dbc9",
    borderTopWidth: 1,
    padding: 20,
  },
  encryptedActionPanel: {
    gap: 8,
  },
  actionHint: {
    color: "#5f5a4f",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 21,
    textAlign: "center",
  },
  choiceText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "900",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#202124",
    borderRadius: 8,
    minHeight: 52,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#202124",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 20,
    minHeight: 46,
    justifyContent: "center",
    minWidth: 120,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: "#202124",
    fontSize: 15,
    fontWeight: "900",
  },
  errorText: {
    color: "#9b1c1c",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center",
  },
});
