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
exec node apps/cli/lib/bin.js --profile siriusxweb --no-open --host "$HOST" --port 3000
