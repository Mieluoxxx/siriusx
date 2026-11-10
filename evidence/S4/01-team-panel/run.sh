#!/usr/bin/env bash
# Reproduce S4: local Bot API + DSH Web Host + Team client plugin + Playwright.
set -euo pipefail
REPO="${REPO:-/root/siriusx/deepseek-harness}"
ROOT="${ROOT:-/root/siriusx}"
H="${H:-/tmp/siriusx-s4-home}"
R="${R:-/tmp/siriusx-s4-ui-repo}"
BOT_PORT="${BOT_PORT:-4319}"

cd "$ROOT/plugins/client-ui-team"
PATH=/opt/node24/bin:$PATH pnpm run build

pkill -f 'autobot/src/cli.ts serve' 2>/dev/null || true
pkill -f 'apps/cli/lib/bin.js --profile s4web' 2>/dev/null || true
sleep 0.5
rm -f /tmp/siriusx-s4-bot-api.log /tmp/siriusx-s4-bot-api.err /tmp/siriusx-s4-bot.sqlite
setsid /opt/node24/bin/node --import tsx "$ROOT/apps/autobot/src/cli.ts" serve --port "$BOT_PORT" --db /tmp/siriusx-s4-bot.sqlite \
  >/tmp/siriusx-s4-bot-api.log 2>/tmp/siriusx-s4-bot-api.err < /dev/null &
for _ in $(seq 1 100); do curl -sf "http://127.0.0.1:$BOT_PORT/api/health" >/dev/null 2>&1 && break; sleep 0.1; done

rm -rf "$H" && mkdir -p "$H"
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js --from-default-profile web --profile s4web --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js plugin --profile s4web add \
  link:"$ROOT/plugins/telemetry-off" link:"$ROOT/plugins/telemetry-off-desktop" link:"$ROOT/plugins/client-ui-team" \
  >/tmp/siriusx-s4-add.log 2>&1
rm -f /tmp/siriusx-s4-web.log /tmp/siriusx-s4-web.err
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" DSH_TELEMETRY_DISABLED=1 \
  setsid node apps/cli/lib/bin.js --profile s4web --no-open --host 127.0.0.1 --port 0 \
  >/tmp/siriusx-s4-web.log 2>/tmp/siriusx-s4-web.err < /dev/null &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/siriusx-s4-web.log && break; sleep 0.1; done
BASE=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/siriusx-s4-web.log)

rm -rf "$R" && mkdir "$R" && cd "$R"
git init -q && git config user.email test@example.com && git config user.name Test
printf 'one\n' > app.txt && git add . && git commit -qm base
printf 'one\ntwo\n' > app.txt

DSH_URL="$BASE" REPO="$R" UI_SCREENSHOT="$ROOT/evidence/S4/01-team-panel/team-panel-ticket.png" \
  /opt/node24/bin/node "$ROOT/evidence/S4/01-team-panel/ui-create.mjs"
