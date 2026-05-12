#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile="${EAS_BUILD_PROFILE:-production}"

if ! command -v java >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Java is required for a local Android build.
Install Android Studio/JDK or enter an environment that provides Java, then retry.
EOF
  exit 1
fi

if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" && -d "$HOME/Android/Sdk" ]]; then
  export ANDROID_HOME="$HOME/Android/Sdk"
fi

if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" ]]; then
  cat >&2 <<'EOF'
ANDROID_HOME or ANDROID_SDK_ROOT must point at your Android SDK for a local Android build.
Devbox provides Java for this script, but the Android SDK still needs to be installed separately.
Install Android Studio, open its SDK Manager once, and export ANDROID_HOME to the SDK path.
Common Linux path: export ANDROID_HOME="$HOME/Android/Sdk"
EOF
  exit 1
fi

export EXPO_NO_TELEMETRY=1
export EAS_NO_VCS="${EAS_NO_VCS:-1}"

cd "$repo_root/apps/mobile"
exec corepack pnpm dlx eas-cli build --platform android --profile "$profile" --local "$@"
