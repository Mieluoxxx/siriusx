#!/usr/bin/env bash
# Verify that the install/deployment entrypoints mention every service we ship.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail=0
check() {
  local file="$1" needle="$2" label="$3"
  if grep -Fq "$needle" "$file"; then echo "OK $label"; else echo "MISSING $label in $file" >&2; fail=1; fi
}
check deploy/single-box/docker-compose.offline.yml 'control-plane:' 'compose control-plane'
check deploy/single-box/docker-compose.offline.yml 'tool-gateway:' 'compose tool-gateway'
check deploy/single-box/docker-compose.offline.yml 'dsh-web:' 'compose dsh-web'
check deploy/single-box/docker-compose.offline.yml 'web-gateway:' 'compose web-gateway'
check deploy/offline/build-full-bundle.sh 'control-plane.tar' 'bundle control-plane image'
check deploy/offline/build-full-bundle.sh 'dsh-web.tar' 'bundle dsh-web image'
check deploy/offline/build-full-bundle.sh 'sandbox.tar' 'bundle sandbox image'
check deploy/offline/build-offline.sh 'apps/web-gateway' 'offline app web-gateway'
check deploy/offline/build-offline.sh 'packages/cloud-executor' 'offline package cloud-executor'
check deploy/offline/build-offline.sh 'packages/kernel-acp' 'offline package kernel-acp'
check deploy/single-box/install-native.sh 'siriusx-reap.timer' 'native reaper timer'
if [ "$fail" -ne 0 ]; then exit 1; fi
echo 'install coverage OK'
