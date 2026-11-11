#!/usr/bin/env bash
# Build the standalone platform admin image.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${IMAGE:-siriusx/admin-web:offline}"
OUT="${OUT:-$ROOT/artifacts/admin-web}"
cd "$ROOT/apps/admin-web"
mkdir -p "$OUT"
PATH=/opt/node24/bin:$PATH pnpm run build >"$OUT/build.log" 2>&1
docker build -f "$ROOT/apps/admin-web/Dockerfile" -t "$IMAGE" "$ROOT/apps/admin-web" >"$OUT/docker-build.log" 2>&1
docker save "$IMAGE" -o "$OUT/admin-web-image.tar"
echo "built $IMAGE and wrote $OUT/admin-web-image.tar"
