#!/usr/bin/env bash
# Reproduce S0 experiments 1-3 against the current deepseek-harness checkout.
#
# Prerequisites:
#   - Node.js >= 24.9 on PATH
#   - pnpm install completed in $REPO
#   - `pnpm run build:artifacts` completed in $REPO
#
# The script builds a disposable DSH home, installs two local spike plugins by
# link, starts the real Web Host, and probes:
#   1. a replacement `deepseekAccount` provider is used by account-controller;
#   2. tenant/subject fields reach a Host plugin;
#   3. an Executor-shaped plugin shares the Host with the Web UI and can see
#      `agents` and `sessionController`.
set -euo pipefail

REPO="${REPO:-/root/siriusx/deepseek-harness}"
EVIDENCE="${EVIDENCE:-/root/siriusx/evidence/S0}"
HOME_DIR="${HOME_DIR:-/tmp/siriusx-s0-home}"
CLI="$REPO/apps/cli/lib/bin.js"
ACCOUNT="$EVIDENCE/01-auth/account-provider"
EXECUTOR="$EVIDENCE/03-coexist/executor-plugin"
PROFILE="$HOME_DIR/profiles/siriusxspike"

if [[ ! -f "$CLI" ]]; then
  echo "missing $CLI; run pnpm run build:artifacts first" >&2
  exit 1
fi

# The fixtures compile against the current workspace packages. Their
# node_modules links are disposable; they are not committed.
rm -rf "$ACCOUNT/node_modules" "$EXECUTOR/node_modules"
mkdir -p "$EXECUTOR/node_modules/@deepseek-ai"
ln -sfn "$REPO/packages/credentials/deepseek-account-platform/node_modules" "$ACCOUNT/node_modules"
ln -sfn "$REPO/packages/bundle/web-app/node_modules/@deepseek-ai/cordis" "$EXECUTOR/node_modules/@deepseek-ai/cordis"
ln -sfn "$REPO/packages/bundle/web-app/node_modules/@deepseek-ai/dsh-host-webserver" "$EXECUTOR/node_modules/@deepseek-ai/dsh-host-webserver"
ln -sfn "$REPO/packages/bundle/web-app/node_modules/@deepseek-ai/dsh-api-session-controller" "$EXECUTOR/node_modules/@deepseek-ai/dsh-api-session-controller"
ln -sfn "$REPO/packages/api/session-controller/node_modules/@deepseek-ai/dsh-agent" "$EXECUTOR/node_modules/@deepseek-ai/dsh-agent"
ln -sfn "$REPO/packages/api/session-controller/node_modules/@deepseek-ai/dsh-llm" "$EXECUTOR/node_modules/@deepseek-ai/dsh-llm"
ln -sfn "$REPO/packages/api/session-controller/node_modules/@deepseek-ai/dsh-session" "$EXECUTOR/node_modules/@deepseek-ai/dsh-session"
"$REPO/node_modules/.bin/tsc" -p "$ACCOUNT/tsconfig.json"
"$REPO/node_modules/.bin/tsc" -p "$EXECUTOR/tsconfig.json"

rm -rf "$HOME_DIR"
mkdir -p "$HOME_DIR"
DSH_HOME="$HOME_DIR" node "$CLI" --from-default-profile web --profile siriusxspike --dump-config >/tmp/siriusx-s0-default.yml

mkdir -p "$PROFILE/node_modules"
ln -sfn "$ACCOUNT" "$PROFILE/node_modules/siriusx-sso-spike"
ln -sfn "$EXECUTOR" "$PROFILE/node_modules/siriusx-executor-spike"
cat > "$PROFILE/cordis.patch.yml" <<'PATCH'
# Replace the official account provider with the enterprise SSO provider.
# A patch may not rename an existing row, so disable it and insert another.
- id: deepseek-account
  disabled: true

- insert:
    - id: siriusx-account
      name: siriusx-sso-spike
    - id: siriusx-executor
      name: siriusx-executor-spike
PATCH

LOG=/tmp/siriusx-s0-web.log
ERR=/tmp/siriusx-s0-web.err
rm -f "$LOG" "$ERR"
DSH_HOME="$HOME_DIR" SIRIUSX_TENANT_ID=tenant-acme SIRIUSX_SUBJECT_ID=user-42 \
  node "$CLI" --profile siriusxspike --no-open --host 127.0.0.1 --port 0 \
  >"$LOG" 2>"$ERR" &
