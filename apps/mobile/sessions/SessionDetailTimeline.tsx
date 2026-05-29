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
  const initialScrollDoneRef = useRef("");
  const downNudge = useRef(new Animated.Value(0)).current;
  const timelineAtEnd = timelineViewportHeight > 0 && timelineContentHeight > 0
    ? timelineContentHeight <= timelineViewportHeight + timelineScrollY + 56
    : userAtTimelineEnd;
  const autoFocusNewActivity = shouldAutoFocusSessionTimelineNewActivity({ userIdle, userAtTimelineEnd: userAtTimelineEnd || timelineAtEnd });
  const hasNewActivity = Boolean(timelineEndKey && seenTimelineEndKey && timelineEndKey !== seenTimelineEndKey && !autoFocusNewActivity);
  const showNewActivityHint = hasNewActivity && !timelineAtEnd;

  useEffect(() => {
    setFocusedRequestID(defaultFocusedRequestID);
    setRenderWindow(initialRenderWindow);
    setSeenTimelineEndKey(timelineEndKey);
    initialScrollDoneRef.current = "";
    requestLayoutYRef.current = {};
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
          onRespond={onRespond}
          onSubmitQuestionnaire={onSubmitQuestionnaire}
          onTimelineLayout={(y) => {
            timelineItemsTopRef.current = y;
            setTimelineLayoutVersion((version) => version + 1);
          }}
          onUnlockResponses={onUnlockResponses}
          questionnaireAnswers={questionnaireAnswers}
          readOnly={readOnly}
          readOnlyReason={readOnlyReason}
          reply={reply}
          respondingRequestKeys={respondingRequestKeys}
          setQuestionnaireAnswer={setQuestionnaireAnswer}
          setReply={setReply}
          timeline={renderedTimeline}
          unlockResponsesLabel={unlockResponsesLabel}
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
}: {
  timeline: ActivityItem[];
  focusedRequestID: string | null;
  onFocusRequest: (requestID: string) => void;
  onRequestLayout?: (requestID: string, y: number) => void;
  onRespond: (request: MobileRequest, choice: Choice) => void;
  onSubmitQuestionnaire: (request: MobileRequest, answers?: Record<string, string[]>) => void;
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
}) {
  const timelineItems = useMemo(() => groupSessionTimelineItems(timeline), [timeline]);
  return (
    <View onLayout={(event) => onTimelineLayout?.(event.nativeEvent.layout.y)} style={styles.sessionTimelineItems}>
      {timelineItems.map((item) => item.kind === "status_group" ? (
        <SessionStatusTimelineGroup key={item.key} statusUpdates={item.statusUpdates} />
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

function SessionStatusTimelineGroup({ statusUpdates }: { statusUpdates: StatusUpdateRecord[] }) {
  return (
    <View style={styles.statusTimelineGroup}>
      <Text style={styles.statusTimelineGroupLabel}>{translateSource("Status updates")}</Text>
      {statusUpdates.map((statusUpdate, index) => (
        <View key={statusUpdate.statusId} style={[styles.statusTimelineRow, index === 0 ? styles.statusTimelineRowFirst : null]}>
          <Text style={styles.statusTimelineTime}>{formatRequestTime(statusUpdate.createdAt)}</Text>
          <View style={styles.statusTimelineBody}>
            <MarkdownInlineText text={statusUpdate.message} style={styles.statusTimelineMessage} />
            {statusUpdate.nextStep ? <MarkdownInlineText text={`Next: ${statusUpdate.nextStep}`} style={styles.statusNext} /> : null}
          </View>
          <Text style={styles.statusTimelineState}>{statusUpdate.state}</Text>
        </View>
      ))}
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
  const canRespond = !effectiveReadOnly && requestCanRespond;
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
        <Text style={styles.statusLabel}>{requestUsesSteeringChoices ? translateSource("Steering Request") : translateSource("Sanction Request")}</Text>
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
              {isQuestionnaireRequest(request) ? requestQuestionnaireControls : null}
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
      ) : requestCanRespond ? (
        <Pressable accessibilityLabel={`Focus Request ${request.title}`} onPress={onFocus} style={[styles.secondaryButton, styles.focusRequestButton]}>
          <Text style={styles.secondaryButtonText}>{translateSource("Focus Request")}</Text>
        </Pressable>
      ) : null}
      {request.status === "pending" && request.agentWaiter ? <RequestWaiterLivenessPanel cancelChoice={focused ? requestWaiterCancelChoice : undefined} onCancel={submitChoice} waiter={request.agentWaiter} /> : null}
    </View>
  );
}

