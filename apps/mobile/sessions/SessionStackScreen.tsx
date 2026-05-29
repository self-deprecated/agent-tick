import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { styles } from "../mobileStyles";
import type { MobileSessionDetail, MobileSessionSummary } from "../mobileTypes";
import type { MobileRequest, RequestChoice as Choice } from "../requests";
import {
  initialSessionStackLocalState,
  sessionPresentation,
  sessionStackSessionKey,
  type SessionLaneSize,
  type SessionStackInteractionMode,
  type SessionStackLocalState,
} from "../sessionStackState";
import {
  allocateSessionLaneLayouts,
  automaticSessionLaneSize,
  previewSessionReorder,
} from "./sessionLaneLayout";
import { sessionLaneDisplayTitle } from "./sessionDisplayHelpers";
import { SESSION_STACK_BOUNDARY_COLOR, SessionLaneFrame } from "./SessionLaneFrame";
import { SessionLaneTimelineViewport } from "./SessionLaneTimelineViewport";
import type { ChoiceInteractionMode } from "./SessionDetailTimeline";

export type LayoutRect = { x: number; y: number; width: number; height: number };

const SESSION_LANE_COLLAPSED_HEIGHT = 56;

export function SessionStackScreen({ summaries, details = {}, hiddenSessionID, initialScrollY = 0, localState = initialSessionStackLocalState(), onLaneLayout, onSelectSession, onStackScroll, onToggleLaneSize, onReorderSession, onRespond = () => undefined, onSubmitQuestionnaire = () => undefined, choiceInteractionMode = "click-to-submit", confirmBeforeSubmit = true, questionnaireAnswers = {}, setQuestionnaireAnswer = () => undefined, reply = "", setReply = () => undefined, readOnly = false, readOnlyReason, respondingRequestKeys = {}, unlockResponsesLabel, onUnlockResponses, viewportHeight = 620 }: { summaries: MobileSessionSummary[]; details?: Record<string, MobileSessionDetail | undefined>; hiddenSessionID?: string; initialScrollY?: number; localState?: SessionStackLocalState; onLaneLayout?: (sessionID: string, rect: LayoutRect) => void; onSelectSession: (session: MobileSessionSummary) => void; onStackScroll?: (scrollY: number) => void; onToggleLaneSize?: (session: MobileSessionSummary, currentSize: SessionLaneSize, gesture: "press" | "long") => void; onReorderSession?: (sessionID: string, targetIndex: number) => void; onRespond?: (request: MobileRequest, choice: Choice) => void; onSubmitQuestionnaire?: (request: MobileRequest, answers?: Record<string, string[]>) => void; choiceInteractionMode?: ChoiceInteractionMode; confirmBeforeSubmit?: boolean; questionnaireAnswers?: Record<string, string[]>; setQuestionnaireAnswer?: (question: string, option: string, multiSelect: boolean) => void; reply?: string; setReply?: (value: string) => void; readOnly?: boolean; readOnlyReason?: string; respondingRequestKeys?: Record<string, boolean | undefined>; unlockResponsesLabel?: string; onUnlockResponses?: () => void; viewportHeight?: number }) {
  const interactionMode = localState.preferences.interactionMode;
  const overviewMode = interactionMode === "overview";
  const [reorderingSessionID, setReorderingSessionID] = useState<string | null>(null);
  const [reorderPreviewIndex, setReorderPreviewIndex] = useState<number | null>(null);
  const [currentStackScrollY, setCurrentStackScrollY] = useState(initialScrollY);
  const stackScrollRef = useRef<ScrollView | null>(null);
  const initialStackScrollYRef = useRef(initialScrollY);
  const reorderingSessionIDRef = useRef<string | null>(null);
  const reorderStartIndexRef = useRef(0);
  const reorderStartPageYRef = useRef(0);
  const reorderPageYRef = useRef(0);
  const reorderContentHeightRef = useRef(0);
  const suppressNextLanePressRef = useRef(false);
  useEffect(() => {
    if (overviewMode || initialStackScrollYRef.current <= 0) return;
    requestAnimationFrame(() => stackScrollRef.current?.scrollTo({ y: initialStackScrollYRef.current, animated: false }));
  }, [overviewMode]);

  const displaySummaries = reorderingSessionID && reorderPreviewIndex !== null
    ? previewSessionReorder(summaries, reorderingSessionID, reorderPreviewIndex)
    : summaries;
  const naturalLaneLayouts = allocateSessionLaneLayouts(summaries, viewportHeight, { autoExpansion: localState.preferences.autoExpansion, laneSizes: localState.laneSizes });
  const laneLayouts = reorderingSessionID
    ? allocateSessionLaneLayouts(displaySummaries, viewportHeight, { autoExpansion: localState.preferences.autoExpansion, laneSizes: Object.fromEntries(summaries.map((summary) => [sessionStackSessionKey(summary), "collapsed" as SessionLaneSize])) })
    : naturalLaneLayouts;
  const laneLayoutBySessionID = new Map(laneLayouts.map((layout) => [layout.sessionId, layout]));
  const reorderingContentMinHeight = reorderingSessionID ? Math.max(viewportHeight, reorderContentHeightRef.current) : undefined;
  const pendingLaneLayouts = summaries.flatMap((summary) => {
    if (summary.pendingRequestCount <= 0 && summary.state !== "needs-input") return [];
    const layout = laneLayoutBySessionID.get(sessionStackSessionKey(summary));
    return layout ? [layout] : [];
  });
  const offscreenPendingAbove = pendingLaneLayouts.filter((layout) => layout.y + layout.height <= currentStackScrollY + 8);
  const offscreenPendingBelow = pendingLaneLayouts.filter((layout) => layout.y >= currentStackScrollY + viewportHeight - 8);
  const scrollToPendingLane = (direction: "above" | "below") => {
    const target = direction === "above" ? offscreenPendingAbove.at(-1) : offscreenPendingBelow[0];
    if (!target) return;
    stackScrollRef.current?.scrollTo({ y: Math.max(0, target.y), animated: true });
  };
  const reorderTargetIndex = (pageY: number) => {
    const rowsMoved = Math.round((pageY - reorderStartPageYRef.current) / SESSION_LANE_COLLAPSED_HEIGHT);
    return Math.max(0, Math.min(summaries.length - 1, reorderStartIndexRef.current + rowsMoved));
  };
  const laneViews = displaySummaries.map((summary, index) => {
    const sessionID = sessionStackSessionKey(summary);
    const presentation = sessionPresentation(localState, summary);
    const displayTitle = sessionLaneDisplayTitle(localState, summaries, summary);
    const detail = details[sessionID];
    const layout = laneLayoutBySessionID.get(sessionID);
    const laneSize = layout?.mode ?? automaticSessionLaneSize(summary, localState.preferences.autoExpansion);
    const hidden = hiddenSessionID === sessionID;
    const openLane = () => {
      if (suppressNextLanePressRef.current) return;
      onSelectSession(summary);
    };
    const beginReorder = (event: any) => {
      if (!onReorderSession || !layout) return;
      const pageY = event?.nativeEvent?.pageY;
      const startPageY = typeof pageY === "number" ? pageY : 0;
      reorderingSessionIDRef.current = sessionID;
      reorderStartIndexRef.current = index;
      reorderStartPageYRef.current = startPageY;
      reorderPageYRef.current = startPageY;
      reorderContentHeightRef.current = naturalLaneLayouts.reduce((total, item) => total + item.height, 0);
      suppressNextLanePressRef.current = true;
      setReorderPreviewIndex(index);
      setReorderingSessionID(sessionID);
    };
    const moveReorder = (event: any) => {
      if (reorderingSessionIDRef.current !== sessionID) return;
      const pageY = event?.nativeEvent?.pageY;
      if (typeof pageY === "number") {
        reorderPageYRef.current = pageY;
        setReorderPreviewIndex((current) => {
          const next = reorderTargetIndex(pageY);
          return current === next ? current : next;
        });
      }
    };
    const endReorder = (event: any) => {
      if (reorderingSessionIDRef.current !== sessionID) return;
      const pageY = event?.nativeEvent?.pageY;
      const finalPageY = typeof pageY === "number" ? pageY : reorderPageYRef.current;
      onReorderSession?.(sessionID, reorderTargetIndex(finalPageY));
      reorderingSessionIDRef.current = null;
      setReorderingSessionID(null);
      setReorderPreviewIndex(null);
      requestAnimationFrame(() => {
        suppressNextLanePressRef.current = false;
      });
    };
    const reorderingThisLane = reorderingSessionID === sessionID;
    const laneFrame = (
      <SessionLaneFrame borderColor={reorderingThisLane ? SESSION_STACK_BOUNDARY_COLOR : presentation.color} bottomBoundary={index === displaySummaries.length - 1} collapsed={laneSize === "collapsed"} displayTitle={displayTitle} laneSize={laneSize} onBeginReorder={beginReorder} onEndReorder={endReorder} onMoveReorder={moveReorder} onTitlePress={overviewMode || reorderingSessionID ? undefined : openLane} onToggleSize={onToggleLaneSize ? () => onToggleLaneSize(summary, laneSize, "press") : undefined} onToggleSizeLong={onToggleLaneSize ? () => onToggleLaneSize(summary, laneSize, "long") : undefined} state={summary.state} topBoundary={index === 0 || reorderingThisLane}>
        <SessionLaneTimelineViewport
          choiceInteractionMode={choiceInteractionMode}
          confirmBeforeSubmit={confirmBeforeSubmit}
          detail={detail}
          interactionMode={interactionMode}
          onRespond={onRespond}
          onSubmitQuestionnaire={onSubmitQuestionnaire}
          onUnlockResponses={onUnlockResponses}
          questionnaireAnswers={questionnaireAnswers}
          readOnly={readOnly}
          readOnlyReason={readOnlyReason}
          reply={reply}
          respondingRequestKeys={respondingRequestKeys}
          setQuestionnaireAnswer={setQuestionnaireAnswer}
          setReply={setReply}
          summary={summary}
          unlockResponsesLabel={unlockResponsesLabel}
        />
      </SessionLaneFrame>
    );
    if (overviewMode) {
      return (
        <View
          key={sessionID}
          onLayout={(event) => onLaneLayout?.(sessionID, { x: event.nativeEvent.layout.x, y: event.nativeEvent.layout.y, width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
          pointerEvents={hidden ? "none" : "auto"}
          style={[styles.sessionLane, reorderingThisLane ? styles.sessionLaneReorderPreview : null, hidden ? styles.sessionLaneHidden : null, { height: layout?.height }]}
        >
          {laneFrame}
        </View>
      );
    }
    return (
      <Pressable
        accessibilityLabel={`Open Session ${displayTitle}`}
        accessibilityRole="button"
        key={sessionID}
        onLayout={(event) => onLaneLayout?.(sessionID, { x: event.nativeEvent.layout.x, y: event.nativeEvent.layout.y, width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
        onPress={reorderingSessionID ? undefined : openLane}
        pointerEvents={hidden ? "none" : "auto"}
        style={[styles.sessionLane, reorderingThisLane ? styles.sessionLaneReorderPreview : null, hidden ? styles.sessionLaneHidden : null, { height: layout?.height }]}
      >
        {laneFrame}
      </Pressable>
    );
  });

  if (overviewMode) {
    return <View style={[styles.requestScroll, styles.sessionStackContent]}>{laneViews}</View>;
  }
  return (
    <View style={styles.sessionStackViewport}>
      {offscreenPendingAbove.length > 0 ? (
        <Pressable onPress={() => scrollToPendingLane("above")} style={[styles.pendingLaneNudge, styles.pendingLaneNudgeTop]}>
          <Text style={styles.pendingLaneNudgeText}>↑ {offscreenPendingAbove.length}</Text>
        </Pressable>
      ) : null}
      {offscreenPendingBelow.length > 0 ? (
        <Pressable onPress={() => scrollToPendingLane("below")} style={[styles.pendingLaneNudge, styles.pendingLaneNudgeBottom]}>
          <Text style={styles.pendingLaneNudgeText}>↓ {offscreenPendingBelow.length}</Text>
        </Pressable>
      ) : null}
      <ScrollView
        bounces={!reorderingSessionID}
        contentContainerStyle={[styles.sessionStackContent, reorderingContentMinHeight ? { minHeight: reorderingContentMinHeight } : null]}
        nestedScrollEnabled
        onScroll={(event) => {
          if (reorderingSessionIDRef.current || reorderingSessionID) return;
          const y = Math.max(0, event.nativeEvent.contentOffset.y);
          setCurrentStackScrollY(y);
          onStackScroll?.(y);
        }}
        ref={stackScrollRef}
        scrollEnabled={!reorderingSessionID}
        scrollEventThrottle={16}
        style={styles.requestScroll}
      >
        {laneViews}
      </ScrollView>
    </View>
  );
}
