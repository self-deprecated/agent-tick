#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$repo_root/.local-tools/android-sdk}}"
avd_name="${AGENT_TICK_ANDROID_AVD_NAME:-agent-tick-api36}"
system_image="${AGENT_TICK_ANDROID_SYSTEM_IMAGE:-system-images;android-36;google_apis;x86_64}"
platform="${AGENT_TICK_ANDROID_PLATFORM:-platforms;android-36}"
build_tools="${AGENT_TICK_ANDROID_BUILD_TOOLS:-build-tools;36.0.0}"

log() { printf '[android-setup] %s\n' "$*" >&2; }
fail() { log "FAILED: $*"; exit 1; }

command -v sdkmanager >/dev/null 2>&1 || fail "sdkmanager is required. Install Android Studio command-line tools or enter a shell that provides the Android SDK tools."

mkdir -p "$sdk_root"
log "Using Android SDK root: $sdk_root"

log "Accepting Android SDK licenses"
yes | sdkmanager --sdk_root="$sdk_root" --licenses >/dev/null || {
  status=("${PIPESTATUS[@]}")
  if [[ "${status[1]}" -ne 0 ]]; then
    exit "${status[1]}"
  fi
}

log "Installing Android SDK packages"
sdkmanager --sdk_root="$sdk_root" \
  "cmdline-tools;latest" \
  "platform-tools" \
  "emulator" \
  "$platform" \
  "$build_tools" \
  "$system_image"

export ANDROID_HOME="$sdk_root"
export ANDROID_SDK_ROOT="$sdk_root"
export PATH="$sdk_root/cmdline-tools/latest/bin:$sdk_root/platform-tools:$sdk_root/emulator:$PATH"

avdmanager_bin="$sdk_root/cmdline-tools/latest/bin/avdmanager"
[[ -x "$avdmanager_bin" ]] || fail "SDK-local avdmanager was not installed at $avdmanager_bin"

if ! "$avdmanager_bin" list avd | grep -Fq "Name: $avd_name"; then
  log "Creating AVD: $avd_name"
  printf 'no\n' | "$avdmanager_bin" create avd \
    --name "$avd_name" \
    --package "$system_image" \
    --device "pixel_6" \
    --force >/dev/null
else
  log "AVD already exists: $avd_name"
fi

cat >&2 <<EOF
[android-setup] Done.
[android-setup] Add this to your shell or rely on your development shell exports:
[android-setup]   export ANDROID_HOME="$sdk_root"
[android-setup]   export ANDROID_SDK_ROOT="$sdk_root"
[android-setup]   export PATH="$sdk_root/cmdline-tools/latest/bin:$sdk_root/platform-tools:$sdk_root/emulator:\$PATH"
[android-setup]
[android-setup] Start the emulator with:
[android-setup]   sd agent-tick android/start-emulator
EOF
