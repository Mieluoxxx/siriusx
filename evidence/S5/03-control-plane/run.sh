#!/usr/bin/env bash
# Single-box control-plane integration: tenants, SSO sessions, bots, pairing,
# settings, tickets and tenant model gateway.
set -euo pipefail
ROOT="${ROOT:-/root/siriusx}"
DB="${DB:-/tmp/s5-cp/control.sqlite}"
DATA="${DATA:-/tmp/s5-cp/data}"
SECRET="${SIRIUSX_SESSION_SECRET:-test-session-secret}"
CLI="$ROOT/apps/control-plane/src/cli.ts"
export SIRIUSX_SESSION_SECRET="$SECRET"

pkill -f 'apps/control-plane/src/cli.ts serve' 2>/dev/null || true
rm -rf /tmp/s5-cp && mkdir -p /tmp/s5-cp
cd "$ROOT"

tenant_a=$(PATH=/opt/node24/bin:$PATH node --import tsx "$CLI" tenant create --db "$DB" --data-dir "$DATA" \
  --name Acme --issuer http://127.0.0.1:18082 --admin-email admin@acme.example --tenant-id tenant-acme)
echo "TENANT_A=$tenant_a"
admin_a=$(echo "$tenant_a" | python3 -c 'import json,sys;print(json.load(sys.stdin)["adminUserId"])')
member=$(PATH=/opt/node24/bin:$PATH node --import tsx "$CLI" user add --db "$DB" --data-dir "$DATA" \
  --tenant tenant-acme --email member@acme.example --role member)
member_id=$(echo "$member" | python3 -c 'import json,sys;print(json.load(sys.stdin)["userId"])')
tenant_b=$(PATH=/opt/node24/bin:$PATH node --import tsx "$CLI" tenant create --db "$DB" --data-dir "$DATA" \
  --name Beta --issuer http://127.0.0.1:18082/beta --admin-email admin@beta.example --tenant-id tenant-beta)
echo "TENANT_B=$tenant_b"
admin_b=$(echo "$tenant_b" | python3 -c 'import json,sys;print(json.load(sys.stdin)["adminUserId"])')

token_a=$(PATH=/opt/node24/bin:$PATH node --import tsx "$CLI" token issue --db "$DB" --data-dir "$DATA" --tenant tenant-acme --user "$admin_a" --role admin)
token_b=$(PATH=/opt/node24/bin:$PATH node --import tsx "$CLI" token issue --db "$DB" --data-dir "$DATA" --tenant tenant-beta --user "$admin_b" --role admin)
token_m=$(PATH=/opt/node24/bin:$PATH node --import tsx "$CLI" token issue --db "$DB" --data-dir "$DATA" --tenant tenant-acme --user "$member_id" --role member)

# Upstream model mock.
pkill -f 'mock-llm-server.mjs' 2>/dev/null || true
MOCK_LOG=/tmp/s5-cp-upstream.jsonl PORT=18081 setsid /opt/node24/bin/node "$ROOT/evidence/S1/02-conversation/mock-llm-server.mjs" >/tmp/s5-cp-upstream.log 2>&1 &
MOCK_PID=$!
sleep 1
SIRIUSX_UPSTREAM_MODEL_URL=http://127.0.0.1:18081/v1/chat/completions \
SIRIUSX_UPSTREAM_MODEL_KEY=upstream-secret \
  setsid /opt/node24/bin/node --import tsx "$CLI" serve --db "$DB" --data-dir "$DATA" --port 4320 --gateway-port 4321 \
  >/tmp/s5-cp-server.log 2>/tmp/s5-cp-server.err < /dev/null &
SERVER_PID=$!
trap 'kill "$SERVER_PID" "$MOCK_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4320/health >/dev/null 2>&1 && break; sleep 0.1; done

echo '$ GET /v1/settings'
curl -sS -H "Authorization: Bearer $token_a" http://127.0.0.1:4320/v1/settings; echo
echo '$ POST /v1/bots'
curl -sS -H "Authorization: Bearer $token_a" -H 'content-type: application/json' -d '{"name":"Acme Personal Bot"}' http://127.0.0.1:4320/v1/bots; echo
echo '$ GET /v1/bots (A)'
curl -sS -H "Authorization: Bearer $token_a" http://127.0.0.1:4320/v1/bots; echo
echo '$ GET /v1/bots (B)'
curl -sS -H "Authorization: Bearer $token_b" http://127.0.0.1:4320/v1/bots; echo
echo '$ POST pair/start'
pair=$(curl -sS -H "Authorization: Bearer $token_a" -H 'content-type: application/json' -d '{"name":"Alice MacBook"}' http://127.0.0.1:4320/v1/devices/pair/start); echo "$pair"
code=$(echo "$pair" | python3 -c 'import json,sys;print(json.load(sys.stdin)["code"])')
echo '$ POST pair/confirm'
pair_result=$(curl -sS -H "Authorization: Bearer $token_a" -H 'content-type: application/json' -d "{\"code\":\"$code\"}" http://127.0.0.1:4320/v1/devices/pair/confirm); echo "$pair_result"
device_id=$(echo "$pair_result" | python3 -c 'import json,sys;print(json.load(sys.stdin)["deviceId"])')
echo '$ POST devices/revoke'
curl -sS -H "Authorization: Bearer $token_a" -X POST "http://127.0.0.1:4320/v1/devices/$device_id/revoke"; echo
echo '$ PUT settings as member (expect 403)'
curl -sS -o /tmp/s5-cp-member-write.out -w 'status=%{http_code}\n' -H "Authorization: Bearer $token_m" -H 'content-type: application/json' -X PUT -d '{"nativeConversationEnabled":true}' http://127.0.0.1:4320/v1/settings
cat /tmp/s5-cp-member-write.out; echo
echo '$ PUT settings as admin'
curl -sS -H "Authorization: Bearer $token_a" -H 'content-type: application/json' -X PUT -d '{"nativeConversationEnabled":false,"byokEnabled":false}' http://127.0.0.1:4320/v1/settings; echo

repo=/tmp/s5-cp-repo
rm -rf "$repo" && mkdir "$repo" && cd "$repo"
git init -q && git config user.email test@example.com && git config user.name Test && echo one > app.txt && git add . && git commit -qm base
echo '$ POST /v1/tickets'
ticket=$(curl -sS -H "Authorization: Bearer $token_a" -H 'content-type: application/json' -d "{\"path\":\"$repo\",\"prompt\":\"tenant ticket\"}" http://127.0.0.1:4320/v1/tickets); echo "$ticket"
ticket_id=$(echo "$ticket" | python3 -c 'import json,sys;print(json.load(sys.stdin)["ticketId"])')
sleep 1
echo '$ GET /v1/tickets/:id'
curl -sS -H "Authorization: Bearer $token_a" "http://127.0.0.1:4320/v1/tickets/$ticket_id" | tee /tmp/s5-cp-ticket.json; echo
echo '$ cross-tenant ticket read (expect non-2xx)'
curl -sS -o /tmp/s5-cp-cross.out -w 'status=%{http_code}\n' -H "Authorization: Bearer $token_b" "http://127.0.0.1:4320/v1/tickets/$ticket_id"
cat /tmp/s5-cp-cross.out; echo
echo '$ GET model gateway /v1/models'
curl -sS -H "Authorization: Bearer $token_a" http://127.0.0.1:4321/v1/models; echo
echo '$ POST model gateway /v1/chat/completions'
curl -sS -o /tmp/s5-cp-gateway.out -w 'status=%{http_code} type=%{content_type}\n' -H "Authorization: Bearer $token_a" -H 'content-type: application/json' \
  -d '{"model":"tenant-default","messages":[{"role":"user","content":"hi"}],"stream":false}' http://127.0.0.1:4321/v1/chat/completions
head -c 400 /tmp/s5-cp-gateway.out; echo
echo '$ model gateway unauthenticated (expect 401)'
curl -sS -o /dev/null -w 'status=%{http_code}\n' http://127.0.0.1:4321/v1/models
