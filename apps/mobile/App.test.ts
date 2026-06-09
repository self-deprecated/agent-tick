import {
  buildQuestionnaireAnswers,
  canRespondToRequest,
  groupRequestsBySource,
  mobileRequestKey,
  mobileRequestMatchesSelection,
  mobileRequestSelectionKey,
  normalizeRequest,
  quorumProgressMessage,
  questionnaireReady,
  requestCommandDetails,
  requestQuorumSummary,
  requestResponsibilityLabel,
  requestStatusLabel,
  requestResponseHistory,
  requestAgentLabel,
  requestRoutingLabel,
  requestOwnerLabel,
  supportsNotificationActions,
  updateQuestionnaireAnswers,
  requestSourceID,
  requestSourceLabel,
  requestRequesterLabel,
  shouldScheduleLocalNotifications,
  shouldSuppressResponseProgress,
} from "./requests";
import {
  billingAccessCheckPending,
  billingAccessGraceWindowActive,
  billingStatusesNativeAppEntitlementGrant,
  bufferedNativeResponseAccess,
  compareAppVersions,
  currentSavedAccounts,
  entitlementStatusCopy,
  formatHostedDate,
  hostedPersonalActive,
  hostedUsageExpiry,
  hostedUsageExpiryWarning,
  localNotificationRequestData,
  mobileUpdateStatus,
  nativeAppEntitlement,
  nativePaywallAutoDisplayKey,
  notificationConnectionID,
  notificationDecision,
  notificationSessionID,
  notificationStatusUpdateID,
  notificationWorkspaceID,
  notificationFallbackState,
  notificationRequestID,
  hostedAccountDeletionLocalCleanup,
  isMobileSessionDetailFresh,
  loadConnectionWorkspaceValues,
  flattenConnectionWorkspaceActivities,
  mobileSessionKey,
  parsePairingPayload,
  parseSessionDeepLinkTarget,
  requestLoadConnectionStatus,
  realtimeErrorDecision,
  responseReadOnlyState,
  resolveConnectionWorkspaceIDs,
  shouldFallbackToBootstrapHistory,
  trialRemainingLabel,
  webActivitySessionURL,
} from "./AppLogic";
import { mobileConnectionCredentialKey, savedMobileAccountID } from "./mobileAuth";

function notificationResponse(actionIdentifier: string, requestID?: unknown, data: Record<string, unknown> = {}) {
  return {
    actionIdentifier,
    notification: {
      request: {
        content: {
          data: { requestID, ...data },
        },
      },
    },
  };
}

describe("mobile account session helpers", () => {
  it("matches only the hosted connection for the signed-out Clerk session", () => {
    const accounts = [
      {
        id: "acct_a",
        serverURL: "https://app.agenttick.sh",
        authProvider: "clerk",
        authScheme: "clerk-bootstrap-mobile-token",
        credentialRef: "agent-tick.mobileConnection.acct_a",
        label: "GitHub account",
        userID: "usr_a",
        email: "a@example.com",
        clerkSessionID: "sess_a",
        createdAt: "2026-05-10T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z",
      },
      {
        id: "acct_b",
        serverURL: "https://app.agenttick.sh",
        authProvider: "clerk",
        authScheme: "clerk-bootstrap-mobile-token",
        credentialRef: "agent-tick.mobileConnection.acct_b",
        label: "Apple account",
        userID: "usr_b",
        email: "b@example.com",
        clerkSessionID: "sess_b",
        createdAt: "2026-05-10T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z",
      },
    ] as const;

    expect(currentSavedAccounts([...accounts], {
      authProvider: "clerk",
      clerkSessionID: "sess_a",
      currentAccountProfile: { userId: "usr_a", email: "a@example.com" },
      serverURL: "https://app.agenttick.sh/",
    }).map((account) => account.id)).toEqual(["acct_a"]);

    expect(currentSavedAccounts([{ ...accounts[0], id: "legacy_acct_a", clerkSessionID: undefined }], {
      authProvider: "clerk",
      clerkSessionID: "sess_a",
      currentAccountProfile: { userId: "usr_a", email: "a@example.com" },
      serverURL: "https://app.agenttick.sh/",
    }).map((account) => account.id)).toEqual(["legacy_acct_a"]);
  });

  it("removes the active hosted Clerk account after account deletion", () => {
    const sessionScopedID = savedMobileAccountID({ serverURL: "https://app.agenttick.sh", authProvider: "clerk", userID: "usr_a", clerkSessionID: "sess_a" });
    const legacyID = savedMobileAccountID({ serverURL: "https://app.agenttick.sh", authProvider: "clerk", userID: "usr_a" });
    const staleSessionID = savedMobileAccountID({ serverURL: "https://app.agenttick.sh", authProvider: "clerk", userID: "usr_a", clerkSessionID: "sess_old_a" });
    const otherID = savedMobileAccountID({ serverURL: "https://app.agenttick.sh", authProvider: "clerk", userID: "usr_b", clerkSessionID: "sess_b" });
    const sessionCredentialRef = "agent-tick.mobileConnectionCredential.custom-session-a";
    const accounts = [
      {
        id: sessionScopedID,
        serverURL: "https://app.agenttick.sh",
        authProvider: "clerk",
        authScheme: "clerk-bootstrap-mobile-token",
        credentialRef: sessionCredentialRef,
        label: "GitHub account",
        userID: "usr_a",
        email: "a@example.com",
        clerkSessionID: "sess_a",
        createdAt: "2026-05-10T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z",
      },
      {
        id: legacyID,
        serverURL: "https://app.agenttick.sh",
        authProvider: "clerk",
        authScheme: "clerk-bootstrap-mobile-token",
        credentialRef: mobileConnectionCredentialKey(legacyID),
        label: "Legacy account",
        userID: "usr_a",
        email: "a@example.com",
        createdAt: "2026-05-10T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z",
      },
      {
        id: staleSessionID,
        serverURL: "https://app.agenttick.sh",
        authProvider: "clerk",
        authScheme: "clerk-bootstrap-mobile-token",
        credentialRef: mobileConnectionCredentialKey(staleSessionID),
        label: "Old GitHub account",
        userID: "usr_a",
        email: "a@example.com",
        clerkSessionID: "sess_old_a",
        createdAt: "2026-05-10T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z",
      },
      {
        id: otherID,
        serverURL: "https://app.agenttick.sh",
        authProvider: "clerk",
        authScheme: "clerk-bootstrap-mobile-token",
        credentialRef: mobileConnectionCredentialKey(otherID),
        label: "Apple account",
        userID: "usr_b",
        email: "b@example.com",
        clerkSessionID: "sess_b",
        createdAt: "2026-05-10T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z",
      },
    ] as const;

    const cleanup = hostedAccountDeletionLocalCleanup([...accounts], {
      deletedClerkSessionID: "sess_a",
      deletedUserID: "usr_a",
      deletedEmail: "a@example.com",
      serverURL: "https://app.agenttick.sh/",
    });

    expect(cleanup.remainingAccounts.map((account) => account.id)).toEqual([otherID]);
    expect(Array.from(cleanup.removedAccountIDs)).toEqual([sessionScopedID, legacyID, staleSessionID]);
    expect(cleanup.credentialKeys).toEqual(expect.arrayContaining([
      sessionCredentialRef,
      mobileConnectionCredentialKey(sessionScopedID),
      mobileConnectionCredentialKey(legacyID),
      mobileConnectionCredentialKey(staleSessionID),
    ]));
  });
});

