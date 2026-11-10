#!/usr/bin/env bash
set -euo pipefail
cd /root/siriusx
PATH=/opt/node24/bin:$PATH /opt/node24/bin/node --import tsx evidence/S7/13-github-issue-mr/run.ts
