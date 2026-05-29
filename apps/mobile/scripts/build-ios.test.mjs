import test from "node:test";
import assert from "node:assert/strict";

import { buildPlan, parseDotEnv, redactValue } from "./build-ios.mjs";

test("parseDotEnv reads local build env files", () => {
  assert.deepEqual(parseDotEnv("# comment\nEXPO_PUBLIC_REVENUECAT_IOS_API_KEY=appl_1234\nQUOTED='value with spaces'\n"), {
    EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: "appl_1234",
    QUOTED: "value with spaces",
  });
});

test("TestFlight builds must use App Store Connect RevenueCat mode", () => {
  assert.throws(
    () => buildPlan({
      target: "testflight",
      revenueCatMode: "test-store",
      env: { EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY: "test_secret" },
    }),
    /TestFlight .* must use app-store-connect mode/,
  );
});

test("production builds must use App Store Connect RevenueCat mode", () => {
  assert.throws(
    () => buildPlan({
      target: "production",
      revenueCatMode: "test-store",
      env: { EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY: "test_secret" },
    }),
    /Production App Store submission builds must use app-store-connect mode/,
  );
});

test("App Store Connect mode requires and exports the normal iOS API key", () => {
  const plan = buildPlan({
    target: "testflight",
    revenueCatMode: "app-store-connect",
    env: { EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: "appl_123456789" },
  });

  assert.equal(plan.profile, "production");
  assert.equal(plan.env.EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE, "0");
  assert.equal(plan.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY, "appl_123456789");
  assert.equal(plan.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY, "");
  assert.equal(plan.env.EAS_NO_VCS, "1");
  assert.match(plan.env.EAS_PROJECT_ROOT, /agent-tick$/);
  assert.match(plan.displayCommand, /--profile production/);
  assert.match(plan.displayCommand, /EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE=0/);
  assert.doesNotMatch(plan.displayCommand, /appl_123456789/);
  assert.match(plan.displayCommand, /EXPO_PUBLIC_REVENUECAT_IOS_API_KEY='appl…6789'/);
});

test("test store mode is allowed for development builds only", () => {
  const plan = buildPlan({
    target: "development",
    revenueCatMode: "test-store",
    env: { EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY: "test_123456789" },
  });

  assert.equal(plan.profile, "development");
  assert.equal(plan.env.EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE, "1");
  assert.equal(plan.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY, "test_123456789");
});

test("missing required keys fail before a build command is produced", () => {
  assert.throws(
    () => buildPlan({ target: "development", revenueCatMode: "test-store", env: {} }),
    /EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY is required/,
  );
  assert.throws(
    () => buildPlan({ target: "testflight", revenueCatMode: "app-store-connect", env: {} }),
    /EXPO_PUBLIC_REVENUECAT_IOS_API_KEY is required/,
  );
});

test("redaction avoids printing full API keys", () => {
  assert.equal(redactValue("appl_123456789"), "appl…6789");
  assert.equal(redactValue("short"), "<set>");
  assert.equal(redactValue(""), "<missing>");
});
