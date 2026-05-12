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

if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" ]]; then
  if [[ -d "$HOME/Android/Sdk" ]]; then
    export ANDROID_HOME="$HOME/Android/Sdk"
  else
    export ANDROID_HOME="$repo_root/.devbox/android-sdk"
  fi
fi

export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/build-tools/36.0.0:$PATH"

if ! command -v sdkmanager >/dev/null 2>&1; then
  cat >&2 <<'EOF'
sdkmanager is required to bootstrap the Android SDK.
Install Android Studio command-line tools or run this through Devbox with android-studio-tools installed.
EOF
  exit 1
fi

if [[ ! -x "$ANDROID_SDK_ROOT/platform-tools/adb" || ! -d "$ANDROID_SDK_ROOT/platforms/android-36" || ! -d "$ANDROID_SDK_ROOT/build-tools/36.0.0" ]]; then
  echo "Installing Android SDK components into $ANDROID_SDK_ROOT..." >&2
  mkdir -p "$ANDROID_SDK_ROOT"
  yes | sdkmanager --sdk_root="$ANDROID_SDK_ROOT" --licenses >/dev/null
  sdkmanager --sdk_root="$ANDROID_SDK_ROOT" \
    "platform-tools" \
    "platforms;android-36" \
    "build-tools;36.0.0"
fi

export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$repo_root/.devbox/gradle}"
mkdir -p "$GRADLE_USER_HOME"
cat >"$GRADLE_USER_HOME/gradle.properties" <<'EOF'
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1536m -Dfile.encoding=UTF-8
org.gradle.workers.max=2
android.lint.execution.in-process=false
EOF

export EXPO_NO_TELEMETRY=1
export EAS_NO_VCS="${EAS_NO_VCS:-1}"

cd "$repo_root/apps/mobile"
exec corepack pnpm dlx eas-cli build --platform android --profile "$profile" --local "$@"
