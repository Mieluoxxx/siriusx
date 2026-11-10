#!/usr/bin/env bash
# Single-box installer. Docker Compose is the supported Linux path; the host
# never receives the upstream model key except through the service env.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/deploy/single-box"
ENV_FILE="${SIRIUSX_ENV_FILE:-$HERE/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  secret="$(openssl rand -base64 48 | tr -d '\n')"
  cat > "$ENV_FILE" <<ENV
SIRIUSX_SESSION_SECRET=$secret
SIRIUSX_UPSTREAM_MODEL_URL=${SIRIUSX_UPSTREAM_MODEL_URL:-}
SIRIUSX_UPSTREAM_MODEL_KEY=${SIRIUSX_UPSTREAM_MODEL_KEY:-}
ENV
  echo "created $ENV_FILE (mode 0600)"
fi

cd "$HERE"
docker compose --env-file "$ENV_FILE" config >/dev/null
docker compose --env-file "$ENV_FILE" up -d --build
for _ in $(seq 1 120); do
  if curl -fsS http://127.0.0.1:4320/health >/dev/null; then
    echo "SiriusX control plane ready at http://127.0.0.1:4320"
    echo "Provision a tenant:"
    echo "  docker compose --env-file $ENV_FILE exec control-plane node --import tsx apps/control-plane/src/cli.ts tenant create --name Acme --issuer https://idp.acme.example --admin-email admin@acme.example"
    exit 0
  fi
  sleep 1
done
echo "control plane did not become healthy" >&2
docker compose --env-file "$ENV_FILE" logs --tail=100 >&2
exit 1
