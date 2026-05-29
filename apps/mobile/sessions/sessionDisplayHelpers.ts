import { formatRequestTime } from "../requestsScreen/requestDisplayHelpers";
import { sessionStackSessionKey, type SessionStackLocalState } from "../sessionStackState";
import type { MobileSessionSummary } from "../mobileTypes";

export function sessionLaneDisplayTitle(localState: SessionStackLocalState, summaries: MobileSessionSummary[], summary: MobileSessionSummary): string {
  const title = sessionLaneTitle(localState, summary);
  const duplicateCount = summaries.filter((candidate) => sessionLaneTitle(localState, candidate) === title).length;
  return duplicateCount > 1 ? `${title} · ${sessionLaneDisambiguator(summary)}` : title;
}

function sessionLaneTitle(localState: SessionStackLocalState, summary: MobileSessionSummary): string {
  const overrideTitle = localState.presentationOverrides[sessionStackSessionKey(summary)]?.title?.trim();
  return overrideTitle || summary.sourceLabels[0]?.trim() || sessionLaneDisambiguator(summary);
}

function sessionLaneDisambiguator(summary: MobileSessionSummary): string {
  return summary.sourceLabels[1]?.trim() || formatRequestTime(summary.startedAt || summary.updatedAt) || sessionStackSessionKey(summary).slice(0, 8);
}
