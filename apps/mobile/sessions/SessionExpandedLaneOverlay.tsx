import type { ReactNode } from "react";
import { Animated } from "react-native";

import { styles } from "../mobileStyles";
import type { MobileSessionDetail, MobileSessionSummary } from "../mobileTypes";
import type { MobileRequest, RequestChoice as Choice } from "../requests";
import { SessionDetailTimeline, type ChoiceInteractionMode } from "./SessionDetailTimeline";
import { SessionLaneFrame } from "./SessionLaneFrame";
import { SessionLaneTimelineViewport } from "./SessionLaneTimelineViewport";

type LayoutRect = { x: number; y: number; width: number; height: number };

type SessionExpandedLaneOverlayState =
  | { kind: "expanding"; sessionID: string; from: LayoutRect; to: LayoutRect }
  | { kind: "detail"; sessionID: string }
  | { kind: "collapsing"; sessionID: string; from: LayoutRect; to: LayoutRect }
  | { kind: "settling"; sessionID: string; rect: LayoutRect };

const SESSION_LANE_TITLE_BAR_HEIGHT = 52;

export function SessionExpandedLaneOverlay({
  choiceInteractionMode,
  confirmBeforeSubmit,
  detail,
  displayTitle,
  expansion,
  headerAction,
  interactive,
  messageBodiesExpanded,
  messageBodiesFocusRevision,
  onBack,
  onRespond,
  onSubmitQuestionnaire,
  onUnlockResponses,
  progress,
  questionnaireAnswers,
  readOnly,
  readOnlyReason,
  respondingRequestKeys,
  reply,
  setQuestionnaireAnswer,
  setReply,
  summary,
  targetRect,
  unlockResponsesLabel,
}: {
  choiceInteractionMode?: ChoiceInteractionMode;
  confirmBeforeSubmit?: boolean;
  detail?: MobileSessionDetail;
  displayTitle: string;
  expansion: SessionExpandedLaneOverlayState;
  headerAction?: ReactNode;
  interactive: boolean;
  messageBodiesExpanded?: boolean;
  messageBodiesFocusRevision?: number;
  onBack: () => void;
  onRespond: (request: MobileRequest, choice: Choice) => void;
  onSubmitQuestionnaire: (request: MobileRequest, answers?: Record<string, string[]>) => void;
  onUnlockResponses?: () => void;
  progress: Animated.Value;
  questionnaireAnswers: Record<string, string[]>;
  readOnly?: boolean;
  readOnlyReason?: string;
  respondingRequestKeys?: Record<string, boolean | undefined>;
  reply: string;
  setQuestionnaireAnswer: (question: string, option: string, multiSelect: boolean) => void;
  setReply: (value: string) => void;
  summary: MobileSessionSummary;
  targetRect: LayoutRect;
  unlockResponsesLabel?: string;
}) {
  const from = expansion.kind === "expanding" ? expansion.from : expansion.kind === "collapsing" ? expansion.from : targetRect;
  const to = expansion.kind === "expanding" ? expansion.to : expansion.kind === "collapsing" ? expansion.to : targetRect;
  const animatedStyle = expansion.kind === "detail" ? {
    left: targetRect.x,
    top: targetRect.y,
    width: targetRect.width,
    height: targetRect.height,
    borderRadius: 0,
  } : expansion.kind === "settling" ? {
    left: expansion.rect.x,
    top: expansion.rect.y,
    width: expansion.rect.width,
    height: expansion.rect.height,
    borderRadius: 0,
  } : {
    left: progress.interpolate({ inputRange: [0, 1], outputRange: [from.x, to.x] }),
    top: progress.interpolate({ inputRange: [0, 1], outputRange: [from.y, to.y] }),
    width: progress.interpolate({ inputRange: [0, 1], outputRange: [from.width, to.width] }),
    height: progress.interpolate({ inputRange: [0, 1], outputRange: [from.height, to.height] }),
    borderRadius: 0,
  };
  const overlayBranch = expansion.kind !== "settling" && detail ? "detail" : "lane_preview";
  return (
    <Animated.View pointerEvents={interactive ? "auto" : "none"} style={[styles.sessionExpansionOverlay, animatedStyle]}>
      <SessionLaneFrame displayTitle={displayTitle} expanded headerAction={headerAction} onBack={expansion.kind === "detail" ? onBack : undefined} state={summary.state}>
        {overlayBranch === "detail" && detail ? (
          <SessionDetailTimeline
            detail={detail}
            onRespond={onRespond}
            onSubmitQuestionnaire={onSubmitQuestionnaire}
            respondingRequestKeys={respondingRequestKeys}
            choiceInteractionMode={choiceInteractionMode}
            confirmBeforeSubmit={confirmBeforeSubmit}
            questionnaireAnswers={questionnaireAnswers}
            setQuestionnaireAnswer={setQuestionnaireAnswer}
            reply={reply}
            setReply={setReply}
            readOnly={readOnly}
            readOnlyReason={readOnlyReason}
            unlockResponsesLabel={unlockResponsesLabel}
            onUnlockResponses={onUnlockResponses}
            showHeader={false}
            messageBodiesExpanded={messageBodiesExpanded}
            messageBodiesFocusRevision={messageBodiesFocusRevision}
            collapseScrollProgress={expansion.kind === "collapsing" ? progress : undefined}
            collapseTargetViewportHeight={expansion.kind === "collapsing" ? Math.max(0, expansion.to.height - SESSION_LANE_TITLE_BAR_HEIGHT) : undefined}
          />
        ) : (
          <SessionLaneTimelineViewport detail={detail} summary={summary} />
        )}
      </SessionLaneFrame>
    </Animated.View>
  );
}
