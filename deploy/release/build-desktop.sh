#!/usr/bin/env bash
# Build a SiriusX-branded desktop artifact using the upstream packaging scripts.
# Run on the matching OS: macOS for dmg, Windows for exe. Linux is not a
# supported Electron target in the current DSH checkout.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${1:?usage: build-desktop.sh mac-arm64|mac-x64|win-x64}"
export SIRIUSX_PRODUCT_NAME="${SIRIUSX_PRODUCT_NAME:-SiriusX}"
export SIRIUSX_ARTIFACT_PREFIX="${SIRIUSX_ARTIFACT_PREFIX:-siriusx}"
export SIRIUSX_ICON_MACOS="${SIRIUSX_ICON_MACOS:-$ROOT/deploy/release/brand/siriusx-icon-macos.png}"
export SIRIUSX_ICON_WINDOWS="${SIRIUSX_ICON_WINDOWS:-$ROOT/deploy/release/brand/siriusx-icon-windows.ico}"
cd "$ROOT/deepseek-harness"
pnpm --filter @deepseek-ai/dsh-desktop "package:$TARGET"