describe("mobile update policy", () => {
  it("compares dotted app versions", () => {
    expect(compareAppVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareAppVersions("0.1.1", "0.1.0")).toBe(1);
    expect(compareAppVersions("0.1", "0.1.1")).toBe(-1);
    expect(compareAppVersions("Agent Tick 2.0.0", "1.9.9")).toBe(1);
    expect(compareAppVersions(undefined, "1.0.0")).toBeNull();
  });

  it("requires an update only when the app is below the server minimum", () => {
    expect(mobileUpdateStatus({ minimumSupportedVersion: "0.2.0", updateURL: "https://apps.apple.com/app/id123", message: "Please update." }, "0.1.0")).toEqual({
      supported: false,
      minimumSupportedVersion: "0.2.0",
      currentVersion: "0.1.0",
      updateURL: "https://apps.apple.com/app/id123",
      message: "Please update.",
    });
    expect(mobileUpdateStatus({ minimumSupportedVersion: "0.2.0" }, "0.2.0")).toEqual({ supported: true });
    expect(mobileUpdateStatus(undefined, "0.1.0")).toEqual({ supported: true });
  });
});

describe("request response access state", () => {
  it("does not require personal app entitlement for entitled Shared Workspace Requests", () => {
    expect(responseReadOnlyState({ appResponsesReadOnly: true, hostedRequest: true, hostedResponsesUnlocked: false, sharedWorkspace: true, workspaceResponsesEntitled: true })).toEqual({ appReadOnly: false, hostedReadOnly: false, workspaceReadOnly: false, readOnly: false });
  });

  it("keeps unpaid Shared Workspace Requests read-only even with personal access", () => {
    expect(responseReadOnlyState({ appResponsesReadOnly: false, hostedRequest: true, hostedResponsesUnlocked: true, sharedWorkspace: true, workspaceResponsesEntitled: false })).toEqual({ appReadOnly: false, hostedReadOnly: false, workspaceReadOnly: true, readOnly: true });
  });

  it("keeps personal hosted Requests read-only without hosted access", () => {
    expect(responseReadOnlyState({ appResponsesReadOnly: true, hostedRequest: true, hostedResponsesUnlocked: false, sharedWorkspace: false, workspaceResponsesEntitled: false })).toEqual({ appReadOnly: true, hostedReadOnly: true, workspaceReadOnly: false, readOnly: true });
  });

  it("never blocks Test Request responses on app or workspace entitlement", () => {
    expect(responseReadOnlyState({ appResponsesReadOnly: true, hostedRequest: true, hostedResponsesUnlocked: false, sharedWorkspace: true, workspaceResponsesEntitled: false, requestIsTest: true })).toEqual({ appReadOnly: false, hostedReadOnly: false, workspaceReadOnly: false, readOnly: false });
  });

  it("lets the first real personal Request answer before locking later responses behind App access", () => {
    expect(responseReadOnlyState({ appResponsesReadOnly: true, hostedRequest: true, hostedResponsesUnlocked: false, sharedWorkspace: false, workspaceResponsesEntitled: false, firstRealResponseBeforePaywallAllowed: true })).toEqual({ appReadOnly: false, hostedReadOnly: false, workspaceReadOnly: false, readOnly: false });
  });

  it("keeps responses available while startup billing is still inside the grace window", () => {
    const entitlement = nativeAppEntitlement({ now: new Date("2026-05-09T00:00:00.000Z") });
    const access = bufferedNativeResponseAccess({ nativeEntitlement: entitlement, billingAccessGraceActive: true });
    expect(access).toEqual({ appResponsesReadOnly: false, hostedResponsesUnlocked: true });
    expect(responseReadOnlyState({ appResponsesReadOnly: access.appResponsesReadOnly, hostedRequest: true, hostedResponsesUnlocked: access.hostedResponsesUnlocked, sharedWorkspace: false, workspaceResponsesEntitled: false })).toEqual({ appReadOnly: false, hostedReadOnly: false, workspaceReadOnly: false, readOnly: false });
  });

  it("ends the startup billing grace when billing settles or the timeout elapses", () => {
    expect(billingAccessGraceWindowActive({ billingCheckPending: true, graceStartedAtMs: 1_000, nowMs: 5_999 })).toBe(true);
    expect(billingAccessGraceWindowActive({ billingCheckPending: false, graceStartedAtMs: 1_000, nowMs: 2_000 })).toBe(false);
    expect(billingAccessGraceWindowActive({ billingCheckPending: true, graceStartedAtMs: 1_000, nowMs: 6_000 })).toBe(false);
  });

  it("does not auto-open the paywall before a brand-new user reaches a real Request", () => {
    const entitlement = nativeAppEntitlement({ now: new Date("2026-05-09T00:00:00.000Z") });
    expect(nativePaywallAutoDisplayKey({ nativeEntitlement: entitlement, appAccessSettled: false, billingAccessGraceActive: false })).toBe("");
    expect(nativePaywallAutoDisplayKey({ nativeEntitlement: entitlement, appAccessSettled: true, billingAccessGraceActive: true })).toBe("");
    expect(nativePaywallAutoDisplayKey({ nativeEntitlement: entitlement, appAccessSettled: true, billingAccessGraceActive: false })).toBe("");
  });

  it("still auto-opens the paywall after an existing Trial has expired", () => {
    const entitlement = nativeAppEntitlement({ now: new Date("2026-05-20T00:00:00.000Z"), trialStartedAt: "2026-05-01T00:00:00.000Z" });
    expect(nativePaywallAutoDisplayKey({ nativeEntitlement: entitlement, appAccessSettled: true, billingAccessGraceActive: false })).toBe("2026-05-08T00:00:00.000Z");
  });

  it("does not keep a fresh active hosted login in grace waiting on its own saved connection", () => {
    expect(billingAccessCheckPending({
      settingsLoaded: true,
      hasRequestAuth: true,
      personalBillingSettled: true,
      connectedBillingSettled: false,
      connectedBillingAccountCount: 0,
    })).toBe(false);
    expect(billingAccessCheckPending({
      settingsLoaded: true,
      hasRequestAuth: true,
      personalBillingSettled: true,
      connectedBillingSettled: false,
      connectedBillingAccountCount: 1,
    })).toBe(true);
  });
});

