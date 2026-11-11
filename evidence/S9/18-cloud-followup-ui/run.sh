#!/usr/bin/env bash
set -euo pipefail
ROOT=/root/siriusx
REPO=$ROOT/deepseek-harness
SECRET=s9-followup-ui-secret
CP=/tmp/s9-followup-ui-cp
H=/tmp/s9-followup-ui-home
rm -rf "$CP" "$H"; mkdir -p "$CP"
pkill -9 -f 's9followupui' 2>/dev/null || true
pkill -9 -f 'apps/control-plane/src/cli.ts serve.*4323' 2>/dev/null || true
cd "$ROOT"
A=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts tenant create --db "$CP/control.sqlite" --data-dir "$CP/data" --name Followup --issuer https://idp.example --admin-email admin@followup.example --tenant-id tenant-followup-ui)
AID=$(echo "$A" | python3 -c 'import json,sys;print(json.load(sys.stdin)["adminUserId"])')
TOKEN=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts token issue --db "$CP/control.sqlite" --data-dir "$CP/data" --tenant tenant-followup-ui --user "$AID" --role admin)
SIRIUSX_SESSION_SECRET=$SECRET SIRIUSX_SANDBOX_IMAGE=teams-bridge:0.2.0 setsid /opt/node24/bin/node --import tsx apps/control-plane/src/cli.ts serve --db "$CP/control.sqlite" --data-dir "$CP/data" --port 4323 >/tmp/s9-followup-ui-cp.log 2>/tmp/s9-followup-ui-cp.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4323/health >/dev/null && break; sleep 0.1; done
TICKET=$(curl -sf -X POST http://127.0.0.1:4323/v1/cloud-projects/tickets -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"repoUrl":"https://github.com/acme/repo.git","baseRef":"main","prompt":"follow-up ui ticket"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["ticketId"])')
for _ in $(seq 1 200); do
  READY=$(curl -sf http://127.0.0.1:4323/v1/tickets/$TICKET -H "authorization: Bearer $TOKEN" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("latestAssignment",{}).get("report",{}).get("kind",""))' 2>/dev/null || true)
  [ "$READY" = ready ] && break
  sleep 0.1
done
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js --from-default-profile web --profile s9followupui --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js plugin --profile s9followupui add link:"$ROOT/plugins/telemetry-off" link:"$ROOT/plugins/brand-siriusx" link:"$ROOT/plugins/client-ui-team" >/tmp/s9-followup-ui-add.log 2>&1
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" DSH_TELEMETRY_DISABLED=1 setsid node apps/cli/lib/bin.js --profile s9followupui --no-open --host 127.0.0.1 --port 0 >/tmp/s9-followup-ui-dsh.log 2>/tmp/s9-followup-ui-dsh.err < /dev/null &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/s9-followup-ui-dsh.log && break; sleep 0.1; done
DSH_URL=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/s9-followup-ui-dsh.log)
DSH_URL="$DSH_URL" TOKEN="$TOKEN" TICKET="$TICKET" /opt/node24/bin/node "$ROOT/evidence/S9/18-cloud-followup-ui/ui-followup.mjs"
