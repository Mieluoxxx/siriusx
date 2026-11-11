#!/usr/bin/env bash
# Build the internal protocol-conversion router (lite-cpa based).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${IMAGE:-siriusx/model-router:offline}"
OUT="${OUT:-$ROOT/artifacts/model-router}"
mkdir -p "$OUT"
docker build -f "$ROOT/services/model-router/Dockerfile" -t "$IMAGE" "$ROOT/services/model-router" >"$OUT/docker-build.log" 2>&1
docker save "$IMAGE" -o "$OUT/model-router-image.tar"
echo "built $IMAGE and wrote $OUT/model-router-image.tar"
