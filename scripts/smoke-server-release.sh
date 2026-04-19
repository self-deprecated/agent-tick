#!/usr/bin/env sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
dist="$root/dist/server"

if [ ! -d "$dist" ]; then
  echo "missing release artifact directory: $dist" >&2
  exit 1
fi

for archive in "$dist"/*.tar.gz; do
  name="$(basename "$archive" .tar.gz)"
  tar -tzf "$archive" | grep -qx "$name/agent-tick"
  tar -tzf "$archive" | grep -qx "$name/README.md"
  tar -tzf "$archive" | grep -qx "$name/LICENSE"
done

case "$(uname -s)" in
  Linux) goos=linux ;;
  Darwin) goos=darwin ;;
  *)
    echo "skipping executable smoke test on unsupported host OS: $(uname -s)"
    exit 0
    ;;
esac

case "$(uname -m)" in
  x86_64|amd64) goarch=amd64 ;;
  arm64|aarch64) goarch=arm64 ;;
  *)
    echo "skipping executable smoke test on unsupported host arch: $(uname -m)"
    exit 0
    ;;
esac

archive="$(find "$dist" -name "agent-tick_*_${goos}_${goarch}.tar.gz" | head -n 1)"
if [ -z "$archive" ]; then
  echo "missing host-compatible artifact for ${goos}/${goarch}" >&2
  exit 1
fi

tmp="${TMPDIR:-/tmp}/agent-tick-smoke-$$"
rm -rf "$tmp"
mkdir -p "$tmp"
trap 'rm -rf "$tmp"' EXIT

tar -C "$tmp" -xzf "$archive"
bin="$(find "$tmp" -mindepth 2 -maxdepth 2 -type f -name agent-tick | head -n 1)"
if [ -z "$bin" ]; then
  echo "missing extracted agent-tick binary" >&2
  exit 1
fi

"$bin" --version >/dev/null
"$bin" request --help >/dev/null

echo "Release artifacts passed smoke checks"