describe("native app entitlement", () => {
  it("combines visible billing entitlements across connected accounts", () => {
    const grant = billingStatusesNativeAppEntitlementGrant([
      {
        activeEntitlements: {
          trial7Day: { active: false, purchasedAt: null, expiresAt: null, originPlatform: "unknown" },
          lifetimeUnlock: { active: true, purchasedAt: "2026-05-10T00:00:00.000Z", originPlatform: "ios" },
          hostedPersonal: { active: false, expiresAt: null, willRenew: false, originPlatform: "unknown" },
        },
        entitlement: { appUnlockedAt: "2026-05-10T00:00:00.000Z" },
        hostedPersonal: { lifecycle: "inactive" },
        products: [],
        purchaseAvailability: {},
      } as any,
      {
        activeEntitlements: {
          trial7Day: { active: false, purchasedAt: null, expiresAt: null, originPlatform: "unknown" },
          lifetimeUnlock: { active: false, purchasedAt: null, originPlatform: "unknown" },
          hostedPersonal: { active: true, expiresAt: "2026-06-10T00:00:00.000Z", willRenew: true, originPlatform: "ios" },
        },
        entitlement: { appUnlockedAt: null },
        hostedPersonal: { lifecycle: "active" },
        products: [],
        purchaseAvailability: {},
      } as any,
    ]);

    expect(grant).toMatchObject({ lifetimeUnlocked: true, hostedSubscriptionActive: true });
    expect(nativeAppEntitlement({ now: new Date("2026-05-11T00:00:00.000Z"), ...grant })).toMatchObject({
      readOnly: false,
      lifetimeUnlocked: true,
      hostedSubscriptionActive: true,
      hostedResponsesUnlocked: true,
    });
  });

  it("does not start a local trial on first open", () => {
    const state = nativeAppEntitlement({ now: new Date("2026-05-01T00:00:00.000Z") });
    expect(state.trialActive).toBe(false);
    expect(state.trialPurchased).toBe(false);
    expect(state.readOnly).toBe(true);
    expect(state.trialEndsAt).toBeUndefined();
    expect(trialRemainingLabel(state.trialRemainingMs)).toBe("Trial ended");
  });

  it("unlocks responses for seven days from the App Store trial transaction", () => {
    const state = nativeAppEntitlement({
      now: new Date("2026-05-02T00:00:00.000Z"),
      trialStartedAt: "2026-05-01T00:00:00.000Z",
    });
    expect(state.trialActive).toBe(true);
    expect(state.readOnly).toBe(false);
    expect(state.trialEndsAt).toBe("2026-05-08T00:00:00.000Z");
    expect(trialRemainingLabel(state.trialRemainingMs)).toBe("6 days left in trial");
  });

  it("makes the app read-only after trial without a paid entitlement", () => {
    const state = nativeAppEntitlement({
      now: new Date("2026-05-09T00:00:00.000Z"),
      trialStartedAt: "2026-05-01T00:00:00.000Z",
    });
    expect(state.trialActive).toBe(false);
    expect(state.readOnly).toBe(true);
  });

  it("keeps self-host app use unlocked after lifetime purchase", () => {
    const state = nativeAppEntitlement({
      now: new Date("2026-05-09T00:00:00.000Z"),
      lifetimeUnlocked: true,
    });
    expect(state.readOnly).toBe(false);
    expect(state.selfHostedResponsesUnlocked).toBe(true);
    expect(state.hostedResponsesUnlocked).toBe(false);
  });

  it("keeps hosted and self-hosted responses unlocked when a lifetime purchase overlaps an active trial", () => {
    const state = nativeAppEntitlement({
      now: new Date("2026-05-06T00:00:00.000Z"),
      trialStartedAt: "2026-05-01T00:00:00.000Z",
      lifetimeUnlocked: true,
    });
    expect(state.trialActive).toBe(true);
    expect(state.lifetimeUnlocked).toBe(true);
    expect(state.readOnly).toBe(false);
    expect(state.selfHostedResponsesUnlocked).toBe(true);
    expect(state.hostedResponsesUnlocked).toBe(true);
    expect(hostedPersonalActive(state)).toBe(true);
  });

  it("falls back to self-hosted lifetime access after an overlapping trial ends", () => {
    const state = nativeAppEntitlement({
      now: new Date("2026-05-09T00:00:00.000Z"),
      trialStartedAt: "2026-05-01T00:00:00.000Z",
      lifetimeUnlocked: true,
    });
    expect(state.trialActive).toBe(false);
    expect(state.lifetimeUnlocked).toBe(true);
    expect(state.readOnly).toBe(false);
    expect(state.selfHostedResponsesUnlocked).toBe(true);
    expect(state.hostedResponsesUnlocked).toBe(false);
  });

  it("lets a hosted subscription unlock hosted and self-hosted responses without lifetime", () => {
    const state = nativeAppEntitlement({
      now: new Date("2026-05-09T00:00:00.000Z"),
      hostedSubscriptionActive: true,
    });
    expect(state.hostedSubscriptionActive).toBe(true);
    expect(hostedPersonalActive(state)).toBe(true);
    expect(state.readOnly).toBe(false);
    expect(entitlementStatusCopy(state)).toMatchObject({
      title: "Hosted service active",
      appAccess: "You can respond to hosted and self-hosted Requests while the subscription is active.",
    });
  });

  it("provides clear app access and paywall copy", () => {
    const trial = nativeAppEntitlement({ now: new Date("2026-05-02T00:00:00.000Z"), trialStartedAt: "2026-05-01T00:00:00.000Z" });
    expect(entitlementStatusCopy(trial)).toMatchObject({
      title: "7-day Trial active",
      summary: "6 days left in trial",
      paywall: "Subscribe to Hosted service or buy Self-hosted Lifetime before the trial ends to keep responding.",
    });

    const readOnly = nativeAppEntitlement({ now: new Date("2026-05-09T00:00:00.000Z"), trialStartedAt: "2026-05-01T00:00:00.000Z" });
    expect(entitlementStatusCopy(readOnly)).toMatchObject({
      title: "Read-only after Trial",
      appAccess: "Responses require an active 7-day Trial, Hosted subscription, or Self-hosted Lifetime unlock.",
    });

    const subscribed = nativeAppEntitlement({
      now: new Date("2026-05-20T00:00:00.000Z"),
      lifetimeUnlocked: true,
      hostedSubscriptionActive: true,
    });
    expect(entitlementStatusCopy(subscribed)).toMatchObject({
      title: "Hosted service active",
      hostedAccess: "agenttick.sh routing, push, updates, and uptime are covered by your hosted subscription.",
    });
  });
});