PID=$!
trap 'kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 100); do
  grep -q '^dsh web: ' "$LOG" && break
  sleep 0.1
done
BASE=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' "$LOG")
if [[ -z "$BASE" ]]; then
  echo 'Host did not become ready' >&2
  cat "$ERR" >&2
  exit 1
fi
ORIGIN=$(python3 -c 'import sys,urllib.parse; u=urllib.parse.urlsplit(sys.argv[1]); print(f"{u.scheme}://{u.netloc}")' "$BASE")
COOKIE=/tmp/siriusx-s0-cookies.txt
rm -f "$COOKIE"
curl -sS -o /dev/null -c "$COOKIE" "$BASE"

echo "origin=$ORIGIN"
echo '--- index ---'
curl -sS -o /dev/null -b "$COOKIE" -w 'status=%{http_code}\n' "$ORIGIN/"
echo '--- tenant plugin ---'
curl -sS -b "$COOKIE" -w '\nstatus=%{http_code}\n' "$ORIGIN/__siriusx/tenant"
echo '--- executor plugin ---'
curl -sS -b "$COOKIE" -w '\nstatus=%{http_code}\n' "$ORIGIN/__siriusx/executor"

rpc() {
  local method="$1" args="$2" out="$3"
  python3 - "$method" "$args" >"$out.req" <<'PY'
import json,sys,uuid
print(json.dumps({'type':'client-request','rpcId':str(uuid.uuid4()),'method':sys.argv[1],'payload':{'args':json.loads(sys.argv[2])}}))
PY
  curl -sS -b "$COOKIE" -H 'content-type: application/json' --data @"$out.req" -w '\nstatus=%{http_code}\n' "$ORIGIN/api/$method" >"$out"
}

echo '--- account/getState (replacement provider) ---'
rpc account/getState '{}' /tmp/siriusx-s0-account-state.out
cat /tmp/siriusx-s0-account-state.out
echo '--- account/startSignIn (replacement provider) ---'
rpc account/startSignIn "{\"client\":{\"version\":\"0.0.0-spike\",\"locale\":\"en-US\",\"timezoneOffsetSeconds\":0},\"callbackOrigin\":\"$ORIGIN\",\"loginSource\":\"desktop\"}" /tmp/siriusx-s0-account-start.out
cat /tmp/siriusx-s0-account-start.out
AUTHORIZE_URL=$(head -n1 /tmp/siriusx-s0-account-start.out | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["value"]["attempt"]["authorizeUrl"])')
echo '--- SSO callback (browser step; callback carries tenant claims) ---'
curl -sS -b "$COOKIE" -w 'status=%{http_code}\n' "$AUTHORIZE_URL&tenant=tenant-sso&subject=user-sso"
echo '--- account/getState after SSO callback ---'
rpc account/getState '{}' /tmp/siriusx-s0-account-after.out
cat /tmp/siriusx-s0-account-after.out
echo '--- tenant plugin after SSO callback ---'
curl -sS -b "$COOKIE" -w '\nstatus=%{http_code}\n' "$ORIGIN/__siriusx/tenant"
echo '--- executor plugin after SSO callback (same tenant service) ---'
curl -sS -b "$COOKIE" -w '\nstatus=%{http_code}\n' "$ORIGIN/__siriusx/executor"
echo '--- executor run (UI-like path + Executor path on one live Session) ---'
curl -sS -b "$COOKIE" -X POST -w '\nstatus=%{http_code}\n' "$ORIGIN/__siriusx/executor/run"
RUN_UI="${RUN_UI:-0}"
UI_SCREENSHOT="$EVIDENCE/03-coexist/ui-open.png"
if [[ "$RUN_UI" == 1 ]]; then
  echo '--- Web UI open + Executor turn in the same Host ---'
  DSH_URL="$BASE" UI_SCREENSHOT="$UI_SCREENSHOT" node "$EVIDENCE/03-coexist/ui-open-test.mjs"
fi
echo '--- host stderr ---'
cat "$ERR"
