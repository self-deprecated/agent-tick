import type { Dispatch, SetStateAction } from "react";
import { translateSource } from "@agent-tick/i18n";

import { responseReadOnlyState } from "../AppLogic";
import type { MobileSessionDetail, MobileSessionSummary } from "../mobileTypes";
import type { PaywallPlacement } from "../purchases";
import { updateQuestionnaireAnswers, type MobileRequest, type RequestChoice } from "../requests";
import {
  moveSessionInStableOrder,
  setSessionLaneSize,
  sessionStackSessionKey,
  type SessionStackLocalState,
} from "../sessionStackState";
import { SessionApprovalFlow } from "../sessions/SessionApprovalFlow";
import { SessionStackEmptyState } from "../sessions/SessionStackEmptyState";
import { nextCollapsedToggleSessionLaneSize, nextLargeToggleSessionLaneSize } from "../sessions/sessionLaneLayout";
import type { ChoiceInteractionMode } from "../sessions/SessionDetailTimeline";

type MaybePromise<T> = T | Promise<T>;

type AgentTickSessionDashboardRouteProps = {
  choiceInteractionMode: ChoiceInteractionMode;
  confirmBeforeSubmit: boolean;
  dashboardSessionDetails: Record<string, MobileSessionDetail | undefined>;
  dashboardSessionSummaries: MobileSessionSummary[];
  hostedReadOnly: boolean;
  load: (options?: { visible?: boolean }) => MaybePromise<void>;
  loading: boolean;
  questionnaireAnswers: Record<string, string[]>;
  reply: string;
  respond: (request: MobileRequest, choice: RequestChoice) => MaybePromise<void>;
  respondingRequestKeys: Record<string, boolean | undefined>;
  responseAppReadOnly: boolean;
  responseReadOnly: ReturnType<typeof responseReadOnlyState>;
  selectedRequestHosted: boolean;
  selectedSessionID: string | null;
  sessionStackLocalState: SessionStackLocalState;
  sessionSummaries: MobileSessionSummary[];
  setQuestionnaireAnswers: Dispatch<SetStateAction<Record<string, string[]>>>;
  setReply: (value: string) => void;
  setSelectedSessionID: (sessionID: string | null) => void;
  setSessionStackLocalState: Dispatch<SetStateAction<SessionStackLocalState>>;
  showNativePaywall: (placement: PaywallPlacement) => void;
  submitQuestionnaire: (request: MobileRequest, answers?: Record<string, string[]>) => MaybePromise<void>;
};

export function AgentTickSessionDashboardRoute({
  choiceInteractionMode,
  confirmBeforeSubmit,
  dashboardSessionDetails,
  dashboardSessionSummaries,
  hostedReadOnly,
  load,
  loading,
  questionnaireAnswers,
  reply,
  respond,
  respondingRequestKeys,
  responseAppReadOnly,
  responseReadOnly,
  selectedRequestHosted,
  selectedSessionID,
  sessionStackLocalState,
  sessionSummaries,
  setQuestionnaireAnswers,
  setReply,
  setSelectedSessionID,
  setSessionStackLocalState,
  showNativePaywall,
  submitQuestionnaire,
}: AgentTickSessionDashboardRouteProps) {
  return dashboardSessionSummaries.length > 0 ? (
    <SessionApprovalFlow
      summaries={dashboardSessionSummaries}
      selectedSessionID={selectedSessionID}
      details={dashboardSessionDetails}
      localState={sessionStackLocalState}
      onSelectSession={(sessionID) => setSelectedSessionID(sessionID)}
      onExitSessionDetail={() => setSelectedSessionID(null)}
      onToggleLaneSize={(session, currentSize, gesture) => setSessionStackLocalState((current) => setSessionLaneSize(current, sessionStackSessionKey(session), gesture === "long" ? nextLargeToggleSessionLaneSize(currentSize) : nextCollapsedToggleSessionLaneSize(session, currentSize, current.preferences.autoExpansion)))}
      onReorderSession={(sessionID, targetIndex) => setSessionStackLocalState((current) => moveSessionInStableOrder(current, sessionID, targetIndex))}
      onRespond={(request, choice) => void respond(request, choice)}
      onSubmitQuestionnaire={(request, answers) => void submitQuestionnaire(request, answers)}
      respondingRequestKeys={respondingRequestKeys}
      readOnly={responseReadOnly.readOnly}
      readOnlyReason={responseAppReadOnly ? "Responses require an active 7-day Trial, Hosted subscription, or Self-hosted Lifetime unlock." : responseReadOnly.workspaceReadOnly ? translateSource("Workspace billing is inactive. Ask a Workspace Owner or Admin to renew before responding.") : hostedReadOnly ? "Hosted service is inactive. Subscribe to respond on hosted Requests, or buy Self-hosted Lifetime to respond on self-hosted servers." : undefined}
      unlockResponsesLabel={hostedReadOnly ? "View App access" : undefined}
      onUnlockResponses={responseReadOnly.workspaceReadOnly ? undefined : () => showNativePaywall(hostedReadOnly ? "hosted_gate" : selectedRequestHosted ? "hosted_gate" : "self_hosted_gate")}
      choiceInteractionMode={choiceInteractionMode}
      confirmBeforeSubmit={confirmBeforeSubmit}
      questionnaireAnswers={questionnaireAnswers}
      setQuestionnaireAnswer={(question, option, multiSelect) => setQuestionnaireAnswers((current) => updateQuestionnaireAnswers(current, question, option, multiSelect))}
      reply={reply}
      setReply={setReply}
    />
  ) : (
    <SessionStackEmptyState
      archivedSessionCount={sessionSummaries.length}
      loading={loading}
      onRefresh={() => void load({ visible: true })}
    />
  );
}
