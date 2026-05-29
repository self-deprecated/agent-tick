import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { translateSource } from "@agent-tick/i18n";
import type { Choice, RequestAgentWaiterState, RequestAgentWaiterSummary } from "@self-deprecated/agent-tick-shared";

function isStaticRenderRuntime() {
  const runtime = globalThis as {
    jest?: unknown;
    process?: { env?: Record<string, string | undefined> };
  };
  return Boolean(runtime.jest || runtime.process?.env?.NODE_ENV === "test");
}

export function formatWaiterRelativeAge(value?: string, nowMs = Date.now()) {
  if (!value) return translateSource("just now");
  const seenMs = new Date(value).getTime();
  const elapsedMs = nowMs - seenMs;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 5_000) return translateSource("just now");
  if (elapsedMs < 60_000) {
    const seconds = Math.max(1, Math.floor(elapsedMs / 1_000));
    return `${seconds} second${seconds === 1 ? "" : "s"} ago`;
  }
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 60) return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays === 1 ? "" : "s"} ago`;
}

function formatWaiterCompactAge(value?: string, nowMs = Date.now()) {
  if (!value) return translateSource("now");
  const seenMs = new Date(value).getTime();
  const elapsedMs = nowMs - seenMs;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 5_000) return translateSource("now");
  if (elapsedMs < 60_000) return `${Math.max(1, Math.floor(elapsedMs / 1_000))}s ago`;
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.floor(elapsedHours / 24)}d ago`;
}

function useNowTick(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled || isStaticRenderRuntime()) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [enabled]);

  return now;
}

function useWaitingDots(enabled: boolean) {
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (!enabled || isStaticRenderRuntime()) return;
    const timer = setInterval(() => setCount((current) => current % 3 + 1), 450);
    return () => clearInterval(timer);
  }, [enabled]);

  return ".".repeat(count);
}

export function isRefreshableRequestWaiter(waiter?: RequestAgentWaiterSummary): boolean {
  return waiter?.state === "waiting" || waiter?.state === "stale";
}

export function requestWaiterLivenessShortLabel(state?: RequestAgentWaiterState): string {
  switch (state) {
    case "waiting":
      return translateSource("Agent waiting");
    case "stale":
      return translateSource("Wait stale");
    case "expired":
      return translateSource("Wait expired");
    case "stopped":
      return translateSource("Wait stopped");
    case "errored":
      return translateSource("Wait failed");
    default:
      return translateSource("No live wait");
  }
}

function requestWaiterLivenessTitle(waiter?: RequestAgentWaiterSummary): string {
  switch (waiter?.state) {
    case "waiting":
      return translateSource("Agent is waiting");
    case "stale":
      return translateSource("Agent wait is stale");
    case "expired":
      return translateSource("Agent wait expired");
    case "stopped":
      return translateSource("Agent stopped waiting");
    case "errored":
      return translateSource("Agent wait failed");
    default:
      return translateSource("No live wait");
  }
}

function requestWaiterLivenessCompactTitle(waiter?: RequestAgentWaiterSummary): string {
  return requestWaiterLivenessShortLabel(waiter?.state);
}

export function waiterLastCheckedInLine(waiter?: RequestAgentWaiterSummary, nowMs = Date.now()): string {
  if (!waiter?.lastSeenAt) return translateSource("Last check-in unavailable");
  return `${translateSource("Last checked in")} ${formatWaiterRelativeAge(waiter.lastSeenAt, nowMs)}`;
}

function requestWaiterLivenessDetail(waiter: RequestAgentWaiterSummary | undefined, nowMs: number): string {
  const lastChecked = waiterLastCheckedInLine(waiter, nowMs);
  switch (waiter?.state) {
    case "stale":
      return `${lastChecked} · ${translateSource("Refresh before responding if possible.")}`;
    case "expired":
    case "errored":
      return `${lastChecked} · ${translateSource("The answer may not reach the original agent.")}`;
    default:
      return lastChecked;
  }
}

function requestWaiterLivenessCompactDetail(waiter: RequestAgentWaiterSummary | undefined, nowMs: number): string {
  const lastChecked = waiter?.lastSeenAt
    ? formatWaiterCompactAge(waiter.lastSeenAt, nowMs)
    : translateSource("Unknown check-in");
  switch (waiter?.state) {
    case "stale":
      return `${lastChecked} · ${translateSource("Refresh")}`;
    case "expired":
    case "errored":
      return `${lastChecked} · ${translateSource("May not reach agent")}`;
    default:
      return lastChecked;
  }
}

export function RequestWaiterLivenessPanel({
  cancelChoice,
  onCancel,
  waiter,
}: {
  cancelChoice?: Choice;
  onCancel?: (choice: Choice) => void;
  waiter?: RequestAgentWaiterSummary;
}) {
  const active = waiter?.state === "waiting";
  const now = useNowTick(Boolean(waiter?.lastSeenAt));
  const dots = useWaitingDots(active);
  const compact = Boolean(cancelChoice);
  const title = compact ? requestWaiterLivenessCompactTitle(waiter) : requestWaiterLivenessTitle(waiter);
  const detail = compact ? requestWaiterLivenessCompactDetail(waiter, now) : requestWaiterLivenessDetail(waiter, now);
  const panel = (
    <View
      accessible
      accessibilityLabel={active ? `${title}${dots} ${detail}` : `${title}. ${detail}`}
      style={[styles.panel, active ? styles.panelActive : styles.panelAttention, compact ? styles.panelCompact : null, cancelChoice ? styles.panelInActionRow : null]}
    >
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        {active ? <Text style={styles.dots}>{dots}</Text> : null}
      </View>
      <Text style={styles.detail}>{detail}</Text>
    </View>
  );

  if (!cancelChoice) return panel;

  return (
    <View style={styles.actionRow}>
      {panel}
      <Pressable
        accessibilityLabel={translateSource("Cancel Request")}
        accessibilityRole="button"
        onPress={() => onCancel?.(cancelChoice)}
        style={styles.cancelWaitButton}
      >
        <Text style={styles.cancelWaitText}>{cancelChoice.label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    alignSelf: "flex-start",
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  panelCompact: {
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  panelInActionRow: {
    alignSelf: "stretch",
    flex: 3,
    marginTop: 0,
  },
  panelActive: {
    backgroundColor: "#edf7f3",
    borderColor: "#1f6f5b",
  },
  panelAttention: {
    backgroundColor: "#fff4e5",
    borderColor: "#d6862b",
  },
  titleRow: {
    alignItems: "baseline",
    flexDirection: "row",
  },
  title: {
    color: "#202124",
    fontSize: 13,
    fontWeight: "900",
  },
  dots: {
    color: "#1f6f5b",
    fontSize: 13,
    fontWeight: "900",
    minWidth: 18,
  },
  detail: {
    color: "#5f5a4f",
    fontSize: 12,
    fontWeight: "700",
  },
  actionRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  cancelWaitButton: {
    alignItems: "center",
    backgroundColor: "#fff8f5",
    borderColor: "#a33b2f",
    borderRadius: 10,
    borderWidth: 1,
    flex: 2,
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  cancelWaitText: {
    color: "#7a231b",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
});
