import type { LocalePreference, SupportedLocale } from "@agent-tick/i18n";

import type { RuntimeAuthConfig, SavedMobileAccount } from "../mobileAuth";

export type ClerkTokenProvider = () => Promise<string | null>;

export type AgentTickAppProps = {
  initialServerURL?: string;
  initialAuthConfig?: RuntimeAuthConfig | null;
  initialShowClerkAuthView?: boolean;
  clerkTokenProvider?: ClerkTokenProvider;
  clerkSessionToken?: string | null;
  clerkSessionID?: string | null;
  clerkSignedIn?: boolean;
  clerkDebugState?: Record<string, unknown>;
  onRuntimeAuthConfig?: (serverURL: string, config: RuntimeAuthConfig | null) => void;
  activeLocale: SupportedLocale;
  localePreference: LocalePreference;
  onLocalePreferenceChange: (preference: LocalePreference) => void;
};

export type AgentTickAppClerkControls = {
  onAddClerkAccount?: () => void;
  onForgetClerkSession?: (options?: { reopenSignIn?: boolean }) => void;
  onSelectSavedClerkAccount?: (account: SavedMobileAccount) => Promise<"selected" | "reauth_started" | "missing">;
};
