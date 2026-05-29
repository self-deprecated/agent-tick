import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { translateSource } from "@agent-tick/i18n";

import { styles } from "../mobileStyles";
import { formatRequestTime } from "./requestDisplayHelpers";
import {
  quorumProgressMessage,
  requestOwnerLabel,
  requestQuorumSummary,
  requestRequesterLabel,
  requestResponseHistory,
  requestRoutingLabel,
  requestSourceLabel,
  shouldSuppressResponseProgress,
  type MobileRequest,
} from "../requests";

export function RequestContextPanel({ request, docked = false }: { request: MobileRequest; docked?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const routing = requestRoutingLabel(request);
  const owner = requestOwnerLabel(request);
  const quorum = requestQuorumSummary(request);
  const source = requestSourceLabel(request);
  const rows = [
    { label: translateSource("Requester"), value: requestRequesterLabel(request) },
    source ? { label: translateSource("Source"), value: source } : null,
    request.requester.workingDirectory?.trim()
      ? { label: translateSource("Directory"), value: request.requester.workingDirectory.trim() }
      : null,
    request.requester.host?.trim() ? { label: translateSource("Host"), value: request.requester.host.trim() } : null,
    owner ? { label: translateSource("Owner"), value: owner } : null,
    routing ? { label: translateSource("Routing Rule"), value: routing } : null,
    quorum ? { label: translateSource("Required Responses"), value: quorum } : null,
  ].filter((row): row is { label: string; value: string } => Boolean(row?.value));
  const summary = [requestRequesterLabel(request), source, quorum].filter(Boolean).join(" · ");
  return (
    <View style={[styles.contextSummaryPanel, docked ? styles.contextSummaryPanelDocked : null, expanded ? styles.contextSummaryPanelExpanded : null]}>
      <Pressable
        accessibilityLabel={expanded ? translateSource("Collapse request details") : translateSource("Expand request details")}
        accessibilityRole="button"
        onPress={() => setExpanded((current) => !current)}
        style={styles.contextSummaryHeader}
      >
        {docked ? (
          <Text numberOfLines={1} style={[styles.contextSummaryText, styles.contextSummaryTextDocked]}>{summary || translateSource("Request details")}</Text>
        ) : (
          <Text style={styles.contextSummaryTitle}>{translateSource("Request details")}</Text>
        )}
        <Text style={styles.contextSummaryChevron}>{expanded ? "⌃" : "⌄"}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.contextSummaryRows}>
          {rows.map((row) => (
            <ContextRow key={row.label} label={row.label} value={row.value} />
          ))}
        </View>
      ) : !docked && summary ? (
        <Text numberOfLines={1} style={styles.contextSummaryText}>{summary}</Text>
      ) : null}
    </View>
  );
}

export function QuorumProgressPanel({ request }: { request: MobileRequest }) {
  if (shouldSuppressResponseProgress(request)) {
    return null;
  }
  const quorum = request.quorum;
  const message = quorumProgressMessage(request);
  const responses = requestResponseHistory(request);
  if (!quorum && responses.length === 0) {
    return null;
  }
  return (
    <View style={styles.responsePanel}>
      <Text style={styles.responseTitle}>{translateSource("Response progress")}</Text>
      {message ? <Text style={styles.responseMessage}>{message}</Text> : null}
      {quorum ? (
        <Text style={styles.responseMeta}>
          {quorum.receivedResponseCount}/{quorum.requiredResponseCount} responses
        </Text>
      ) : null}
      {responses.length > 0 ? (
        <View style={styles.responseList}>
          {responses.map((response) => (
            <View key={response.id} style={styles.responseRow}>
              <Text style={styles.responseText}>{response.label}</Text>
              {response.message ? <Text style={styles.responseEntryMessage}>{response.message}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.contextSummaryRow}>
      <Text style={styles.contextSummaryLabel}>{label}</Text>
      <Text selectable style={styles.contextSummaryValue}>{value}</Text>
    </View>
  );
}

export function AudienceRequestPanel({ request }: { request: MobileRequest }) {
  if (request.deliveryKind !== "audience_channel") return null;
  const aggregateChoices = request.aggregateResult?.choices && typeof request.aggregateResult.choices === "object" && !Array.isArray(request.aggregateResult.choices)
    ? request.aggregateResult.choices as Record<string, unknown>
    : {};
  const countRows = Object.entries(aggregateChoices).map(([choiceId, count]) => ({
    label: request.choices.find((choice) => choice.id === choiceId)?.label ?? choiceId,
    count: typeof count === "number" ? count : Number(count) || 0,
  }));
  return (
    <View style={styles.contextSummaryPanel}>
      <Text style={styles.contextSummaryTitle}>{translateSource("Community vote")}</Text>
      {request.closesAt && request.status === "pending" ? (
        <View style={styles.contextSummaryRow}>
          <Text style={styles.contextSummaryLabel}>{translateSource("Closes")}</Text>
          <Text selectable style={styles.contextSummaryValue}>{formatRequestTime(request.closesAt)}</Text>
        </View>
      ) : null}
      <Text style={styles.contextSummaryText}>{translateSource(request.status === "pending" ? "Voting closes at the deadline. The agent will receive the winning choice." : "Voting is closed. The agent received the aggregate result.")}</Text>
      {countRows.length ? (
        <View style={styles.responseList}>
          {countRows.map((row) => <Text key={row.label} style={styles.responseText}>{row.label}: {row.count}</Text>)}
        </View>
      ) : null}
    </View>
  );
}

