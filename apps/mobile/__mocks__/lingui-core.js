const i18n = {
  locale: "en",
  loadAndActivate({ locale }) {
    this.locale = locale;
  },
  _(message) {
    return typeof message === "string" ? message : message?.message ?? message?.id ?? "";
  },
};

module.exports = { i18n };
