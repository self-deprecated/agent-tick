import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { translateSource } from "@agent-tick/i18n";

import { styles } from "../mobileStyles";
import type { SessionLaneSize } from "../sessionStackState";

export const SESSION_STACK_BOUNDARY_COLOR = "#2563eb";

function sessionStateTextStyle(state: string) {
  switch (state) {
    case "needs-input": return styles.statusStateNeedsInput;
    case "waiting": return styles.statusStateWaiting;
    case "active": return styles.statusStateActive;
    case "blocked": return styles.statusStateBlocked;
    case "failed": return styles.statusStateFailed;
    case "complete": return styles.statusStateComplete;
    case "recent": return styles.statusStateRecent;
    default: return null;
  }
}

export function SessionLaneFrame({ borderColor, bottomBoundary = false, children, collapsed = false, displayTitle, expanded = false, laneSize, onBack, onBeginReorder, onEndReorder, onMoveReorder, onTitlePress, onToggleSize, onToggleSizeLong, state, topBoundary = false }: { borderColor?: string; bottomBoundary?: boolean; children: ReactNode; collapsed?: boolean; displayTitle: string; expanded?: boolean; laneSize?: SessionLaneSize; onBack?: () => void; onBeginReorder?: (event: any) => void; onEndReorder?: (event: any) => void; onMoveReorder?: (event: any) => void; onTitlePress?: () => void; onToggleSize?: () => void; onToggleSizeLong?: () => void; state: string; topBoundary?: boolean }) {
  const titlePrefix = expanded && onBack ? "<" : ">";
  const titleBarContent = (
    <>
      <View style={styles.sessionLaneTitleCluster}>
        <Text numberOfLines={1} style={styles.historyTitle}>{titlePrefix} {displayTitle}</Text>
      </View>
      <View style={styles.statusHeaderActions}>
        <Text style={[styles.statusState, sessionStateTextStyle(state)]}>{state}</Text>
        {onToggleSize && laneSize ? (
          <Pressable accessibilityLabel={translateSource("Change Session Lane size")} accessibilityRole="button" delayLongPress={260} hitSlop={10} onLongPress={(event) => { event?.stopPropagation?.(); onToggleSizeLong?.(); }} onPress={(event) => { event?.stopPropagation?.(); onToggleSize(); }} style={styles.sessionLaneSizeButton}>
            <Text style={styles.sessionLaneSizeButtonText}>{laneSize === "collapsed" ? "▴" : laneSize === "large" ? "−" : "▾"}</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
  return (
    <View style={[styles.sessionLaneFrame, expanded ? styles.sessionLaneFrameExpanded : null, borderColor ? { borderColor } : null, topBoundary ? { borderTopColor: SESSION_STACK_BOUNDARY_COLOR } : null, bottomBoundary ? { borderBottomColor: SESSION_STACK_BOUNDARY_COLOR } : null]}>
      {expanded && onBack ? (
        <Pressable accessibilityLabel={translateSource("Back to Session Stack")} accessibilityRole="button" onPress={onBack} style={[styles.sessionLaneTitleBar, styles.sessionLaneTitleBarExpanded]}>
          {titleBarContent}
        </Pressable>
      ) : (
        <Pressable delayLongPress={320} onLongPress={onBeginReorder} onPress={onTitlePress} onTouchEnd={onEndReorder} onTouchMove={onMoveReorder} style={[styles.sessionLaneTitleBar, expanded ? styles.sessionLaneTitleBarExpanded : null]}>
          {titleBarContent}
        </Pressable>
      )}
      {collapsed ? null : children}
    </View>
  );
}
