import { translateSource } from "@agent-tick/i18n";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Choice, Question } from "@self-deprecated/agent-tick-shared";

export function isRequestLevelCancelChoice(choice: Pick<Choice, "id" | "label" | "kind">) {
  return choice.id === "cancel" || (choice.kind === "deny" && /^cancel$/i.test(choice.label.trim()));
}

function choiceFlagBadges(choice: Choice) {
  return [
    ...(choice.flags ?? []).filter((flag) => flag !== "favorite").map((flag) => flag.replace(/_/g, " ")),
    ...(choice.tags ?? []),
  ].slice(0, 4);
}

function optionKey(options: Array<{ label?: string; id?: string }>) {
  return options.map((option) => option.id ?? option.label ?? "").join("\u001f");
}

function ChoiceCard({
  label,
  description,
  badges = [],
  favorite = false,
  disabled = false,
  selected = false,
  showDetails,
  kind = "option",
  flagged = false,
  checkbox,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  description?: string;
  badges?: string[];
  favorite?: boolean;
  disabled?: boolean;
  selected?: boolean;
  showDetails: boolean;
  kind?: string;
  flagged?: boolean;
  checkbox?: "checked" | "unchecked";
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.choiceCard,
        kind === "approve" ? styles.approveCard : null,
        kind === "deny" ? styles.denyCard : null,
        selected ? styles.selectedChoiceCard : null,
        flagged ? styles.flaggedChoiceCard : null,
        disabled ? styles.choiceCardDisabled : null,
      ]}
    >
      {checkbox ? (
        <Text style={[styles.checkboxBadge, checkbox === "checked" ? styles.checkboxBadgeChecked : null]}>
          {checkbox === "checked" ? "☑" : "☐"}
        </Text>
      ) : null}
      <View style={styles.choiceContent}>
        {favorite && showDetails ? <Text accessibilityLabel="Favorite choice" style={styles.choiceFavoriteIcon}>★</Text> : null}
        <View style={styles.choiceLabelStack}>
          <Text style={styles.choiceText}>{label}</Text>
          {showDetails && description ? <Text style={styles.choiceDescription}>{description}</Text> : null}
          {showDetails && badges.length ? (
            <View style={styles.choiceBadgeRow}>
              {badges.map((badge) => <Text key={badge} style={styles.choiceBadge}>{badge}</Text>)}
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function OptionDetailsToggle({ expanded, onPress }: { expanded: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={expanded ? translateSource("Hide option details") : translateSource("Show option details")}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.detailsToggle, styles.detailsToggleFloating]}
    >
      <Text style={styles.detailsToggleText}>{expanded ? "⌃" : "ⓘ"}</Text>
    </Pressable>
  );
}

