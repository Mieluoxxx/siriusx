#!/usr/bin/env bash
set -euo pipefail
ROOT=/root/siriusx
CP=/tmp/s5-admin-web-cp
rm -rf "$CP"; mkdir -p "$CP"
pkill -9 -f 'apps/admin-web/server.mjs' 2>/dev/null || true
pkill -9 -f 'apps/control-plane/src/cli.ts serve.*4327' 2>/dev/null || true
cd "$ROOT/apps/admin-web"
PATH=/root/.local/node24/bin:$PATH pnpm run build >/tmp/s5-admin-web-build.log 2>&1
cd "$ROOT"
SIRIUSX_SESSION_SECRET=admin-web-secret SIRIUSX_PLATFORM_ADMIN_TOKEN=platform-secret setsid /opt/node24/bin/node --import tsx apps/control-plane/src/cli.ts serve --db "$CP/control.sqlite" --data-dir "$CP/data" --port 4327 >/tmp/s5-admin-web-cp.log 2>/tmp/s5-admin-web-cp.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4327/health >/dev/null && break; sleep 0.1; done
CONTROL_PLANE_URL=http://127.0.0.1:4327 PORT=8091 HOST=127.0.0.1 setsid /opt/node24/bin/node apps/admin-web/server.mjs >/tmp/s5-admin-web-server.log 2>/tmp/s5-admin-web-server.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:8091/health >/dev/null && break; sleep 0.1; done
/opt/node24/bin/node "$ROOT/evidence/S5/31-admin-web/ui-admin.mjs"