describe("hosted usage expiry", () => {
  it("reports trial expiry and warns inside one week without renewal", () => {
    const status = {
      hostedPersonal: {
        lifecycle: "active",
        trialEndsAt: "2026-05-08T00:00:00.000Z",
        responsesEnabled: true,
        routingEnabled: true,
        pushEnabled: true,
        historyRetentionDays: 30,
      },
      activeEntitlements: {
        trial7Day: { active: true, purchasedAt: "2026-05-01T00:00:00.000Z", expiresAt: "2026-05-08T00:00:00.000Z" },
        lifetimeUnlock: { active: false },
        hostedPersonal: { active: false },
      },
    } as const;

    expect(hostedUsageExpiry(status, new Date("2026-05-02T00:00:00.000Z"))).toMatchObject({ source: "trial", expiresAt: "2026-05-08T00:00:00.000Z", renewable: false });
    expect(hostedUsageExpiryWarning(status, new Date("2026-05-02T00:00:00.000Z"))).toMatchObject({ source: "trial" });
    expect(formatHostedDate("2026-05-08T00:00:00.000Z")).toBe("May 8, 2026");
  });

  it("does not warn when a hosted subscription is set to renew", () => {
    const status = {
      hostedPersonal: {
        lifecycle: "active",
        trialEndsAt: "2026-05-08T00:00:00.000Z",
        hostedSubscriptionEndsAt: "2026-05-20T00:00:00.000Z",
        responsesEnabled: true,
        routingEnabled: true,
        pushEnabled: true,
        historyRetentionDays: 30,
      },
      activeEntitlements: {
        trial7Day: { active: false },
        lifetimeUnlock: { active: true },
        hostedPersonal: { active: true, expiresAt: "2026-05-20T00:00:00.000Z", willRenew: true },
      },
    } as const;

    expect(hostedUsageExpiry(status, new Date("2026-05-15T00:00:00.000Z"))).toMatchObject({ source: "subscription", renewable: true });
    expect(hostedUsageExpiryWarning(status, new Date("2026-05-15T00:00:00.000Z"))).toBeNull();
  });
});

describe("parsePairingPayload", () => {
  it("parses Agent Tick QR JSON payloads", () => {
    expect(
      parsePairingPayload(
        JSON.stringify({
          serverURL: "https://tick.example.com",
          pairingCode: "pair_abc123",
        }),
      ),
    ).toEqual({
      serverURL: "https://tick.example.com",
      pairingCode: "pair_abc123",
    });
  });

  it("parses Clerk mode discovery QR payloads", () => {
    expect(
      parsePairingPayload(
        JSON.stringify({
          serverURL: "https://tick.example.com",
          mode: "clerk",
          authProvider: "clerk",
          workspaceId: "org_123",
        }),
      ),
    ).toEqual({
      serverURL: "https://tick.example.com",
      mode: "clerk",
      authProvider: "clerk",
      workspaceId: "org_123",
    });
  });

  it("accepts raw pairing codes", () => {
    expect(parsePairingPayload("pair_abc123")).toEqual({
      pairingCode: "pair_abc123",
    });
  });

  it("parses External Approver invite links", () => {
    expect(parsePairingPayload("https://app.agenttick.sh/external-approver-invites/xinv_abc123")).toEqual({
      serverURL: "https://app.agenttick.sh",
      externalApproverInviteToken: "xinv_abc123",
    });
    expect(parsePairingPayload("agenttick://join-external-approver?token=xinv_abc123")).toEqual({
      externalApproverInviteToken: "xinv_abc123",
    });
  });

  it("parses app deep links for pairing and Clerk workspace join", () => {
    expect(parsePairingPayload("agenttick://pair?token=pair_abc123&serverURL=https%3A%2F%2Ftick.example.com")).toEqual({
      serverURL: "https://tick.example.com",
      pairingCode: "pair_abc123",
    });
    expect(parsePairingPayload("https://app.agenttick.sh/pairing/pair_abc123?workspaceId=wsp_123")).toEqual({
      serverURL: "https://app.agenttick.sh",
      pairingCode: "pair_abc123",
      workspaceId: "wsp_123",
    });
    expect(parsePairingPayload("agenttick://join?serverURL=https%3A%2F%2Ftick.example.com&authProvider=clerk&workspaceId=wsp_123")).toEqual({
      serverURL: "https://tick.example.com",
      authProvider: "clerk",
      workspaceId: "wsp_123",
    });
  });

  it("parses Session deep links separately from pairing payloads", () => {
    expect(parseSessionDeepLinkTarget("agenttick://session/session_abc?requestId=req_123&workspaceId=wsp_1&serverURL=https%3A%2F%2Ftick.example.com")).toEqual({
      serverURL: "https://tick.example.com",
      sessionID: "session_abc",
      requestID: "req_123",
      workspaceID: "wsp_1",
    });
    expect(parseSessionDeepLinkTarget("https://app.agenttick.sh/activity?session=session_abc&statusUpdate=st_1")).toEqual({
      serverURL: "https://app.agenttick.sh",
      sessionID: "session_abc",
      statusUpdateID: "st_1",
    });
    expect(parsePairingPayload("agenttick://session/session_abc?requestId=req_123")).toEqual({});
  });

  it("builds web Activity fallback links with the selected Session", () => {
    expect(webActivitySessionURL("https://app.agenttick.sh/", { sessionID: "session_abc", requestID: "req_123", workspaceID: "wsp_1" })).toBe("https://app.agenttick.sh/activity?session=session_abc&request=req_123&workspaceId=wsp_1");
  });

  it("ignores unrelated QR payloads", () => {
    expect(parsePairingPayload("https://example.com")).toEqual({});
    expect(parseSessionDeepLinkTarget("https://example.com")).toBeNull();
  });
});

