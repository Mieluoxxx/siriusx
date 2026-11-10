#!/usr/bin/env bash
set -euo pipefail
ROOT=/root/siriusx
IMAGE="${IMAGE:-siriusx/dsh-web:offline5}"
docker rm -f siriusx-dsh-web-evidence >/dev/null 2>&1 || true
docker volume rm siriusx-dsh-web-evidence >/dev/null 2>&1 || true
docker run -d --name siriusx-dsh-web-evidence -p 13000:3000 -v siriusx-dsh-web-evidence:/data "$IMAGE" >/dev/null
for _ in $(seq 1 160); do docker logs siriusx-dsh-web-evidence 2>&1 | grep -q 'dsh web:' && break; sleep .5; done
docker logs siriusx-dsh-web-evidence 2>&1 | tail -10
URL=$(docker logs siriusx-dsh-web-evidence 2>&1 | sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' | tail -1)
[ -n "$URL" ] || { echo 'DSH web did not print a URL' >&2; exit 1; }
QUERY=$(echo "$URL" | sed 's#^[^?]*##')
curl -sS -L -c /tmp/s8-dsh-web-evidence-cookies -b /tmp/s8-dsh-web-evidence-cookies -o /tmp/s8-dsh-web-evidence-page.html -w 'HTTP:%{http_code}\n' "http://127.0.0.1:13000/${QUERY}"
QUERY="$QUERY" /opt/node24/bin/node "$ROOT/evidence/S8/09-dsh-web-image/ui-dsh-web.mjs"
docker rm -f siriusx-dsh-web-evidence >/dev/null
