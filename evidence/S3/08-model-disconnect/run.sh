#!/usr/bin/env bash
# Real model disconnect through the Host plugin: the assignment must settle as
# reported/failed, and the Bot stage must become person/blocked_failed.
set -euo pipefail
ROOT="${ROOT:-/root/siriusx}"
REPO="${REPO:-$ROOT/deepseek-harness}"
H="${H:-/tmp/s3-host-disconnect-home}"
DBDIR=/tmp/s3-host-disconnect
R=/tmp/s3-host-disconnect-repo
EVID="$ROOT/evidence/S3/08-model-disconnect"
pkill -9 -f 'apps/cli/lib/bin.js --profile s3disconnectweb' 2>/dev/null || true
pkill -f 'mock-llm-server.mjs' 2>/dev/null || true
sleep 0.5
rm -rf "$H" "$DBDIR" "$R"; mkdir -p "$H" "$DBDIR" "$R"
cd "$R" && git init -q && git config user.email test@example.com && git config user.name Test && echo one > app.txt && git add . && git commit -qm base
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js --from-default-profile web --profile s3disconnectweb --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js plugin --profile s3disconnectweb add \
  link:"$ROOT/plugins/telemetry-off" link:"$ROOT/plugins/executor-local" >/tmp/s3-disconnect-add.log 2>&1
cat > "$H/profiles/s3disconnectweb/cordis.patch.yml" <<'YML'
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
MOCK_LOG=/tmp/s3-host-disconnect-mock.jsonl PORT=18081 DROP_AFTER_MS=1000 setsid /opt/node24/bin/node \
  "$ROOT/evidence/S1/02-conversation/mock-llm-server.mjs" >/tmp/s3-host-disconnect-mock.log 2>&1 &
MOCK_PID=$!
sleep 1
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" SIRIUSX_BOT_DB="$DBDIR/bot.sqlite" SIRIUSX_MOCK_KEY=local-test DSH_TELEMETRY_DISABLED=1 \
  setsid node apps/cli/lib/bin.js --profile s3disconnectweb --no-open --host 127.0.0.1 --port 0 >/tmp/s3-host-disconnect.log 2>/tmp/s3-host-disconnect.err &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/s3-host-disconnect.log && break; sleep 0.1; done
BASE=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/s3-host-disconnect.log)
ORIGIN=$(python3 -c 'import urllib.parse,sys;u=urllib.parse.urlsplit(sys.argv[1]);print(f"{u.scheme}://{u.netloc}")' "$BASE")
timeout 70s curl -sS -w '\nHTTP=%{http_code}\n' -X POST -H 'content-type: application/json' \
  -d "{\"path\":\"$R\",\"prompt\":\"hit a model disconnect\"}" "$ORIGIN/__siriusx/bot/run-ticket" | tee "$EVID/result.txt"
python3 - "$EVID/result.txt" <<'PY'
import json,sys
s=open(sys.argv[1]).read().split('\nHTTP=')[0]
d=json.loads(s)
assert d['stage'] == 'person/blocked_failed', d
assert d['latestAssignment']['report']['kind'] == 'failed', d
assert d['latestAssignment']['report']['reason'] == 'Connection error.', d
print('stage', d['stage'], 'report', d['latestAssignment']['report'])
PY
pkill -9 -f 'apps/cli/lib/bin.js --profile s3disconnectweb' 2>/dev/null || true
kill "$MOCK_PID" 2>/dev/null || true
