#!/usr/bin/env bash
# Build a self-contained full-stack offline bundle: app tar, sandbox image,
# control-plane image and DSH Web image, plus a one-command installer.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$ROOT/artifacts/full}"
CP_IMAGE="${CP_IMAGE:-siriusx/control-plane:full}"
DSH_IMAGE="${DSH_IMAGE:-siriusx/dsh-web:full}"
SANDBOX_IMAGE="${SIRIUSX_SANDBOX_IMAGE:-teams-bridge:0.2.0}"
rm -rf "$OUT"; mkdir -p "$OUT/images"
SIRIUSX_SANDBOX_IMAGE="$SANDBOX_IMAGE" OUT="$OUT/app" "$ROOT/deploy/offline/build-offline.sh" >"$OUT/app-build.log" 2>&1
(
  cd "$OUT/app/stage/app"
  docker build -f "$ROOT/deploy/single-box/Dockerfile.offline" -t "$CP_IMAGE" . >"$OUT/control-plane-build.log" 2>&1
)
docker save "$CP_IMAGE" -o "$OUT/images/control-plane.tar"
IMAGE="$DSH_IMAGE" OUT="$OUT/dsh-web" "$ROOT/deploy/offline/build-dsh-web-image.sh" >"$OUT/dsh-web-build.log" 2>&1
cp "$OUT/dsh-web/dsh-web-image.tar" "$OUT/images/dsh-web.tar"
cp "$OUT/app/stage/sandbox-image.tar" "$OUT/images/sandbox.tar"
cp "$ROOT/deploy/single-box/docker-compose.offline.yml" "$OUT/docker-compose.yml"
cp "$ROOT/deploy/single-box/docker-compose.isolated.yml" "$OUT/docker-compose.isolated.yml"
cat > "$OUT/install-full.sh" <<'INSTALL'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  umask 077
  cat > .env <<ENV
SIRIUSX_SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')
SIRIUSX_IMAGE=${SIRIUSX_IMAGE:-siriusx/control-plane:full}
SIRIUSX_DSH_WEB_IMAGE=${SIRIUSX_DSH_WEB_IMAGE:-siriusx/dsh-web:full}
ENV
fi
health() {
  if command -v curl >/dev/null 2>&1; then curl -sf "$1" >/dev/null; else
    node -e 'fetch(process.argv[1]).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))' "$1"
  fi
}
for image in images/*.tar; do docker load -i "$image" >/dev/null; done
docker compose --profile full up -d
for _ in $(seq 1 180); do
  health http://127.0.0.1:4320/health && \
  health http://127.0.0.1:4330/health && \
  health http://127.0.0.1:8080/health && break
  sleep 1
done
health http://127.0.0.1:4320/health
health http://127.0.0.1:4330/health
health http://127.0.0.1:8080/health
echo "SiriusX full stack is ready on http://127.0.0.1:8080"
INSTALL
chmod +x "$OUT/install-full.sh"
tar -C "$OUT" -czf "$OUT/siriusx-full-offline.tar.gz" images docker-compose.yml docker-compose.isolated.yml install-full.sh
sha256sum "$OUT/siriusx-full-offline.tar.gz" > "$OUT/siriusx-full-offline.tar.gz.sha256"
echo "wrote $OUT/siriusx-full-offline.tar.gz"
