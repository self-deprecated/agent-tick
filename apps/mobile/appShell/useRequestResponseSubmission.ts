import { Alert } from "react-native";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { AgentTickApiError, AgentTickClient } from "@self-deprecated/agent-tick-sdk";
import type { PersonalBillingStatus, RequestRecord } from "@self-deprecated/agent-tick-shared";

import { diagnosticEvents, recordDiagnostic } from "../diagnostics";
import { mobileRequestKey, normalizeRequest, type MobileRequest, type RequestChoice as Choice } from "../requests";
import { updateSessionDetailsRequest } from "../sessions/sessionDetailConnection";
import type { AccountPendingState, MobileSessionDetail } from "../mobileTypes";
import type { SavedMobileAccount } from "../mobileAuth";
import { apiCode, apiStatus, decrementReadyAccountPending } from "./mobileActivityHelpers";
import { getStoredConnectionToken } from "./mobileSessionClientHelpers";

type LoadActivity = (options?: { visible?: boolean }) => Promise<void>;

type SubmitResponsePayload = {
  choiceId?: string;
  message?: string;
  answers?: Record<string, string[]>;
};

type ResponseSubmissionClient = Pick<AgentTickClient, "respondToAudienceRequest" | "respondToRequest">;

const responseRetryDelaysMs = [750, 2_000];

type UseRequestResponseSubmissionOptions = {
  hostedReadOnly: boolean;
  firstRealResponseBeforePaywallAllowed: boolean;
  interruptRealtime: () => void;
  load: LoadActivity;
  questionnaireAnswers: Record<string, string[]>;
  refreshPersonalBilling: (options?: { configureStore?: boolean }) => Promise<PersonalBillingStatus | null>;
  reply: string;
  responseAppReadOnly: boolean;
  savedAccounts: SavedMobileAccount[];
  sdk: AgentTickClient;
  serverURL: string;
  setAccountPending: Dispatch<SetStateAction<Record<string, AccountPendingState>>>;
  setDiagnosticsEventCount: Dispatch<SetStateAction<number>>;
  setFirstRealResponseBeforePaywallPending: Dispatch<SetStateAction<boolean>>;
  setQuestionnaireAnswers: Dispatch<SetStateAction<Record<string, string[]>>>;
  setReply: Dispatch<SetStateAction<string>>;
  setRequests: Dispatch<SetStateAction<MobileRequest[]>>;
  setRespondingRequestKeys: Dispatch<SetStateAction<Record<string, boolean | undefined>>>;
  setSelectedID: Dispatch<SetStateAction<string | null>>;
  setSessionDetails: Dispatch<SetStateAction<Record<string, MobileSessionDetail | undefined>>>;
};

export function isTransientResponseSubmissionError(error: unknown): boolean {
  if (error instanceof AgentTickApiError) return error.status === 408 || error.status === 429 || error.status >= 500;
  // React Native fetch can throw TypeError when the network path changes after
  // the POST was accepted but before the response body is delivered. SyntaxError
  // covers proxy/CDN non-JSON timeout bodies from a response we cannot trust.
  return error instanceof TypeError || error instanceof SyntaxError;
}

