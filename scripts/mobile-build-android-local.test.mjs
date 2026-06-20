import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const scriptPath = path.join(projectRoot, "scripts", "mobile-build-android-local.sh");
const mobileAppConfig = JSON.parse(await readFile(path.join(projectRoot, "apps", "mobile", "app.json"), "utf8"));
const mobileAppVersion = mobileAppConfig.expo.version;
const defaultProductionArtifactPattern = new RegExp(
  `--output .*apps/mobile/builds/agent-tick-android-production-v${mobileAppVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-20260612T110203Z\\.aab`,
);

async function writeExecutable(filePath, content) {
  await writeFile(filePath, content, { mode: 0o755 });
}

async function makeHarness() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-tick-android-local-test-"));
  const bin = path.join(root, "bin");
  await mkdir(bin, { recursive: true });

  await writeExecutable(
    path.join(bin, "java"),
    `#!/usr/bin/env bash
exit 0
`,
  );

  await writeExecutable(
    path.join(bin, "sdkmanager"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$SDKMANAGER_LOG"
for arg in "$@"; do
  if [[ "$arg" == "--licenses" ]]; then
    exit "\${SDKMANAGER_LICENSE_EXIT:-0}"
  fi
done
sdk_root=""
for arg in "$@"; do
  case "$arg" in
    --sdk_root=*) sdk_root="\${arg#--sdk_root=}" ;;
  esac
done
if [[ -n "$sdk_root" ]]; then
  mkdir -p "$sdk_root/platform-tools" "$sdk_root/platforms/android-36" "$sdk_root/build-tools/36.0.0"
  touch "$sdk_root/platform-tools/adb"
  chmod +x "$sdk_root/platform-tools/adb"
fi
`,
  );

  await writeExecutable(
    path.join(bin, "corepack"),
    `#!/usr/bin/env bash
printf '%s\n' "$*" > "$COREPACK_LOG"
printf '%s\n' "\${EAS_PROJECT_ROOT:-}" > "$EAS_PROJECT_ROOT_LOG"
command -v pnpm > "$PNPM_PATH_LOG"
exit 0
`,
  );

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: path.join(root, "home"),
    ANDROID_HOME: path.join(root, "android-sdk"),
    ANDROID_SDK_ROOT: path.join(root, "android-sdk"),
    GRADLE_USER_HOME: path.join(root, "gradle"),
    AGENT_TICK_LOCAL_TOOLS_BIN: path.join(root, "local-tools-bin"),
    SDKMANAGER_LOG: path.join(root, "sdkmanager.log"),
    COREPACK_LOG: path.join(root, "corepack.log"),
    EAS_PROJECT_ROOT_LOG: path.join(root, "eas-project-root.log"),
    PNPM_PATH_LOG: path.join(root, "pnpm-path.log"),
    AGENT_TICK_BUILD_TIMESTAMP: "20260612T110203Z",
  };
  delete env.EAS_BUILD_PROFILE;

  return { root, env };
}

function runScript(env, args = []) {
  return new Promise((resolve) => {
    const child = spawn("bash", [scriptPath, ...args], {
      cwd: projectRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test("Android local build bootstrap tolerates yes SIGPIPE after sdkmanager accepts licenses", async () => {
  const { env } = await makeHarness();

  const result = await runScript(env);

  assert.equal(result.signal, null);
  assert.equal(result.code, 0, result.stderr);
  assert.match(await readFile(env.SDKMANAGER_LOG, "utf8"), /--licenses/);
  const corepackLog = await readFile(env.COREPACK_LOG, "utf8");
  assert.match(corepackLog, /eas-cli build --platform android --profile production --local/);
  assert.match(corepackLog, defaultProductionArtifactPattern);
  assert.equal((await readFile(env.EAS_PROJECT_ROOT_LOG, "utf8")).trim(), projectRoot);
  assert.equal((await readFile(env.PNPM_PATH_LOG, "utf8")).trim(), path.join(env.AGENT_TICK_LOCAL_TOOLS_BIN, "pnpm"));
});

test("Android local build bootstrap still fails when sdkmanager license acceptance fails", async () => {
  const { env } = await makeHarness();
  env.SDKMANAGER_LICENSE_EXIT = "7";

  const result = await runScript(env);

  assert.equal(result.signal, null);
  assert.equal(result.code, 7);
});

test("Android local build output can be overridden", async () => {
  const { env, root } = await makeHarness();
  const customOutput = path.join(root, "custom-output.aab");

  const result = await runScript(env, ["--output", customOutput]);

  assert.equal(result.signal, null);
  assert.equal(result.code, 0, result.stderr);
  const corepackLog = await readFile(env.COREPACK_LOG, "utf8");
  assert.match(corepackLog, new RegExp(`--output ${customOutput.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.doesNotMatch(corepackLog, defaultProductionArtifactPattern);
});

test("EAS archive ignores local Android SDK and Gradle tools", async () => {
  const easIgnore = await readFile(path.join(projectRoot, ".easignore"), "utf8");

  assert.match(easIgnore, /^\.local-tools\/$/m);
});
