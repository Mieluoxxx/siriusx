#!/usr/bin/env bash
# Build a self-contained Linux control-plane bundle. The offline machine needs
# only Docker (for sandboxes) or Node 24 (for direct control-plane execution).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$ROOT/artifacts/offline}"
STAGE="$OUT/stage"
rm -rf "$STAGE" && mkdir -p "$STAGE/app/apps" "$STAGE/app/packages"
cd "$ROOT"
pnpm install --frozen-lockfile --offline
cp -a package.json pnpm-lock.yaml pnpm-workspace.yaml "$STAGE/app/"
cp -a apps/control-plane apps/autobot apps/tool-gateway apps/web-gateway "$STAGE/app/apps/"
mkdir -p "$STAGE/app/packages"
cp -a packages/contracts packages/app-contract packages/executor-local packages/fake-kernel packages/kernel-api packages/analytics packages/cloud-executor packages/kernel-acp "$STAGE/app/packages/"
# A pnpm virtual-store copy makes the bundle independent of the build host's store.
cp -a node_modules "$STAGE/app/node_modules"
cp deploy/offline/install-offline.sh "$STAGE/"
SANDBOX_IMAGE="${SIRIUSX_SANDBOX_IMAGE:-teams-bridge:0.2.0}"
if docker image inspect "$SANDBOX_IMAGE" >/dev/null 2>&1; then
  docker save "$SANDBOX_IMAGE" -o "$STAGE/sandbox-image.tar"
else
  echo "warning: sandbox image $SANDBOX_IMAGE is not present; bundle will not include it" >&2
fi
tar -C "$OUT" -czf "$OUT/siriusx-offline-linux-x64.tar.gz" stage
sha256sum "$OUT/siriusx-offline-linux-x64.tar.gz" > "$OUT/siriusx-offline-linux-x64.tar.gz.sha256"
[ -f "$STAGE/sandbox-image.tar" ] && sha256sum "$STAGE/sandbox-image.tar" > "$OUT/sandbox-image.tar.sha256"
echo "wrote $OUT/siriusx-offline-linux-x64.tar.gz"
