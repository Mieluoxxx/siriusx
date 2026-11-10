#!/usr/bin/env bash
# Real DSH Web Host + SiriusX executor-local Host plugin + real AgentLoop.
set -euo pipefail
REPO="${REPO:-/root/siriusx/deepseek-harness}"
ROOT="${ROOT:-/root/siriusx}"
H="${H:-/tmp/siriusx-s3-host-plugin-home}"
MOCK_PORT="${MOCK_PORT:-18081}"
R="${R:-/tmp/siriusx-s3-host-plugin-repo}"

cd "$ROOT/plugins/executor-local"
PATH=/opt/node24/bin:$PATH pnpm run build

pkill -f 'mock-llm-server.mjs' 2>/dev/null || true
PORT="$MOCK_PORT" setsid /opt/node24/bin/node "$ROOT/evidence/S1/02-conversation/mock-llm-server.mjs" >/tmp/siriusx-s3-host-mock.log 2>&1 < /dev/null &
MOCK_PID=$!
trap 'kill "$MOCK_PID" 2>/dev/null || true; pkill -f "apps/cli/lib/bin.js --profile s3web" 2>/dev/null || true' EXIT
sleep 1

rm -rf "$H" && mkdir -p "$H"
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js --from-default-profile web --profile s3web --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js plugin --profile s3web add \
  link:"$ROOT/plugins/telemetry-off" link:"$ROOT/plugins/executor-local" >/tmp/siriusx-s3-host-plugin-add.log 2>&1
cat > "$H/profiles/s3web/cordis.patch.yml" <<'YAML'
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
            input: [text]
- id: agent-default-model
  config:
    provider: siriusx-mock
    model: siriusx-mock
YAML

rm -f /tmp/siriusx-s3-host-web.log /tmp/siriusx-s3-host-web.err
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" SIRIUSX_MOCK_KEY=local-test DSH_TELEMETRY_DISABLED=1 \
  setsid node apps/cli/lib/bin.js --profile s3web --no-open --host 127.0.0.1 --port 0 \
  >/tmp/siriusx-s3-host-web.log 2>/tmp/siriusx-s3-host-web.err < /dev/null &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/siriusx-s3-host-web.log && break; sleep 0.1; done
BASE=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/siriusx-s3-host-web.log)
ORIGIN=$(python3 -c 'import sys,urllib.parse;u=urllib.parse.urlsplit(sys.argv[1]);print(f"{u.scheme}://{u.netloc}")' "$BASE")

rm -rf "$R" && mkdir "$R" && cd "$R"
git init -q && git config user.email test@example.com && git config user.name Test
printf 'one\n' > app.txt && git add . && git commit -qm base
printf 'one\ntwo\n' > app.txt
python3 - "$R" > /tmp/siriusx-s3-host-request.json <<'PY'
import json,sys
print(json.dumps({'path':sys.argv[1],'prompt':'Reply with a short completion. The Host plugin test is running.'}))
PY
curl -sS -H 'content-type: application/json' --data @/tmp/siriusx-s3-host-request.json -w '\nstatus=%{http_code}\n' "$ORIGIN/__siriusx/executor/run"

if [[ "${RUN_UI:-0}" == 1 ]]; then
  DSH_URL="$BASE" EXECUTOR_REPO="$R" UI_SCREENSHOT="$ROOT/evidence/S3/02-host-plugin/ui-open.png" \
    /opt/node24/bin/node "$ROOT/evidence/S3/02-host-plugin/ui-run.mjs"
fi
