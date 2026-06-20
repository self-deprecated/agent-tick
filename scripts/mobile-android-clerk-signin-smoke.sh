#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_name="${AGENT_TICK_ANDROID_PACKAGE:-ai.selfdeprecated.agenttick}"
server_url="${AGENT_TICK_ANDROID_CLERK_SERVER_URL:-https://app.agenttick.sh}"
hosted_url="https://app.agenttick.sh"
artifacts_dir="${AGENT_TICK_ANDROID_UI_ARTIFACT_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/agent-tick-android-clerk-signin.XXXXXX")}" 
self_hosted_link="Use a self-hosted server instead"
server_input_label="Self-hosted server URL"
continue_label="Continue self-hosted server setup"

mkdir -p "$artifacts_dir"

log() { printf '[android-clerk] %s\n' "$*" >&2; }
fail() {
  log "FAILED: $*"
  log "Artifacts: $artifacts_dir"
  exit 1
}

log "Artifacts: $artifacts_dir"
log "Clerk server URL: $server_url"

if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" ]]; then
  export ANDROID_HOME="$repo_root/.local-tools/android-sdk"
fi
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export PATH="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$PATH"

command -v adb >/dev/null 2>&1 || fail "adb is required. Run 'sd agent-tick android/setup' or enter an Android SDK environment."

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

cat >"$artifacts_dir/xml_text.py" <<'PY'
import sys
import xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
for node in root.iter("node"):
    values = [node.attrib.get("text", ""), node.attrib.get("content-desc", ""), node.attrib.get("resource-id", "")]
    values = [value for value in values if value]
    if values:
        print(" | ".join(values))
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
  local mode="${3:-exact}"
  local info x y
  info="$(wait_for_node "$match" "$prefix" 30 "$mode")" || fail "Could not find UI node '$match'"
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

install_apk_if_needed

if [[ "${AGENT_TICK_ANDROID_UI_SKIP_CLEAR:-0}" != "1" ]]; then
  log "Clearing app data for $package_name"
  "${adb_cmd[@]}" shell pm clear "$package_name" >/dev/null || true
else
  log "Skipping app data clear"
fi

log "Launching $package_name"
"${adb_cmd[@]}" shell monkey -p "$package_name" -c android.intent.category.LAUNCHER 1 >/dev/null
screenshot "00-launched"

if [[ "$server_url" != "$hosted_url" ]]; then
  tap_node "$self_hosted_link" "wait-self-hosted-link"
  sleep 0.5
  screenshot "01-self-hosted-open"
  tap_node "$server_input_label" "wait-server-input"
  log "Entering Clerk server URL: $server_url"
  adb_input_text "$server_url"
  sleep 0.5
  screenshot "02-url-entered"
  tap_node "$continue_label" "wait-continue"
  sign_in_label="Sign in to $(SERVER_URL="$server_url" node --input-type=module - <<'NODE'
const input = process.env.SERVER_URL;
try { console.log(new URL(input).host); } catch { console.log('this server'); }
NODE
)"
else
  sign_in_label="Sign in to agenttick.sh"
fi

log "Waiting for Clerk sign-in entry: $sign_in_label"
wait_for_node "$sign_in_label" "wait-sign-in-entry" 45 >/dev/null || {
  screenshot "03-sign-in-entry-missing"
  fail "Did not reach Clerk sign-in entry for $server_url"
}
screenshot "03-sign-in-entry"
tap_node "$sign_in_label" "tap-sign-in-entry"

log "Waiting for Clerk native auth UI"
if wait_for_node "GitHub" "wait-github" 45 contains >/dev/null; then
  screenshot "04-clerk-auth"
  log "Found GitHub sign-in control"
  tap_node "GitHub" "tap-github" contains
else
  screenshot "04-clerk-auth-missing-github"
  xml="$(dump_xml "04-clerk-auth-missing-github")"
  python3 "$artifacts_dir/xml_text.py" "$xml" >"$artifacts_dir/04-clerk-auth-text.txt" || true
  fail "Could not find a GitHub sign-in control in Clerk auth UI"
fi

sleep 5
xml="$(dump_xml "05-after-github-initial")"
if find_node "$xml" "Use without an account" >/dev/null; then
  screenshot "05-chrome-first-run"
  log "Dismissing Chrome first-run screen"
  tap_node "Use without an account" "tap-chrome-use-without-account"
  sleep 5
fi
screenshot "05-after-github"
xml="$(dump_xml "05-after-github")"
python3 "$artifacts_dir/xml_text.py" "$xml" >"$artifacts_dir/05-after-github-text.txt" || true

if [[ -n "${AGENT_TICK_ANDROID_CLERK_EXPECT_TEXT:-}" ]]; then
  if ! grep -F "$AGENT_TICK_ANDROID_CLERK_EXPECT_TEXT" "$artifacts_dir/05-after-github-text.txt" >/dev/null; then
    fail "Expected to find '$AGENT_TICK_ANDROID_CLERK_EXPECT_TEXT' after GitHub handoff. See $artifacts_dir/05-after-github-text.txt"
  fi
fi
if [[ -n "${AGENT_TICK_ANDROID_CLERK_REJECT_TEXT:-}" ]]; then
  if grep -F "$AGENT_TICK_ANDROID_CLERK_REJECT_TEXT" "$artifacts_dir/05-after-github-text.txt" >/dev/null; then
    fail "Rejected text '$AGENT_TICK_ANDROID_CLERK_REJECT_TEXT' appeared after GitHub handoff. See $artifacts_dir/05-after-github-text.txt"
  fi
fi

log "PASS: reached Clerk GitHub sign-in path for $server_url"
log "Artifacts: $artifacts_dir"
