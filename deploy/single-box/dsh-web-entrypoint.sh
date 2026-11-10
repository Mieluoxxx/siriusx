#!/bin/sh
set -eu
DSH_HOME="${DSH_HOME:-/data/dsh-home}"
export DSH_HOME
mkdir -p "$DSH_HOME"
if [ ! -f "$DSH_HOME/profiles/siriusxweb/package.json" ]; then
  cp -a /opt/dsh-home-template/. "$DSH_HOME/"
fi
cd /opt/dsh
HOST=$(hostname -I | awk '{print $1}')
node apps/cli/lib/bin.js --profile siriusxweb --no-open --host "$HOST" --port 3000 >/tmp/dsh-web.log 2>&1 &
pid=$!
url=""
for _ in $(seq 1 120); do
  url=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/dsh-web.log | tail -1)
  [ -n "$url" ] && break
  sleep 1
done
if [ -z "$url" ]; then
  cat /tmp/dsh-web.log >&2
  kill "$pid" 2>/dev/null || true
  exit 1
fi
printf '%s' "$url" >/data/dsh-web-url
cat /tmp/dsh-web.log
wait "$pid"
