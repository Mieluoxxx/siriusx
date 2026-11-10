#!/usr/bin/env bash
# Real DSH Web Host kill/restart: the Host plugin owns a SQLite Bot store; the
# next Host activation reconciles the in-flight assignment as lost.
set -euo pipefail
ROOT="${ROOT:-/root/siriusx}"
EVID="$ROOT/evidence/S3/07-host-kill"
REPO="${REPO:-$ROOT/deepseek-harness}"
H="${H:-/tmp/s3-host-kill-home}"
DBDIR=/tmp/s3-host-kill
R=/tmp/s3-host-kill-repo
pkill -9 -f 'apps/cli/lib/bin.js --profile s3killweb' 2>/dev/null || true
pkill -f 'mock-llm-server.mjs' 2>/dev/null || true
sleep 0.5
rm -rf "$H" "$DBDIR" "$R"; mkdir -p "$H" "$DBDIR" "$R"
cd "$R" && git init -q && git config user.email test@example.com && git config user.name Test && echo one > app.txt && git add . && git commit -qm base
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js --from-default-profile web --profile s3killweb --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js plugin --profile s3killweb add \
  link:"$ROOT/plugins/telemetry-off" link:"$ROOT/plugins/executor-local" >/tmp/s3-kill-add.log 2>&1
cat > "$H/profiles/s3killweb/cordis.patch.yml" <<'YML'
- id: llm-pi-ai
  config:
    providers:
      siriusx-mock:
        displayName: SiriusX Mock
        apiKeyEnv: SIRIUSX_MOCK_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:18081/v1
        models:
          - id: siriusx-mock
            name: SiriusX Mock
            contextWindow: 65536
            maxTokens: 2048
            input:
              - text
- id: agent-default-model
  config:
    provider: siriusx-mock
    model: siriusx-mock
YML
MOCK_LOG=/tmp/s3-host-kill-mock.jsonl PORT=18081 DELAY_MS=60000 setsid /opt/node24/bin/node \
  "$ROOT/evidence/S1/02-conversation/mock-llm-server.mjs" >/tmp/s3-host-kill-mock.log 2>&1 &
MOCK_PID=$!
sleep 1
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" SIRIUSX_BOT_DB="$DBDIR/bot.sqlite" SIRIUSX_MOCK_KEY=local-test DSH_TELEMETRY_DISABLED=1 \
  setsid node apps/cli/lib/bin.js --profile s3killweb --no-open --host 127.0.0.1 --port 0 >/tmp/s3-host-kill.log 2>/tmp/s3-host-kill.err &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/s3-host-kill.log && break; sleep 0.1; done
BASE=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/s3-host-kill.log)
ORIGIN=$(python3 -c 'import urllib.parse,sys;u=urllib.parse.urlsplit(sys.argv[1]);print(f"{u.scheme}://{u.netloc}")' "$BASE")
curl -sS -X POST -H 'content-type: application/json' -d "{\"path\":\"$R\",\"prompt\":\"run until host is killed\"}" \
  "$ORIGIN/__siriusx/bot/run-ticket" >/tmp/s3-host-kill-post.out 2>/tmp/s3-host-kill-post.err || true &
POSTPID=$!
sleep 2
python3 - "$DBDIR/bot.sqlite" >"$EVID/before-kill.txt" <<'PY'
import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
print('assignments', c.execute('select id,ticket_id,state from assignments').fetchall())
print('tickets', c.execute('select id,closed from tickets').fetchall())
PY
pkill -9 -f 'apps/cli/lib/bin.js --profile s3killweb' || true
sleep 1
kill "$POSTPID" 2>/dev/null || true
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" SIRIUSX_BOT_DB="$DBDIR/bot.sqlite" SIRIUSX_MOCK_KEY=local-test DSH_TELEMETRY_DISABLED=1 \
  setsid node apps/cli/lib/bin.js --profile s3killweb --no-open --host 127.0.0.1 --port 0 >/tmp/s3-host-kill2.log 2>/tmp/s3-host-kill2.err &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/s3-host-kill2.log && break; sleep 0.1; done
BASE2=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/s3-host-kill2.log)
ORIGIN2=$(python3 -c 'import urllib.parse,sys;u=urllib.parse.urlsplit(sys.argv[1]);print(f"{u.scheme}://{u.netloc}")' "$BASE2")
TICKET=$(python3 - "$DBDIR/bot.sqlite" <<'PY'
import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
print(c.execute('select id from tickets order by created_at desc,rowid desc limit 1').fetchone()[0])
PY
)
curl -sS -w '\nHTTP=%{http_code}\n' "$ORIGIN2/__siriusx/bot/ticket?ticketId=$TICKET" | tee "$EVID/after-restart.txt"
python3 - <<'PY'
import json
s=open('/root/siriusx/evidence/S3/07-host-kill/after-restart.txt').read().split('\nHTTP=')[0]
d=json.loads(s)
print('stage', d.get('stage'), 'assignment', d.get('latestAssignment', {}).get('state'))
assert d.get('latestAssignment', {}).get('state') == 'lost'
PY
pkill -9 -f 'apps/cli/lib/bin.js --profile s3killweb' 2>/dev/null || true
kill "$MOCK_PID" 2>/dev/null || true