describe("notificationDecision", () => {
  it("opens the Request for notification action payloads without responding", () => {
    expect(notificationDecision(notificationResponse("approve", "req_123"))).toEqual({
      kind: "open",
      requestID: "req_123",
    });
    expect(notificationDecision(notificationResponse("deny", "req_123"))).toEqual({
      kind: "open",
      requestID: "req_123",
    });
  });

  it("opens the Request for normal notification taps", () => {
    expect(notificationDecision(notificationResponse("default", "req_123"))).toEqual({
      kind: "open",
      requestID: "req_123",
    });
  });

  it("uses canonical request, connection, workspace, and Session keys for local notification payloads", () => {
    const legacyData = localNotificationRequestData("req_local", "conn_1", "org_1");
    const data = localNotificationRequestData("req_local", "conn_1", "org_1", "session_abc");

    expect(legacyData).toEqual({ requestId: "req_local", connectionID: "conn_1", workspaceID: "org_1" });
    expect(data).toEqual({ requestId: "req_local", connectionID: "conn_1", workspaceID: "org_1", sessionID: "session_abc" });
    expect(notificationRequestID(data)).toBe("req_local");
    expect(notificationConnectionID(data)).toBe("conn_1");
    expect(notificationWorkspaceID(data)).toBe("org_1");
    expect(notificationSessionID(data)).toBe("session_abc");
    expect(
      notificationDecision({
        actionIdentifier: "default",
        notification: { request: { content: { data } } },
      }),
    ).toEqual({ kind: "open-session", requestID: "req_local", sessionID: "session_abc", connectionID: "conn_1", workspaceID: "org_1" });
  });

  it("opens Status Update notifications to the Session without requiring a Request id", () => {
    const data = { sessionId: "session_status", statusUpdateId: "st_123", workspaceId: "wsp_1" };
    expect(notificationSessionID(data)).toBe("session_status");
    expect(notificationStatusUpdateID(data)).toBe("st_123");
    expect(notificationDecision({ actionIdentifier: "default", notification: { request: { content: { data } } } })).toEqual({
      kind: "open-session",
      sessionID: "session_status",
      statusUpdateID: "st_123",
      workspaceID: "wsp_1",
    });
  });

  it("accepts quorum push payloads without Session ids as legacy Request links", () => {
    expect(notificationRequestID({ requestId: "req_step" })).toBe("req_step");
    expect(
      notificationDecision({
        actionIdentifier: "default",
        notification: { request: { content: { data: { requestId: "req_quorum" } } } },
      }),
    ).toEqual({ kind: "open", requestID: "req_quorum" });
  });

  it("ignores malformed native notification payloads", () => {
    expect(notificationRequestID(null)).toBe("");
    expect(notificationRequestID(undefined)).toBe("");
    expect(notificationRequestID("req_123")).toBe("");
    expect(notificationDecision({ actionIdentifier: "default", notification: null })).toBeNull();
    expect(notificationDecision({ actionIdentifier: "approve", notification: { request: { content: { data: null } } } })).toBeNull();
  });

  it("ignores notifications without Request ids", () => {
    expect(notificationDecision(notificationResponse("approve"))).toBeNull();
  });
});

describe("notificationFallbackState", () => {
  it("selects and opens a Request after action response failure", () => {
    expect(notificationFallbackState("req_123")).toEqual({
      notificationTargetID: "req_123",
      selectedID: "req_123",
      screen: "requests",
    });
  });

  it("carries Session targets while retaining compatible Request fallback selection", () => {
    expect(notificationFallbackState("req_123", { sessionID: "session_abc", requestID: "req_123", workspaceID: "wsp_1" })).toEqual({
      notificationTargetID: "req_123",
      selectedID: "req_123",
      screen: "requests",
      sessionTarget: { sessionID: "session_abc", requestID: "req_123", workspaceID: "wsp_1" },
    });
  });
});

const questionnaireRequest = {
  id: "req_questions",
  workspaceId: "wsp_personal",
  requester: { name: "Claude", agentTokenId: "claude-code" },
  requestType: "questionnaire",
  deliveryKind: "routed_members" as const,
  responsePolicy: "quorum" as const,
  title: "Pre-flight questions",
  choices: [],
  questions: [
    {
      header: "Environment",
      question: "Which environment?",
      multiSelect: false,
      options: [{ label: "dev" }, { label: "prod" }],
    },
    {
      header: "Checks",
      question: "Which checks should run?",
      multiSelect: true,
      options: [{ label: "lint" }, { label: "test" }],
    },
  ],
  allowFreeformReply: false,
  status: "pending",
  createdAt: "2026-04-19T12:00:00Z",
};

