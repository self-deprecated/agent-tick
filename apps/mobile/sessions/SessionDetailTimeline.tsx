import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { translateSource } from "@agent-tick/i18n";
import type { StatusUpdateRecord, SessionDetail } from "@self-deprecated/agent-tick-sdk";
import type { ActivityItem } from "@self-deprecated/agent-tick-shared";

import { recordDiagnostic } from "../diagnostics";
import { MarkdownInlineText, MarkdownText } from "../MarkdownText";
import { DirectChoiceCards, QuestionnaireOptionCards, isRequestLevelCancelChoice } from "../RequestChoiceControls";
import { RequestWaiterLivenessPanel } from "../RequestWaiterLiveness";
import { styles } from "../mobileStyles";
import { AudienceRequestPanel, QuorumProgressPanel } from "../requestsScreen/RequestPanels";
import { formatRequestTime, requestTitleStyles } from "../requestsScreen/requestDisplayHelpers";
import {
  canRespondToRequest,
  isQuestionnaireRequest,
  mobileRequestKey,
  normalizeRequest,
  questionnaireReady,
  quorumProgressMessage,
  requestStatusLabel,
  updateQuestionnaireAnswers,
  type MobileRequest,
  type RequestChoice as Choice,
} from "../requests";
import {
  SESSION_TIMELINE_CONTENT_TOP_PADDING,
  SESSION_TIMELINE_RENDER_INCREMENT,
  groupSessionTimelineItems,
  newestActionableRequestID,
  orderedSessionTimeline,
  requestAnswerSummary,
  sessionTimelineItemKey,
  sessionTimelineRenderWindow,
  shouldAutoFocusSessionTimelineNewActivity,
  toolActivityCallCountLabel,
  toolActivityCountsLabel,
  toolActivityGroupInProgress,
  toolActivityGroupOutcomeLabel,
  type SessionToolActivityGroup,
  type TimelineRenderWindow,
} from "./sessionTimelineLogic";

export type ChoiceInteractionMode = "click-to-submit" | "select-then-submit";

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

function encryptedLabel(label: string, contentMode?: string): string {
  return contentMode === "private" ? `${label} 🔒` : label;
}

function isRequestPastDeadline(request: MobileRequest) {
  if (!request.deadline) return false;
  const deadlineMs = new Date(request.deadline).getTime();
  return Number.isFinite(deadlineMs) && deadlineMs < Date.now();
}

function requestStaleWarning(request: MobileRequest) {
  if (request.status !== "pending") return "";
  if (isRequestPastDeadline(request)) return translateSource("This Request may be stale. Refresh the Session before responding.");
  return "";
}