export function DirectChoiceCards({
  choices,
  disabled = false,
  separateCancel = false,
  onSubmit,
}: {
  choices: Choice[];
  disabled?: boolean;
  separateCancel?: boolean;
  onSubmit: (choice: Choice) => void;
}) {
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const { primaryChoices, cancelChoices } = useMemo(() => {
    if (!separateCancel) return { primaryChoices: choices, cancelChoices: [] as Choice[] };
    return {
      primaryChoices: choices.filter((choice) => !isRequestLevelCancelChoice(choice)),
      cancelChoices: choices.filter(isRequestLevelCancelChoice),
    };
  }, [choices, separateCancel]);
  const hasDetails = primaryChoices.some((choice) => choice.description || choice.flags?.length || choice.tags?.length);

  useEffect(() => {
    setDetailsExpanded(true);
  }, [optionKey(choices)]);

  return (
    <View style={styles.choiceSet}>
      {hasDetails ? <OptionDetailsToggle expanded={detailsExpanded} onPress={() => setDetailsExpanded((current) => !current)} /> : null}
      {primaryChoices.map((choice, index) => (
        <ChoiceCard
          key={`${choice.id}:${index}`}
          label={choice.label}
          description={choice.description}
          badges={choiceFlagBadges(choice)}
          favorite={choice.flags?.includes("favorite")}
          disabled={disabled}
          showDetails={detailsExpanded}
          kind={choice.kind}
          flagged={Boolean(choice.flags?.includes("destructive") || choice.flags?.includes("production") || choice.flags?.includes("security_sensitive"))}
          onPress={() => onSubmit(choice)}
        />
      ))}
      {cancelChoices.length ? (
        <View style={styles.cancelActionGroup}>
          {cancelChoices.map((choice, index) => (
            <Pressable
              key={`${choice.id}:${index}`}
              disabled={disabled}
              onPress={() => onSubmit(choice)}
              style={[styles.cancelButton, disabled ? styles.choiceCardDisabled : null]}
            >
              <Text style={styles.cancelText}>{choice.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function QuestionnaireOptionCards({
  question,
  selectedAnswers,
  cancelChoices = [],
  disabled = false,
  hideQuestionLabel = false,
  onCancel,
  onSelect,
}: {
  question: Question;
  selectedAnswers: string[];
  cancelChoices?: Choice[];
  disabled?: boolean;
  hideQuestionLabel?: boolean;
  onCancel?: (choice: Choice) => void;
  onSelect: (question: string, option: string, multiSelect: boolean) => void;
}) {
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const hasDetails = question.options.some((option) => option.description);

  useEffect(() => {
    setDetailsExpanded(true);
  }, [optionKey(question.options)]);

  return (
    <View style={styles.choiceSet}>
      {hasDetails ? <OptionDetailsToggle expanded={detailsExpanded} onPress={() => setDetailsExpanded((current) => !current)} /> : null}
      {!hideQuestionLabel ? (
        <View style={styles.questionIntro}>
          {question.header ? <Text style={styles.questionHeader}>{question.header}</Text> : null}
          <Text style={styles.questionText}>{question.question}</Text>
        </View>
      ) : null}
      <Text style={styles.questionHint}>{question.multiSelect ? translateSource("Select one or more") : translateSource("Select one")}</Text>
      {question.options.map((option) => {
        const active = selectedAnswers.includes(option.label);
        return (
          <ChoiceCard
            key={option.label}
            accessibilityLabel={`${option.label} ${active ? translateSource("selected") : translateSource("not selected")}`}
            label={option.label}
            description={option.description}
            disabled={disabled}
            selected={active}
            showDetails={detailsExpanded}
            checkbox={question.multiSelect ? (active ? "checked" : "unchecked") : undefined}
            onPress={() => onSelect(question.question, option.label, question.multiSelect)}
          />
        );
      })}
      {cancelChoices.length ? (
        <View style={styles.cancelActionGroup}>
          {cancelChoices.map((choice, index) => (
            <Pressable
              key={`${choice.id}:${index}`}
              disabled={disabled}
              onPress={() => onCancel?.(choice)}
              style={[styles.cancelButton, disabled ? styles.choiceCardDisabled : null]}
            >
              <Text style={styles.cancelText}>{choice.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  choiceSet: {
    gap: 10,
    marginHorizontal: -20,
    marginTop: -20,
    paddingHorizontal: 20,
    paddingTop: 20,
    position: "relative",
  },
  detailsToggle: {
    alignItems: "center",
    backgroundColor: "#f8f5ed",
    borderColor: "#ded6c6",
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  detailsToggleFloating: {
    position: "absolute",
    right: -10,
    top: -10,
    zIndex: 2,
  },
  detailsToggleText: {
    color: "#202124",
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 20,
  },
  choiceCard: {
    alignItems: "center",
    backgroundColor: "#3c4043",
    borderColor: "transparent",
    borderRadius: 8,
    borderWidth: 2,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 10,
    position: "relative",
  },
  approveCard: { backgroundColor: "#1f6f5b" },
  denyCard: { backgroundColor: "#a33b2f" },
  selectedChoiceCard: { borderColor: "#fbbc04" },
  flaggedChoiceCard: { borderColor: "#fbbc04" },
  choiceCardDisabled: { backgroundColor: "#8e8778" },
  choiceContent: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 34,
    position: "relative",
    width: "100%",
  },
  choiceFavoriteIcon: {
    color: "#fbbc04",
    fontSize: 22,
    fontWeight: "900",
    left: 0,
    position: "absolute",
  },
  choiceLabelStack: { alignItems: "center", gap: 4, width: "100%" },
  choiceText: { color: "#ffffff", fontSize: 17, fontWeight: "900", textAlign: "center" },
  choiceDescription: {
    color: "rgba(255, 255, 255, 0.82)",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    textAlign: "center",
  },
  choiceBadgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, justifyContent: "center" },
  choiceBadge: {
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    borderRadius: 999,
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 2,
    textTransform: "uppercase",
  },
  checkboxBadge: {
    color: "#ffffff",
    fontSize: 19,
    fontWeight: "900",
    left: 10,
    lineHeight: 20,
    position: "absolute",
    top: 10,
    zIndex: 1,
  },
  checkboxBadgeChecked: { color: "#fbbc04" },
  cancelActionGroup: {
    borderTopColor: "#ded6c6",
    borderTopWidth: 1,
    marginTop: 2,
    paddingTop: 10,
  },
  cancelButton: {
    alignItems: "center",
    backgroundColor: "#fff8f5",
    borderColor: "#a33b2f",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 14,
  },
  cancelText: { color: "#7a231b", fontSize: 16, fontWeight: "900" },
  questionIntro: { gap: 4, paddingRight: 28 },
  questionHeader: {
    color: "#6d6657",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  questionText: { color: "#202124", fontSize: 18, fontWeight: "800", lineHeight: 24 },
  questionHint: { color: "#5f5a4f", fontSize: 13, fontWeight: "700" },
});
