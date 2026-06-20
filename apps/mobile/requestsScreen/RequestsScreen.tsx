import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { type StatusUpdateRecord } from "@self-deprecated/agent-tick-sdk";

import { translateSource } from "@agent-tick/i18n";
import { recordDiagnostic } from "../diagnostics";
import { MarkdownInlineText, MarkdownText } from "../MarkdownText";
import { DirectChoiceCards, QuestionnaireOptionCards, isRequestLevelCancelChoice } from "../RequestChoiceControls";
import { RequestWaiterLivenessPanel } from "../RequestWaiterLiveness";
import { styles } from "../mobileStyles";
import { LatestStatusCard } from "./LatestStatusCard";
import { AudienceRequestPanel, RequestContextPanel, QuorumProgressPanel } from "./RequestPanels";
import { formatRequestTime, requestTitleStyles } from "./requestDisplayHelpers";
import {
  canRespondToRequest,
  groupRequestsBySource,
  isQuestionnaireRequest,
  mobileRequestKey,
  questionnaireReady,
  quorumProgressMessage,
  requestResponsibilityLabel,
  updateQuestionnaireAnswers,
  type MobileRequest,
  type RequestChoice as Choice,
} from "../requests";

export type ChoiceInteractionMode = "click-to-submit" | "select-then-submit";
export type OptionPlacement = "sticky-bottom" | "inline-after-content";

