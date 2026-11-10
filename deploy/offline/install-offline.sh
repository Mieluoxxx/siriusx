#!/usr/bin/env bash
# Extract-and-run installer for the offline control-plane bundle.
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/siriusx}"
cd "$(dirname "$0")/app"
mkdir -p "$APP_DIR"
cp -a . "$APP_DIR/"
mkdir -p /var/lib/siriusx
cd "$APP_DIR"
SIRIUSX_SESSION_SECRET="${SIRIUSX_SESSION_SECRET:-$(head -c 48 /dev/urandom | base64 | tr -d '\n')}" \
SIRIUSX_DB=/var/lib/siriusx/control-plane.sqlite \
SIRIUSX_DATA_DIR=/var/lib/siriusx \
  node --import tsx apps/control-plane/src/cli.ts serve --port 4320 --gateway-port 4321
