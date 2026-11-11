#!/usr/bin/env bash
set -euo pipefail
ROOT=/root/siriusx
REPO=$ROOT/deepseek-harness
SECRET=s5-policy-ui-secret
CP=/tmp/s5-policy-ui-cp
H=/tmp/s5-policy-ui-home
rm -rf "$CP" "$H"; mkdir -p "$CP"
pkill -9 -f 's5policyui' 2>/dev/null || true
pkill -9 -f 'apps/control-plane/src/cli.ts serve.*4326' 2>/dev/null || true
pkill -9 -f 'apps/tool-gateway/src/cli.ts' 2>/dev/null || true
cd "$ROOT"
A=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts tenant create --db "$CP/control.sqlite" --data-dir "$CP/data" --name PolicyUI --issuer https://idp.example --admin-email admin@policy.example --tenant-id tenant-policy-ui)
AID=$(echo "$A" | python3 -c 'import json,sys;print(json.load(sys.stdin)["adminUserId"])')
TOKEN=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts token issue --db "$CP/control.sqlite" --data-dir "$CP/data" --tenant tenant-policy-ui --user "$AID" --role admin)
SIRIUSX_TOOL_GATEWAY_DB="$CP/tool.sqlite" SIRIUSX_TOOL_GATEWAY_PORT=4340 SIRIUSX_TOOL_GATEWAY_HOST=127.0.0.1 setsid /opt/node24/bin/node --import tsx apps/tool-gateway/src/cli.ts >/tmp/s5-policy-ui-tool.log 2>/tmp/s5-policy-ui-tool.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4340/health >/dev/null && break; sleep 0.1; done
SIRIUSX_SESSION_SECRET=$SECRET SIRIUSX_PLATFORM_ADMIN_TOKEN=platform-secret SIRIUSX_TOOL_GATEWAY_URL=http://127.0.0.1:4340 setsid /opt/node24/bin/node --import tsx apps/control-plane/src/cli.ts serve --db "$CP/control.sqlite" --data-dir "$CP/data" --port 4326 >/tmp/s5-policy-ui-cp.log 2>/tmp/s5-policy-ui-cp.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4326/health >/dev/null && break; sleep 0.1; done
curl -sf -X POST http://127.0.0.1:4326/v1/admin/tenants/tenant-policy-ui/support-requests -H 'x-siriusx-platform-token: platform-secret' -H 'content-type: application/json' -d '{"reason":"incident support"}' >/dev/null
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js --from-default-profile web --profile s5policyui --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js plugin --profile s5policyui add link:"$ROOT/plugins/telemetry-off" link:"$ROOT/plugins/brand-siriusx" link:"$ROOT/plugins/client-ui-team" >/tmp/s5-policy-ui-add.log 2>&1
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" DSH_TELEMETRY_DISABLED=1 setsid node apps/cli/lib/bin.js --profile s5policyui --no-open --host 127.0.0.1 --port 0 >/tmp/s5-policy-ui-dsh.log 2>/tmp/s5-policy-ui-dsh.err < /dev/null &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/s5-policy-ui-dsh.log && break; sleep 0.1; done
DSH_URL=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/s5-policy-ui-dsh.log)
DSH_URL="$DSH_URL" TOKEN="$TOKEN" /opt/node24/bin/node "$ROOT/evidence/S5/18-tool-policy-ui/ui-policy.mjs"
