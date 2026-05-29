import type { ComponentProps } from "react";

import type { AgentTickAppView } from "./AgentTickAppView";
import { buildAgentTickChromeProps, type BuildAgentTickChromePropsInput } from "./buildAgentTickChromeProps";
import { buildAgentTickMainRouteProps, type BuildAgentTickMainRoutePropsInput } from "./buildAgentTickMainRouteProps";
import { buildAgentTickNativePaywallRouteProps, type BuildAgentTickNativePaywallRoutePropsInput } from "./buildAgentTickNativePaywallRouteProps";

type AgentTickAppViewProps = ComponentProps<typeof AgentTickAppView>;

export type BuildAgentTickAppViewPropsInput = BuildAgentTickChromePropsInput & BuildAgentTickMainRoutePropsInput & BuildAgentTickNativePaywallRoutePropsInput;

export function buildAgentTickAppViewProps(input: BuildAgentTickAppViewPropsInput): AgentTickAppViewProps {
  return {
    chromeProps: buildAgentTickChromeProps(input),
    mainRouteProps: buildAgentTickMainRouteProps(input),
    nativePaywallRouteProps: buildAgentTickNativePaywallRouteProps(input),
  };
}
