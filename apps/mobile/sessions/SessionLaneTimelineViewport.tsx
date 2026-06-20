import { Text, View } from "react-native";
import { translateSource } from "@agent-tick/i18n";

import { styles } from "../mobileStyles";
import type { MobileSessionDetail, MobileSessionSummary } from "../mobileTypes";
import type { MobileRequest, RequestChoice as Choice } from "../requests";
import type { SessionStackInteractionMode } from "../sessionStackState";
import { SessionDetailTimeline, type ChoiceInteractionMode } from "./SessionDetailTimeline";

export function SessionLaneTimelineViewport({ choiceInteractionMode = "click-to-submit", confirmBeforeSubmit = false, detail, interactionMode = "stack", onRespond = () => undefined, onSubmitQuestionnaire = () => undefined, onUnlockResponses, questionnaireAnswers = {}, readOnly = false, readOnlyReason, reply = "", respondingRequestKeys = {}, setQuestionnaireAnswer = () => undefined, setReply = () => undefined, unlockResponsesLabel }: { choiceInteractionMode?: ChoiceInteractionMode; confirmBeforeSubmit?: boolean; detail?: MobileSessionDetail; interactionMode?: SessionStackInteractionMode; onRespond?: (request: MobileRequest, choice: Choice) => void; onSubmitQuestionnaire?: (request: MobileRequest, answers?: Record<string, string[]>) => void; onUnlockResponses?: () => void; questionnaireAnswers?: Record<string, string[]>; readOnly?: boolean; readOnlyReason?: string; reply?: string; respondingRequestKeys?: Record<string, boolean | undefined>; setQuestionnaireAnswer?: (question: string, option: string, multiSelect: boolean) => void; setReply?: (value: string) => void; summary: MobileSessionSummary; unlockResponsesLabel?: string }) {
  const overviewMode = interactionMode === "overview";

  if (!detail) {
    return (
      <View style={styles.sessionLaneViewport}>
        <View style={styles.sessionLaneSkeletonCard}>
          <View style={styles.sessionLaneSkeletonHeader} />
          <View style={styles.sessionLaneSkeletonLineWide} />
          <View style={styles.sessionLaneSkeletonLine} />
        </View>
        <Text style={styles.sessionLaneSkeletonText}>{translateSource("Loading Session timeline…")}</Text>
      </View>
    );
  }

  return (
    <View pointerEvents={overviewMode ? "auto" : "none"} style={styles.sessionLaneViewport}>
      <SessionDetailTimeline
        choiceInteractionMode={overviewMode ? choiceInteractionMode : "click-to-submit"}
        confirmBeforeSubmit={overviewMode ? confirmBeforeSubmit : false}
        detail={detail}
        messageBodiesExpanded={false}
        onRespond={overviewMode ? onRespond : () => undefined}
        onSubmitQuestionnaire={overviewMode ? onSubmitQuestionnaire : () => undefined}
        onUnlockResponses={overviewMode ? onUnlockResponses : undefined}
        pastRequestPresentation={overviewMode ? "auto" : "collapsed"}
        questionnaireAnswers={overviewMode ? questionnaireAnswers : {}}
        readOnly={overviewMode ? readOnly : false}
        readOnlyReason={overviewMode ? readOnlyReason : undefined}
        reply={overviewMode ? reply : ""}
        respondingRequestKeys={overviewMode ? respondingRequestKeys : {}}
        scrollEnabled={overviewMode}
        setQuestionnaireAnswer={overviewMode ? setQuestionnaireAnswer : () => undefined}
        setReply={overviewMode ? setReply : () => undefined}
        showHeader={false}
        showNewActivityNudge={false}
        unlockResponsesLabel={overviewMode ? unlockResponsesLabel : undefined}
      />
    </View>
  );
}
