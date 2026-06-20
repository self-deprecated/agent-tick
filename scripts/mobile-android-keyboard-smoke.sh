#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_name="${AGENT_TICK_ANDROID_PACKAGE:-ai.selfdeprecated.agenttick}"
artifacts_dir="${AGENT_TICK_ANDROID_UI_ARTIFACT_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/agent-tick-android-ui.XXXXXX")}"
self_hosted_link="Use a self-hosted server instead"
server_input_label="Self-hosted server URL"
continue_label="Continue self-hosted server setup"

mkdir -p "$artifacts_dir"

log() { printf '[android-ui] %s\n' "$*" >&2; }
fail() {
  log "FAILED: $*"
  log "Artifacts: $artifacts_dir"
  exit 1
}

log "Artifacts: $artifacts_dir"

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

serial="$(${adb_cmd[@]} devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')"
if [[ -z "$serial" ]]; then
  fail "No connected Android device/emulator is available. Start an emulator or connect a device, then retry."
fi
if [[ -z "${AGENT_TICK_ANDROID_SERIAL:-}" ]]; then
  adb_cmd=(adb -s "$serial")
fi
log "Using Android device $serial"

if [[ "${AGENT_TICK_ANDROID_UI_SKIP_INSTALL:-0}" != "1" ]]; then
  apk="${AGENT_TICK_ANDROID_APK:-}"
  if [[ -z "$apk" ]]; then
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
else
  log "Skipping APK install; using app already installed on device"
fi

if [[ "${AGENT_TICK_ANDROID_UI_SKIP_CLEAR:-0}" != "1" ]]; then
  log "Clearing app data for $package_name"
  "${adb_cmd[@]}" shell pm clear "$package_name" >/dev/null || true
else
  log "Skipping app data clear"
fi

cat >"$artifacts_dir/find_node.py" <<'PY'
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

xml_path = os.environ["XML"]
needle = os.environ["MATCH"]
mode = os.environ.get("MATCH_MODE", "exact")
app_package = os.environ.get("APP_PACKAGE", "")
screen_height = int(os.environ.get("SCREEN_HEIGHT", "0") or "0")

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
keyboard_top = None
for node in root.iter("node"):
    package = node.attrib.get("package", "")
    bounds = parse_bounds(node.attrib.get("bounds"))
    if not bounds:
        continue
    if app_package and package and package != app_package and bounds["top"] > 0:
        # IME nodes usually occupy the lower half of the screen. Ignore status/nav bars.
        if screen_height <= 0 or bounds["top"] > screen_height * 0.35:
            keyboard_top = bounds["top"] if keyboard_top is None else min(keyboard_top, bounds["top"])

for node in root.iter("node"):
    values = [node.attrib.get("text", ""), node.attrib.get("content-desc", ""), node.attrib.get("resource-id", "")]
    if any(value and matches(value) for value in values):
        bounds = parse_bounds(node.attrib.get("bounds"))
        if not bounds:
            continue
        result = {
            "text": node.attrib.get("text", ""),
            "content_desc": node.attrib.get("content-desc", ""),
            "resource_id": node.attrib.get("resource-id", ""),
            "package": node.attrib.get("package", ""),
            "bounds": bounds,
            "keyboard_top": keyboard_top,
            "screen_height": screen_height,
        }
        print(json.dumps(result))
        sys.exit(0)

sys.exit(1)
PY

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

screen_size="$(${adb_cmd[@]} shell wm size | tr -d '\r' | grep -Eo '[0-9]+x[0-9]+' | tail -1 || true)"
screen_width="${screen_size%x*}"
screen_height="${screen_size#*x}"
if [[ -z "$screen_size" || "$screen_width" == "$screen_height" ]]; then
  screen_width=0
  screen_height=0
fi
log "Device screen size: ${screen_size:-unknown}"

find_node() {
  local xml="$1"
  local match="$2"
  MATCH="$match" XML="$xml" APP_PACKAGE="$package_name" SCREEN_HEIGHT="$screen_height" python3 "$artifacts_dir/find_node.py"
}

node_center() {
  python3 -c 'import json,sys; n=json.load(sys.stdin); print(n["bounds"]["x"], n["bounds"]["y"])'
}

wait_for_node() {
  local match="$1"
  local prefix="$2"
  local attempts="${3:-30}"
  local xml info
  for ((i = 1; i <= attempts; i++)); do
    xml="$(dump_xml "$prefix-$i")"
    if info="$(find_node "$xml" "$match")"; then
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

assert_not_covered_by_keyboard() {
  local info_json="$1"
  local label="$2"
  INFO_JSON="$info_json" python3 - "$label" <<'PY'
import json
import os
import sys
label = sys.argv[1]
info = json.loads(os.environ["INFO_JSON"])
bounds = info["bounds"]
keyboard_top = info.get("keyboard_top")
if keyboard_top is None:
    screen_height = int(info.get("screen_height") or 0)
    if screen_height and bounds["bottom"] > screen_height * 0.70:
        print(f"[android-ui] {label!r} bottom {bounds['bottom']} is too low without keyboard bounds on screen height {screen_height}", file=sys.stderr)
        sys.exit(2)
    print(f"[android-ui] WARN: keyboard top unavailable; verified {label!r} is present in the safe upper screen area with bounds {bounds}", file=sys.stderr)
    sys.exit(0)
if bounds["bottom"] > keyboard_top:
    print(f"[android-ui] {label!r} bottom {bounds['bottom']} is below keyboard top {keyboard_top}", file=sys.stderr)
    sys.exit(2)
print(f"[android-ui] {label!r} visible above keyboard top {keyboard_top}: {bounds}", file=sys.stderr)
PY
}

log "Launching $package_name"
"${adb_cmd[@]}" shell monkey -p "$package_name" -c android.intent.category.LAUNCHER 1 >/dev/null
screenshot "00-launched"

tap_node "$self_hosted_link" "wait-self-hosted-link"
sleep 0.5
screenshot "01-self-hosted-open"

tap_node "$server_input_label" "wait-server-input"
sleep 1
screenshot "02-keyboard-open"
after_xml="$(dump_xml "02-keyboard-open")"

input_info="$(find_node "$after_xml" "$server_input_label")" || fail "Server URL input disappeared after keyboard opened"
continue_info="$(find_node "$after_xml" "$continue_label")" || fail "Continue button disappeared after keyboard opened"
assert_not_covered_by_keyboard "$input_info" "$server_input_label"
assert_not_covered_by_keyboard "$continue_info" "$continue_label"

log "PASS: self-hosted server form remains visible after focusing the URL field"
log "Artifacts: $artifacts_dir"