export function RequestsScreen({
  error,
  loading,
  onOpenSettings,
  onRefresh,
  onRespond,
  onSubmitQuestionnaire,
  respondingRequestKeys = {},
  choiceInteractionMode = "click-to-submit",
  optionPlacement = "inline-after-content",
  confirmBeforeSubmit = true,
  sourceGroups,
  questionnaireAnswers,
  reply,
  requests,
  savedAccountCount = 0,
  selectedSourceID,
  statusUpdates,
  readOnly = false,
  readOnlyReason,
  unlockResponsesLabel,
  onUnlockResponses,
  dismissedStatusID,
  onDismissStatus,
  setSourceID,
  setQuestionnaireAnswer,
  selected,
  selectedID,
  setReply,
  setSelectedID,
}: {
  error: string | null;
  loading: boolean;
  onOpenSettings?: () => void;
  onRefresh: () => void;
  onRespond: (request: MobileRequest, choice: Choice) => void;
  onSubmitQuestionnaire: (request: MobileRequest, answers?: Record<string, string[]>) => void;
  respondingRequestKeys?: Record<string, boolean | undefined>;
  choiceInteractionMode?: ChoiceInteractionMode;
  optionPlacement?: OptionPlacement;
  confirmBeforeSubmit?: boolean;
  sourceGroups: ReturnType<typeof groupRequestsBySource>;
  questionnaireAnswers: Record<string, string[]>;
  reply: string;
  requests: MobileRequest[];
  savedAccountCount?: number;
  selectedSourceID: string | null;
  statusUpdates: StatusUpdateRecord[];
  readOnly?: boolean;
  readOnlyReason?: string;
  unlockResponsesLabel?: string;
  onUnlockResponses?: () => void;
  dismissedStatusID?: string | null;
  onDismissStatus?: (statusID: string) => void;
  setSourceID: (sourceID: string | null) => void;
  setQuestionnaireAnswer: (
    question: string,
    option: string,
    multiSelect: boolean,
  ) => void;
  selected?: MobileRequest;
  selectedID: string | null;
  setReply: (value: string) => void;
  setSelectedID: (value: string) => void;
}) {
  if (!selected) {
    return (
      <View style={styles.waitingPane}>
        {loading ? <ActivityIndicator color="#202124" /> : null}
        <Text style={styles.waitingTitle}>{translateSource("Waiting")}</Text>
        <Text style={styles.waitingSubtitle}>{translateSource("Send a test Request from the web app.")}</Text>
        <LatestStatusCard statusUpdates={statusUpdates} compact dismissedStatusID={dismissedStatusID} onDismiss={onDismissStatus} />
        <Pressable onPress={onRefresh} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{translateSource("Refresh")}</Text>
        </Pressable>
      </View>
    );
  }

  const responsibility = requestResponsibilityLabel(selected);
  const connectionLabels = new Set(
    requests
      .map((request) => request.connectionID || request.connectionLabel || request.connectionServerURL)
      .filter((label): label is string => Boolean(label)),
  );
  const connectionLabel = savedAccountCount > 1 || connectionLabels.size > 1
    ? selected.connectionLabel || selected.connectionServerURL
    : "";
  const title = selected.title;
  const body = selected.body;
  const command = selected.command;
  const requestCanRespond = canRespondToRequest(selected);
  const responding = Boolean(respondingRequestKeys[mobileRequestKey(selected)]);
  const effectiveReadOnly = (readOnly && !selected.isTest) || responding;
  const canShowReadOnlyChoices = effectiveReadOnly && selected.status === "pending" && !selected.response && (selected.choices?.length ?? 0) > 0;
  const responsibilityLabel = responsibility === translateSource("Your response is needed") && requestCanRespond
    ? ""
    : responsibility;
  const canRespond = !effectiveReadOnly && requestCanRespond;
  const selectedUsesSteeringChoices = selected.requestType === "steering" || isQuestionnaireRequest(selected);
  const submitChoice = (choice: Choice) => {
    recordDiagnostic("info", "button", "request_choice_pressed", {
      requestId: selected.id,
      choiceId: choice.id,
      choiceKind: choice.kind,
      choiceInteractionMode,
      optionPlacement,
      confirmBeforeSubmit,
      readOnly: effectiveReadOnly,
      requestCanRespond,
    });
    if (!isRequestLevelCancelChoice(choice) && (choiceInteractionMode === "click-to-submit" || (!selectedUsesSteeringChoices && !confirmBeforeSubmit))) {
      recordDiagnostic("info", "button", "request_choice_confirmed", { requestId: selected.id, choiceId: choice.id, choiceKind: choice.kind });
      onRespond(selected, choice);
      return;
    }
    Alert.alert(translateSource("Send this decision?"), choice.label, [
      { text: translateSource("Cancel"), style: "cancel" },
      {
        text: translateSource("Send decision"),
        onPress: () => {
          recordDiagnostic("info", "button", "request_choice_confirmed", { requestId: selected.id, choiceId: choice.id, choiceKind: choice.kind });
          onRespond(selected, choice);
        },
      },
    ]);
  };
  const selectedQuestions = selected.questions ?? [];
  const selectedCancelChoices = (selected.choices ?? []).filter(isRequestLevelCancelChoice);
  const selectedWaiterCancelChoice = !effectiveReadOnly && selected.agentWaiter ? selectedCancelChoices[0] : undefined;
  const selectedInlineCancelChoices = selectedWaiterCancelChoice ? [] : selectedCancelChoices;
  const selectedChoiceCards = selectedWaiterCancelChoice && selectedUsesSteeringChoices
    ? (selected.choices ?? []).filter((choice) => !isRequestLevelCancelChoice(choice))
    : (selected.choices ?? []);
  const waiterPanel = selected.status === "pending" && selected.agentWaiter
    ? <RequestWaiterLivenessPanel cancelChoice={selectedWaiterCancelChoice} onCancel={submitChoice} waiter={selected.agentWaiter} />
    : null;
  const submitQuestionnaireSelection = (question: string, option: string, multiSelect: boolean) => {
    const nextAnswers = updateQuestionnaireAnswers(questionnaireAnswers, question, option, multiSelect);
    setQuestionnaireAnswer(question, option, multiSelect);
    if (!multiSelect && choiceInteractionMode === "click-to-submit" && !effectiveReadOnly && questionnaireReady(selected, nextAnswers)) {
      onSubmitQuestionnaire(selected, nextAnswers);
    }
  };
  const selectedQuestionnaireControls = isQuestionnaireRequest(selected) ? (
    <>
      {selectedQuestions.map((question, index) => (
        <QuestionnaireOptionCards
          key={question.question}
          question={question}
          selectedAnswers={questionnaireAnswers[question.question] ?? []}
          cancelChoices={index === selectedQuestions.length - 1 ? selectedInlineCancelChoices : []}
          disabled={effectiveReadOnly}
          hideQuestionLabel={question.question.trim() === selected.title.trim()}
          onCancel={submitChoice}
          onSelect={submitQuestionnaireSelection}
        />
      ))}
    </>
  ) : null;
  const actionPanel = (
    <View style={[styles.actions, optionPlacement === "inline-after-content" ? styles.actionsInline : null]}>
      {effectiveReadOnly ? (
        <>
          {isQuestionnaireRequest(selected) ? (
            <>
              {selectedQuestionnaireControls}
              <Pressable
                disabled
                style={[styles.choiceButton, styles.submitButton, styles.choiceButtonDisabled]}
              >
                <Text style={styles.choiceText}>{translateSource("Submit Answers")}</Text>
              </Pressable>
            </>
          ) : requestCanRespond || canShowReadOnlyChoices ? (
            <DirectChoiceCards
              choices={selectedChoiceCards}
              disabled
              separateCancel={selectedUsesSteeringChoices}
              onSubmit={submitChoice}
            />
          ) : null}
          <View style={styles.readOnlyPanel}>
            <Text style={styles.actionHint}>{responding ? translateSource("Sending response…") : readOnlyReason || translateSource("Responses require an active 7-day Trial, Hosted subscription, or Self-hosted Lifetime unlock.")}</Text>
            {!responding && onUnlockResponses ? (
              <Pressable onPress={onUnlockResponses} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>{translateSource(unlockResponsesLabel ?? "Unlock responses")}</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : isQuestionnaireRequest(selected) ? (
        <>
          {selectedQuestionnaireControls}
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
            <Text style={styles.choiceText}>{translateSource("Submit Answers")}</Text>
          </Pressable>
        </>
      ) : canRespond ? (
        <DirectChoiceCards
          choices={selectedChoiceCards}
          separateCancel={selectedUsesSteeringChoices}
          onSubmit={submitChoice}
        />
      ) : (
        <Text style={styles.actionHint}>
          {quorumProgressMessage(selected) || translateSource("This request is read-only.")}
        </Text>
      )}
      {waiterPanel}
    </View>
  );

  return (
    <View style={styles.requestsPane}>
      {sourceGroups.length > 1 ? (
        <View style={styles.requestStrip}>
          <Pressable
            onPress={() => setSourceID(null)}
            style={[
              styles.requestPill,
              selectedSourceID === null ? styles.requestPillActive : null,
            ]}
          >
            <Text numberOfLines={1} style={styles.requestPillText}>
              All ({sourceGroups.reduce((sum, group) => sum + group.requests.length, 0)})
            </Text>
          </Pressable>
          {sourceGroups.map((group) => (
            <Pressable
              key={group.id}
              onPress={() => setSourceID(group.id)}
              style={[
                styles.requestPill,
                selectedSourceID === group.id ? styles.requestPillActive : null,
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
              key={mobileRequestKey(request)}
              onPress={() => setSelectedID(mobileRequestKey(request))}
              style={[
                styles.requestPill,
                selectedID === mobileRequestKey(request) ? styles.requestPillActive : null,
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
        contentContainerStyle={styles.requestContent}
        style={styles.requestScroll}
      >
        <LatestStatusCard statusUpdates={statusUpdates} dismissedStatusID={dismissedStatusID} onDismiss={onDismissStatus} />
        <MarkdownInlineText text={title} style={requestTitleStyles(title)} />
        {responsibilityLabel ? (
          <Text style={styles.responsibilityBadge}>{responsibilityLabel}</Text>
        ) : null}
        {selected.isTest || selected.testLabel ? <Text style={styles.testRequestBadge}>{selected.testLabel || translateSource("Test Request")}</Text> : null}
        <View style={styles.detailFacts}>
          {connectionLabel ? (
            <Text style={styles.factText}>{connectionLabel}</Text>
          ) : null}
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
          {selected.deadline ? (
            <Text style={styles.factText}>
              Expires {formatRequestTime(selected.deadline)}
            </Text>
          ) : null}
        </View>
        {body ? <MarkdownText selectable style={styles.markdownBody} text={body} /> : null}
        {command ? (
          <Text selectable style={styles.commandText}>
            {command}
          </Text>
        ) : null}
        <AudienceRequestPanel request={selected} />
        <QuorumProgressPanel request={selected} />
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
        {isQuestionnaireRequest(selected) && selected.status !== "pending" ? (
          <View style={styles.questionnairePanel}>
            {selectedQuestions.map((question) => (
              <QuestionnaireOptionCards
                key={question.question}
                question={question}
                selectedAnswers={questionnaireAnswers[question.question] ?? []}
                disabled={effectiveReadOnly}
                hideQuestionLabel={question.question.trim() === selected.title.trim()}
                onSelect={setQuestionnaireAnswer}
              />
            ))}
          </View>
        ) : null}
        {selected.allowFreeformReply ? (
          <TextInput
            editable={!readOnly}
            multiline
            onChangeText={setReply}
            placeholder="Optional message"
            style={[styles.reply, readOnly ? styles.choiceButtonDisabled : null]}
            value={reply}
          />
        ) : null}
        {optionPlacement === "inline-after-content" ? actionPanel : null}
      </ScrollView>

      {optionPlacement === "sticky-bottom" ? actionPanel : null}
      <RequestContextPanel docked request={selected} />
    </View>
  );
}
