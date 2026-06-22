import { Text, View, type StyleProp, type ViewStyle } from "react-native";

import { translateSource } from "@agent-tick/i18n";

import { MarkdownText } from "../MarkdownText";
import { styles } from "../mobileStyles";

type PromptSectionKey = "previousContext" | "details";

type PromptSection = {
  key: PromptSectionKey;
  body: string;
};

export type ParsedRequestPromptBody = {
  sections: PromptSection[];
  fallbackBody?: string;
};

const SECTION_LABELS: Record<string, { key: PromptSectionKey }> = {
  "previous context:": { key: "previousContext" },
  "details:": { key: "details" },
};

export function parseRequestPromptBody(body: string): ParsedRequestPromptBody | null {
  const normalized = body.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").trim();
  if (!normalized) return null;

  const sectionLines: Record<PromptSectionKey, string[]> = {
    previousContext: [],
    details: [],
  };
  const fallbackLines: string[] = [];
  let activeSection: PromptSectionKey | null = null;
  let foundSection = false;

  for (const line of normalized.split("\n")) {
    const label = SECTION_LABELS[line.trim().toLowerCase()];
    if (label) {
      activeSection = label.key;
      foundSection = true;
      continue;
    }

    if (activeSection) {
      sectionLines[activeSection].push(line);
    } else {
      fallbackLines.push(line);
    }
  }

  if (!foundSection) return null;

  const sections = (Object.values(SECTION_LABELS) as Array<{ key: PromptSectionKey }>)
    .filter((label, index, labels) => labels.findIndex((candidate) => candidate.key === label.key) === index)
    .map((label) => ({
      key: label.key,
      body: sectionLines[label.key].join("\n").trim(),
    }))
    .filter((section) => section.body.length > 0);

  const fallbackBody = fallbackLines.join("\n").trim() || undefined;
  return sections.length > 0 || fallbackBody ? { sections, fallbackBody } : null;
}

export function RequestPromptBody({ body, selectable = false, style }: { body: string; selectable?: boolean; style?: StyleProp<ViewStyle> }) {
  const parsed = parseRequestPromptBody(body);

  if (!parsed) {
    return <MarkdownText selectable={selectable} style={[styles.markdownBody, style]} text={body} />;
  }

  return (
    <View style={[styles.requestPromptBody, style]}>
      {parsed.fallbackBody ? <MarkdownText selectable={selectable} text={parsed.fallbackBody} /> : null}
      {parsed.sections.map((section) => (
        <View key={section.key} style={styles.requestPromptSection} testID={requestPromptSectionTestID(section.key)}>
          <Text style={styles.requestPromptSectionTitle}>{requestPromptSectionTitle(section.key)}</Text>
          <MarkdownText selectable={selectable} text={section.body} />
        </View>
      ))}
    </View>
  );
}

function requestPromptSectionTitle(sectionKey: PromptSectionKey): string {
  switch (sectionKey) {
    case "previousContext": return translateSource("Previous context");
    case "details": return translateSource("Details");
  }
}

function requestPromptSectionTestID(sectionKey: PromptSectionKey): string {
  return `request-prompt-section-${sectionKey}`;
}
