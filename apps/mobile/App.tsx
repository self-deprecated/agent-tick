import { AgentTickApp } from "./appShell/AgentTickApp";
import { AgentTickAppRoot } from "./appShell/AgentTickAppRoot";
export { usesCompactRequestTitle, usesDenseRequestTitle } from "./requestsScreen/requestTitleDensity";
export { allocateSessionLaneLayouts, type SessionLaneLayout } from "./sessions/sessionLaneLayout";
export { shouldAutoFocusSessionTimelineNewActivity } from "./sessions/sessionTimelineLogic";
export { synthesizeSessionlessActivityStack } from "./sessions/sessionlessActivityStack";
export { ScannerScreen } from "./scanner/ScannerScreen";
export { HistoryScreen } from "./history/HistoryScreen";
export { RequestsScreen } from "./requestsScreen/RequestsScreen";
export { SessionApprovalFlow } from "./sessions/SessionApprovalFlow";
export { SessionDetailTimeline } from "./sessions/SessionDetailTimeline";
export { SessionStackScreen } from "./sessions/SessionStackScreen";
export { SessionStackEmptyState } from "./sessions/SessionStackEmptyState";
export { SideMenu } from "./sideMenu/SideMenu";
export { cachedRuntimeAuthConfig, fetchRuntimeAuthConfigIfAvailable } from "./appShell/runtimeAuthConfigCache";
export type { AccountPendingState } from "./mobileTypes";


export default function App() {
  return <AgentTickAppRoot renderAgentTickApp={(key, agentTickAppProps) => <AgentTickApp key={key} {...agentTickAppProps} />} />;
}
