#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$repo_root/.local-tools/android-sdk}}"
avd_name="${AGENT_TICK_ANDROID_AVD_NAME:-agent-tick-api36}"
log_file="${AGENT_TICK_ANDROID_EMULATOR_LOG:-${TMPDIR:-/tmp}/agent-tick-emulator-${avd_name}.log}"

log() { printf '[android-emulator] %s\n' "$*" >&2; }
fail() { log "FAILED: $*"; exit 1; }

export ANDROID_HOME="$sdk_root"
export ANDROID_SDK_ROOT="$sdk_root"
export PATH="$sdk_root/cmdline-tools/latest/bin:$sdk_root/platform-tools:$sdk_root/emulator:$PATH"
export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-offscreen}"
emulator_library_path="$sdk_root/emulator/lib64:$sdk_root/emulator/lib:$sdk_root/emulator/lib64/qt/lib"
if [[ -n "${ANDROID_EMULATOR_LIBRARY_PATH:-}" ]]; then
  emulator_library_path="$ANDROID_EMULATOR_LIBRARY_PATH:$emulator_library_path"
fi
export LD_LIBRARY_PATH="$emulator_library_path${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

command -v adb >/dev/null 2>&1 || fail "adb is required. Run 'sd agent-tick android/setup' first."
command -v emulator >/dev/null 2>&1 || fail "emulator is required. Run 'sd agent-tick android/setup' first."

if adb devices | awk 'NR > 1 && $2 == "device" { found=1 } END { exit found ? 0 : 1 }'; then
  log "A device/emulator is already connected:"
  adb devices >&2
else
  if ! emulator -list-avds | grep -Fxq "$avd_name"; then
    fail "AVD '$avd_name' does not exist. Run 'sd agent-tick android/setup' first."
  fi
  log "Starting emulator '$avd_name' in the background"
  nohup emulator -avd "$avd_name" -no-window -gpu swiftshader_indirect -no-snapshot-save -no-boot-anim ${AGENT_TICK_ANDROID_EMULATOR_ARGS:-} >"$log_file" 2>&1 &
  log "Emulator log: $log_file"
fi

log "Waiting for adb device"
adb wait-for-device

log "Waiting for Android boot completion"
for _ in $(seq 1 180); do
  boot_completed="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  if [[ "$boot_completed" == "1" ]]; then
    log "Emulator/device is booted"
    adb devices >&2
    exit 0
  fi
  sleep 1
done

fail "Timed out waiting for Android boot completion. See $log_file"
