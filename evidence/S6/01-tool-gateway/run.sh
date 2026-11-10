#!/usr/bin/env bash
# Live tool gateway approval/deny/audit probe.
set -euo pipefail
ROOT="${ROOT:-/root/siriusx}"
DB="${DB:-/tmp/siriusx-s6-gateway.sqlite}"

pkill -f 'apps/tool-gateway/src/cli.ts' 2>/dev/null || true
rm -f "$DB"
cd "$ROOT"
GITHUB_TOKEN=super-secret-token SIRIUSX_TOOL_GATEWAY_PORT=4330 SIRIUSX_TOOL_GATEWAY_DB="$DB" \
  setsid /opt/node24/bin/node --import tsx apps/tool-gateway/src/cli.ts >/tmp/s6-gateway.log 2>/tmp/s6-gateway.err < /dev/null &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4330/health >/dev/null 2>&1 && break; sleep 0.1; done
HEADERS=(-H 'content-type: application/json' -H 'x-tenant-id: tenant-a' -H 'x-user-id: user-1' -H 'x-role: admin')
BODY='{"tenantId":"tenant-a","botId":"bot-1","ticketId":"ticket-1","operatorId":"app:user-1","system":"github","actionClass":"send_email","target":"acme/repo#1","content":"hello","mandate":{"actions":[]}}'
echo '$ POST /v1/actions outside mandate'
PROPOSED=$(curl -sS "${HEADERS[@]}" -d "$BODY" http://127.0.0.1:4330/v1/actions); echo "$PROPOSED"
APPROVAL=$(echo "$PROPOSED" | python3 -c 'import json,sys;print(json.load(sys.stdin)["approvalId"])')
echo '$ GET /v1/approvals'
curl -sS -H 'x-tenant-id: tenant-a' -H 'x-user-id: user-1' -H 'x-role: admin' http://127.0.0.1:4330/v1/approvals; echo
echo '$ POST approval decision'
curl -sS "${HEADERS[@]}" -d '{"approved":true}' "http://127.0.0.1:4330/v1/approvals/$APPROVAL/decide"; echo
echo '$ GET audit'
curl -sS -H 'x-tenant-id: tenant-a' -H 'x-user-id: user-1' -H 'x-role: admin' 'http://127.0.0.1:4330/v1/audit?ticketId=ticket-1' | tee /tmp/s6-audit.json; echo
echo '$ built-in deny'
curl -sS -o /tmp/s6-deny.out -w 'status=%{http_code}\n' "${HEADERS[@]}" -d '{"tenantId":"tenant-a","botId":"bot-1","ticketId":"ticket-1","operatorId":"app:user-1","system":"github","actionClass":"delete_repository","target":"acme/repo","mandate":{"actions":[]}}' http://127.0.0.1:4330/v1/actions
cat /tmp/s6-deny.out; echo
echo '$ tenant mismatch'
curl -sS -o /tmp/s6-tenant.out -w 'status=%{http_code}\n' -H 'content-type: application/json' -H 'x-tenant-id: tenant-b' -H 'x-user-id: user-2' -H 'x-role: admin' -d '{"tenantId":"tenant-a","botId":"bot-1","ticketId":"ticket-1","operatorId":"app:user-1","system":"github","actionClass":"read","target":"acme/repo","mandate":{"actions":[]}}' http://127.0.0.1:4330/v1/actions
cat /tmp/s6-tenant.out; echo
