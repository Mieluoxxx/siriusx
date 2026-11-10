#!/usr/bin/env bash
set -euo pipefail
ROOT=/root/siriusx
BUNDLE="${BUNDLE:-/tmp/s8-offline-sandbox/extract/stage}"
docker rm -f s8-clean-machine >/dev/null 2>&1 || true
docker run -d --name s8-clean-machine --network none \
  -v "$BUNDLE:/bundle:ro" -v /opt/node24:/opt/node24:ro \
  -e PATH=/opt/node24/bin:/usr/local/bin:/usr/bin:/bin \
  -e SIRIUSX_SESSION_SECRET=clean-machine-secret \
  -e SIRIUSX_DATA_DIR=/data -e APP_DIR=/opt/siriusx \
  debian:bookworm-slim sh -c 'mkdir -p /data; /bundle/install-offline.sh >/tmp/install.log 2>&1 & sleep 2; wait' >/dev/null
sleep 4
docker exec s8-clean-machine /opt/node24/bin/node -e "fetch('http://127.0.0.1:4320/health').then(r=>r.text()).then(console.log)"
A=$(docker exec -e SIRIUSX_SESSION_SECRET=clean-machine-secret s8-clean-machine sh -c 'cd /opt/siriusx && /opt/node24/bin/node --import tsx apps/control-plane/src/cli.ts tenant create --db /data/control-plane.sqlite --data-dir /data --name Clean --issuer https://idp.example --admin-email admin@clean.example --tenant-id tenant-clean')
AID=$(echo "$A" | python3 -c 'import json,sys;print(json.load(sys.stdin)["adminUserId"])')
TOKEN=$(docker exec -e SIRIUSX_SESSION_SECRET=clean-machine-secret s8-clean-machine sh -c "cd /opt/siriusx && /opt/node24/bin/node --import tsx apps/control-plane/src/cli.ts token issue --db /data/control-plane.sqlite --data-dir /data --tenant tenant-clean --user $AID --role admin")
docker exec -e TOKEN="$TOKEN" s8-clean-machine /opt/node24/bin/node -e "fetch('http://127.0.0.1:4320/v1/settings',{headers:{authorization:'Bearer '+process.env.TOKEN}}).then(r=>r.text()).then(console.log)"
docker exec s8-clean-machine sh -c 'cat /tmp/install.log'
docker rm -f s8-clean-machine >/dev/null
