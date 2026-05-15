const supportedLocales = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "da", label: "Danish", nativeLabel: "Dansk" },
];
const i18n = {
  locale: "en",
  loadAndActivate({ locale }) {
    this.locale = locale;
  },
  _(message) {
    return typeof message === "string" ? message : message?.message ?? message?.id ?? "";
  },
};
const defaultLocale = "en";
const localePreferenceStorageKey = "agent-tick.locale";
const normalizeLocale = (value) => value === "da" ? "da" : "en";
const resolveLocalePreference = (preference, systemLocale) => preference === "system" ? normalizeLocale(systemLocale) : normalizeLocale(preference);
const systemLocaleFromIntl = () => "en";
const localeName = (locale) => supportedLocales.find((candidate) => candidate.code === locale)?.nativeLabel ?? locale;
const activateMessages = async (locale) => {
  const resolved = normalizeLocale(locale);
  i18n.locale = resolved;
  return resolved;
};
const activateDefaultMessages = async () => activateMessages(defaultLocale);
const loadMessages = async () => ({});

module.exports = {
  activateDefaultMessages,
  activateMessages,
  defaultLocale,
  i18n,
  loadMessages,
  localeName,
  localePreferenceStorageKey,
  normalizeLocale,
  resolveLocalePreference,
  supportedLocales,
  systemLocaleFromIntl,
};
