import { i18n, type Messages } from "@lingui/core";
import { messages as messagesDa } from "./locales/da/messages.js";
import { messages as messagesEn } from "./locales/en/messages.js";

const defaultLocale = "en";
const supportedLocaleCodes = new Set(["en", "da"]);

type SupportedLocale = "en" | "da";

function normalizeLocale(value: string | null | undefined): SupportedLocale {
  if (!value) return defaultLocale;
  const normalized = value.trim().replace("_", "-").toLowerCase();
  if (supportedLocaleCodes.has(normalized)) return normalized as SupportedLocale;
  const language = normalized.split("-")[0];
  return supportedLocaleCodes.has(language ?? "") ? language as SupportedLocale : defaultLocale;
}

function activateLocale(locale: SupportedLocale, messages: Messages): void {
  i18n.loadAndActivate({ locale, messages });
}

export async function loadMessages(locale: SupportedLocale): Promise<Messages> {
  switch (locale) {
    case "da":
      return messagesDa;
    case "en":
    default:
      return messagesEn;
  }
}

export async function activateMessages(locale: string): Promise<SupportedLocale> {
  const resolved = normalizeLocale(locale);
  const messages = await loadMessages(resolved);
  activateLocale(resolved, messages);
  return resolved;
}

export async function activateDefaultMessages(): Promise<SupportedLocale> {
  return activateMessages(defaultLocale);
}
