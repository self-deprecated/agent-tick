import { sessionStackSessionKey, type SessionLaneSize } from "../sessionStackState";

export const SESSION_LANE_MIN_HEIGHT = 220;

export type SessionLaneLayout = { sessionId: string; y: number; height: number; targetActivityId?: string; mode: SessionLaneSize; expanded: boolean };

type SessionLaneSummary = {
  sessionId: string;
  mobileSessionKey?: string;
  state: string;
  pendingRequestCount: number;
  latestActivity: { id: string };
};

type SessionLaneModeSummary = Pick<SessionLaneSummary, "sessionId" | "mobileSessionKey" | "state" | "pendingRequestCount">;

export function automaticSessionLaneSize(summary: Pick<SessionLaneSummary, "state" | "pendingRequestCount">, autoExpansion: "needs-input" | "none" = "needs-input"): SessionLaneSize {
  return autoExpansion !== "none" && (summary.state === "needs-input" || summary.pendingRequestCount > 0) ? "large" : "normal";
}

export function nextCollapsedToggleSessionLaneSize(summary: Pick<SessionLaneSummary, "state" | "pendingRequestCount">, size: SessionLaneSize, autoExpansion: "needs-input" | "none" = "needs-input"): SessionLaneSize {
  return size === "collapsed" ? automaticSessionLaneSize(summary, autoExpansion) : "collapsed";
}

export function nextLargeToggleSessionLaneSize(size: SessionLaneSize): SessionLaneSize {
  return size === "large" ? "normal" : "large";
}

export function resolveSessionLaneModes(summaries: SessionLaneModeSummary[], autoExpansion: "needs-input" | "none" = "needs-input", laneSizes: Record<string, SessionLaneSize | undefined> = {}): Record<string, SessionLaneSize> {
  const modes: Record<string, SessionLaneSize> = {};
  let largeSessionID: string | null = null;
  for (const summary of summaries) {
    const sessionId = sessionStackSessionKey(summary);
    const manualSize = laneSizes[sessionId];
    if (manualSize) {
      const mode = manualSize === "large" && largeSessionID ? "normal" : manualSize;
      modes[sessionId] = mode;
      if (mode === "large") largeSessionID = sessionId;
      continue;
    }
    const automaticSize = automaticSessionLaneSize(summary, autoExpansion);
    const mode = automaticSize === "large" && largeSessionID ? "normal" : automaticSize;
    modes[sessionId] = mode;
    if (mode === "large") largeSessionID = sessionId;
  }
  return modes;
}

export function allocateSessionLaneLayouts(summaries: SessionLaneSummary[], viewportHeight: number, options: { collapsedHeight?: number; compactMinHeight?: number; expandedMinHeight?: number; autoExpansion?: "needs-input" | "none"; laneSizes?: Record<string, SessionLaneSize | undefined> } = {}): SessionLaneLayout[] {
  if (summaries.length === 0) return [];
  const collapsedHeight = options.collapsedHeight ?? 56;
  const compactMinHeight = options.compactMinHeight ?? SESSION_LANE_MIN_HEIGHT;
  const modes = resolveSessionLaneModes(summaries, options.autoExpansion, options.laneSizes);
  const collapsedCount = summaries.filter((summary) => modes[sessionStackSessionKey(summary)] === "collapsed").length;
  const largeSession = summaries.find((summary) => modes[sessionStackSessionKey(summary)] === "large");
  const visibleCount = summaries.length - collapsedCount;
  const remainingHeight = Math.max(0, viewportHeight - (collapsedCount * collapsedHeight));
  const largeHeight = largeSession && visibleCount > 1 ? Math.floor(remainingHeight / 2) : remainingHeight;
  const normalCount = summaries.filter((summary) => modes[sessionStackSessionKey(summary)] === "normal").length;
  const normalHeight = largeSession
    ? Math.floor(Math.max(0, remainingHeight - largeHeight) / Math.max(1, normalCount))
    : Math.floor(remainingHeight / Math.max(1, normalCount));
  let nextY = 0;
  const layouts = summaries.map((summary) => {
    const sessionId = sessionStackSessionKey(summary);
    const mode = modes[sessionId] ?? "normal";
    const height = mode === "collapsed"
      ? collapsedHeight
      : mode === "large"
        ? Math.max(largeHeight, compactMinHeight)
        : Math.max(normalHeight, compactMinHeight);
    const y = nextY;
    nextY += height;
    return {
      sessionId,
      y,
      height,
      targetActivityId: summary.latestActivity.id,
      mode,
      expanded: mode === "large",
    };
  });
  const allocatedHeight = layouts.reduce((total, layout) => total + layout.height, 0);
  const fillLayout = [...layouts].reverse().find((layout) => layout.mode !== "collapsed");
  if (fillLayout && allocatedHeight < viewportHeight) {
    fillLayout.height += viewportHeight - allocatedHeight;
  }
  let y = 0;
  for (const layout of layouts) {
    layout.y = y;
    y += layout.height;
  }
  return layouts;
}

export function previewSessionReorder<T extends { sessionId: string; mobileSessionKey?: string }>(summaries: T[], sessionID: string, targetIndex: number): T[] {
  const dragged = summaries.find((summary) => sessionStackSessionKey(summary) === sessionID);
  if (!dragged) return summaries;
  const remaining = summaries.filter((summary) => sessionStackSessionKey(summary) !== sessionID);
  const index = Math.max(0, Math.min(targetIndex, remaining.length));
  return [...remaining.slice(0, index), dragged, ...remaining.slice(index)];
}
