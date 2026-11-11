#!/usr/bin/env bash
set -euo pipefail
cd /root/siriusx
PATH=/opt/node24/bin:$PATH /opt/node24/bin/node --import tsx evidence/S9/17-login-rate-limit/run.ts