describe("connection workspace resolution", () => {
  it("uses live workspace memberships for a connection when available", async () => {
    await expect(resolveConnectionWorkspaceIDs(
      { authProvider: "clerk", workspaceID: "old", workspaces: [{ id: "stale", name: "Stale" }] },
      { listWorkspaces: async () => [{ workspaceId: "org_a" }, { id: "org_b" }, { workspaceId: "org_a" }] },
    )).resolves.toEqual(["org_a", "org_b"]);
  });

  it("falls back to saved connection workspace metadata", async () => {
    await expect(resolveConnectionWorkspaceIDs(
      { authProvider: "clerk", workspaceID: "org_saved", workspaces: [{ id: "org_meta", name: "Meta" }] },
      { listWorkspaces: async () => { throw new Error("offline"); } },
    )).resolves.toEqual(["org_meta"]);
  });

  it("falls back to workspace IDs and null when no memberships are known", async () => {
    await expect(resolveConnectionWorkspaceIDs(
      { authProvider: "local", workspaceID: "org_saved", workspaces: [] },
      undefined,
      "org_fallback",
    )).resolves.toEqual(["org_saved"]);
    await expect(resolveConnectionWorkspaceIDs(
      { authProvider: "local", workspaceID: "", workspaces: [] },
      undefined,
      "org_fallback",
    )).resolves.toEqual(["org_fallback"]);
    await expect(resolveConnectionWorkspaceIDs(
      { authProvider: "local", workspaceID: "", workspaces: [] },
    )).resolves.toEqual([null]);
  });

  it("derives request load status from verified fetch success", () => {
    expect(requestLoadConnectionStatus({ successfulConnectionCount: 1, fallbackAttempted: false, fallbackSucceeded: false })).toBe("connected");
    expect(requestLoadConnectionStatus({ successfulConnectionCount: 0, fallbackAttempted: true, fallbackSucceeded: true })).toBe("connected");
    expect(requestLoadConnectionStatus({ successfulConnectionCount: 0, fallbackAttempted: true, fallbackSucceeded: false })).toBe("disconnected");
    expect(requestLoadConnectionStatus({ successfulConnectionCount: 0, fallbackAttempted: false, fallbackSucceeded: false })).toBe("disconnected");
  });

  it("falls back to the bootstrap session when saved connections yield no History results", () => {
    expect(shouldFallbackToBootstrapHistory({
      savedAccountCount: 1,
      connectionHistoryCount: 0,
      connectionResultSummaries: [{ status: "fulfilled", failedCount: 0, valueCount: 0 }],
    })).toBe(true);
    expect(shouldFallbackToBootstrapHistory({
      savedAccountCount: 1,
      connectionHistoryCount: 0,
      connectionResultSummaries: [{ status: "fulfilled", failedCount: 1, valueCount: 0 }],
    })).toBe(false);
    expect(shouldFallbackToBootstrapHistory({
      savedAccountCount: 1,
      connectionHistoryCount: 1,
      connectionResultSummaries: [{ status: "fulfilled", failedCount: 0, valueCount: 1 }],
    })).toBe(false);
  });

  it("classifies realtime auth errors as disabling realtime", () => {
    expect(realtimeErrorDecision(401)).toEqual({ disableRealtime: true, diagnosticMessage: "long_poll_auth_failed" });
    expect(realtimeErrorDecision(403)).toEqual({ disableRealtime: true, diagnosticMessage: "long_poll_auth_failed" });
    expect(realtimeErrorDecision(404)).toEqual({ disableRealtime: true, diagnosticMessage: "long_poll_unavailable" });
    expect(realtimeErrorDecision(500)).toEqual({ disableRealtime: false, diagnosticMessage: "stream_error" });
    expect(realtimeErrorDecision()).toEqual({ disableRealtime: false, diagnosticMessage: "stream_error" });
  });

  it("preserves fetched Session summaries when flattening saved connection workspace values", () => {
    const account = { id: "acct_1", label: "Work", serverURL: "https://tick.example", authProvider: "local" } as const;
    const flattened = flattenConnectionWorkspaceActivities(account, [
      { workspaceID: "wsp_1", value: { activity: [], requests: [], workspaceMemberCount: 2, sessions: [{ sessionId: "session_1", title: "Deploy", state: "needs-input", latestActivity: { kind: "request", id: "req_1", createdAt: "2026-04-19T12:00:00Z", preview: "Approve", requestStatus: "pending" }, pendingRequestCount: 1, sourceLabels: ["Pi"], startedAt: "2026-04-19T12:00:00Z", updatedAt: "2026-04-19T12:00:00Z" }] } },
    ]);

    expect(flattened[0]?.sessions).toEqual([expect.objectContaining({ sessionId: "session_1" })]);
  });

  it("uses composite mobile Session keys for saved connection Sessions", () => {
    expect(mobileSessionKey({ sessionId: "session_same", connectionID: "acct_a", workspaceID: "wsp_1" })).toBe("acct_a:wsp_1:session_same");
    expect(mobileSessionKey({ sessionId: "session_same", connectionID: "acct_b", workspaceID: "wsp_1" })).toBe("acct_b:wsp_1:session_same");
    expect(mobileSessionKey({ sessionId: "session_same" })).toBe("session_same");
  });

  it("treats cached Session detail as stale when the summary latest Activity changes", () => {
    const summary = {
      sessionId: "session_same",
      title: "Run",
      state: "active",
      pendingRequestCount: 0,
      sourceLabels: ["Pi"],
      startedAt: "2026-05-08T00:00:00.000Z",
      updatedAt: "2026-05-08T00:02:00.000Z",
      latestActivity: { id: "st_2", kind: "status_update" as const, preview: "New", createdAt: "2026-05-08T00:02:00.000Z" },
    };
    const staleDetail = {
      summary: { ...summary, updatedAt: "2026-05-08T00:01:00.000Z", latestActivity: { ...summary.latestActivity, id: "st_1", preview: "Old", createdAt: "2026-05-08T00:01:00.000Z" } },
      timeline: [],
    };

    expect(isMobileSessionDetailFresh(summary, staleDetail)).toBe(false);
    expect(isMobileSessionDetailFresh(summary, { ...staleDetail, summary })).toBe(true);
  });

  it("treats cached Session detail as stale when a pending latest Request is resolved locally", () => {
    const pendingSummary = {
      sessionId: "session_same",
      title: "Run",
      state: "needs-input" as const,
      pendingRequestCount: 1,
      pendingRequests: [{ id: "req_1", title: "Choose?", createdAt: "2026-05-08T00:02:00.000Z", status: "pending" as const }],
      sourceLabels: ["Pi"],
      startedAt: "2026-05-08T00:00:00.000Z",
      updatedAt: "2026-05-08T00:02:00.000Z",
      latestActivity: { id: "req_1", kind: "request" as const, preview: "Choose?", createdAt: "2026-05-08T00:02:00.000Z", requestStatus: "pending" as const },
    };
    const resolvedSummary = {
      ...pendingSummary,
      state: "recent" as const,
      pendingRequestCount: 0,
      pendingRequests: undefined,
      latestActivity: { ...pendingSummary.latestActivity, requestStatus: "resolved" as const },
    };
    const staleDetail = { summary: pendingSummary, timeline: [] };

    expect(isMobileSessionDetailFresh(resolvedSummary, staleDetail)).toBe(false);
    expect(isMobileSessionDetailFresh(resolvedSummary, { ...staleDetail, summary: resolvedSummary })).toBe(true);
  });

  it("loads workspace values for success, failure, and empty inputs", async () => {
    await expect(loadConnectionWorkspaceValues(["org_a", "org_b"], async (workspaceID) => [`request:${workspaceID}`])).resolves.toEqual({
      failedCount: 0,
      values: [
        { workspaceID: "org_a", value: ["request:org_a"] },
        { workspaceID: "org_b", value: ["request:org_b"] },
      ],
    });
    await expect(loadConnectionWorkspaceValues(["org_ok", "org_fail"], async (workspaceID) => {
      if (workspaceID === "org_fail") throw new Error("offline");
      return [`request:${workspaceID}`];
    })).resolves.toEqual({
      failedCount: 1,
      values: [{ workspaceID: "org_ok", value: ["request:org_ok"] }],
    });
    await expect(loadConnectionWorkspaceValues(["org_a", "org_b"], async () => { throw new Error("offline"); })).resolves.toEqual({
      failedCount: 2,
      values: [],
    });
    await expect(loadConnectionWorkspaceValues([], async () => "unused")).resolves.toEqual({
      failedCount: 0,
      values: [],
    });
  });
});

