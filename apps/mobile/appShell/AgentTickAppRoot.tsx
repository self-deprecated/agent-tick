import AsyncStorage from "@react-native-async-storage/async-storage";
import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { I18nProvider, type TransRenderProps } from "@lingui/react";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Linking, Text } from "react-native";

import {
  activateMessages,
  defaultLocale,
  i18n,
  isSupportedLocale,
  localePreferenceStorageKey,
  resolveLocalePreference,
  systemLocaleFromIntl,
  type LocalePreference,
  type SupportedLocale,
} from "@agent-tick/i18n";

import { mobileUpdateStatus, parsePairingPayload } from "../AppLogic";
import { hostedServerURL, normalizeServerURL, serverURLStorageKey, type RuntimeAuthConfig } from "../mobileAuth";
import { ClerkBoundApp } from "./ClerkBoundApp";
import type { AgentTickAppClerkControls, AgentTickAppProps } from "./AgentTickAppProps";
import { currentMobileAppVersion } from "./appBootstrapHelpers";
import { HostedFirstOnboardingScreen } from "./HostedFirstOnboardingScreen";
import { LoadingScreen } from "./LoadingScreen";
import { fetchRuntimeAuthConfigIfAvailable, writeRuntimeAuthConfigCache } from "./runtimeAuthConfigCache";
import { hasSavedLocalSession } from "./mobileSessionClientHelpers";
import { UpdateRequiredScreen } from "./UpdateRequiredScreen";

const defaultServer = hostedServerURL;
const LinguiText = ({ children }: TransRenderProps) => <Text>{children}</Text>;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export type AgentTickAppRootProps = {
  renderAgentTickApp: (key: string, props: AgentTickAppProps & AgentTickAppClerkControls) => ReactElement;
};

export function AgentTickAppRoot({ renderAgentTickApp }: AgentTickAppRootProps) {
  const [bootstrap, setBootstrap] = useState<{
    serverURL: string;
    authConfig: RuntimeAuthConfig | null;
    loaded: boolean;
  }>({ serverURL: defaultServer, authConfig: null, loaded: false });
  const [localeState, setLocaleState] = useState<{
    loaded: boolean;
    activeLocale: SupportedLocale;
    preference: LocalePreference;
  }>({ loaded: false, activeLocale: defaultLocale, preference: "system" });

  useEffect(() => {
    let cancelled = false;
    const loadLocale = async () => {
      const savedPreference = await AsyncStorage.getItem(localePreferenceStorageKey);
      const preference: LocalePreference = savedPreference === "system" || isSupportedLocale(savedPreference) ? savedPreference : "system";
      const activeLocale = resolveLocalePreference(preference, systemLocaleFromIntl());
      await activateMessages(activeLocale);
      if (!cancelled) setLocaleState({ loaded: true, activeLocale, preference });
    };
    void loadLocale();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadBootstrap = async () => {
      const initialURLPayload = parsePairingPayload((await Linking.getInitialURL().catch(() => null)) ?? "");
      const linkedServerURL = initialURLPayload.serverURL ? normalizeServerURL(initialURLPayload.serverURL) : "";
      const savedServerURL = normalizeServerURL((await AsyncStorage.getItem(serverURLStorageKey)) ?? defaultServer);
      const savedAuthConfig = await fetchRuntimeAuthConfigIfAvailable(savedServerURL);
      const shouldKeepSavedServer =
        savedServerURL === defaultServer ||
        (savedAuthConfig?.authProvider !== "clerk" && (await hasSavedLocalSession(savedServerURL)));
      const serverURL = linkedServerURL || (shouldKeepSavedServer ? savedServerURL : defaultServer);
      const authConfig = serverURL === savedServerURL
        ? savedAuthConfig
        : await fetchRuntimeAuthConfigIfAvailable(serverURL);
      if (!cancelled) setBootstrap({ serverURL, authConfig, loaded: true });
    };
    void loadBootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRuntimeAuthConfig = useCallback((serverURL: string, authConfig: RuntimeAuthConfig | null) => {
    const normalizedServerURL = normalizeServerURL(serverURL);
    void AsyncStorage.setItem(serverURLStorageKey, normalizedServerURL);
    if (authConfig) void writeRuntimeAuthConfigCache(normalizedServerURL, authConfig);
    setBootstrap({ serverURL: normalizedServerURL, authConfig, loaded: true });
  }, []);

  const handleLocalePreferenceChange = useCallback((preference: LocalePreference) => {
    const activeLocale = resolveLocalePreference(preference, systemLocaleFromIntl());
    void AsyncStorage.setItem(localePreferenceStorageKey, preference);
    void activateMessages(activeLocale).then((activatedLocale) => {
      setLocaleState({ loaded: true, activeLocale: activatedLocale, preference });
    });
  }, []);

  if (!bootstrap.loaded || !localeState.loaded) {
    return <LoadingScreen />;
  }

  const i18nProps = {
    activeLocale: localeState.activeLocale,
    localePreference: localeState.preference,
    onLocalePreferenceChange: handleLocalePreferenceChange,
  };

  const updateStatus = mobileUpdateStatus(bootstrap.authConfig?.mobile, currentMobileAppVersion());

  let content;
  if (!updateStatus.supported) {
    content = <UpdateRequiredScreen status={updateStatus} serverURL={bootstrap.serverURL} />;
  } else if (bootstrap.authConfig?.authProvider === "clerk" && bootstrap.authConfig.clerkPublishableKey) {
    content = (
      <ClerkProvider publishableKey={bootstrap.authConfig.clerkPublishableKey} tokenCache={tokenCache}>
        <ClerkBoundApp
          initialServerURL={bootstrap.serverURL}
          initialAuthConfig={bootstrap.authConfig}
          onRuntimeAuthConfig={handleRuntimeAuthConfig}
          renderAgentTickApp={renderAgentTickApp}
          {...i18nProps}
        />
      </ClerkProvider>
    );
  } else if (normalizeServerURL(bootstrap.serverURL) === defaultServer) {
    content = (
      <HostedFirstOnboardingScreen
        error={bootstrap.authConfig ? "agenttick.sh did not advertise Clerk sign-in." : "Could not reach agenttick.sh."}
        onServerSelected={handleRuntimeAuthConfig}
      />
    );
  } else {
    content = renderAgentTickApp("agent-tick-app", {
      initialServerURL: bootstrap.serverURL,
      initialAuthConfig: bootstrap.authConfig,
      onRuntimeAuthConfig: handleRuntimeAuthConfig,
      ...i18nProps,
    });
  }

  return (
    <I18nProvider i18n={i18n} defaultComponent={LinguiText}>
      {content}
    </I18nProvider>
  );
}
