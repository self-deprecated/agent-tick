import type { ComponentProps } from "react";
import { View } from "react-native";

import { styles } from "../mobileStyles";
import { AgentTickAppChrome } from "./AgentTickAppChrome";
import { AgentTickMainRoute } from "./AgentTickMainRoute";
import { AgentTickNativePaywallRoute } from "./AgentTickNativePaywallRoute";

type AgentTickAppViewProps = {
  chromeProps: ComponentProps<typeof AgentTickAppChrome>;
  mainRouteProps: ComponentProps<typeof AgentTickMainRoute>;
  nativePaywallRouteProps: ComponentProps<typeof AgentTickNativePaywallRoute>;
};

export function AgentTickAppView({
  chromeProps,
  mainRouteProps,
  nativePaywallRouteProps,
}: AgentTickAppViewProps) {
  return (
    <View style={styles.shell}>
      <AgentTickAppChrome {...chromeProps} />
      <AgentTickMainRoute {...mainRouteProps} />
      <AgentTickNativePaywallRoute {...nativePaywallRouteProps} />
    </View>
  );
}
