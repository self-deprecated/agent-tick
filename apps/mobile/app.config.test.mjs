import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const configPath = require.resolve("./app.config.js");

function loadConfig(env = {}) {
  const previous = {
    APP_VARIANT: process.env.APP_VARIANT,
    EAS_BUILD_PROFILE: process.env.EAS_BUILD_PROFILE,
  };

  delete process.env.APP_VARIANT;
  delete process.env.EAS_BUILD_PROFILE;
  Object.assign(process.env, env);
  delete require.cache[configPath];

  try {
    return require(configPath);
  } finally {
    delete require.cache[configPath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function expoBuildProperties(config) {
  const plugin = config.expo.plugins.find((entry) => Array.isArray(entry) && entry[0] === "expo-build-properties");
  assert.ok(plugin, "expected expo-build-properties plugin");
  return plugin[1];
}

test("production Android config does not enable broad cleartext traffic", () => {
  const config = loadConfig();

  assert.equal(config.expo.android.package, "ai.selfdeprecated.agenttick");
  assert.equal(expoBuildProperties(config).android, undefined);
});

test("development Android config allows local HTTP traffic", () => {
  const config = loadConfig({ APP_VARIANT: "development" });

  assert.equal(config.expo.android.package, "ai.selfdeprecated.agenttick.dev");
  assert.equal(expoBuildProperties(config).android.usesCleartextTraffic, true);
});

test("EAS development profile uses development Android cleartext behavior", () => {
  const config = loadConfig({ EAS_BUILD_PROFILE: "development" });

  assert.equal(config.expo.android.package, "ai.selfdeprecated.agenttick.dev");
  assert.equal(expoBuildProperties(config).android.usesCleartextTraffic, true);
});
