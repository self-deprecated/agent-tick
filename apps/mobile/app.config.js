const base = require("./app.json");

const DEV_APP_ID = "ai.selfdeprecated.agenttick.dev";

const appVariant = process.env.APP_VARIANT ?? process.env.EAS_BUILD_PROFILE;
const isDev = appVariant === "development";

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

module.exports = {
  expo: {
    ...base.expo,
    name: isDev ? "Agent Tick Dev" : base.expo.name,
    scheme: isDev ? "agenttick-dev" : base.expo.scheme,
    ios: {
      ...base.expo.ios,
      bundleIdentifier: isDev ? DEV_APP_ID : base.expo.ios.bundleIdentifier,
      associatedDomains: isDev ? [] : base.expo.ios.associatedDomains,
    },
    android: withoutUndefined({
      ...base.expo.android,
      package: isDev ? DEV_APP_ID : base.expo.android.package,
      googleServicesFile: isDev ? undefined : base.expo.android.googleServicesFile,
      playStoreUrl: isDev ? undefined : base.expo.android.playStoreUrl,
      intentFilters: isDev ? [] : base.expo.android.intentFilters,
    }),
  },
};
