import type { Messages } from "@lingui/core";
import { activateLocale, defaultLocale, normalizeLocale, type SupportedLocale } from "./index.js";

export async function loadMessages(locale: SupportedLocale): Promise<Messages> {
  switch (locale) {
    case "da": {
      const catalog = await import("./locales/da/messages.js");
      return catalog.messages;
    }
    case "en":
    default: {
      const catalog = await import("./locales/en/messages.js");
      return catalog.messages;
    }
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
