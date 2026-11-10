#!/usr/bin/env bash
# Real DSH Host + enterprise OIDC account provider test.
set -euo pipefail
REPO="${REPO:-/root/siriusx/deepseek-harness}"
ROOT="${ROOT:-/root/siriusx}"
H="${H:-/tmp/siriusx-s5-home}"
IDP_PORT="${IDP_PORT:-18082}"

cd "$ROOT/plugins/account-sso"
PATH=/opt/node24/bin:$PATH pnpm run build
pkill -f 'fake-oidc.mjs' 2>/dev/null || true
pkill -f 'apps/cli/lib/bin.js --profile s5web' 2>/dev/null || true
sleep 0.5
PORT="$IDP_PORT" setsid /opt/node24/bin/node "$ROOT/evidence/S5/01-sso/fake-oidc.mjs" >/tmp/s5-idp.log 2>/tmp/s5-idp.err < /dev/null &
IDP_PID=$!
trap 'kill "$IDP_PID" 2>/dev/null || true; pkill -f "apps/cli/lib/bin.js --profile s5web" 2>/dev/null || true' EXIT
sleep 1

rm -rf "$H" && mkdir -p "$H"
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js --from-default-profile web --profile s5web --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js plugin --profile s5web add \
  link:"$ROOT/plugins/telemetry-off" link:"$ROOT/plugins/account-sso" >/tmp/s5-add.log 2>&1
rm -f /tmp/s5web.log /tmp/s5web.err
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" \
  SIRIUSX_ENTERPRISE=1 \
  SIRIUSX_SSO_ISSUER="http://127.0.0.1:$IDP_PORT" \
  SIRIUSX_SSO_CLIENT_ID=siriusx-desktop \
  SIRIUSX_SSO_HS256_SECRET=test-secret \
  SIRIUSX_SSO_USAGE_URL=https://acme.example/usage \
  SIRIUSX_SSO_TOPUP_URL=https://acme.example/topup \
  SIRIUSX_MODEL_GATEWAY_URL=http://127.0.0.1:4321 \
  DSH_TELEMETRY_DISABLED=1 \
  setsid node apps/cli/lib/bin.js --profile s5web --no-open --host 127.0.0.1 --port 0 \
  >/tmp/s5web.log 2>/tmp/s5web.err < /dev/null &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/s5web.log && break; sleep 0.1; done
BASE=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/s5web.log)
ORIGIN=$(python3 -c 'import sys,urllib.parse;u=urllib.parse.urlsplit(sys.argv[1]);print(f"{u.scheme}://{u.netloc}")' "$BASE")
COOKIE=/tmp/s5-cookies.txt
rm -f "$COOKIE"
curl -sS -o /dev/null -c "$COOKIE" "$BASE"
python3 - "$ORIGIN" >/tmp/s5-start.json <<'PY'
import json,sys,uuid
print(json.dumps({'type':'client-request','rpcId':str(uuid.uuid4()),'method':'account/startSignIn','payload':{'args':{'client':{'version':'0.0.0-s5','locale':'en-US','timezoneOffsetSeconds':0},'callbackOrigin':sys.argv[1],'loginSource':'desktop'}}}))
PY
echo '$ account/startSignIn'
curl -sS -b "$COOKIE" -H 'content-type: application/json' --data @/tmp/s5-start.json "$ORIGIN/api/account/startSignIn" | tee /tmp/s5-start.out; echo
AUTHORIZE=$(python3 -c 'import json;print(json.load(open("/tmp/s5-start.out"))["result"]["value"]["attempt"]["authorizeUrl"])')
echo '$ GET authorizeURL (fake IdP -> Host callback)'
curl -sS -L -b "$COOKIE" -c "$COOKIE" -o /tmp/s5-callback.out -w 'callback_status=%{http_code}\n' "$AUTHORIZE"
cat /tmp/s5-callback.out; echo
python3 - >/tmp/s5-state.json <<'PY'
import json,uuid
print(json.dumps({'type':'client-request','rpcId':str(uuid.uuid4()),'method':'account/getState','payload':{'args':{}}}))
PY
echo '$ account/getState'
curl -sS -b "$COOKIE" -H 'content-type: application/json' --data @/tmp/s5-state.json "$ORIGIN/api/account/getState"; echo
echo '$ GET /__siriusx/tenant'
curl -sS -b "$COOKIE" "$ORIGIN/__siriusx/tenant"; echo
python3 - >/tmp/s5-signout.json <<'PY'
import json,uuid
print(json.dumps({'type':'client-request','rpcId':str(uuid.uuid4()),'method':'account/signOut','payload':{'args':{'client':{'version':'0.0.0-s5','locale':'en-US','timezoneOffsetSeconds':0}}}}))
PY
echo '$ account/signOut'
curl -sS -b "$COOKIE" -H 'content-type: application/json' --data @/tmp/s5-signout.json "$ORIGIN/api/account/signOut"; echo
echo '$ GET /__siriusx/tenant after sign-out'
curl -sS -b "$COOKIE" "$ORIGIN/__siriusx/tenant"; echo
