import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";

import { translateSource } from "@agent-tick/i18n";

import { styles } from "../mobileStyles";
import type { MobileSessionDetail, MobileSessionSummary } from "../mobileTypes";
import type { MobileRequest, RequestChoice as Choice } from "../requests";
import {
  initialSessionStackLocalState,
  sessionPresentation,
  sessionStackSessionKey,
  type SessionLaneSize,
  type SessionStackLocalState,
} from "../sessionStackState";
import { SessionDetailLoading } from "./SessionDetailLoading";
import { SessionDetailTimeline, sessionHasExpandableMessageBodies, type ChoiceInteractionMode } from "./SessionDetailTimeline";
import { sessionLaneDisplayTitle } from "./sessionDisplayHelpers";
import { SessionExpandedLaneOverlay } from "./SessionExpandedLaneOverlay";
import { SessionLaneFrame } from "./SessionLaneFrame";
import { SessionStackScreen, type LayoutRect } from "./SessionStackScreen";

type SessionExpansionState =
  | { kind: "stack" }
  | { kind: "expanding"; sessionID: string; from: LayoutRect; to: LayoutRect }
  | { kind: "detail"; sessionID: string }
  | { kind: "collapsing"; sessionID: string; from: LayoutRect; to: LayoutRect }
  | { kind: "settling"; sessionID: string; rect: LayoutRect };

const SESSION_LANE_EXPANSION_DURATION_MS = 720;

function sessionTransitionRuntime() {
  return globalThis as {
    jest?: unknown;
    process?: { env?: Record<string, string | undefined> };
  };
}

function shouldSkipSessionLaneExpansionAnimation() {
  const runtime = sessionTransitionRuntime();
  return Boolean(runtime.jest || runtime.process?.env?.NODE_ENV === "test");
}

export type SessionApprovalFlowProps = {
  summaries: MobileSessionSummary[];
  selectedSessionID: string | null;
  details: Record<string, MobileSessionDetail | undefined>;
  localState?: SessionStackLocalState;
  onSelectSession: (sessionID: string) => void;
  onExitSessionDetail?: () => void;
  onToggleLaneSize?: (session: MobileSessionSummary, currentSize: SessionLaneSize, gesture: "press" | "long") => void;
  onReorderSession?: (sessionID: string, targetIndex: number) => void;
  onRespond: (request: MobileRequest, choice: Choice) => void;
  onSubmitQuestionnaire: (request: MobileRequest, answers?: Record<string, string[]>) => void;
  respondingRequestKeys?: Record<string, boolean | undefined>;
  choiceInteractionMode?: ChoiceInteractionMode;
  confirmBeforeSubmit?: boolean;
  questionnaireAnswers: Record<string, string[]>;
  setQuestionnaireAnswer: (question: string, option: string, multiSelect: boolean) => void;
  reply: string;
  setReply: (value: string) => void;
  readOnly?: boolean;
  readOnlyReason?: string;
  unlockResponsesLabel?: string;
  onUnlockResponses?: () => void;
};

