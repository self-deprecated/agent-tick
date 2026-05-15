import { i18n } from "@lingui/core";
import type { Messages } from "@lingui/core";
import { generateMessageId } from "@lingui/message-utils/generateMessageId";

export const defaultLocale = "en";
export const localePreferenceStorageKey = "agent-tick.locale";

export const supportedLocales = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "da", label: "Danish", nativeLabel: "Dansk" },
  { code: "de", label: "German", nativeLabel: "Deutsch" },
  { code: "fr", label: "French", nativeLabel: "Français" },
  { code: "es", label: "Spanish", nativeLabel: "Español" },
  { code: "zh", label: "Chinese", nativeLabel: "中文" },
] as const;

export type SupportedLocale = (typeof supportedLocales)[number]["code"];
export type LocalePreference = SupportedLocale | "system";

const supportedLocaleCodes = new Set<string>(supportedLocales.map((locale) => locale.code));

export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return Boolean(value && supportedLocaleCodes.has(value));
}

export function localeName(locale: SupportedLocale): string {
  return supportedLocales.find((candidate) => candidate.code === locale)?.nativeLabel ?? locale;
}

export function normalizeLocale(value: string | null | undefined): SupportedLocale {
  if (!value) return defaultLocale;
  const normalized = value.trim().replace("_", "-").toLowerCase();
  if (isSupportedLocale(normalized)) return normalized;
  const language = normalized.split("-")[0];
  return isSupportedLocale(language) ? language : defaultLocale;
}

export function resolveLocalePreference(preference: LocalePreference, systemLocale: string | null | undefined): SupportedLocale {
  return preference === "system" ? normalizeLocale(systemLocale) : preference;
}

export function systemLocaleFromIntl(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || null;
  } catch {
    return null;
  }
}

export function activateLocale(locale: SupportedLocale, messages: Messages): void {
  i18n.loadAndActivate({ locale, messages });
}

export function translateSource(message: string): string {
  return i18n._(generateMessageId(message));
}

export { i18n };
export { activateDefaultMessages, activateMessages, loadMessages } from "./catalogs.js";
