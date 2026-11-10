#!/usr/bin/env bash
set -euo pipefail
ROOT=/root/siriusx
REPO="$ROOT/deepseek-harness"
SECRET=s9-browser-oidc-secret
SERVICE=s9-browser-sso-service
CP=/tmp/s9-browser-oidc-cp
H=/tmp/siriusx-s9-browser-oidc-home
WORK=/tmp/s9-browser-oidc-repo
rm -rf "$CP" "$H" "$WORK"; mkdir -p "$CP"
cd "$ROOT"
for pattern in 'apps/control-plane/src/cli.ts serve' 'apps/web-gateway/src/cli.ts' 'apps/cli/lib/bin.js --profile s9oidcweb' 'evidence/S9/07-browser-oidc/idp.mjs'; do pkill -9 -f "$pattern" 2>/dev/null || true; done
sleep 0.5
/opt/node24/bin/node evidence/S9/07-browser-oidc/idp.mjs >/tmp/s9-browser-idp.log 2>&1 & sleep 0.5
A=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts tenant create --db "$CP/control.sqlite" --data-dir "$CP/data" --name Acme --issuer http://127.0.0.1:19090 --admin-email admin@acme.example --tenant-id tenant-acme)
AID=$(echo "$A" | python3 -c 'import json,sys;print(json.load(sys.stdin)["adminUserId"])')
TOKEN=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts token issue --db "$CP/control.sqlite" --data-dir "$CP/data" --tenant tenant-acme --user "$AID" --role admin)
SIRIUSX_SESSION_SECRET=$SECRET SIRIUSX_SSO_SERVICE_TOKEN=$SERVICE setsid /opt/node24/bin/node --import tsx apps/control-plane/src/cli.ts serve --db "$CP/control.sqlite" --data-dir "$CP/data" --port 4320 >/tmp/s9-browser-cp.log 2>/tmp/s9-browser-cp.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4320/health >/dev/null && break; sleep 0.1; done
mkdir "$WORK" && cd "$WORK" && git init -q && git config user.email test@example.com && git config user.name Test && echo one > app.txt && git add . && git commit -qm base
curl -sS -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"path\":\"$WORK\",\"prompt\":\"gateway ticket\"}" http://127.0.0.1:4320/v1/tickets >/tmp/s9-browser-ticket.json
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js --from-default-profile web --profile s9oidcweb --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js plugin --profile s9oidcweb add \
  link:"$ROOT/plugins/telemetry-off" link:"$ROOT/plugins/brand-siriusx" link:"$ROOT/plugins/client-ui-team" >/tmp/s9-browser-add.log 2>&1
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" DSH_TELEMETRY_DISABLED=1 setsid node apps/cli/lib/bin.js --profile s9oidcweb --no-open --host 127.0.0.1 --port 0 >/tmp/s9-browser-dsh.log 2>/tmp/s9-browser-dsh.err < /dev/null &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/s9-browser-dsh.log && break; sleep 0.1; done
DSH_URL=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/s9-browser-dsh.log)
cd "$ROOT"
SIRIUSX_SSO_SERVICE_TOKEN=$SERVICE \
SIRIUSX_OIDC_ISSUER=http://127.0.0.1:19090 \
SIRIUSX_OIDC_CLIENT_ID=siriusx-web \
SIRIUSX_OIDC_CLIENT_SECRET=browser-oidc-secret \
SIRIUSX_OIDC_REDIRECT_URI=http://127.0.0.1:8080/auth/oidc/callback \
SIRIUSX_OIDC_TENANT_ID=tenant-acme \
SIRIUSX_OIDC_ROLE=admin \
SIRIUSX_OIDC_ID_TOKEN_ALG=HS256 \
setsid /opt/node24/bin/node --import tsx apps/web-gateway/src/cli.ts --control-plane http://127.0.0.1:4320 --dsh-web "$DSH_URL" --port 8080 >/tmp/s9-browser-gateway.log 2>/tmp/s9-browser-gateway.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:8080/health >/dev/null && break; sleep 0.1; done
/opt/node24/bin/node evidence/S9/07-browser-oidc/ui-oidc.mjs
