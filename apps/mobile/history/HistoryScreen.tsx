import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { translateSource } from "@agent-tick/i18n";

import { MarkdownInlineText, MarkdownText } from "../MarkdownText";
import { styles } from "../mobileStyles";
import type { MobileSessionDetail, MobileSessionSummary } from "../mobileTypes";
import {
  isQuestionnaireRequest,
  mobileRequestKey,
  normalizeRequest,
  requestCommandDetails,
  requestRequesterLabel,
  requestResponseHistory,
  requestStatusLabel,
  type MobileRequest,
} from "../requests";
import { RequestContextPanel, QuorumProgressPanel } from "../requestsScreen/RequestPanels";
import { formatRequestTime, requestTitleStyles } from "../requestsScreen/requestDisplayHelpers";
import { sessionStackSessionKey } from "../sessionStackState";
import { groupSessionTimelineItems, orderedSessionTimeline, sessionTimelineItemKey, toolActivityCallCountLabel, toolActivityCountsLabel, toolActivityGroupOutcomeLabel } from "../sessions/sessionTimelineLogic";

export function HistoryScreen({
  error,
  history,
  loading,
  onRefresh,
  sessionArchives = [],
  sessionDetails = {},
}: {
  error: string | null;
  history: MobileRequest[];
  loading: boolean;
  onRefresh: () => void;
  sessionArchives?: MobileSessionSummary[];
  sessionDetails?: Record<string, MobileSessionDetail | undefined>;
}) {
  const [selectedHistoryID, setSelectedHistoryID] = useState<string | null>(null);
  const [selectedArchiveSessionID, setSelectedArchiveSessionID] = useState<string | null>(null);
  const selectedHistoryIndex = history.findIndex((request) => mobileRequestKey(request) === selectedHistoryID);
  const selectedHistory = selectedHistoryIndex >= 0 ? history[selectedHistoryIndex] : undefined;
  const previousHistory = selectedHistoryIndex > 0 ? history[selectedHistoryIndex - 1] : undefined;
  const nextHistory = selectedHistoryIndex >= 0 && selectedHistoryIndex < history.length - 1 ? history[selectedHistoryIndex + 1] : undefined;
  const selectedArchiveSession = selectedArchiveSessionID ? sessionArchives.find((session) => sessionStackSessionKey(session) === selectedArchiveSessionID) : undefined;
  const selectedArchiveDetail = selectedArchiveSession ? sessionDetails[sessionStackSessionKey(selectedArchiveSession)] : undefined;

  if (selectedArchiveSession) {
    return <SessionArchiveDetailScreen detail={selectedArchiveDetail} onBack={() => setSelectedArchiveSessionID(null)} summary={selectedArchiveSession} />;
  }

  if (selectedHistory) {
    return (
      <HistoryDetailScreen
        onBack={() => setSelectedHistoryID(null)}
        onNext={nextHistory ? () => setSelectedHistoryID(mobileRequestKey(nextHistory)) : undefined}
        onPrevious={previousHistory ? () => setSelectedHistoryID(mobileRequestKey(previousHistory)) : undefined}
        request={selectedHistory}
      />
    );
  }

  return (
    <View style={styles.historyPane}>
      <View style={styles.historyHeader}>
        <Text style={styles.sectionHeading}>{translateSource("History")}</Text>
        <Pressable onPress={onRefresh} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>{loading ? "..." : translateSource("Refresh")}</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <ScrollView contentContainerStyle={styles.historyList}>
        {sessionArchives.length > 0 ? (
          <>
            <Text style={styles.historyDetailType}>{translateSource("Session Archive")}</Text>
            {sessionArchives.map((session) => (
              <Pressable
                accessibilityLabel={`Open archived Session ${session.title}`}
                accessibilityRole="button"
                key={sessionStackSessionKey(session)}
                onPress={() => setSelectedArchiveSessionID(sessionStackSessionKey(session))}
                style={styles.historyRow}
              >
                <View style={styles.historyRowTop}>
                  <Text numberOfLines={2} style={styles.historyTitle}>{session.title}</Text>
                  <Text style={styles.historyStatus}>{session.state}</Text>
                </View>
                <Text numberOfLines={1} style={styles.historyMeta}>{session.pendingRequestCount} pending · {new Date(session.updatedAt).toLocaleString()}</Text>
                <Text numberOfLines={2} style={styles.historyResponseText}>{session.latestActivity.preview}</Text>
              </Pressable>
            ))}
          </>
        ) : history.length === 0 ? (
          <Text style={styles.emptyText}>{translateSource("No Session archive yet.")}</Text>
        ) : (
          history.map((request) => (
            <Pressable
              accessibilityLabel={`Open history item ${request.title}`}
              accessibilityRole="button"
              key={mobileRequestKey(request)}
              onPress={() => setSelectedHistoryID(mobileRequestKey(request))}
              style={styles.historyRow}
            >
              <View style={styles.historyRowTop}>
                <Text numberOfLines={2} style={styles.historyTitle}>
                  {request.title}
                </Text>
                <Text
                  style={[
                    styles.historyStatus,
                    requestStatusLabel(request) === translateSource("Approved")
                      ? styles.historyStatusApprove
                      : null,
                    requestStatusLabel(request) === translateSource("Denied")
                      ? styles.historyStatusDeny
                      : null,
                  ]}
                >
                  {requestStatusLabel(request)}
                </Text>
              </View>
              <Text numberOfLines={1} style={styles.historyMeta}>
                {historyKindLabel(request)} · {request.requester.host || request.requester.name || translateSource("Agent")} · {translateSource("Tap for details")}
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
              {requestResponseHistory(request).length > 0 ? (
                <View style={styles.historyResponses}>
                  {requestResponseHistory(request).slice(0, 2).map((response) => (
                    <Text key={response.id} style={styles.historyResponseText}>
                      {response.label}
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

function SessionArchiveDetailScreen({ detail, onBack, summary }: { detail?: MobileSessionDetail; onBack: () => void; summary: MobileSessionSummary }) {
  return (
    <View style={styles.historyPane}>
      <View style={styles.historyHeader}>
        <Pressable accessibilityLabel={translateSource("Back to history")} onPress={onBack} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>{translateSource("Back")}</Text>
        </Pressable>
        <Text style={styles.historyStatus}>{summary.state}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.historyDetailContent}>
        <Text style={styles.historyDetailType}>{translateSource("Session Archive")}</Text>
        <Text style={styles.sectionHeading}>{summary.title}</Text>
        {!detail ? <Text style={styles.emptyText}>{translateSource("Session timeline is loading.")}</Text> : null}
        {detail ? groupSessionTimelineItems(orderedSessionTimeline(detail)).map((item) => (
          item.kind === "status_group" ? item.statusUpdates.map((statusUpdate) => (
            <View key={statusUpdate.statusId} style={styles.historyRow}>
              <Text style={styles.historyDetailType}>{translateSource("Status Update")}</Text>
              <MarkdownInlineText text={statusUpdate.message} style={styles.statusMessage} />
              <Text style={styles.historyMeta}>{statusUpdate.state} · {formatRequestTime(statusUpdate.createdAt)}</Text>
            </View>
          )) : item.kind === "tool_activity_group" ? (
            <View key={item.group.key} style={styles.historyRow}>
              <Text style={styles.historyDetailType}>{translateSource("Tool Activity")}</Text>
              <MarkdownInlineText text={`${translateSource("Tools used")} · ${toolActivityCallCountLabel(item.group.toolActivities)}`} style={styles.statusMessage} />
              <Text style={styles.historyMeta}>{toolActivityCountsLabel(item.group.toolActivities)} · {toolActivityGroupOutcomeLabel(item.group.toolActivities)} · {formatRequestTime(item.group.toolActivities[0]?.createdAt ?? summary.updatedAt)}</Text>
            </View>
          ) : (
            <View key={sessionTimelineItemKey(item.timelineItem)} style={styles.historyRow}>
              <Text style={styles.historyDetailType}>{translateSource("Request")}</Text>
              <MarkdownInlineText text={item.request.title} style={styles.statusMessage} />
              <Text style={styles.historyMeta}>{item.request.status} · {formatRequestTime(item.request.createdAt)}</Text>
              {item.request.command ? <Text selectable style={styles.commandText}>{item.request.command}</Text> : null}
              <QuorumProgressPanel request={normalizeRequest(item.request)} />
            </View>
          )
        )) : null}
      </ScrollView>
    </View>
  );
}

function HistoryDetailScreen({
  onBack,
  onNext,
  onPrevious,
  request,
}: {
  onBack: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  request: MobileRequest;
}) {
  const title = request.title;
  const body = request.body;
  const command = request.command;
  const responseAnswers = request.response?.answers ?? request.responses?.find((response) => response.userId)?.answers;

  return (
    <View style={styles.historyPane}>
      <View style={styles.historyHeader}>
        <Pressable accessibilityLabel={translateSource("Back to history")} onPress={onBack} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>{translateSource("Back")}</Text>
        </Pressable>
        <Text style={styles.historyStatus}>{requestStatusLabel(request)}</Text>
      </View>
      <View style={styles.historyDetailNav}>
        <Pressable
          accessibilityLabel={translateSource("Previous history item")}
          accessibilityRole="button"
          disabled={!onPrevious}
          onPress={onPrevious}
          style={[styles.historyNavButton, !onPrevious ? styles.historyNavButtonDisabled : null]}
        >
          <Text style={[styles.historyNavButtonText, !onPrevious ? styles.historyNavButtonTextDisabled : null]}>{translateSource("‹ Previous")}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={translateSource("Next history item")}
          accessibilityRole="button"
          disabled={!onNext}
          onPress={onNext}
          style={[styles.historyNavButton, !onNext ? styles.historyNavButtonDisabled : null]}
        >
          <Text style={[styles.historyNavButtonText, !onNext ? styles.historyNavButtonTextDisabled : null]}>{translateSource("Next ›")}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.historyDetailContent}>
        <Text style={styles.historyDetailType}>{historyKindLabel(request)}</Text>
        <MarkdownInlineText selectable text={title} style={requestTitleStyles(title)} />
        <Text style={styles.detailMeta}>
          {requestRequesterLabel(request)} · {formatRequestTime(request.createdAt)}
        </Text>
        {body ? <MarkdownText selectable style={styles.markdownBody} text={body} /> : null}
        {command ? (
          <Text selectable style={styles.commandText}>{command}</Text>
        ) : null}
        <RequestContextPanel request={request} />
        <QuorumProgressPanel request={request} />
        {request.questions && request.questions.length > 0 ? (
          <View style={styles.questionnairePanel}>
            <Text style={styles.contextSummaryTitle}>{translateSource("Questions")}</Text>
            {request.questions.map((question) => (
              <View key={question.question} style={styles.questionCard}>
                <Text style={styles.questionHeader}>{question.header}</Text>
                <Text selectable style={styles.questionText}>{question.question}</Text>
                {(responseAnswers?.[question.question] ?? []).length ? (
                  <Text selectable style={styles.historyAnswerText}>
                    {translateSource("Answer:")} {(responseAnswers?.[question.question] ?? []).join(", ")}
                  </Text>
                ) : null}
                <Text style={styles.questionHint}>
                  {translateSource("Options:")} {question.options.map((option) => option.label).join(", ")}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {request.response?.message ? (
          <View style={styles.contextPanel}>
            <Text style={styles.contextTitle}>{translateSource("Response message")}</Text>
            <Text selectable style={styles.contextText}>{request.response.message}</Text>
          </View>
        ) : null}
        {request.metadata?.context ? (
          <View style={styles.contextPanel}>
            <Text style={styles.contextTitle}>{request.metadata.contextFile || translateSource("Context")}</Text>
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

function historyKindLabel(request: MobileRequest) {
  if (isQuestionnaireRequest(request)) return translateSource("Question");
  if (request.requestType === "steering") return translateSource("Steering");
  if (request.requestType === "sanction") return translateSource("Sanction Request");
  return translateSource("Request");
}