export async function submitResponseWithNetworkRecovery(
  responseClient: ResponseSubmissionClient,
  request: Pick<MobileRequest, "deliveryKind" | "id">,
  payload: SubmitResponsePayload,
  options: { retryDelaysMs?: number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<RequestRecord> {
  const retryDelaysMs = options.retryDelaysMs ?? responseRetryDelaysMs;
  const sleep = options.sleep ?? delay;
  let attempt = 0;

  while (true) {
    try {
      return request.deliveryKind === "audience_channel"
        ? await responseClient.respondToAudienceRequest(request.id, payload)
        : await responseClient.respondToRequest(request.id, payload);
    } catch (error) {
      const retryDelayMs = retryDelaysMs[attempt];
      if (retryDelayMs === undefined || !isTransientResponseSubmissionError(error)) throw error;
      attempt += 1;
      await sleep(retryDelayMs);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useRequestResponseSubmission({
  hostedReadOnly,
  firstRealResponseBeforePaywallAllowed,
  interruptRealtime,
  load,
  questionnaireAnswers,
  refreshPersonalBilling,
  reply,
  responseAppReadOnly,
  savedAccounts,
  sdk,
  serverURL,
  setAccountPending,
  setDiagnosticsEventCount,
  setFirstRealResponseBeforePaywallPending,
  setQuestionnaireAnswers,
  setReply,
  setRequests,
  setRespondingRequestKeys,
  setSelectedID,
  setSessionDetails,
}: UseRequestResponseSubmissionOptions) {
  const removePendingRequest = useCallback((request: Pick<MobileRequest, "id" | "connectionID">) => {
    const requestKey = mobileRequestKey(request);
    setRequests((current) => {
      const next = current.filter((candidate) => mobileRequestKey(candidate) !== requestKey);
      setSelectedID(next[0] ? mobileRequestKey(next[0]) : null);
      return next;
    });
    if (request.connectionID) {
      setAccountPending((current) => decrementReadyAccountPending(current, request.connectionID!));
    }
  }, [setAccountPending, setRequests, setSelectedID]);

  const updatePendingRequest = useCallback((updated: MobileRequest) => {
    const updatedKey = mobileRequestKey(updated);
    setRequests((current) => {
      const exists = current.some((request) => mobileRequestKey(request) === updatedKey);
      if (!exists) {
        return [updated, ...current];
      }
      return current.map((request) => (mobileRequestKey(request) === updatedKey ? updated : request));
    });
    setSelectedID(updatedKey);
  }, [setRequests, setSelectedID]);

  const applyResponseResult = useCallback(
    (request: Pick<MobileRequest, "id" | "connectionID" | "workspaceId">, updated: MobileRequest) => {
      setSessionDetails((current) => updateSessionDetailsRequest(current, request, updated));
      if (updated.status === "pending" && !updated.response) {
        updatePendingRequest(updated);
        return;
      }
      removePendingRequest(request);
    },
    [removePendingRequest, setSessionDetails, updatePendingRequest],
  );

  const submitResponse = useCallback(async (
    request: MobileRequest,
    payload: SubmitResponsePayload,
  ) => {
    const bypassesResponsePaywall = request.isTest === true || firstRealResponseBeforePaywallAllowed;
    if ((responseAppReadOnly || hostedReadOnly) && !bypassesResponsePaywall) {
      setFirstRealResponseBeforePaywallPending(false);
      void refreshPersonalBilling({ configureStore: false });
      void load({ visible: false });
      return;
    }
    const respondingRequestKey = mobileRequestKey(request);
    setRespondingRequestKeys((current) => ({ ...current, [respondingRequestKey]: true }));
    interruptRealtime();
    try {
      let responseClient = sdk;
      const requestConnection = request.connectionID ? savedAccounts.find((account) => account.id === request.connectionID) : undefined;
      if (requestConnection) {
        const connectionToken = await getStoredConnectionToken(requestConnection);
        if (!connectionToken) throw new Error("This request's connection needs to be signed in again.");
        responseClient = new AgentTickClient({
          baseUrl: requestConnection.serverURL,
          tokenProvider: () => connectionToken,
          workspaceIdProvider: () => request.workspaceId || requestConnection.workspaceID || null,
        });
      }
      const response = await submitResponseWithNetworkRecovery(responseClient, request, payload);
      const updated: MobileRequest = {
        ...normalizeRequest(response),
        ...(request.connectionID ? { connectionID: request.connectionID } : {}),
        ...(request.connectionLabel ? { connectionLabel: request.connectionLabel } : {}),
        ...(request.connectionServerURL ? { connectionServerURL: request.connectionServerURL } : {}),
      };
      applyResponseResult(request, updated);
      if (!request.isTest && firstRealResponseBeforePaywallAllowed) {
        setFirstRealResponseBeforePaywallPending(false);
      }
      setReply("");
      setQuestionnaireAnswers({});
      void load({ visible: false });
    } catch (err) {
      const transientSubmissionError = isTransientResponseSubmissionError(err);
      recordDiagnostic("warn", "requests", transientSubmissionError ? "response_status_unknown" : "response_failed", {
        message: err instanceof Error ? err.message : String(err),
        status: apiStatus(err),
        code: apiCode(err),
        requestID: request.id,
        deliveryKind: request.deliveryKind,
      });
      setDiagnosticsEventCount(diagnosticEvents().length);
      if (apiStatus(err) === 409) {
        void load({ visible: false });
        return;
      }
      if (apiStatus(err) === 402 && apiCode(err) === "hosted_personal_inactive") {
        void refreshPersonalBilling({ configureStore: false });
        void load({ visible: false });
        return;
      }
      if (transientSubmissionError) {
        void load({ visible: false });
        return;
      }
      Alert.alert(
        "Response failed",
        err instanceof Error ? err.message : "Could not send response",
      );
    } finally {
      setRespondingRequestKeys((current) => {
        const { [respondingRequestKey]: _removed, ...next } = current;
        return next;
      });
    }
  }, [
    applyResponseResult,
    hostedReadOnly,
    firstRealResponseBeforePaywallAllowed,
    interruptRealtime,
    load,
    refreshPersonalBilling,
    responseAppReadOnly,
    savedAccounts,
    sdk,
    serverURL,
    setDiagnosticsEventCount,
    setFirstRealResponseBeforePaywallPending,
    setQuestionnaireAnswers,
    setReply,
    setRespondingRequestKeys,
  ]);

  const respond = useCallback(async (request: MobileRequest, choice: Choice) =>
    submitResponse(request, { choiceId: choice.id, message: reply }), [reply, submitResponse]);

  const submitQuestionnaire = useCallback(async (request: MobileRequest, answers: Record<string, string[]> = questionnaireAnswers) =>
    submitResponse(request, { answers }), [questionnaireAnswers, submitResponse]);

  return { respond, submitQuestionnaire, submitResponse };
}
