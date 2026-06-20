#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_name="${AGENT_TICK_ANDROID_PACKAGE:-ai.selfdeprecated.agenttick}"
port="${AGENT_TICK_ANDROID_INTEGRATION_PORT:-18787}"
if [[ -n "${AGENT_TICK_ANDROID_UI_ARTIFACT_DIR:-}" ]]; then
  artifacts_dir="$AGENT_TICK_ANDROID_UI_ARTIFACT_DIR"
else
  artifacts_dir="$(mktemp -d "${TMPDIR:-/tmp}/agent-tick-android-integration.XXXXXX")"
fi
server_host_url="${AGENT_TICK_ANDROID_INTEGRATION_HOST_URL:-http://127.0.0.1:$port}"
server_device_url="${AGENT_TICK_ANDROID_INTEGRATION_SERVER_URL:-http://127.0.0.1:$port}"
self_hosted_link="Use a self-hosted server instead"
server_input_label="Self-hosted server URL"
continue_label="Continue self-hosted server setup"
connected_marker="Open menu"
server_pid=""

mkdir -p "$artifacts_dir"

log() { printf '[android-integration] %s\n' "$*" >&2; }
fail() {
  log "FAILED: $*"
  log "Artifacts: $artifacts_dir"
  [[ -f "$artifacts_dir/server.log" ]] && log "Server log: $artifacts_dir/server.log"
  exit 1
}

