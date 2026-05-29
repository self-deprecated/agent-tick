import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { translateSource } from "@agent-tick/i18n";
import type { ActivityItem } from "@self-deprecated/agent-tick-shared";

import { styles } from "../mobileStyles";
import { normalizeRequest, type MobileRequest, type RequestChoice as Choice } from "../requests";
import type { SessionStackInteractionMode } from "../sessionStackState";
import type { MobileSessionDetail, MobileSessionSummary } from "../mobileTypes";
import { SessionTimelineContent, type ChoiceInteractionMode } from "./SessionDetailTimeline";
import {
  SESSION_TIMELINE_CONTENT_TOP_PADDING,
  newestActionableRequestID,
  orderedSessionTimeline,
} from "./sessionTimelineLogic";

export function SessionLaneTimelineViewport({ choiceInteractionMode = "click-to-submit", confirmBeforeSubmit = false, detail, interactionMode = "stack", onRespond = () => undefined, onSubmitQuestionnaire = () => undefined, onUnlockResponses, questionnaireAnswers = {}, readOnly = false, readOnlyReason, reply = "", respondingRequestKeys = {}, setQuestionnaireAnswer = () => undefined, setReply = () => undefined, summary, unlockResponsesLabel }: { choiceInteractionMode?: ChoiceInteractionMode; confirmBeforeSubmit?: boolean; detail?: MobileSessionDetail; interactionMode?: SessionStackInteractionMode; onRespond?: (request: MobileRequest, choice: Choice) => void; onSubmitQuestionnaire?: (request: MobileRequest, answers?: Record<string, string[]>) => void; onUnlockResponses?: () => void; questionnaireAnswers?: Record<string, string[]>; readOnly?: boolean; readOnlyReason?: string; reply?: string; respondingRequestKeys?: Record<string, boolean | undefined>; setQuestionnaireAnswer?: (question: string, option: string, multiSelect: boolean) => void; setReply?: (value: string) => void; summary: MobileSessionSummary; unlockResponsesLabel?: string }) {
  const timeline = useMemo(() => detail ? orderedSessionTimeline(detail) : [], [detail]);
  const overviewScrollRef = useRef<ScrollView | null>(null);
  const stackPreviewScrollRef = useRef<ScrollView | null>(null);
  const overviewTimelineTopRef = useRef(0);
  const overviewRequestLayoutYRef = useRef<Record<string, number>>({});
  const overviewScrollYRef = useRef(0);
  const overviewFocusScrollDoneKeyRef = useRef("");
  const overviewFocusScrollUntilRef = useRef(0);
  const overviewFocusScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchoredRequestID = newestActionableRequestID(timeline);
  const windowedTimeline = sessionLaneTimelineWindow(timeline, summary);
  const focusedRequestID = anchoredRequestID ?? newestRequestID(windowedTimeline);
  const overviewMode = interactionMode === "overview";
  const [overviewReady, setOverviewReady] = useState(!overviewMode);
  const overviewFocusScrollKey = `${detail?.summary.sessionId ?? summary.sessionId}:${focusedRequestID ?? "end"}:${summary.latestActivity.id}:${timeline.length}`;
  const scrollOverviewToFocus = useCallback(() => {
    if (!focusedRequestID) {
      if (timeline.length === 0) return true;
      overviewScrollRef.current?.scrollToEnd({ animated: false });
      return true;
    }
    const requestY = overviewRequestLayoutYRef.current[focusedRequestID];
    if (typeof requestY !== "number") return false;
    const y = Math.max(0, overviewTimelineTopRef.current + requestY - SESSION_TIMELINE_CONTENT_TOP_PADDING);
    overviewScrollYRef.current = y;
    overviewScrollRef.current?.scrollTo({ y, animated: false });
    return true;
  }, [focusedRequestID, timeline.length]);
  const scheduleOverviewFocusScroll = useCallback(() => {
    if (!overviewMode) return;
    if (overviewFocusScrollDoneKeyRef.current === overviewFocusScrollKey && Date.now() > overviewFocusScrollUntilRef.current) return;
    if (overviewFocusScrollTimerRef.current) clearTimeout(overviewFocusScrollTimerRef.current);
    overviewFocusScrollTimerRef.current = setTimeout(() => {
      if (!scrollOverviewToFocus()) return;
      setOverviewReady(true);
      if (Date.now() <= overviewFocusScrollUntilRef.current) {
        scheduleOverviewFocusScroll();
        return;
      }
      overviewFocusScrollDoneKeyRef.current = overviewFocusScrollKey;
    }, 180);
  }, [focusedRequestID, overviewFocusScrollKey, overviewMode, scrollOverviewToFocus]);

  useEffect(() => {
    setOverviewReady(!overviewMode);
    if (!overviewMode) return;
    overviewFocusScrollDoneKeyRef.current = "";
    overviewFocusScrollUntilRef.current = Date.now() + 1100;
    scheduleOverviewFocusScroll();
    requestAnimationFrame(() => {
      scrollOverviewToFocus();
      scheduleOverviewFocusScroll();
    });
  }, [overviewFocusScrollKey, overviewMode, scheduleOverviewFocusScroll, scrollOverviewToFocus]);

  const restoreOverviewScrollOffset = useCallback(() => {
    if (!overviewMode || !overviewFocusScrollDoneKeyRef.current) return;
    const y = overviewScrollYRef.current;
    requestAnimationFrame(() => overviewScrollRef.current?.scrollTo({ y, animated: false }));
  }, [overviewMode]);

  const scrollStackPreviewToEnd = useCallback(() => {
    if (overviewMode || anchoredRequestID) return;
    requestAnimationFrame(() => stackPreviewScrollRef.current?.scrollToEnd({ animated: false }));
  }, [anchoredRequestID, overviewMode]);

  useEffect(() => {
    scrollStackPreviewToEnd();
  }, [scrollStackPreviewToEnd, summary.latestActivity.id, windowedTimeline.length]);

  useEffect(() => () => {
    if (overviewFocusScrollTimerRef.current) clearTimeout(overviewFocusScrollTimerRef.current);
  }, []);

  if (!detail) {
    return (
      <View style={styles.sessionLaneViewport}>
        <View style={styles.sessionLaneSkeletonCard}>
          <View style={styles.sessionLaneSkeletonHeader} />
          <View style={styles.sessionLaneSkeletonLineWide} />
          <View style={styles.sessionLaneSkeletonLine} />
        </View>
        <Text style={styles.sessionLaneSkeletonText}>{translateSource("Loading Session timeline…")}</Text>
      </View>
    );
  }
  const content = (
    <SessionTimelineContent
      choiceInteractionMode={overviewMode ? choiceInteractionMode : "click-to-submit"}
      confirmBeforeSubmit={overviewMode ? confirmBeforeSubmit : false}
      focusedRequestID={focusedRequestID}
      onFocusRequest={() => undefined}
      onRequestLayout={overviewMode ? (requestID, y) => {
        overviewRequestLayoutYRef.current[requestID] = y;
        scheduleOverviewFocusScroll();
      } : undefined}
      onRespond={overviewMode ? onRespond : () => undefined}
      onSubmitQuestionnaire={overviewMode ? onSubmitQuestionnaire : () => undefined}
      onTimelineLayout={overviewMode ? (y) => {
        overviewTimelineTopRef.current = y;
        scheduleOverviewFocusScroll();
      } : undefined}
      pastRequestPresentation={overviewMode ? "auto" : "collapsed"}
      onUnlockResponses={overviewMode ? onUnlockResponses : undefined}
      questionnaireAnswers={overviewMode ? questionnaireAnswers : {}}
      readOnly={overviewMode ? readOnly : false}
      readOnlyReason={overviewMode ? readOnlyReason : undefined}
      reply={overviewMode ? reply : ""}
      respondingRequestKeys={overviewMode ? respondingRequestKeys : {}}
      setQuestionnaireAnswer={overviewMode ? setQuestionnaireAnswer : () => undefined}
      setReply={overviewMode ? setReply : () => undefined}
      timeline={overviewMode ? timeline : windowedTimeline}
      unlockResponsesLabel={overviewMode ? unlockResponsesLabel : undefined}
    />
  );
  return (
    <View style={styles.sessionLaneViewport}>
      {overviewMode ? (
        <ScrollView
          ref={overviewScrollRef}
          nestedScrollEnabled
          onContentSizeChange={scheduleOverviewFocusScroll}
          onLayout={restoreOverviewScrollOffset}
          onScroll={(event) => { overviewScrollYRef.current = event.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          contentContainerStyle={styles.sessionLaneTimelineClipContent}
          style={[styles.sessionLaneOverviewScroll, overviewReady ? null : styles.sessionLaneOverviewScrollPreparing]}
        >
          {content}
        </ScrollView>
      ) : anchoredRequestID ? (
        <View pointerEvents="none" style={styles.sessionLaneTimelineClipContent}>
          {content}
        </View>
      ) : (
        <ScrollView
          ref={stackPreviewScrollRef}
          pointerEvents="none"
          scrollEnabled={false}
          onContentSizeChange={scrollStackPreviewToEnd}
          onLayout={scrollStackPreviewToEnd}
          contentContainerStyle={styles.sessionLaneTimelineClipContent}
          style={styles.sessionLaneOverviewScroll}
        >
          {content}
        </ScrollView>
      )}
    </View>
  );
}

function sessionLaneTimelineWindow(timeline: ActivityItem[], summary: MobileSessionSummary): ActivityItem[] {
  if (timeline.length === 0) return [];
  const actionableRequestID = newestActionableRequestID(timeline);
  if (actionableRequestID) {
    const requestIndex = timeline.findIndex((item) => item.kind === "request" && normalizeRequest(item.request).id === actionableRequestID);
    return timeline.slice(Math.max(0, requestIndex));
  }
  const latestActivityID = summary.latestActivity.id;
  const latestIndex = timeline.findIndex((item) => sessionTimelineItemActivityId(item) === latestActivityID);
  const anchorIndex = latestIndex >= 0 ? latestIndex : timeline.length - 1;
  return timeline.slice(Math.max(0, anchorIndex - 4), anchorIndex + 1);
}

function newestRequestID(timeline: ActivityItem[]): string | null {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item?.kind === "request") return normalizeRequest(item.request).id;
  }
  return null;
}

function sessionTimelineItemActivityId(item: ActivityItem): string {
  return item.kind === "request" ? normalizeRequest(item.request).id : item.statusUpdate.statusId;
}

