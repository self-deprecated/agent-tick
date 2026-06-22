import { translateSource } from "@agent-tick/i18n";

import { formatRequestTime } from "../requestsScreen/requestDisplayHelpers";
import { sessionStackSessionKey, type SessionStackLocalState } from "../sessionStackState";
import type { MobileSessionSummary } from "../mobileTypes";

export function sessionLaneDisplayTitle(localState: SessionStackLocalState, summaries: MobileSessionSummary[], summary: MobileSessionSummary): string {
  const title = sessionLaneTitle(localState, summary);
  const duplicateCount = summaries.filter((candidate) => sessionLaneTitle(localState, candidate) === title).length;
  return duplicateCount > 1 ? `${title} · ${sessionLaneDisambiguator(summary, title)}` : title;
}

function sessionLaneTitle(localState: SessionStackLocalState, summary: MobileSessionSummary): string {
  const overrideTitle = localState.presentationOverrides[sessionStackSessionKey(summary)]?.title?.trim();
  if (overrideTitle) return overrideTitle;
  return preferredSessionSourceLabel(summary) || displayableSessionSummaryTitle(summary.title) || sessionLaneDisambiguator(summary);
}

function displayableSessionSummaryTitle(title: string): string | undefined {
  const trimmed = title.trim();
  if (!trimmed || isGenericAgentSourceLabel(trimmed)) return undefined;
  if (isToolActivitySummaryTitle(trimmed)) return translateSource("Tools");
  return trimmed;
}

function preferredSessionSourceLabel(summary: MobileSessionSummary): string | undefined {
  const labels = normalizedSourceLabels(summary);
  const genericAgentHosts = genericAgentHostLabels(labels);
  return labels.find((label) => !isGenericAgentSourceLabel(label) && !genericAgentHosts.has(normalizedLabelKey(label)));
}

function sessionLaneDisambiguator(summary: MobileSessionSummary, title?: string): string {
  const titleKey = normalizedLabelKey(title ?? "");
  const labels = normalizedSourceLabels(summary);
  const genericAgentHosts = genericAgentHostLabels(labels);
  const sourceLabel = labels.find((label) => {
    const key = normalizedLabelKey(label);
    return key !== titleKey && !isGenericAgentSourceLabel(label) && !genericAgentHosts.has(key);
  });
  return sourceLabel || formatRequestTime(summary.startedAt || summary.updatedAt) || sessionStackSessionKey(summary).slice(0, 8);
}

function normalizedSourceLabels(summary: MobileSessionSummary): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const sourceLabel of summary.sourceLabels) {
    const label = sourceLabel.trim();
    const key = normalizedLabelKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

function isGenericAgentSourceLabel(label: string): boolean {
  return /^agent on\s+.+$/i.test(label.trim());
}

function isToolActivitySummaryTitle(title: string): boolean {
  return /^[A-Za-z0-9_.:-]+\s+(started|finished|cancelled|failed)$/i.test(title.trim());
}

function genericAgentHostLabels(labels: string[]): Set<string> {
  const hosts = new Set<string>();
  for (const label of labels) {
    const match = /^agent on\s+(.+)$/i.exec(label.trim());
    const host = match?.[1]?.trim();
    if (host) hosts.add(normalizedLabelKey(host));
  }
  return hosts;
}

function normalizedLabelKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