export function SessionDetailTimeline({
  detail,
  onRespond,
  onSubmitQuestionnaire,
  respondingRequestKeys = {},
  choiceInteractionMode = "click-to-submit",
  confirmBeforeSubmit = true,
  questionnaireAnswers,
  setQuestionnaireAnswer,
  reply,
  setReply,
  readOnly = false,
  readOnlyReason,
  unlockResponsesLabel,
  onUnlockResponses,
  showHeader = true,
  userIdle = false,
  userAtTimelineEnd = false,
  collapseScrollProgress,
  collapseTargetViewportHeight,
  messageBodiesExpanded,
  messageBodiesFocusRevision,
  pastRequestPresentation = "auto",
  scrollEnabled = true,
  showNewActivityNudge = true,
}: {
  detail: SessionDetail;
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
  showHeader?: boolean;
  userIdle?: boolean;
  userAtTimelineEnd?: boolean;
  collapseScrollProgress?: Animated.Value;
  collapseTargetViewportHeight?: number;
  messageBodiesExpanded?: boolean;
  messageBodiesFocusRevision?: number;
  pastRequestPresentation?: "auto" | "collapsed";
  scrollEnabled?: boolean;
  showNewActivityNudge?: boolean;
}) {
  const timeline = useMemo(() => orderedSessionTimeline(detail), [detail]);
  const timelineEnd = timeline[timeline.length - 1];
  const timelineEndKey = timelineEnd ? sessionTimelineItemKey(timelineEnd) : "";
  const defaultFocusedRequestID = useMemo(() => newestActionableRequestID(timeline), [timeline]);
  const initialRenderWindow = useMemo(() => sessionTimelineRenderWindow(timeline, defaultFocusedRequestID), [defaultFocusedRequestID, timeline]);
  const [focusedRequestID, setFocusedRequestID] = useState<string | null>(defaultFocusedRequestID);
  const [renderWindow, setRenderWindow] = useState<TimelineRenderWindow>(initialRenderWindow);
  const renderedTimeline = useMemo(() => timeline.slice(renderWindow.start, renderWindow.end), [renderWindow.end, renderWindow.start, timeline]);
  const [seenTimelineEndKey, setSeenTimelineEndKey] = useState(timelineEndKey);
  const [timelineViewportHeight, setTimelineViewportHeight] = useState(0);
  const [timelineContentHeight, setTimelineContentHeight] = useState(0);
  const [timelineScrollY, setTimelineScrollY] = useState(0);
  const [timelineLayoutVersion, setTimelineLayoutVersion] = useState(0);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const timelineScrollYRef = useRef(0);
  const timelineItemsTopRef = useRef(0);
  const requestLayoutYRef = useRef<Record<string, number>>({});
  const statusLayoutYRef = useRef<Record<string, number>>({});
  const initialScrollDoneRef = useRef("");
  const observedMessageBodiesFocusRevisionRef = useRef(0);
  const pendingMessageBodiesFocusRevisionRef = useRef(0);
  const pendingMessageBodiesFocusLayoutVersionRef = useRef(0);
  const pendingMessageBodiesFocusContentHeightRef = useRef(0);
  const downNudge = useRef(new Animated.Value(0)).current;
  const timelineAtEnd = timelineViewportHeight > 0 && timelineContentHeight > 0
    ? timelineContentHeight <= timelineViewportHeight + timelineScrollY + 56
    : userAtTimelineEnd;
  const autoFocusNewActivity = shouldAutoFocusSessionTimelineNewActivity({ userIdle, userAtTimelineEnd: userAtTimelineEnd || timelineAtEnd });
  const hasNewActivity = Boolean(timelineEndKey && seenTimelineEndKey && timelineEndKey !== seenTimelineEndKey && !autoFocusNewActivity);
  const showNewActivityHint = showNewActivityNudge && hasNewActivity && !timelineAtEnd;
  const latestExpandableStatusID = useMemo(() => latestExpandableStatusUpdateID(timeline), [timeline]);

  useEffect(() => {
    setFocusedRequestID(defaultFocusedRequestID);
    setRenderWindow(initialRenderWindow);
    setSeenTimelineEndKey(timelineEndKey);
    initialScrollDoneRef.current = "";
    requestLayoutYRef.current = {};
    statusLayoutYRef.current = {};
    timelineItemsTopRef.current = 0;
    setTimelineLayoutVersion((version) => version + 1);
  }, [detail.summary.sessionId]);

  useEffect(() => {
    setRenderWindow((current) => {
      if (timeline.length === 0) return { start: 0, end: 0 };
      const next = {
        start: Math.min(current.start, Math.max(0, timeline.length - 1)),
        end: Math.min(Math.max(current.end, initialRenderWindow.end), timeline.length),
      };
      if (next.start === current.start && next.end === current.end) return current;
      return next;
    });
  }, [initialRenderWindow.end, timeline.length]);

  useEffect(() => {
    const initialScrollKey = `${detail.summary.sessionId}:${defaultFocusedRequestID || timelineEndKey}`;
    if (!initialScrollKey || initialScrollDoneRef.current === initialScrollKey) return;
    if (defaultFocusedRequestID) {
      const requestY = requestLayoutYRef.current[defaultFocusedRequestID];
      if (typeof requestY !== "number") return;
      initialScrollDoneRef.current = initialScrollKey;
      requestAnimationFrame(() => scrollViewRef.current?.scrollTo({ y: Math.max(0, timelineItemsTopRef.current + requestY - SESSION_TIMELINE_CONTENT_TOP_PADDING), animated: false }));
      return;
    }
    if (!timelineEndKey || timelineContentHeight <= timelineViewportHeight) return;
    initialScrollDoneRef.current = initialScrollKey;
    requestAnimationFrame(() => scrollViewRef.current?.scrollToEnd({ animated: false }));
  }, [defaultFocusedRequestID, detail.summary.sessionId, timelineContentHeight, timelineEndKey, timelineLayoutVersion, timelineViewportHeight]);

  useEffect(() => {
    if (!messageBodiesExpanded || !messageBodiesFocusRevision) return;
    if (messageBodiesFocusRevision === observedMessageBodiesFocusRevisionRef.current) return;
    observedMessageBodiesFocusRevisionRef.current = messageBodiesFocusRevision;
    pendingMessageBodiesFocusRevisionRef.current = messageBodiesFocusRevision;
    pendingMessageBodiesFocusLayoutVersionRef.current = timelineLayoutVersion;
    pendingMessageBodiesFocusContentHeightRef.current = timelineContentHeight;
  }, [messageBodiesExpanded, messageBodiesFocusRevision, timelineContentHeight, timelineLayoutVersion]);

  useEffect(() => {
    if (!messageBodiesExpanded || !pendingMessageBodiesFocusRevisionRef.current || !latestExpandableStatusID) return;
    if (timelineLayoutVersion <= pendingMessageBodiesFocusLayoutVersionRef.current) return;
    if (timelineContentHeight <= pendingMessageBodiesFocusContentHeightRef.current) return;
    const y = statusLayoutYRef.current[latestExpandableStatusID];
    if (typeof y !== "number") return;
    pendingMessageBodiesFocusRevisionRef.current = 0;
    requestAnimationFrame(() => requestAnimationFrame(() => scrollViewRef.current?.scrollTo({ y: Math.max(0, timelineItemsTopRef.current + y - 6), animated: true })));
  }, [latestExpandableStatusID, messageBodiesExpanded, timelineContentHeight, timelineLayoutVersion]);

  const effectiveCollapseTargetViewportHeight = collapseTargetViewportHeight ?? timelineViewportHeight;
  useEffect(() => {
    if (!collapseScrollProgress) return;

    if (!defaultFocusedRequestID) {
      if (timelineContentHeight <= 0 || effectiveCollapseTargetViewportHeight <= 0) return;
      const startY = timelineScrollYRef.current;
      const targetY = Math.max(0, timelineContentHeight - effectiveCollapseTargetViewportHeight);
      if (shouldSkipSessionLaneExpansionAnimation()) {
        scrollViewRef.current?.scrollTo({ y: targetY, animated: false });
        timelineScrollYRef.current = targetY;
        setTimelineScrollY(targetY);
        return;
      }
      const listenerID = collapseScrollProgress.addListener(({ value }) => {
        const y = startY + ((targetY - startY) * value);
        scrollViewRef.current?.scrollTo({ y, animated: false });
        timelineScrollYRef.current = y;
      });
      return () => {
        collapseScrollProgress.removeListener(listenerID);
      };
    }

    const requestY = requestLayoutYRef.current[defaultFocusedRequestID];
    if (typeof requestY !== "number") return;
    const startY = timelineScrollYRef.current;
    const targetY = Math.max(0, timelineItemsTopRef.current + requestY - SESSION_TIMELINE_CONTENT_TOP_PADDING);
    if (shouldSkipSessionLaneExpansionAnimation()) {
      scrollViewRef.current?.scrollTo({ y: targetY, animated: false });
      timelineScrollYRef.current = targetY;
      setTimelineScrollY(targetY);
      return;
    }
    const listenerID = collapseScrollProgress.addListener(({ value }) => {
      const y = startY + ((targetY - startY) * value);
      scrollViewRef.current?.scrollTo({ y, animated: false });
      timelineScrollYRef.current = y;
    });
    return () => {
      collapseScrollProgress.removeListener(listenerID);
    };
  }, [collapseScrollProgress, defaultFocusedRequestID, detail.summary.sessionId, effectiveCollapseTargetViewportHeight, timelineContentHeight, timelineLayoutVersion]);

  useEffect(() => {
    if (!timelineEndKey || timelineEndKey === seenTimelineEndKey) return;
    if (!autoFocusNewActivity) return;
    setFocusedRequestID(defaultFocusedRequestID);
    setSeenTimelineEndKey(timelineEndKey);
  }, [autoFocusNewActivity, defaultFocusedRequestID, seenTimelineEndKey, timelineEndKey]);

  useEffect(() => {
    if (!showNewActivityHint) {
      downNudge.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(downNudge, { toValue: 10, duration: 1100, useNativeDriver: true }),
        Animated.timing(downNudge, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [downNudge, showNewActivityHint]);

  const hasEarlierTimelineHistory = renderWindow.start > 0;
  const loadTimelineBefore = () => setRenderWindow((current) => current.start > 0 ? { ...current, start: Math.max(0, current.start - SESSION_TIMELINE_RENDER_INCREMENT) } : current);
  const loadTimelineAfter = () => setRenderWindow((current) => current.end < timeline.length ? { ...current, end: Math.min(timeline.length, current.end + SESSION_TIMELINE_RENDER_INCREMENT) } : current);
  const handleTimelineScroll = (event: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = event.nativeEvent.contentOffset.y;
    timelineScrollYRef.current = y;
    setTimelineScrollY(y);
    if (timelineViewportHeight > 0 && timelineContentHeight <= y + timelineViewportHeight + 180) loadTimelineAfter();
  };

  const jumpToNewActivity = () => {
    setRenderWindow((current) => ({ start: current.start, end: timeline.length }));
    requestAnimationFrame(() => scrollViewRef.current?.scrollToEnd({ animated: true }));
    setFocusedRequestID(defaultFocusedRequestID);
    setSeenTimelineEndKey(timelineEndKey);
  };

  return (
    <View style={[styles.requestsPane, styles.sessionTimelinePane]}>
      {showNewActivityHint ? (
        <Pressable accessibilityLabel={translateSource("Jump to new Session Activity")} onPress={jumpToNewActivity} style={styles.newActivityNudge}>
          <Animated.Text style={[styles.newActivityNudgeText, { transform: [{ translateY: downNudge }] }]}>↓</Animated.Text>
        </Pressable>
      ) : null}
      <ScrollView
        contentContainerStyle={styles.sessionTimelineContent}
        onContentSizeChange={(_width, height) => setTimelineContentHeight(height)}
        onLayout={(event) => setTimelineViewportHeight(event.nativeEvent.layout.height)}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onScroll={handleTimelineScroll}
        ref={scrollViewRef}
        scrollEnabled={scrollEnabled}
        scrollEventThrottle={120}
        style={[styles.requestScroll, styles.sessionTimelineScroll]}
      >
        {showHeader ? (
          <View style={styles.sessionTimelineHeader}>
            <Text style={styles.sectionHeading}>{detail.summary.title}</Text>
            <Text style={styles.detailMeta}>{detail.summary.state} · {detail.summary.pendingRequestCount} pending</Text>
          </View>
        ) : null}
        {hasEarlierTimelineHistory ? (
          <Pressable accessibilityLabel={translateSource("Load earlier Session history")} accessibilityRole="button" onPress={loadTimelineBefore} style={styles.loadEarlierSessionHistoryButton}>
            <Text style={styles.secondaryButtonText}>{translateSource("Load earlier Session history")}</Text>
          </Pressable>
        ) : null}
        <SessionTimelineContent
          choiceInteractionMode={choiceInteractionMode}
          confirmBeforeSubmit={confirmBeforeSubmit}
          focusedRequestID={focusedRequestID}
          onFocusRequest={setFocusedRequestID}
          onRequestLayout={(requestID, y) => {
            requestLayoutYRef.current[requestID] = y;
            setTimelineLayoutVersion((version) => version + 1);
          }}
          onStatusLayout={(statusID, y) => {
            statusLayoutYRef.current[statusID] = y;
            setTimelineLayoutVersion((version) => version + 1);
          }}
          onRespond={onRespond}
          onSubmitQuestionnaire={onSubmitQuestionnaire}
          onTimelineLayout={(y) => {
            timelineItemsTopRef.current = y;
            setTimelineLayoutVersion((version) => version + 1);
          }}
          onUnlockResponses={onUnlockResponses}
          pastRequestPresentation={pastRequestPresentation}
          questionnaireAnswers={questionnaireAnswers}
          readOnly={readOnly}
          readOnlyReason={readOnlyReason}
          reply={reply}
          respondingRequestKeys={respondingRequestKeys}
          setQuestionnaireAnswer={setQuestionnaireAnswer}
          setReply={setReply}
          timeline={renderedTimeline}
          unlockResponsesLabel={unlockResponsesLabel}
          messageBodiesExpanded={messageBodiesExpanded}
        />
      </ScrollView>
    </View>
  );
}

export function SessionTimelineContent({
  timeline,
  focusedRequestID,
  onFocusRequest,
  onRequestLayout,
  onRespond,
  onSubmitQuestionnaire,
  onStatusLayout,
  onTimelineLayout,
  pastRequestPresentation = "auto",
  choiceInteractionMode = "click-to-submit",
  confirmBeforeSubmit = true,
  questionnaireAnswers,
  setQuestionnaireAnswer,
  reply,
  setReply,
  readOnly = false,
  readOnlyReason,
  respondingRequestKeys = {},
  unlockResponsesLabel,
  onUnlockResponses,
  messageBodiesExpanded,
}: {
  timeline: ActivityItem[];
  focusedRequestID: string | null;
  onFocusRequest: (requestID: string) => void;
  onRequestLayout?: (requestID: string, y: number) => void;
  onRespond: (request: MobileRequest, choice: Choice) => void;
  onSubmitQuestionnaire: (request: MobileRequest, answers?: Record<string, string[]>) => void;
  onStatusLayout?: (statusID: string, y: number) => void;
  onTimelineLayout?: (y: number) => void;
  pastRequestPresentation?: "auto" | "collapsed";
  choiceInteractionMode?: ChoiceInteractionMode;
  confirmBeforeSubmit?: boolean;
  questionnaireAnswers: Record<string, string[]>;
  setQuestionnaireAnswer: (question: string, option: string, multiSelect: boolean) => void;
  reply: string;
  setReply: (value: string) => void;
  readOnly?: boolean;
  readOnlyReason?: string;
  respondingRequestKeys?: Record<string, boolean | undefined>;
  unlockResponsesLabel?: string;
  onUnlockResponses?: () => void;
  messageBodiesExpanded?: boolean;
}) {
  const timelineItems = useMemo(() => groupSessionTimelineDisplayItems(groupSessionTimelineItems(timeline)), [timeline]);
  return (
    <View onLayout={(event) => onTimelineLayout?.(event.nativeEvent.layout.y)} style={styles.sessionTimelineItems}>
      {timelineItems.map((item) => item.kind === "activity_group" ? (
        <SessionActivityTimelineGroup key={item.key} groupKey={item.key} messageBodiesExpanded={messageBodiesExpanded} onStatusLayout={onStatusLayout} rows={item.rows} />
      ) : (
        <SessionRequestTimelineItem
          choiceInteractionMode={choiceInteractionMode}
          confirmBeforeSubmit={confirmBeforeSubmit}
          focused={focusedRequestID === item.request.id}
          key={sessionTimelineItemKey(item.timelineItem)}
          onFocus={() => onFocusRequest(item.request.id)}
          onLayout={(y) => onRequestLayout?.(item.request.id, y)}
          onRespond={onRespond}
          onSubmitQuestionnaire={onSubmitQuestionnaire}
          pastRequestPresentation={pastRequestPresentation}
          questionnaireAnswers={questionnaireAnswers}
          readOnly={readOnly}
          readOnlyReason={readOnlyReason}
          responding={Boolean(respondingRequestKeys[mobileRequestKey(normalizeRequest(item.request))])}
          reply={reply}
          request={normalizeRequest(item.request)}
          setQuestionnaireAnswer={setQuestionnaireAnswer}
          setReply={setReply}
          unlockResponsesLabel={unlockResponsesLabel}
          onUnlockResponses={onUnlockResponses}
        />
      ))}
    </View>
  );
}

type SessionTimelineActivityRow =
  | { kind: "status"; key: string; statusUpdates: StatusUpdateRecord[] }
  | { kind: "tool"; key: string; group: SessionToolActivityGroup };

type SessionTimelineDisplayItem =
  | { kind: "activity_group"; key: string; rows: SessionTimelineActivityRow[] }
  | Extract<ReturnType<typeof groupSessionTimelineItems>[number], { kind: "request" }>;

function groupSessionTimelineDisplayItems(timelineItems: ReturnType<typeof groupSessionTimelineItems>): SessionTimelineDisplayItem[] {
  const displayItems: SessionTimelineDisplayItem[] = [];
  let rows: SessionTimelineActivityRow[] = [];
  const flushRows = () => {
    if (!rows.length) return;
    displayItems.push({ kind: "activity_group", key: rows[0]?.key ?? "activity", rows });
    rows = [];
  };

  for (const item of timelineItems) {
    if (item.kind === "request") {
      flushRows();
      displayItems.push(item);
      continue;
    }
    if (item.kind === "status_group") {
      rows.push({ kind: "status", key: item.key, statusUpdates: item.statusUpdates });
      continue;
    }
    rows.push({ kind: "tool", key: item.group.key, group: item.group });
  }
  flushRows();
  return displayItems;
}

function statusMessageRole(statusUpdate: StatusUpdateRecord): "assistant" | "user" | "system" | undefined {
  const privateContent = privateStatusContent(statusUpdate);
  const role = privateContent?.status === "decrypted" ? privateContent.role : statusUpdate.metadata?.role;
  return role === "assistant" || role === "user" || role === "system" ? role : undefined;
}

function statusContextUsageLabel(statusUpdate: StatusUpdateRecord): string | null {
  const usage = statusUpdate.contextUsage;
  if (!usage) return null;
  const tokenText = usage.tokens === null ? "unknown" : usage.tokens >= 1000 ? `${Math.round(usage.tokens / 1000)}k` : String(usage.tokens);
  const windowText = usage.contextWindow >= 1000 ? `${Math.round(usage.contextWindow / 1000)}k` : String(usage.contextWindow);
  const percentText = usage.percent === null ? "unknown" : `${Math.round(usage.percent)}%`;
  return `${tokenText} / ${windowText} · ${percentText}`;
}

function privateStatusContent(statusUpdate: StatusUpdateRecord) {
  return (statusUpdate as StatusUpdateRecord & {
    privateContent?:
      | { status: "decrypted"; body?: string; preview?: string; role?: "assistant" | "user" | "system"; collapsedByDefault?: boolean; contentFormat?: "markdown" | "text" }
      | { status: "unsupported" | "locked" | "error"; message: string };
  }).privateContent;
}

function statusExpandableMessageBody(statusUpdate: StatusUpdateRecord): string | undefined {
  const privateContent = privateStatusContent(statusUpdate);
  if (privateContent?.status !== "decrypted" || !privateContent.body?.trim()) return undefined;
  return privateContent.body.trim() === statusUpdate.message.trim() ? undefined : privateContent.body;
}

function statusHasExpandableMessageBody(statusUpdate: StatusUpdateRecord): boolean {
  return Boolean(statusExpandableMessageBody(statusUpdate));
}

export function sessionHasExpandableMessageBodies(detail?: Pick<SessionDetail, "timeline">): boolean {
  return Boolean(detail?.timeline.some((item) => item.kind === "status_update" && statusHasExpandableMessageBody(item.statusUpdate)));
}

function latestExpandableStatusUpdateID(timeline: ActivityItem[]): string | undefined {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item?.kind === "status_update" && statusHasExpandableMessageBody(item.statusUpdate)) return item.statusUpdate.statusId;
  }
  return undefined;
}

function statusRoleLabel(statusUpdate: StatusUpdateRecord): string {
  const privateContent = privateStatusContent(statusUpdate);
  const metadataRole = statusUpdate.metadata?.role;
  const role = privateContent?.status === "decrypted" ? privateContent.role : metadataRole;
  if (role === "assistant") return encryptedLabel(translateSource("Assistant"), statusUpdate.contentMode);
  if (role === "user") return encryptedLabel(translateSource("User"), statusUpdate.contentMode);
  return encryptedLabel(translateSource("Status"), statusUpdate.contentMode);
}

function isMirroredMessageStatus(statusUpdate: StatusUpdateRecord): boolean {
  const privateContent = privateStatusContent(statusUpdate);
  return statusUpdate.metadata?.event === "message_end" || (privateContent?.status === "decrypted" && Boolean(privateContent.role));
}

function isRoutineLifecycleStatus(statusUpdate: StatusUpdateRecord): boolean {
  const event = statusUpdate.metadata?.event;
  if (event && ["before_agent_start", "agent_start", "agent_end", "session_shutdown", "turn_end", "working_heartbeat"].includes(event)) return true;
  const message = statusUpdate.message.trim().toLowerCase();
  return message === "working" || message === "finished; waiting" || message === "last turn completed; pi is still working";
}

function visibleStatusUpdatesForGroup(statusUpdates: StatusUpdateRecord[]): StatusUpdateRecord[] {
  if (!statusUpdates.some(isMirroredMessageStatus)) return statusUpdates;
  return statusUpdates.filter((statusUpdate) => !isRoutineLifecycleStatus(statusUpdate));
}

function privateToolActivityContent(toolActivity: Extract<ActivityItem, { kind: "tool_activity" }>["toolActivity"]) {
  return (toolActivity as typeof toolActivity & {
    privateContent?:
      | { status: "decrypted"; detail?: Record<string, unknown> }
      | { status: "unsupported" | "locked" | "error"; message: string };
  }).privateContent;
}

type ToolActivityDisplayCall = {
  key: string;
  toolName: string;
  title: string;
  meta: string;
  result?: string;
  repairMessage?: string;
};

function toolActivityDetail(toolActivity: Extract<ActivityItem, { kind: "tool_activity" }>["toolActivity"]): Record<string, unknown> | undefined {
  const privateContent = privateToolActivityContent(toolActivity);
  return privateContent?.status === "decrypted" ? privateContent.detail : undefined;
}

function toolActivityRepairMessage(toolActivity: Extract<ActivityItem, { kind: "tool_activity" }>["toolActivity"]): string | undefined {
  const privateContent = privateToolActivityContent(toolActivity);
  return privateContent && privateContent.status !== "decrypted" ? privateContent.message : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(object: Record<string, unknown> | undefined, field: string): string | undefined {
  const value = object?.[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function truncateMiddle(value: string, maxLength = 140): string {
  if (value.length <= maxLength) return value;
  const head = Math.ceil((maxLength - 1) * 0.62);
  const tail = Math.floor((maxLength - 1) * 0.38);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

function commandSnippet(command: string): string {
  const normalized = command.replace(/\s+/g, " ").trim();
  return truncateMiddle(normalized, 180);
}

function titleForToolCall(toolName: string, detail: Record<string, unknown> | undefined, fallbackSummary: string | undefined): string {
  const input = asRecord(detail?.input);
  if (toolName === "bash") {
    const command = stringField(input, "command");
    return command ? commandSnippet(command) : fallbackSummary || translateSource("Shell command");
  }
  if (toolName === "read") {
    const path = stringField(input, "path");
    return path ? `${translateSource("Read")} ${truncateMiddle(path)}` : fallbackSummary || translateSource("Read file");
  }
  if (toolName === "edit") {
    const path = stringField(input, "path");
    return path ? `${translateSource("Edited")} ${truncateMiddle(path)}` : fallbackSummary || translateSource("Edited file");
  }
  if (toolName === "write") {
    const path = stringField(input, "path");
    return path ? `${translateSource("Wrote")} ${truncateMiddle(path)}` : fallbackSummary || translateSource("Wrote file");
  }
  return fallbackSummary || toolName;
}

function toolCallOutcomeLabel(outcome: Extract<ActivityItem, { kind: "tool_activity" }>["toolActivity"]["outcome"] | undefined, running: boolean): string {
  if (running) return translateSource("running");
  if (outcome === "failed") return translateSource("failed");
  if (outcome === "cancelled") return translateSource("cancelled");
  return translateSource("completed");
}

function toolActivityDisplayCalls(toolActivities: Extract<ActivityItem, { kind: "tool_activity" }>["toolActivity"][]): ToolActivityDisplayCall[] {
  const calls = new Map<string, Extract<ActivityItem, { kind: "tool_activity" }>["toolActivity"][]>();
  const ordered = [...toolActivities].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.toolActivityId.localeCompare(right.toolActivityId);
  });
  for (const activity of ordered) {
    const key = activity.toolCallId || activity.toolActivityId;
    calls.set(key, [...(calls.get(key) ?? []), activity]);
  }

  return [...calls.entries()].map(([key, activities]) => {
    const start = activities.find((activity) => activity.state === "started") ?? activities[0];
    const finish = [...activities].reverse().find((activity) => activity.state === "finished");
    const last = finish ?? activities[activities.length - 1] ?? start;
    const toolName = start?.toolName ?? last?.toolName ?? translateSource("Tool");
    const startDetail = start ? toolActivityDetail(start) : undefined;
    const finishDetail = finish ? toolActivityDetail(finish) : undefined;
    const running = Boolean(start && !finish);
    const outcome = finish?.outcome;
    const result = typeof finishDetail?.result === "string" && finishDetail.result.trim() ? finishDetail.result.trim() : undefined;
    const repairMessage = activities.map(toolActivityRepairMessage).find(Boolean);
    return {
      key,
      toolName,
      title: titleForToolCall(toolName, startDetail ?? finishDetail, finish?.summary ?? start?.summary),
      meta: [toolName, toolCallOutcomeLabel(outcome, running), last ? formatRequestTime(last.createdAt) : undefined].filter(Boolean).join(" · "),
      ...(result ? { result } : {}),
      ...(repairMessage ? { repairMessage } : {}),
    };
  });
}

function SessionToolActivityTimelineRow({ first, group }: { first: boolean; group: SessionToolActivityGroup }) {
  const [expanded, setExpanded] = useState(false);
  const counts = toolActivityCountsLabel(group.toolActivities);
  const callCount = toolActivityCallCountLabel(group.toolActivities);
  const outcome = toolActivityGroupOutcomeLabel(group.toolActivities);
  const running = toolActivityGroupInProgress(group.toolActivities);
  const title = running ? translateSource("Using tools…") : translateSource("Tools");
  const firstTime = group.toolActivities[0]?.createdAt;
  const detailsAvailable = group.toolActivities.some((activity) => activity.summary || privateToolActivityContent(activity));
  return (
    <View style={[styles.statusTimelineRow, styles.statusMessageTimelineRow, styles.statusMessageTimelineRowTools, first ? styles.statusTimelineRowFirst : null]}>
      <View style={styles.statusTimelineBody}>
        <Pressable accessibilityRole="button" disabled={!detailsAvailable} onPress={() => setExpanded((value) => !value)} style={styles.toolActivitySummaryPressable}>
          <View style={styles.statusMessageHeader}>
            <Text style={[styles.statusMessageRole, styles.statusMessageRoleTools]}>{title}</Text>
            <Text style={styles.statusMessageMeta}>{[firstTime ? formatRequestTime(firstTime) : undefined, running ? translateSource("running") : undefined].filter(Boolean).join(" · ")}</Text>
          </View>
          <Text style={styles.statusTimelineMessage}>{`${callCount} · ${outcome}`}</Text>
          {counts ? <Text style={styles.statusNext}>{counts}</Text> : null}
        </Pressable>
        {expanded ? toolActivityDisplayCalls(group.toolActivities).map((call) => (
          <View key={call.key} style={styles.toolActivityInlineDetailRow}>
            <View style={styles.statusTimelineBody}>
              <Text style={styles.toolActivityInlineMeta}>{call.title}</Text>
              <Text style={styles.toolActivityInlineCounts}>{call.meta}</Text>
              {call.repairMessage ? <Text style={styles.toolActivityInlineCounts}>{call.repairMessage}</Text> : null}
              {call.result ? <Text style={styles.statusTimelineMarkdownBody}>{call.result}</Text> : null}
            </View>
          </View>
        )) : null}
      </View>
    </View>
  );
}

type SessionTimelineVisibleActivityRow =
  | { kind: "status"; key: string; statusUpdate: StatusUpdateRecord }
  | { kind: "tool"; key: string; group: SessionToolActivityGroup };

function SessionActivityTimelineGroup({ groupKey, messageBodiesExpanded, onStatusLayout, rows }: { groupKey: string; messageBodiesExpanded?: boolean; onStatusLayout?: (statusID: string, y: number) => void; rows: SessionTimelineActivityRow[] }) {
  const groupLayoutYRef = useRef<number | null>(null);
  const rowLayoutYRef = useRef<Record<string, number>>({});
  const reportRowLayout = (statusID: string, rowY: number) => {
    rowLayoutYRef.current[statusID] = rowY;
    const groupY = groupLayoutYRef.current;
    if (typeof groupY === "number") onStatusLayout?.(statusID, groupY + rowY);
  };
  const visibleRows: SessionTimelineVisibleActivityRow[] = [];
  for (const row of rows) {
    if (row.kind === "status") {
      for (const statusUpdate of visibleStatusUpdatesForGroup(row.statusUpdates)) {
        visibleRows.push({ kind: "status", key: `${row.key}:${statusUpdate.statusId}`, statusUpdate });
      }
      continue;
    }
    visibleRows.push({ kind: "tool", key: row.key, group: row.group });
  }
  if (!visibleRows.length) return null;
  const allConversationRows = visibleRows.every((row) => row.kind === "tool" || isMirroredMessageStatus(row.statusUpdate) || Boolean(privateStatusContent(row.statusUpdate)));
  return (
    <View
      onLayout={(event) => {
        groupLayoutYRef.current = event.nativeEvent.layout.y;
        for (const row of visibleRows) {
          if (row.kind !== "status") continue;
          const rowY = rowLayoutYRef.current[row.statusUpdate.statusId];
          if (typeof rowY === "number") onStatusLayout?.(row.statusUpdate.statusId, event.nativeEvent.layout.y + rowY);
        }
      }}
      style={styles.statusTimelineGroup}
    >
      {allConversationRows ? null : <Text style={styles.statusTimelineGroupLabel}>{translateSource("Status updates")}</Text>}
      {visibleRows.map((row, index) => row.kind === "status" ? (
        <SessionStatusTimelineRow key={row.key} first={index === 0} messageBodiesExpanded={messageBodiesExpanded} onLayout={(y) => reportRowLayout(row.statusUpdate.statusId, y)} statusUpdate={row.statusUpdate} />
      ) : (
        <SessionToolActivityTimelineRow key={row.key} first={index === 0} group={row.group} />
      ))}
    </View>
  );
}

function SessionStatusTimelineRow({ first, messageBodiesExpanded, onLayout, statusUpdate }: { first: boolean; messageBodiesExpanded?: boolean; onLayout?: (y: number) => void; statusUpdate: StatusUpdateRecord }) {
  const privateContent = privateStatusContent(statusUpdate);
  const [localExpanded, setLocalExpanded] = useState(!privateContent || privateContent.status !== "decrypted" || privateContent.collapsedByDefault === false);
  const expanded = messageBodiesExpanded ?? localExpanded;
  const usesGlobalExpansion = messageBodiesExpanded !== undefined;
  const body = statusExpandableMessageBody(statusUpdate);
  const bodyIsHidden = Boolean(body && !expanded);
  const usageLabel = statusContextUsageLabel(statusUpdate);
  const repairMessage = privateContent && privateContent.status !== "decrypted" ? privateContent.message : undefined;
  const roleLabel = statusRoleLabel(statusUpdate);
  const conversationRow = isMirroredMessageStatus(statusUpdate) || Boolean(privateContent);
  const toggleLabel = privateContent?.status === "decrypted" && privateContent.role === "user" ? {
    show: translateSource("Show full message"),
    hide: translateSource("Hide full message"),
  } : {
    show: translateSource("Show full reply"),
    hide: translateSource("Hide full reply"),
  };

  if (conversationRow) {
    const role = statusMessageRole(statusUpdate);
    const meta = [formatRequestTime(statusUpdate.createdAt), statusUpdate.state, usageLabel].filter(Boolean).join(" · ");
    return (
      <View onLayout={(event) => onLayout?.(event.nativeEvent.layout.y)} style={[styles.statusTimelineRow, styles.statusMessageTimelineRow, role === "user" ? styles.statusMessageTimelineRowUser : styles.statusMessageTimelineRowAssistant, first ? styles.statusTimelineRowFirst : null]}>
        <View style={styles.statusTimelineBody}>
          <View style={styles.statusMessageHeader}>
            <Text style={[styles.statusMessageRole, role === "user" ? styles.statusMessageRoleUser : styles.statusMessageRoleAssistant]}>{roleLabel}</Text>
            <Text style={styles.statusMessageMeta}>{meta}</Text>
          </View>
          {!body || !expanded ? <MarkdownInlineText text={statusUpdate.message} style={styles.statusTimelineMessage} /> : null}
          {repairMessage ? <MarkdownInlineText text={repairMessage} style={styles.statusNext} /> : null}
          {body ? (
            <View style={styles.statusFullReplyPanel}>
              {expanded ? <MarkdownText text={body} paragraphStyle={styles.statusTimelineMarkdownBody} /> : null}
              {!usesGlobalExpansion ? (
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setLocalExpanded((value) => !value)} style={styles.statusFullReplyButton}>
                  <Text style={styles.statusFullReplyButtonText}>{bodyIsHidden ? toggleLabel.show : toggleLabel.hide}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {statusUpdate.nextStep ? <MarkdownInlineText text={`Next: ${statusUpdate.nextStep}`} style={styles.statusNext} /> : null}
        </View>
      </View>
    );
  }

  return (
    <View onLayout={(event) => onLayout?.(event.nativeEvent.layout.y)} style={[styles.statusTimelineRow, first ? styles.statusTimelineRowFirst : null]}>
      <Text style={styles.statusTimelineTime}>{formatRequestTime(statusUpdate.createdAt)}</Text>
      <View style={styles.statusTimelineBody}>
        <Text style={styles.statusTimelineGroupLabel}>{roleLabel}</Text>
        <MarkdownInlineText text={statusUpdate.message} style={styles.statusTimelineMessage} />
        {repairMessage ? <MarkdownInlineText text={repairMessage} style={styles.statusNext} /> : null}
        {usageLabel ? <Text style={styles.statusNext}>{usageLabel}</Text> : null}
        {statusUpdate.nextStep ? <MarkdownInlineText text={`Next: ${statusUpdate.nextStep}`} style={styles.statusNext} /> : null}
      </View>
      <Text style={styles.statusTimelineState}>{statusUpdate.state}</Text>
    </View>
  );
}

function PastRequestChoiceSummary({ request }: { request: MobileRequest }) {
  if (!request.choices?.length) return null;
  const steeringLike = request.requestType === "steering" || isQuestionnaireRequest(request);
  const choices = steeringLike ? request.choices.filter((choice) => !isRequestLevelCancelChoice(choice)) : request.choices;
  if (!choices.length) return null;
  const selectedChoiceID = request.response?.choiceId ?? (request.quorum?.responses ?? request.responses ?? []).find((response) => response.choiceId)?.choiceId;
  return (
    <View style={styles.pastRequestOptionsPanel}>
      <Text style={styles.contextSummaryTitle}>{translateSource("Options")}</Text>
      {choices.map((choice) => (
        <View key={choice.id} style={[styles.pastRequestOptionRow, choice.id === selectedChoiceID ? styles.pastRequestOptionSelected : null]}>
          <Text style={[styles.pastRequestOptionText, choice.id === selectedChoiceID ? styles.pastRequestOptionTextSelected : null]}>{choice.label}</Text>
        </View>
      ))}
    </View>
  );
}

function SessionRequestTimelineItem({
  request,
  focused,
  onFocus,
  onLayout,
  onRespond,
  onSubmitQuestionnaire,
  pastRequestPresentation = "auto",
  choiceInteractionMode,
  confirmBeforeSubmit,
  questionnaireAnswers,
  setQuestionnaireAnswer,
  reply,
  setReply,
  readOnly,
  readOnlyReason,
  responding = false,
  unlockResponsesLabel,
  onUnlockResponses,
}: {
  request: MobileRequest;
  focused: boolean;
  onFocus: () => void;
  onLayout?: (y: number) => void;
  onRespond: (request: MobileRequest, choice: Choice) => void;
  onSubmitQuestionnaire: (request: MobileRequest, answers?: Record<string, string[]>) => void;
  pastRequestPresentation?: "auto" | "collapsed";
  choiceInteractionMode: ChoiceInteractionMode;
  confirmBeforeSubmit: boolean;
  questionnaireAnswers: Record<string, string[]>;
  setQuestionnaireAnswer: (question: string, option: string, multiSelect: boolean) => void;
  reply: string;
  setReply: (value: string) => void;
  readOnly: boolean;
  readOnlyReason?: string;
  responding?: boolean;
  unlockResponsesLabel?: string;
  onUnlockResponses?: () => void;
}) {
  const requestCanRespond = canRespondToRequest(request);
  const isPastRequest = request.status !== "pending" || Boolean(request.response);
  const forceCollapsedPastRequest = pastRequestPresentation === "collapsed" && isPastRequest;
  const [expandedPastRequest, setExpandedPastRequest] = useState(!isPastRequest);
  const effectiveReadOnly = (readOnly && !request.isTest) || responding;
  const canShowReadOnlyChoices = effectiveReadOnly && request.status === "pending" && !request.response && (request.choices?.length ?? 0) > 0;
  const canRespond = !effectiveReadOnly && requestCanRespond;
  const canFocusRequest = requestCanRespond || canShowReadOnlyChoices;
  const staleWarning = requestStaleWarning(request);
  const requestUsesSteeringChoices = request.requestType === "steering" || isQuestionnaireRequest(request);
  const displayedQuestionnaireAnswers = isPastRequest && request.response?.answers ? request.response.answers : questionnaireAnswers;
  const submitChoice = (choice: Choice) => {
    recordDiagnostic("info", "button", "session_request_choice_pressed", { requestId: request.id, choiceId: choice.id, choiceKind: choice.kind, confirmBeforeSubmit, readOnly: effectiveReadOnly, requestCanRespond });
    const send = () => {
      recordDiagnostic("info", "button", "session_request_choice_confirmed", { requestId: request.id, choiceId: choice.id, choiceKind: choice.kind });
      onRespond(request, choice);
    };
    const requiresHighRiskConfirmation = request.requestType === "sanction" && request.risk === "high" && choice.kind === "approve";
    if (requiresHighRiskConfirmation) {
      Alert.alert(translateSource("Approve high-risk Sanction?"), choice.label, [
        { text: translateSource("Cancel"), style: "cancel" },
        { text: translateSource("Approve Sanction"), onPress: send },
      ]);
      return;
    }
    if (!isRequestLevelCancelChoice(choice) && (choiceInteractionMode === "click-to-submit" || (!requestUsesSteeringChoices && !confirmBeforeSubmit))) {
      send();
      return;
    }
    Alert.alert(translateSource("Send this decision?"), choice.label, [
      { text: translateSource("Cancel"), style: "cancel" },
      { text: translateSource("Send decision"), onPress: send },
    ]);
  };
  const requestQuestions = request.questions ?? [];
  const requestCancelChoices = (request.choices ?? []).filter(isRequestLevelCancelChoice);
  const requestWaiterCancelChoice = !effectiveReadOnly && request.agentWaiter ? requestCancelChoices[0] : undefined;
  const requestInlineCancelChoices = requestWaiterCancelChoice ? [] : requestCancelChoices;
  const requestChoiceCards = requestWaiterCancelChoice && requestUsesSteeringChoices
    ? (request.choices ?? []).filter((choice) => !isRequestLevelCancelChoice(choice))
    : (request.choices ?? []);
  const submitQuestionnaireSelection = (question: string, option: string, multiSelect: boolean) => {
    const nextAnswers = updateQuestionnaireAnswers(questionnaireAnswers, question, option, multiSelect);
    setQuestionnaireAnswer(question, option, multiSelect);
    if (!multiSelect && choiceInteractionMode === "click-to-submit" && !effectiveReadOnly && questionnaireReady(request, nextAnswers)) {
      onSubmitQuestionnaire(request, nextAnswers);
    }
  };
  const requestQuestionnaireControls = isQuestionnaireRequest(request) ? (
    <>
      {requestQuestions.map((question, index) => (
        <QuestionnaireOptionCards
          key={question.question}
          question={question}
          selectedAnswers={displayedQuestionnaireAnswers[question.question] ?? []}
          cancelChoices={index === requestQuestions.length - 1 ? requestInlineCancelChoices : []}
          disabled={effectiveReadOnly}
          hideQuestionLabel={question.question.trim() === request.title.trim()}
          onCancel={submitChoice}
          onSelect={submitQuestionnaireSelection}
        />
      ))}
    </>
  ) : null;

  const wasPastRequest = useRef(isPastRequest);
  useEffect(() => {
    if (!isPastRequest) {
      setExpandedPastRequest(true);
    } else if (!wasPastRequest.current) {
      setExpandedPastRequest(false);
    }
    wasPastRequest.current = isPastRequest;
  }, [isPastRequest]);

  if (isPastRequest && (forceCollapsedPastRequest || !expandedPastRequest)) {
    return (
      <Pressable
        accessibilityLabel={`Expand past Request ${request.title}`}
        accessibilityRole="button"
        onLayout={(event) => onLayout?.(event.nativeEvent.layout.y)}
        onPress={() => { if (!forceCollapsedPastRequest) setExpandedPastRequest(true); }}
        style={[styles.sessionTimelineItem, styles.pastRequestCollapsed]}
      >
        <View style={styles.pastRequestCollapsedHeader}>
          <MarkdownInlineText text={request.title} style={styles.pastRequestCollapsedTitle} />
          <Text style={styles.contextSummaryChevron}>⌄</Text>
        </View>
        <Text numberOfLines={2} style={styles.pastRequestAnswer}>{translateSource("Answer")}: {requestAnswerSummary(request)}</Text>
      </Pressable>
    );
  }

  return (
    <View onLayout={(event) => onLayout?.(event.nativeEvent.layout.y)} style={[styles.sessionTimelineItem, focused ? styles.sessionTimelineItemFocused : null, isPastRequest ? styles.pastRequestExpanded : null]}>
      {isPastRequest ? (
        <Pressable accessibilityLabel={`Collapse past Request ${request.title}`} accessibilityRole="button" onPress={() => setExpandedPastRequest(false)} style={styles.pastRequestCollapseButton}>
          <Text style={styles.secondaryButtonText}>{translateSource("Collapse")}</Text>
          <Text style={styles.contextSummaryChevron}>⌃</Text>
        </Pressable>
      ) : null}
      <View style={styles.statusCardHeader}>
        <Text style={styles.statusLabel}>{encryptedLabel(requestUsesSteeringChoices ? translateSource("Steering Request") : translateSource("Sanction Request"), request.contentMode)}</Text>
        <Text style={styles.historyStatus}>{requestStatusLabel(request)}</Text>
      </View>
      {request.isTest || request.testLabel ? <Text style={styles.testRequestBadge}>{request.testLabel || translateSource("Test Request")}</Text> : null}
      <MarkdownInlineText text={request.title} style={requestTitleStyles(request.title)} />
      <View style={styles.detailFacts}>
        {request.risk ? <Text style={[styles.riskBadge, request.risk === "high" ? styles.riskHigh : null, request.risk === "medium" ? styles.riskMedium : null, request.risk === "low" ? styles.riskLow : null]}>{request.risk}</Text> : null}
        <Text style={styles.factText}>{formatRequestTime(request.createdAt)}</Text>
        {request.deadline ? <Text style={styles.factText}>Expires {formatRequestTime(request.deadline)}</Text> : null}
      </View>
      {staleWarning ? <Text style={styles.warningText}>{staleWarning}</Text> : null}
      {request.body ? <MarkdownText selectable style={styles.markdownBody} text={request.body} /> : null}
      {request.command ? <Text selectable style={styles.commandText}>{request.command}</Text> : null}
      <AudienceRequestPanel request={request} />
      {request.status === "pending" ? <QuorumProgressPanel request={request} /> : null}
      {isQuestionnaireRequest(request) && !(focused && request.status === "pending") ? (
        <View style={styles.questionnairePanel}>
          {requestQuestions.map((question) => (
            <QuestionnaireOptionCards
              key={question.question}
              question={question}
              selectedAnswers={displayedQuestionnaireAnswers[question.question] ?? []}
              disabled={effectiveReadOnly}
              hideQuestionLabel={question.question.trim() === request.title.trim()}
              onSelect={setQuestionnaireAnswer}
            />
          ))}
        </View>
      ) : null}
      {isPastRequest ? <PastRequestChoiceSummary request={request} /> : null}
      {request.allowFreeformReply && !isPastRequest ? <TextInput editable={!effectiveReadOnly} multiline onChangeText={setReply} placeholder="Optional message" style={[styles.reply, effectiveReadOnly ? styles.choiceButtonDisabled : null]} value={reply} /> : null}
      {focused && request.status === "pending" ? (
        <View style={[styles.actions, styles.actionsInline]}>
          {effectiveReadOnly ? (
            <>
              {isQuestionnaireRequest(request) ? requestQuestionnaireControls : canShowReadOnlyChoices ? (
                <DirectChoiceCards choices={requestChoiceCards} disabled separateCancel={requestUsesSteeringChoices} onSubmit={submitChoice} />
              ) : null}
              <View style={styles.readOnlyPanel}>
                <Text style={styles.actionHint}>{responding ? translateSource("Sending response…") : readOnlyReason || translateSource("Responses require an active 7-day Trial, Hosted subscription, or Self-hosted Lifetime unlock.")}</Text>
                {!responding && onUnlockResponses ? <Pressable onPress={onUnlockResponses} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{translateSource(unlockResponsesLabel ?? "Unlock responses")}</Text></Pressable> : null}
              </View>
            </>
          ) : isQuestionnaireRequest(request) ? (
            <>
              {requestQuestionnaireControls}
              <Pressable disabled={!questionnaireReady(request, questionnaireAnswers)} onPress={() => onSubmitQuestionnaire(request)} style={[styles.choiceButton, styles.submitButton, !questionnaireReady(request, questionnaireAnswers) ? styles.choiceButtonDisabled : null]}>
                <Text style={styles.choiceText}>{translateSource("Submit Answers")}</Text>
              </Pressable>
            </>
          ) : canRespond ? (
            <DirectChoiceCards choices={requestChoiceCards} separateCancel={requestUsesSteeringChoices} onSubmit={submitChoice} />
          ) : (
            <Text style={styles.actionHint}>{quorumProgressMessage(request) || translateSource("This request is read-only.")}</Text>
          )}
        </View>
      ) : canFocusRequest ? (
        <Pressable accessibilityLabel={`Focus Request ${request.title}`} onPress={onFocus} style={[styles.secondaryButton, styles.focusRequestButton]}>
          <Text style={styles.secondaryButtonText}>{translateSource("Focus Request")}</Text>
        </Pressable>
      ) : null}
      {request.status === "pending" && request.agentWaiter ? <RequestWaiterLivenessPanel cancelChoice={focused ? requestWaiterCancelChoice : undefined} onCancel={submitChoice} waiter={request.agentWaiter} /> : null}
    </View>
  );
}

