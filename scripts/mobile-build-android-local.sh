#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile="${EAS_BUILD_PROFILE:-production}"
extra_args=("$@")

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
    export ANDROID_HOME="$repo_root/.local-tools/android-sdk"
  fi
fi

export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
local_tools_bin="${AGENT_TICK_LOCAL_TOOLS_BIN:-$repo_root/.local-tools/bin}"
mkdir -p "$local_tools_bin"
cat >"$local_tools_bin/pnpm" <<'EOF'
#!/usr/bin/env bash
exec corepack pnpm "$@"
EOF
chmod +x "$local_tools_bin/pnpm"
export PATH="$local_tools_bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/build-tools/36.0.0:$PATH"

if ! command -v sdkmanager >/dev/null 2>&1; then
  cat >&2 <<'EOF'
sdkmanager is required to bootstrap the Android SDK.
Install Android Studio command-line tools or enter the root mono-sd devenv shell with android-studio-tools installed.
EOF
  exit 1
fi

if [[ ! -x "$ANDROID_SDK_ROOT/platform-tools/adb" || ! -d "$ANDROID_SDK_ROOT/platforms/android-36" || ! -d "$ANDROID_SDK_ROOT/build-tools/36.0.0" ]]; then
  echo "Installing Android SDK components into $ANDROID_SDK_ROOT..." >&2
  mkdir -p "$ANDROID_SDK_ROOT"
  # sdkmanager may close stdin early after accepting licenses; ignore only yes' SIGPIPE.
  yes | sdkmanager --sdk_root="$ANDROID_SDK_ROOT" --licenses >/dev/null || {
    license_status=("${PIPESTATUS[@]}")
    if [[ "${license_status[1]}" -ne 0 ]]; then
      exit "${license_status[1]}"
    fi
  }
  sdkmanager --sdk_root="$ANDROID_SDK_ROOT" \
    "platform-tools" \
    "platforms;android-36" \
    "build-tools;36.0.0"
fi

export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$repo_root/.local-tools/gradle}"
mkdir -p "$GRADLE_USER_HOME"
cat >"$GRADLE_USER_HOME/gradle.properties" <<'EOF'
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1536m -Dfile.encoding=UTF-8
org.gradle.workers.max=2
android.lint.execution.in-process=false
EOF

has_output=0
for arg in "${extra_args[@]}"; do
  if [[ "$arg" == "--output" || "$arg" == --output=* ]]; then
    has_output=1
    break
  fi
done

if [[ "$has_output" -eq 0 ]]; then
  app_version="$(node -e 'const fs = require("fs"); const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(config.expo?.version || "unknown");' "$repo_root/apps/mobile/app.json")"
  timestamp="${AGENT_TICK_BUILD_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
  safe_profile="${profile//[^A-Za-z0-9._-]/-}"
  safe_app_version="${app_version//[^A-Za-z0-9._-]/-}"
  case "$profile" in
    production) artifact_extension="aab" ;;
    *) artifact_extension="apk" ;;
  esac
  output_dir="$repo_root/apps/mobile/builds"
  output_file="agent-tick-android-${safe_profile}-v${safe_app_version}-${timestamp}.${artifact_extension}"
  mkdir -p "$output_dir"
  extra_args+=(--output "$output_dir/$output_file")
  echo "Writing Android build artifact to $output_dir/$output_file" >&2
fi

export EXPO_NO_TELEMETRY=1
export EAS_NO_VCS="${EAS_NO_VCS:-1}"
export EAS_PROJECT_ROOT="${EAS_PROJECT_ROOT:-$repo_root}"

cd "$repo_root/apps/mobile"
exec corepack pnpm dlx --allow-build=dtrace-provider eas-cli build --platform android --profile "$profile" --local "${extra_args[@]}"