describe("source grouping helpers", () => {
  it("groups requests by source context", () => {
    const requests = [
      normalizeRequest({
        id: "req_a",
        requester: { name: "Agent", agentTokenId: "agent", host: "box", workingDirectory: "/work/a", clientName: "Alpha", clientId: "box:/work/a" },
        title: "A",
        choices: [],
        allowFreeformReply: false,
        status: "pending",
        createdAt: "2026-04-19T12:00:00Z",
      }),
      normalizeRequest({
        id: "req_b",
        requester: { name: "Agent", agentTokenId: "agent", host: "box", workingDirectory: "/work/a", clientName: "Alpha", clientId: "box:/work/a" },
        title: "B",
        choices: [],
        allowFreeformReply: false,
        status: "pending",
        createdAt: "2026-04-19T12:00:00Z",
      }),
      normalizeRequest({
        id: "req_c",
        requester: { name: "Agent", agentTokenId: "agent", host: "box", workingDirectory: "/work/c" },
        title: "C",
        choices: [],
        allowFreeformReply: false,
        status: "pending",
        createdAt: "2026-04-19T12:00:00Z",
      }),
    ];

    const [first, second, third] = requests;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();
    expect(requestSourceID(first!)).toBe("box:Alpha");
    expect(requestSourceLabel(third!)).toBe("c");
    expect(groupRequestsBySource(requests)).toEqual([
      { id: "box:Alpha", label: "Alpha", requests: [first!, second!] },
      { id: "box:/work/c", label: "c", requests: [third!] },
    ]);
  });
});

describe("request detail metadata helpers", () => {
  it("builds detailed command history rows", () => {
    const request = normalizeRequest({
      id: "req_cmd",
      requester: {
        name: "agent-tick",
        agentTokenId: "agent",
        host: "lattice",
        workingDirectory: "/work/agent-tick",
        clientName: "agent-tick",
      },
      title: "Run tests?",
      command: "corepack pnpm test -- --runInBand",
      choices: [{ id: "approve", label: "Approve", kind: "approve" }],
      allowFreeformReply: false,
      status: "responded",
      createdAt: "2026-04-19T12:00:00Z",
      respondedAt: "2026-04-19T12:03:00Z",
    });

    expect(requestCommandDetails(request)).toEqual([
      { label: "Command", value: "corepack pnpm test -- --runInBand" },
      { label: "Source", value: "agent-tick" },
      { label: "Directory", value: "/work/agent-tick" },
      { label: "Host", value: "lattice" },
      { label: "Requested", value: "2026-04-19T12:00:00Z" },
      { label: "Responded", value: "2026-04-19T12:03:00Z" },
    ]);
  });

  it("uses product-facing labels instead of raw IDs in normal Request UI helpers", () => {
    const request = normalizeRequest({
      id: "req_labels",
      requester: { name: "Agent", agentTokenId: "agt_secret" },
      title: "Approve?",
      choices: [{ id: "approve", label: "Approve", kind: "approve" }],
      allowFreeformReply: false,
      status: "pending",
      createdAt: "2026-04-19T12:00:00Z",
      metadata: { routingRuleId: "rul_secret", ownerUserId: "usr_secret" },
    });

    expect(requestAgentLabel(request)).toBe("Agent");
    expect(requestRoutingLabel(request)).toBe("Routing Rule");
    expect(requestOwnerLabel(request)).toBe("Workspace Owner");
  });

  it("keeps requester and project context separate to avoid duplicate host text", () => {
    const request = normalizeRequest({
      id: "req_project",
      requester: {
        name: "agent-tick",
        agentTokenId: "agent",
        host: "lattice",
        workingDirectory: "/work/agent-tick",
        clientName: "agent-tick",
      },
      title: "Approve?",
      choices: [{ id: "approve", label: "Approve", kind: "approve" }],
      allowFreeformReply: false,
      status: "pending",
      createdAt: "2026-04-19T12:00:00Z",
    });

    expect(requestRequesterLabel(request)).toBe("agent-tick");
    expect(requestSourceLabel(request)).toBe("agent-tick");
  });
});

