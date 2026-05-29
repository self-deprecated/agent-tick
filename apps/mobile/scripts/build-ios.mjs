#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const MOBILE_DIR = resolve(SCRIPT_DIR, "..");
const ROOT_DIR = resolve(MOBILE_DIR, "../..");
const LOCAL_ENV_PATH = resolve(MOBILE_DIR, ".env.build.local");
const EAS_ARCHIVE_ENV = {
  EAS_NO_VCS: "1",
  EAS_PROJECT_ROOT: ROOT_DIR,
};

const REVENUECAT_MODES = {
  "app-store-connect": {
    label: "App Store Connect / StoreKit",
    requiredKey: "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY",
    env: { EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE: "0" },
  },
  "test-store": {
    label: "RevenueCat Test Store",
    requiredKey: "EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY",
    env: { EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE: "1" },
  },
};

const BUILD_TARGETS = {
  development: {
    label: "Development client",
    profile: "development",
    description: "Internal development client. Test Store is allowed for developer-only validation.",
    allowTestStore: true,
  },
  preview: {
    label: "Internal preview build",
    profile: "preview",
    description: "Internal install build. Test Store is allowed only for non-TestFlight QA.",
    allowTestStore: true,
  },
  testflight: {
    label: "TestFlight / Apple sandbox",
    profile: "production",
    description: "Build intended for App Store Connect/TestFlight. Must use normal iOS RevenueCat key.",
    allowTestStore: false,
  },
  production: {
    label: "Production App Store submission",
    profile: "production",
    description: "Build intended for App Store submission. Must use normal iOS RevenueCat key.",
    allowTestStore: false,
  },
};

export function parseDotEnv(contents) {
  const parsed = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[match[1]] = value;
  }
  return parsed;
}

export function loadBuildEnv({ envPath = LOCAL_ENV_PATH, baseEnv = process.env } = {}) {
  const fileEnv = existsSync(envPath) ? parseDotEnv(readFileSync(envPath, "utf8")) : {};
  return { ...fileEnv, ...baseEnv };
}

export function redactValue(value) {
  if (!value) return "<missing>";
  const text = String(value);
  if (text.length <= 8) return "<set>";
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

export function buildPlan({ target, revenueCatMode, preflight = false, local = false, env = {} }) {
  const targetConfig = BUILD_TARGETS[target];
  if (!targetConfig) throw new Error(`Unknown build target: ${target}`);
  const modeConfig = REVENUECAT_MODES[revenueCatMode];
  if (!modeConfig) throw new Error(`Unknown RevenueCat mode: ${revenueCatMode}`);
  if (!targetConfig.allowTestStore && revenueCatMode === "test-store") {
    throw new Error(`${targetConfig.label} builds must use app-store-connect mode, not RevenueCat Test Store.`);
  }

  const requiredValue = env[modeConfig.requiredKey];
  if (!requiredValue || !String(requiredValue).trim()) {
    throw new Error(`${modeConfig.requiredKey} is required for ${modeConfig.label} builds.`);
  }

  const buildEnv = {
    ...EAS_ARCHIVE_ENV,
    ...modeConfig.env,
    [modeConfig.requiredKey]: String(requiredValue).trim(),
  };
  if (revenueCatMode === "app-store-connect") {
    buildEnv.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY = "";
  }

  const args = ["dlx", "--allow-build=dtrace-provider", "eas-cli", "build", "--platform", "ios", "--profile", targetConfig.profile];
  if (local) args.push("--local");

  return {
    target,
    revenueCatMode,
    profile: targetConfig.profile,
    preflight,
    local,
    env: buildEnv,
    command: "corepack",
    args,
    displayCommand: formatCommand(buildEnv, "corepack", args, { redactKeys: [/API_KEY$/] }),
    requiredKey: modeConfig.requiredKey,
    requiredKeyPreview: redactValue(requiredValue),
  };
}

export function formatCommand(env, command, args, { redactKeys = [] } = {}) {
  const envPrefix = Object.entries(env).map(([key, value]) => {
    const printableValue = redactKeys.some((pattern) => pattern.test(key)) ? redactValue(value) : value;
    return `${key}=${shellQuote(printableValue)}`;
  }).join(" ");
  const commandText = [command, ...args].map(shellQuote).join(" ");
  return `${envPrefix} ${commandText}`.trim();
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]*$/.test(text)) return text || "''";
  return `'${text.replaceAll("'", "'\\''")}'`;
}

