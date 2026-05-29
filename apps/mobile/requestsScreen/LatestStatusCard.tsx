import { Pressable, Text, View } from "react-native";

import type { StatusUpdateRecord } from "@self-deprecated/agent-tick-sdk";

import { MarkdownInlineText } from "../MarkdownText";
import { styles } from "../mobileStyles";
import { formatRequestTime } from "./requestDisplayHelpers";

function formatRelativeAge(value?: string) {
  if (!value) return "just now";
  const elapsedMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 60_000) return "just now";
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 60) return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays === 1 ? "" : "s"} ago`;
}

function isTurnStatusUpdate(status: StatusUpdateRecord) {
  return status.metadata?.event === "turn_end";
}

export function LatestStatusCard({ statusUpdates, compact = false, dismissedStatusID, onDismiss }: { statusUpdates: StatusUpdateRecord[]; compact?: boolean; dismissedStatusID?: string | null; onDismiss?: (statusID: string) => void }) {
  const latest = statusUpdates[0];
  if (!latest || latest.statusId === dismissedStatusID) return null;
  const isTurnHeartbeat = isTurnStatusUpdate(latest);
  const source = latest.clientName || latest.workingDirectory || latest.threadId;
  const title = isTurnHeartbeat ? "Agent activity" : "Latest agent status";
  const state = isTurnHeartbeat ? "working" : latest.state;
  const message = isTurnHeartbeat ? "Pi is still working" : latest.message;
  const nextLine = isTurnHeartbeat ? `Last turn completed ${formatRelativeAge(latest.createdAt)}` : latest.nextStep ? `Next: ${latest.nextStep}` : null;
  return (
    <View style={[styles.statusCard, compact ? styles.statusCardCompact : null]}>
      <View style={styles.statusCardHeader}>
        <Text style={styles.statusLabel}>{title}</Text>
        <View style={styles.statusHeaderActions}>
          <Text style={styles.statusState}>{state}</Text>
          {onDismiss ? (
            <Pressable accessibilityLabel="Dismiss latest agent status" onPress={() => onDismiss(latest.statusId)}>
              <Text style={styles.statusDismiss}>×</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <MarkdownInlineText text={message} style={styles.statusMessage} />
      {nextLine ? <MarkdownInlineText text={nextLine} style={styles.statusNext} /> : null}
      <Text numberOfLines={1} style={styles.statusMeta}>
        {latest.agentTokenLabel} · {source} · {formatRequestTime(latest.createdAt)}
      </Text>
    </View>
  );
}