describe("quorum progress helpers", () => {
  it("shows current-user quorum waiting state after responding", () => {
    const request = normalizeRequest({
      id: "req_quorum",
      requester: { name: "Agent", agentTokenId: "agent" },
      requestType: "sanction",
      title: "Deploy?",
      choices: [
        { id: "approve", label: "Approve", kind: "approve" },
        { id: "deny", label: "Deny", kind: "deny" },
      ],
      allowFreeformReply: false,
      status: "pending",
      createdAt: "2026-04-19T12:00:00Z",
      metadata: { routingRuleName: "Backend", routingRuleSummary: "Requires 2 responses from Backend" },
      quorum: {
        requiredResponseCount: 2,
        receivedResponseCount: 1,
        currentUserResponded: true,
        currentUserEligible: true,
        currentUserResponse: {
          responseId: "resp_a",
          requestId: "req_quorum",
          userId: "usr_a",
          source: "device",
          choiceId: "approve",
          createdAt: "2026-04-19T12:01:00Z",
        },
        waitingFor: 1,
        responses: [
          {
            responseId: "resp_a",
            requestId: "req_quorum",
            userId: "usr_a",
            source: "device",
            choiceId: "approve",
            createdAt: "2026-04-19T12:01:00Z",
          },
        ],
      },
    });

    expect(requestQuorumSummary(request)).toBe("Requires 2 responses from Backend");
    expect(requestResponsibilityLabel(request)).toBe("Waiting for others");
    expect(quorumProgressMessage(request)).toBe("You responded. Waiting for 1 more response.");
    expect(canRespondToRequest(request)).toBe(false);
    expect(supportsNotificationActions(request)).toBe(false);
    expect(requestResponseHistory(request)[0]?.label).toBe("Member response approved via device");
  });

  it("suppresses redundant response progress for pending one-user workspace Requests", () => {
    const request = normalizeRequest({
      id: "req_one_user",
      workspaceId: "wsp_personal",
      workspaceMemberCount: 1,
      requester: { name: "Agent", agentTokenId: "agent" },
      requestType: "sanction",
      title: "Restart?",
      choices: [
        { id: "approve", label: "Approve", kind: "approve" },
        { id: "deny", label: "Deny", kind: "deny" },
      ],
      allowFreeformReply: false,
      status: "pending",
      createdAt: "2026-04-19T12:00:00Z",
      quorum: {
        requiredResponseCount: 1,
        receivedResponseCount: 0,
        currentUserResponded: false,
        currentUserEligible: true,
        waitingFor: 1,
        recipients: [{ userId: "usr_a", hasActiveDevice: true }],
        responses: [],
      },
    });

    expect(shouldSuppressResponseProgress(request)).toBe(true);
    expect(quorumProgressMessage(request)).toBe("");
    expect(canRespondToRequest(request)).toBe(true);
  });

  it("distinguishes eligible and ineligible routed Request views", () => {
    const eligible = normalizeRequest({
      id: "req_routed",
      requester: { name: "Agent", agentTokenId: "agent" },
      requestType: "sanction",
      title: "Restart?",
      choices: [
        { id: "approve", label: "Approve", kind: "approve" },
        { id: "deny", label: "Deny", kind: "deny" },
      ],
      allowFreeformReply: false,
      status: "pending",
      createdAt: "2026-04-19T12:00:00Z",
      quorum: {
        requiredResponseCount: 1,
        receivedResponseCount: 0,
        currentUserResponded: false,
        currentUserEligible: true,
        waitingFor: 1,
      },
    });
    const ineligible = normalizeRequest({
      ...eligible,
      id: "req_readonly",
      quorum: { ...eligible.quorum!, currentUserEligible: false },
    });

    expect(requestResponsibilityLabel(eligible)).toBe("Your response is needed");
    expect(quorumProgressMessage(eligible)).toBe("");
    expect(canRespondToRequest(eligible)).toBe(true);
    expect(requestResponsibilityLabel(ineligible)).toBe("Read-only");
    expect(quorumProgressMessage(ineligible)).toContain("You are not a routed recipient");
    expect(canRespondToRequest(ineligible)).toBe(false);
  });
});

describe("request normalization and notification helpers", () => {
  it("keys same server request IDs separately per connection", () => {
    const first = normalizeRequest({
      id: "req_shared",
      connectionID: "conn_1",
      requester: { name: "Agent", agentTokenId: "agent" },
      requestType: "sanction",
      title: "First account",
      choices: [{ id: "approve", label: "Approve", kind: "approve" }],
      allowFreeformReply: false,
      status: "pending",
      createdAt: "2026-04-19T12:00:00Z",
    });
    const second = normalizeRequest({ ...first, connectionID: "conn_2", title: "Second account" });

    expect(mobileRequestKey(first)).toBe("conn_1:req_shared");
    expect(mobileRequestKey(second)).toBe("conn_2:req_shared");
    const workspaceScoped = { ...first, workspaceId: "org_1" };
    expect(mobileRequestKey(workspaceScoped)).toBe("conn_1:org_1:req_shared");
    expect(mobileRequestSelectionKey("req_shared", undefined, "org_1")).toBe("workspace:org_1:req_shared");
    expect(mobileRequestMatchesSelection(workspaceScoped, "workspace:org_1:req_shared")).toBe(true);
    expect(mobileRequestMatchesSelection(workspaceScoped, "workspace:org_2:req_shared")).toBe(false);
  });


  it("preserves steering request type and disables notification actions", () => {
    const steer = normalizeRequest({
      id: "req_steer",
      requester: { name: "Agent", agentTokenId: "agent" },
      requestType: "steering",
      title: "Choose next step",
      choices: [
        { id: "run-tests", label: "Run tests", kind: "steer" },
        { id: "none", label: "Do nothing / skip", kind: "none" },
      ],
      allowFreeformReply: false,
      status: "pending",
      createdAt: "2026-04-19T12:00:00Z",
    });

    expect(steer.requestType).toBe("steering");
    expect(supportsNotificationActions(steer)).toBe(false);
  });

  it("disables notification actions for launch", () => {
    expect(
      supportsNotificationActions({
        id: "req_approve",
        workspaceId: "wsp_personal",
        requester: { name: "Agent", agentTokenId: "agent" },
        requestType: "sanction",
        deliveryKind: "routed_members",
        responsePolicy: "quorum",
        title: "Run?",
        choices: [
          { id: "approve", label: "Approve", kind: "approve" },
          { id: "deny", label: "Deny", kind: "deny" },
        ],
        allowFreeformReply: false,
        status: "pending",
        createdAt: "2026-04-19T12:00:00Z",
      }),
    ).toBe(false);
  });

  it("does not schedule local notification copies at launch", () => {
    expect(shouldScheduleLocalNotifications("registered")).toBe(false);
    expect(shouldScheduleLocalNotifications("idle")).toBe(false);
    expect(shouldScheduleLocalNotifications("failed")).toBe(false);
    expect(shouldScheduleLocalNotifications("idle", false)).toBe(false);
  });
});

describe("questionnaire helpers", () => {
  it("keeps only answers that still exist on the request", () => {
    expect(
      buildQuestionnaireAnswers(questionnaireRequest, {
        "Which environment?": ["prod"],
        "Which checks should run?": ["lint", "missing"],
      }),
    ).toEqual({
      "Which environment?": ["prod"],
      "Which checks should run?": ["lint"],
    });
  });

  it("updates single-select and multi-select answers", () => {
    let answers = updateQuestionnaireAnswers({}, "Which environment?", "dev", false);
    answers = updateQuestionnaireAnswers(
      answers,
      "Which checks should run?",
      "lint",
      true,
    );
    answers = updateQuestionnaireAnswers(
      answers,
      "Which checks should run?",
      "test",
      true,
    );
    answers = updateQuestionnaireAnswers(
      answers,
      "Which checks should run?",
      "lint",
      true,
    );

    expect(answers).toEqual({
      "Which environment?": ["dev"],
      "Which checks should run?": ["test"],
    });
  });

  it("knows when a questionnaire is ready and labels answered history rows", () => {
    expect(
      questionnaireReady(questionnaireRequest, {
        "Which environment?": ["prod"],
        "Which checks should run?": ["lint"],
      }),
    ).toBe(true);
    expect(questionnaireReady(questionnaireRequest, {})).toBe(false);
    expect(
      requestStatusLabel({
        ...questionnaireRequest,
        response: { answers: { "Which environment?": ["prod"] } },
      }),
    ).toBe("Responded");
  });
});
