#!/usr/bin/env bash
# Extract-and-run installer for the offline control-plane bundle.
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/siriusx}"
BUNDLE_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$BUNDLE_DIR/sandbox-image.tar" ] && command -v docker >/dev/null 2>&1; then
  docker load -i "$BUNDLE_DIR/sandbox-image.tar" >/dev/null
fi
cd "$APP_DIR" 2>/dev/null || true
cd "$BUNDLE_DIR/app"
mkdir -p "$APP_DIR"
cp -a . "$APP_DIR/"
mkdir -p "${SIRIUSX_DATA_DIR:-/var/lib/siriusx}"
cd "$APP_DIR"
SIRIUSX_SESSION_SECRET="${SIRIUSX_SESSION_SECRET:-$(head -c 48 /dev/urandom | base64 | tr -d '\n')}" \
SIRIUSX_DB="${SIRIUSX_DB:-${SIRIUSX_DATA_DIR:-/var/lib/siriusx}/control-plane.sqlite}" \
SIRIUSX_DATA_DIR="${SIRIUSX_DATA_DIR:-/var/lib/siriusx}" \
SIRIUSX_SANDBOX_IMAGE="${SIRIUSX_SANDBOX_IMAGE:-teams-bridge:0.2.0}" \
  node --import tsx apps/control-plane/src/cli.ts serve --port 4320 --gateway-port 4321