async function askChoice(rl, prompt, choices, defaultKey) {
  const entries = Object.entries(choices);
  output.write(`\n${prompt}\n`);
  entries.forEach(([key, choice], index) => {
    output.write(`  ${index + 1}. ${key} — ${choice.label ?? choice.description}\n`);
    if (choice.description) output.write(`     ${choice.description}\n`);
  });
  const answer = (await rl.question(`Choose [${defaultKey}]: `)).trim();
  if (!answer) return defaultKey;
  const byNumber = entries[Number(answer) - 1]?.[0];
  if (byNumber) return byNumber;
  if (choices[answer]) return answer;
  throw new Error(`Invalid choice: ${answer}`);
}

function parseArgs(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const options = { preflight: false, run: false, local: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--target") options.target = args[++index];
    else if (arg === "--revenuecat-mode") options.revenueCatMode = args[++index];
    else if (arg === "--preflight") options.preflight = true;
    else if (arg === "--run") options.run = true;
    else if (arg === "--local") options.local = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  output.write(`iOS build helper for Agent Tick\n\nUsage:\n  corepack pnpm --filter @agent-tick/mobile build:ios [options]\n\nOptions:\n  --target <development|preview|testflight|production>\n  --revenuecat-mode <app-store-connect|test-store>\n  --preflight      Run typecheck, tests, and Expo config introspection before build\n  --run            Run the EAS build command instead of only printing it\n  --local          Add --local to the EAS build command\n\nLocal env file:\n  apps/mobile/.env.build.local (ignored)\n\nImportant:\n  TestFlight and production submission builds always require app-store-connect mode.\n`);
}

function runStep(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", cwd: ROOT_DIR, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
}

function runPreflight() {
  runStep("corepack", ["pnpm", "--filter", "@agent-tick/mobile", "verify:brand-assets"]);
  runStep("corepack", ["pnpm", "--filter", "@agent-tick/mobile", "typecheck"]);
  runStep("corepack", ["pnpm", "--filter", "@agent-tick/mobile", "exec", "jest", "--runInBand"]);
  runStep("corepack", ["pnpm", "--filter", "@agent-tick/mobile", "exec", "expo", "config", "--type", "introspect", "--json"]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  let { target, revenueCatMode } = options;
  if (!target || !revenueCatMode) {
    const rl = createInterface({ input, output });
    try {
      target ||= await askChoice(rl, "Build target", BUILD_TARGETS, "testflight");
      const allowedModes = BUILD_TARGETS[target].allowTestStore
        ? REVENUECAT_MODES
        : { "app-store-connect": REVENUECAT_MODES["app-store-connect"] };
      revenueCatMode ||= await askChoice(rl, "RevenueCat mode", allowedModes, "app-store-connect");
    } finally {
      rl.close();
    }
  }

  const env = loadBuildEnv();
  const plan = buildPlan({ target, revenueCatMode, preflight: options.preflight, local: options.local, env });

  output.write(`\nSelected build target: ${BUILD_TARGETS[target].label} (EAS profile: ${plan.profile})\n`);
  output.write(`Selected RevenueCat mode: ${REVENUECAT_MODES[revenueCatMode].label}\n`);
  output.write(`Required key: ${plan.requiredKey}=${plan.requiredKeyPreview}\n`);
  output.write("Full API keys are intentionally not printed.\n");
  output.write(`\nCommand shape (API keys redacted):\n${plan.displayCommand}\n`);

  if (options.preflight) runPreflight();
  if (options.run) {
    runStep(plan.command, plan.args, { cwd: MOBILE_DIR, env: { ...process.env, ...plan.env } });
  } else {
    output.write("\nDry run only. Add --run to execute the EAS build command.\n");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`mobile iOS build helper failed: ${error.message}`);
    process.exitCode = 1;
  });
}
