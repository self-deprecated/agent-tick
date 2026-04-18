#!/usr/bin/env bash

# agent-tick installation script
# Downloads and installs the latest version of agent-tick

set -e

# Configuration
REPO="self-deprecated/agent-tick"
INSTALL_DIR="${HOME}/.local/bin"
BINARY_NAME="agent-tick"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() {
    echo -e "${GREEN}==>${NC} $1"
}

warn() {
    echo -e "${YELLOW}Warning:${NC} $1"
}

error() {
    echo -e "${RED}Error:${NC} $1" >&2
    exit 1
}

detect_platform() {
    local os
    local arch

    case "$(uname -s)" in
        Darwin*)  os="darwin" ;;
        Linux*)   os="linux" ;;
        *)        error "Unsupported operating system: $(uname -s)" ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64)   arch="amd64" ;;
        aarch64|arm64)  arch="arm64" ;;
        *)              error "Unsupported architecture: $(uname -m)" ;;
    esac

    echo "${os}-${arch}"
}

get_latest_version() {
    local version
    version=$(curl -s "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

    if [ -z "$version" ]; then
        error "Failed to fetch latest version"
    fi

    echo "$version"
}

install_binary() {
    local platform="$1"
    local version="$2"
    local tmp_dir
    local version_num="${version#v}"
    local platform_underscore="${platform//-/_}"
    local archive_name="${BINARY_NAME}_${version_num}_${platform_underscore}.tar.gz"

    info "Installing agent-tick ${version} for ${platform}..."

    tmp_dir=$(mktemp -d)
    trap "rm -rf ${tmp_dir}" EXIT

    local download_url="https://github.com/${REPO}/releases/download/${version}/${archive_name}"

    info "Downloading from ${download_url}..."
    if ! curl -L -o "${tmp_dir}/${archive_name}" "${download_url}"; then
        error "Failed to download agent-tick"
    fi

    info "Extracting archive..."
    if ! tar -xzf "${tmp_dir}/${archive_name}" -C "${tmp_dir}"; then
        error "Failed to extract archive"
    fi

    mkdir -p "${INSTALL_DIR}"

    info "Installing to ${INSTALL_DIR}/${BINARY_NAME}..."
    mv "${tmp_dir}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
    chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

    info "Installation complete!"
}

check_path() {
    if [[ ":$PATH:" != *":${INSTALL_DIR}:"* ]]; then
        warn "${INSTALL_DIR} is not in your PATH"
        echo
        echo "Add the following line to your shell configuration file:"
        echo "  (e.g., ~/.bashrc, ~/.zshrc, ~/.profile)"
        echo
        echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
        echo
        echo "Then reload your shell configuration:"
        echo "  source ~/.bashrc  # or source ~/.zshrc"
        echo
    fi
}

main() {
    echo "agent-tick Installer"
    echo "===================="
    echo

    for cmd in curl tar; do
        if ! command -v "$cmd" &> /dev/null; then
            error "Required command not found: $cmd"
        fi
    done

    local platform
    platform=$(detect_platform)
    info "Detected platform: ${platform}"

    local version
    version=$(get_latest_version)
    info "Latest version: ${version}"

    install_binary "${platform}" "${version}"

    check_path

    echo
    info "Verifying installation..."
    if "${INSTALL_DIR}/${BINARY_NAME}" --version &> /dev/null; then
        echo
        echo -e "${GREEN}✓${NC} agent-tick installed successfully!"
        echo
        echo "Get started:"
        echo "  agent-tick --help"
        echo "  https://github.com/${REPO}"
    else
        error "Installation verification failed"
    fi
}

build_from_source() {
    info "Pre-built binaries not available, attempting to build from source..."

    if ! command -v go &> /dev/null; then
        error "Go is required to build from source. Install Go from https://golang.org/dl/"
    fi

    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap "rm -rf ${tmp_dir}" EXIT

    info "Cloning repository..."
    if ! git clone "https://github.com/${REPO}.git" "${tmp_dir}/agent-tick"; then
        error "Failed to clone repository"
    fi

    cd "${tmp_dir}/agent-tick/apps/server"

    info "Building binary..."
    if ! CGO_ENABLED=0 go build -o "${BINARY_NAME}" ./cmd/agent-tick; then
        error "Failed to build binary"
    fi

    mkdir -p "${INSTALL_DIR}"
    mv "${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
    chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

    info "Build and installation complete!"
}

if ! main; then
    warn "Standard installation failed"
    build_from_source
    check_path
fi
