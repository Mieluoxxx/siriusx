#!/usr/bin/env bash
set -euo pipefail
cd /root/siriusx
PATH=/opt/node24/bin:$PATH /opt/node24/bin/node --import tsx evidence/S5/12-session-revocation/run.ts