cleanup() {
  local status=$?
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" >/dev/null 2>&1; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

log "Artifacts: $artifacts_dir"

if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" ]]; then
  export ANDROID_HOME="$repo_root/.local-tools/android-sdk"
fi
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export PATH="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$PATH"

command -v adb >/dev/null 2>&1 || fail "adb is required. Run 'sd agent-tick android/setup' or enter an Android SDK environment."
command -v node >/dev/null 2>&1 || fail "node is required to wait for the local backend."

adb_cmd=(adb)
if [[ -n "${AGENT_TICK_ANDROID_SERIAL:-}" ]]; then
  adb_cmd+=( -s "$AGENT_TICK_ANDROID_SERIAL" )
fi

serial="$("${adb_cmd[@]}" devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')"
if [[ -z "$serial" ]]; then
  fail "No connected Android device/emulator is available. Start an emulator or connect a device, then retry."
fi
if [[ -z "${AGENT_TICK_ANDROID_SERIAL:-}" ]]; then
  adb_cmd=(adb -s "$serial")
fi
log "Using Android device $serial"

wait_for_url() {
  local url="$1"
  local label="$2"
  node --input-type=module - "$url" "$label" <<'NODE'
const [url, label] = process.argv.slice(2);
const deadline = Date.now() + 30_000;
let lastError = '';
while (Date.now() < deadline) {
  try {
    const response = await fetch(url);
    if (response.ok) process.exit(0);
    lastError = `${response.status} ${response.statusText}`;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
console.error(`${label} did not become ready at ${url}: ${lastError}`);
process.exit(1);
NODE
}

start_local_server() {
  if [[ "${AGENT_TICK_ANDROID_INTEGRATION_SKIP_SERVER:-0}" == "1" ]]; then
    log "Skipping local backend start; using $server_device_url"
    return 0
  fi

  local db_path="$artifacts_dir/agent-tick.db"
  log "Starting local single-mode backend at $server_host_url"
  (
    cd "$repo_root"
    env \
      AGENT_TICK_MODE=single \
      AGENT_TICK_HOST=0.0.0.0 \
      AGENT_TICK_PORT="$port" \
      AGENT_TICK_PUBLIC_URL="$server_device_url" \
      AGENT_TICK_DATABASE_URL="file:$db_path" \
      AGENT_TICK_ADMIN_TOKEN=android-integration-admin-token \
      AGENT_TICK_BILLING_PROVIDER=none \
      corepack pnpm --filter @agent-tick/server exec tsx src/index.ts
  ) >"$artifacts_dir/server.log" 2>&1 &
  server_pid=$!
  log "Local backend pid: $server_pid"
  wait_for_url "$server_host_url/readyz" "local backend readyz" || fail "Local backend did not become ready"
}

screenshot_opener() {
  if [[ -n "${AGENT_TICK_ANDROID_UI_SCREENSHOT_OPENER:-}" ]]; then
    printf '%s\n' "$AGENT_TICK_ANDROID_UI_SCREENSHOT_OPENER"
    return 0
  fi
  if command -v xdg-open >/dev/null 2>&1; then
    printf '%s\n' "xdg-open"
    return 0
  fi
  if command -v open >/dev/null 2>&1; then
    printf '%s\n' "open"
    return 0
  fi
  return 1
}

open_artifact_path() {
  local path="$1"
  local kind="$2"
  local opener
  if ! opener="$(screenshot_opener)"; then
    log "$kind opener requested, but no opener was found. Set AGENT_TICK_ANDROID_UI_SCREENSHOT_OPENER."
    return 0
  fi
  log "Opening $kind with '$opener': $path"
  if ! "$opener" "$path" >"$artifacts_dir/opener.log" 2>&1; then
    log "Opening $kind failed with '$opener'. See $artifacts_dir/opener.log"
    return 0
  fi
}

if [[ "${AGENT_TICK_ANDROID_UI_OPEN_ARTIFACT_DIR:-0}" == "1" ]]; then
  open_artifact_path "$artifacts_dir" "artifact directory"
fi

open_screenshot() {
  local path="$1"
  [[ "${AGENT_TICK_ANDROID_UI_OPEN_SCREENSHOTS:-0}" == "1" ]] || return 0
  open_artifact_path "$path" "screenshot"
}

screenshot() {
  local name="$1"
  local path="$artifacts_dir/$name.png"
  "${adb_cmd[@]}" exec-out screencap -p >"$path" || true
  log "Saved screenshot $path"
  open_screenshot "$path"
}

dump_xml() {
  local name="$1"
  "${adb_cmd[@]}" shell rm -f /sdcard/agent-tick-window.xml >/dev/null 2>&1 || true
  "${adb_cmd[@]}" shell uiautomator dump /sdcard/agent-tick-window.xml >/dev/null
  "${adb_cmd[@]}" exec-out cat /sdcard/agent-tick-window.xml >"$artifacts_dir/$name.xml"
  printf '%s\n' "$artifacts_dir/$name.xml"
}

cat >"$artifacts_dir/find_node.py" <<'PY'
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

xml_path = os.environ["XML"]
needle = os.environ["MATCH"]
mode = os.environ.get("MATCH_MODE", "exact")

bounds_re = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")

def parse_bounds(value):
    match = bounds_re.fullmatch(value or "")
    if not match:
        return None
    left, top, right, bottom = map(int, match.groups())
    return {"left": left, "top": top, "right": right, "bottom": bottom, "x": (left + right) // 2, "y": (top + bottom) // 2}

def matches(value):
    if mode == "contains":
        return needle in value
    return value == needle

root = ET.parse(xml_path).getroot()
for node in root.iter("node"):
    values = [node.attrib.get("text", ""), node.attrib.get("content-desc", ""), node.attrib.get("resource-id", "")]
    if any(value and matches(value) for value in values):
        bounds = parse_bounds(node.attrib.get("bounds"))
        if not bounds:
            continue
        print(json.dumps({
            "text": node.attrib.get("text", ""),
            "content_desc": node.attrib.get("content-desc", ""),
            "resource_id": node.attrib.get("resource-id", ""),
            "package": node.attrib.get("package", ""),
            "bounds": bounds,
        }))
        sys.exit(0)

sys.exit(1)
PY

find_node() {
  local xml="$1"
  local match="$2"
  local mode="${3:-exact}"
  MATCH="$match" MATCH_MODE="$mode" XML="$xml" python3 "$artifacts_dir/find_node.py"
}

node_center() {
  python3 -c 'import json,sys; n=json.load(sys.stdin); print(n["bounds"]["x"], n["bounds"]["y"])'
}

wait_for_node() {
  local match="$1"
  local prefix="$2"
  local attempts="${3:-30}"
  local mode="${4:-exact}"
  local xml info
  for ((i = 1; i <= attempts; i++)); do
    xml="$(dump_xml "$prefix-$i")"
    if info="$(find_node "$xml" "$match" "$mode")"; then
      printf '%s\n' "$info"
      return 0
    fi
    sleep 1
  done
  return 1
}

tap_node() {
  local match="$1"
  local prefix="$2"
  local info x y
  info="$(wait_for_node "$match" "$prefix")" || fail "Could not find UI node '$match'"
  read -r x y < <(printf '%s\n' "$info" | node_center)
  log "Tapping '$match' at $x,$y"
  "${adb_cmd[@]}" shell input tap "$x" "$y"
}

adb_input_text() {
  local text="$1"
  local escaped
  escaped="$(TEXT="$text" python3 - <<'PY'
import os
text = os.environ['TEXT']
# Android's input text command treats %s as a space and % as an escape prefix.
print(text.replace('%', '%25').replace(' ', '%s'))
PY
)"
  "${adb_cmd[@]}" shell input text "$escaped"
}

install_apk_if_needed() {
  if [[ "${AGENT_TICK_ANDROID_UI_SKIP_INSTALL:-0}" == "1" ]]; then
    log "Skipping APK install; using app already installed on device"
    return 0
  fi

  local apk="${AGENT_TICK_ANDROID_APK:-}"
  if [[ -z "$apk" ]]; then
    local latest_apk
    latest_apk="$(find "$repo_root/apps/mobile/builds" -maxdepth 1 -type f -name '*.apk' -printf '%T@ %p\n' 2>/dev/null | sort -nr | awk 'NR == 1 { $1=""; sub(/^ /, ""); print; exit }')"
    if [[ -n "$latest_apk" && "${AGENT_TICK_ANDROID_UI_REBUILD:-0}" != "1" ]]; then
      apk="$latest_apk"
      log "Using latest existing APK: $apk"
    else
      log "Building preview APK. Set AGENT_TICK_ANDROID_APK=/path/to.apk to reuse an artifact."
      EAS_BUILD_PROFILE=preview bash "$repo_root/scripts/mobile-build-android-local.sh"
      apk="$(find "$repo_root/apps/mobile/builds" -maxdepth 1 -type f -name '*.apk' -printf '%T@ %p\n' | sort -nr | awk 'NR == 1 { $1=""; sub(/^ /, ""); print; exit }')"
    fi
  fi
  [[ -f "$apk" ]] || fail "APK not found: ${apk:-<empty>}"

  log "Installing $apk"
  "${adb_cmd[@]}" install -r "$apk" >/dev/null
}

start_local_server

if [[ "${AGENT_TICK_ANDROID_INTEGRATION_SKIP_REVERSE:-0}" != "1" ]]; then
  log "Reversing device tcp:$port to host tcp:$port"
  "${adb_cmd[@]}" reverse "tcp:$port" "tcp:$port" >/dev/null || fail "adb reverse failed for tcp:$port"
fi

install_apk_if_needed

if [[ "${AGENT_TICK_ANDROID_UI_SKIP_CLEAR:-0}" != "1" ]]; then
  log "Clearing app data for $package_name"
  "${adb_cmd[@]}" shell pm clear "$package_name" >/dev/null || true
else
  log "Skipping app data clear"
fi

log "Host backend URL: $server_host_url"
log "Device app URL: $server_device_url"
log "Launching $package_name"
"${adb_cmd[@]}" shell monkey -p "$package_name" -c android.intent.category.LAUNCHER 1 >/dev/null
screenshot "00-launched"

tap_node "$self_hosted_link" "wait-self-hosted-link"
sleep 0.5
screenshot "01-self-hosted-open"

tap_node "$server_input_label" "wait-server-input"
log "Entering local backend URL: $server_device_url"
adb_input_text "$server_device_url"
sleep 0.5
screenshot "02-url-entered"

tap_node "$continue_label" "wait-continue"
log "Waiting for app to connect to local backend"
wait_for_node "$connected_marker" "wait-connected" 45 >/dev/null || {
  screenshot "03-connect-failed"
  fail "App did not reach the main Agent Tick UI after connecting to $server_device_url"
}
screenshot "03-connected"

log "PASS: mobile app connected to local backend at $server_device_url"
log "Artifacts: $artifacts_dir"