export function SessionApprovalFlow({
  summaries,
  selectedSessionID,
  details,
  localState = initialSessionStackLocalState(),
  onSelectSession,
  onExitSessionDetail,
  onToggleLaneSize,
  onReorderSession,
  onRespond,
  onSubmitQuestionnaire,
  respondingRequestKeys = {},
  choiceInteractionMode,
  confirmBeforeSubmit,
  questionnaireAnswers,
  setQuestionnaireAnswer,
  reply,
  setReply,
  readOnly,
  readOnlyReason,
  unlockResponsesLabel,
  onUnlockResponses,
}: SessionApprovalFlowProps) {
  const [suppressedSelectedSessionID, setSuppressedSelectedSessionID] = useState<string | null>(null);
  const [expandedMessageBodiesBySession, setExpandedMessageBodiesBySession] = useState<Record<string, boolean | undefined>>({});
  const [messageBodiesFocusRevisionBySession, setMessageBodiesFocusRevisionBySession] = useState<Record<string, number | undefined>>({});
  const effectiveSelectedSessionID = selectedSessionID && selectedSessionID !== suppressedSelectedSessionID ? selectedSessionID : null;
  const previousEffectiveSelectedSessionIDRef = useRef<string | null>(null);
  const expansionProgress = useRef(new Animated.Value(effectiveSelectedSessionID && summaries.length > 1 ? 1 : 0)).current;
  const [containerRect, setContainerRect] = useState<LayoutRect | null>(null);
  const [stackScrollY, setStackScrollY] = useState(0);
  const laneContentLayoutsRef = useRef<Record<string, LayoutRect>>({});
  const lastLaneViewportLayoutsRef = useRef<Record<string, LayoutRect>>({});
  const [expansion, setExpansion] = useState<SessionExpansionState>(() => effectiveSelectedSessionID && summaries.length > 1 ? { kind: "detail", sessionID: effectiveSelectedSessionID } : { kind: "stack" });

  const selected = effectiveSelectedSessionID ? summaries.find((session) => sessionStackSessionKey(session) === effectiveSelectedSessionID) : undefined;
  const directSession = summaries.length === 1 ? summaries[0] : selected;
  const singleDetail = directSession ? details[sessionStackSessionKey(directSession)] : undefined;
  const directDisplayTitle = directSession ? sessionPresentation(localState, directSession).title : "";
  const containerTarget = containerRect ? { x: 0, y: 0, width: containerRect.width, height: containerRect.height } : { x: 0, y: 0, width: 400, height: 620 };

  const messageBodyToggleForSession = (sessionID: string | undefined, detail: MobileSessionDetail | undefined) => {
    if (!sessionID || !sessionHasExpandableMessageBodies(detail)) return undefined;
    const expanded = Boolean(expandedMessageBodiesBySession[sessionID]);
    return (
      <Pressable
        accessibilityLabel={expanded ? translateSource("Collapse mirrored messages") : translateSource("Expand mirrored messages")}
        accessibilityRole="button"
        hitSlop={8}
        onPress={(event) => {
          event?.stopPropagation?.();
          const nextExpanded = !expanded;
          setExpandedMessageBodiesBySession((current) => ({ ...current, [sessionID]: nextExpanded }));
          if (nextExpanded) {
            setMessageBodiesFocusRevisionBySession((current) => ({ ...current, [sessionID]: (current[sessionID] ?? 0) + 1 }));
          }
        }}
        style={styles.sessionMessageToggleButton}
      >
        <Text style={styles.sessionMessageToggleText}>{expanded ? translateSource("Collapse") : translateSource("Expand")}</Text>
      </Pressable>
    );
  };

  useEffect(() => {
    if (!selectedSessionID) setSuppressedSelectedSessionID(null);
  }, [selectedSessionID]);

  useEffect(() => {
    const previousSessionID = previousEffectiveSelectedSessionIDRef.current;
    previousEffectiveSelectedSessionIDRef.current = effectiveSelectedSessionID;
    if (!effectiveSelectedSessionID) {
      if (previousSessionID) setExpandedMessageBodiesBySession((current) => ({ ...current, [previousSessionID]: false }));
      return;
    }
    if (previousSessionID === effectiveSelectedSessionID) return;
    setExpandedMessageBodiesBySession((current) => ({ ...current, [effectiveSelectedSessionID]: true }));
    setMessageBodiesFocusRevisionBySession((current) => ({ ...current, [effectiveSelectedSessionID]: (current[effectiveSelectedSessionID] ?? 0) + 1 }));
  }, [effectiveSelectedSessionID]);

  useEffect(() => {
    if (summaries.length <= 1) return;
    if (!effectiveSelectedSessionID) {
      if (expansion.kind !== "collapsing" && expansion.kind !== "expanding" && expansion.kind !== "settling") {
        expansionProgress.setValue(0);
        setExpansion({ kind: "stack" });
      }
      return;
    }
    if (expansion.kind === "expanding" || expansion.kind === "collapsing" || expansion.kind === "settling") return;
    if (expansion.kind === "detail" && expansion.sessionID === effectiveSelectedSessionID) return;
    expansionProgress.setValue(1);
    setExpansion({ kind: "detail", sessionID: effectiveSelectedSessionID });
  }, [effectiveSelectedSessionID, expansion.kind, expansionProgress, summaries.length]);

  if (summaries.length === 1 && directSession) {
    const directSessionID = sessionStackSessionKey(directSession);
    const directMessageBodiesExpanded = Boolean(expandedMessageBodiesBySession[directSessionID]);
    const directMessageBodiesFocusRevision = messageBodiesFocusRevisionBySession[directSessionID] ?? 0;
    return (
      <View style={styles.sessionExpansionRoot}>
        <SessionLaneFrame expanded displayTitle={directDisplayTitle} headerAction={messageBodyToggleForSession(directSessionID, singleDetail)} state={directSession.state}>
          {singleDetail ? (
            <SessionDetailTimeline
              detail={singleDetail}
              onRespond={onRespond}
              onSubmitQuestionnaire={onSubmitQuestionnaire}
              respondingRequestKeys={respondingRequestKeys}
              choiceInteractionMode={choiceInteractionMode}
              confirmBeforeSubmit={confirmBeforeSubmit}
              questionnaireAnswers={questionnaireAnswers}
              setQuestionnaireAnswer={setQuestionnaireAnswer}
              reply={reply}
              setReply={setReply}
              readOnly={readOnly}
              readOnlyReason={readOnlyReason}
              unlockResponsesLabel={unlockResponsesLabel}
              onUnlockResponses={onUnlockResponses}
              showHeader={false}
              messageBodiesExpanded={directMessageBodiesExpanded}
              messageBodiesFocusRevision={directMessageBodiesFocusRevision}
            />
          ) : (
            <SessionDetailLoading summary={directSession} />
          )}
        </SessionLaneFrame>
      </View>
    );
  }

  const activeSessionID = expansion.kind === "stack" ? null : expansion.sessionID;
  const activeSummary = activeSessionID ? summaries.find((summary) => sessionStackSessionKey(summary) === activeSessionID) : undefined;
  const activeDetail = activeSessionID ? details[activeSessionID] : undefined;
  const activeDisplayTitle = activeSummary ? sessionLaneDisplayTitle(localState, summaries, activeSummary) : "";
  const interactiveExpandedDetail = expansion.kind === "detail" || expansion.kind === "expanding";
  const overlayVisible = Boolean(activeSummary && activeSessionID && containerTarget && expansion.kind !== "stack");
  const hiddenSessionID = overlayVisible && (expansion.kind === "expanding" || expansion.kind === "detail") ? activeSessionID ?? undefined : undefined;

  const laneViewportRect = (sessionID: string): LayoutRect | null => {
    const layout = laneContentLayoutsRef.current[sessionID];
    if (!layout) return null;
    return { ...layout, y: layout.y - stackScrollY };
  };

  const beginExpansion = (summary: MobileSessionSummary) => {
    const sessionID = sessionStackSessionKey(summary);
    setSuppressedSelectedSessionID(null);
    const to = containerTarget;
    if (!to) {
      onSelectSession(sessionID);
      return;
    }
    const from = laneViewportRect(sessionID) ?? { x: 0, y: 0, width: Math.max(1, to.width), height: Math.min(260, to.height) };
    lastLaneViewportLayoutsRef.current[sessionID] = from;
    expansionProgress.stopAnimation();
    if (shouldSkipSessionLaneExpansionAnimation()) {
      expansionProgress.setValue(1);
      setExpansion({ kind: "detail", sessionID });
      onSelectSession(sessionID);
      return;
    }
    expansionProgress.setValue(0);
    setExpansion({ kind: "expanding", sessionID, from, to });
    onSelectSession(sessionID);
    Animated.timing(expansionProgress, {
      toValue: 1,
      duration: SESSION_LANE_EXPANSION_DURATION_MS,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) setExpansion({ kind: "detail", sessionID });
    });
  };

  const beginCollapse = () => {
    if (!activeSummary || !activeSessionID || !containerTarget) {
      if (activeSessionID) setExpandedMessageBodiesBySession((current) => ({ ...current, [activeSessionID]: false }));
      onExitSessionDetail?.();
      setExpansion({ kind: "stack" });
      return;
    }
    setExpandedMessageBodiesBySession((current) => ({ ...current, [activeSessionID]: false }));
    const to = laneViewportRect(activeSessionID) ?? lastLaneViewportLayoutsRef.current[activeSessionID];
    if (!to) {
      onExitSessionDetail?.();
      expansionProgress.setValue(0);
      setExpansion({ kind: "stack" });
      return;
    }
    const from = containerTarget;
    expansionProgress.stopAnimation();
    if (shouldSkipSessionLaneExpansionAnimation()) {
      expansionProgress.setValue(0);
      setExpansion({ kind: "stack" });
      onExitSessionDetail?.();
      return;
    }
    expansionProgress.setValue(0);
    setExpansion({ kind: "collapsing", sessionID: activeSessionID, from, to });
    Animated.timing(expansionProgress, {
      toValue: 1,
      duration: SESSION_LANE_EXPANSION_DURATION_MS,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (!finished) return;
      setSuppressedSelectedSessionID(activeSessionID);
      onExitSessionDetail?.();
      setExpansion({ kind: "stack" });
      requestAnimationFrame(() => {
        expansionProgress.setValue(0);
      });
    });
  };

  return (
    <View
      onLayout={(event) => setContainerRect({ x: event.nativeEvent.layout.x, y: event.nativeEvent.layout.y, width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
      style={styles.sessionExpansionRoot}
    >
      <View pointerEvents={expansion.kind === "stack" ? "auto" : "none"} style={[styles.sessionStackUnderlay, expansion.kind === "detail" ? styles.sessionStackUnderlayHidden : null]}>
        <SessionStackScreen
          summaries={summaries}
          details={details}
          localState={localState}
          hiddenSessionID={hiddenSessionID}
          onLaneLayout={(sessionID, rect) => {
            laneContentLayoutsRef.current[sessionID] = rect;
          }}
          initialScrollY={stackScrollY}
          onSelectSession={beginExpansion}
          onStackScroll={setStackScrollY}
          onToggleLaneSize={onToggleLaneSize}
          onReorderSession={onReorderSession}
          onRespond={onRespond}
          onSubmitQuestionnaire={onSubmitQuestionnaire}
          respondingRequestKeys={respondingRequestKeys}
          choiceInteractionMode={choiceInteractionMode}
          confirmBeforeSubmit={confirmBeforeSubmit}
          questionnaireAnswers={questionnaireAnswers}
          setQuestionnaireAnswer={setQuestionnaireAnswer}
          reply={reply}
          setReply={setReply}
          readOnly={readOnly}
          readOnlyReason={readOnlyReason}
          unlockResponsesLabel={unlockResponsesLabel}
          onUnlockResponses={onUnlockResponses}
          viewportHeight={containerTarget.height}
        />
      </View>
      {overlayVisible && activeSummary && expansion.kind !== "stack" ? (
        <SessionExpandedLaneOverlay
          choiceInteractionMode={choiceInteractionMode}
          confirmBeforeSubmit={confirmBeforeSubmit}
          detail={activeDetail}
          displayTitle={activeDisplayTitle}
          expansion={expansion}
          headerAction={messageBodyToggleForSession(activeSessionID ?? undefined, activeDetail)}
          interactive={interactiveExpandedDetail}
          messageBodiesExpanded={Boolean(activeSessionID && expandedMessageBodiesBySession[activeSessionID])}
          messageBodiesFocusRevision={activeSessionID ? messageBodiesFocusRevisionBySession[activeSessionID] ?? 0 : 0}
          onBack={beginCollapse}
          onRespond={onRespond}
          onSubmitQuestionnaire={onSubmitQuestionnaire}
          onUnlockResponses={onUnlockResponses}
          progress={expansionProgress}
          questionnaireAnswers={questionnaireAnswers}
          readOnly={readOnly}
          readOnlyReason={readOnlyReason}
          reply={reply}
          respondingRequestKeys={respondingRequestKeys}
          setQuestionnaireAnswer={setQuestionnaireAnswer}
          setReply={setReply}
          summary={activeSummary}
          targetRect={containerTarget}
          unlockResponsesLabel={unlockResponsesLabel}
        />
      ) : null}
    </View>
  );
}
