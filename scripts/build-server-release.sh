#!/usr/bin/env sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
server="$root/apps/server"
dist="$root/dist/server"
version="${AGENT_TICK_VERSION:-dev}"

rm -rf "$dist"
mkdir -p "$dist"

build_one() {
  goos="$1"
  goarch="$2"
  name="agent-tick_${version}_${goos}_${goarch}"
  output="$dist/$name/agent-tick"
  if [ "$goos" = "windows" ]; then
    output="$output.exe"
  fi

  mkdir -p "$dist/$name"
  (
    cd "$server"
    CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" go build \
      -trimpath \
      -ldflags "-s -w -X main.version=$version" \
      -o "$output" \
      ./cmd/agent-tick
  )
  tar -C "$dist" -czf "$dist/$name.tar.gz" "$name"
  rm -rf "$dist/$name"
}

build_one linux amd64
build_one linux arm64
build_one darwin amd64
build_one darwin arm64

(
  cd "$dist"
  sha256sum *.tar.gz > checksums.txt
)

echo "Built release artifacts in $dist"
