#!/usr/bin/env bash
# Native (systemd or foreground) single-box installer for the control plane and
# tool gateway. The Web gateway and DSH Web Host need a deployment-specific URL
# and are installed by the surrounding deployment recipe.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PREFIX="${PREFIX:-/opt/siriusx}"
DATA_DIR="${SIRIUSX_DATA_DIR:-/var/lib/siriusx}"
PORT="${SIRIUSX_CONTROL_PORT:-4320}"
DEVICE_PORT="${SIRIUSX_DEVICE_PORT:-4322}"
TOOL_PORT="${SIRIUSX_TOOL_PORT:-4330}"
START=0
SYSTEMD=1
while (($#)); do
  case "$1" in
    --prefix) PREFIX="$2"; shift 2 ;;
    --data) DATA_DIR="$2"; shift 2 ;;
    --no-systemd) SYSTEMD=0; shift ;;
    --start) START=1; shift ;;
    --help) echo "usage: install-native.sh [--prefix DIR] [--data DIR] [--no-systemd] [--start]"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
command -v node >/dev/null || { echo "node 24+ is required" >&2; exit 1; }
mkdir -p "$PREFIX" "$DATA_DIR" "$PREFIX/systemd"
cp -a "$ROOT/package.json" "$ROOT/pnpm-workspace.yaml" "$ROOT/pnpm-lock.yaml" "$PREFIX/"
cp -a "$ROOT/apps/control-plane" "$ROOT/apps/tool-gateway" "$PREFIX/"
mkdir -p "$PREFIX/apps" "$PREFIX/packages"
cp -a "$ROOT/apps/control-plane" "$ROOT/apps/tool-gateway" "$ROOT/apps/autobot" "$PREFIX/apps/"
cp -a "$ROOT/packages/." "$PREFIX/packages/"
cp -a "$ROOT/node_modules" "$PREFIX/node_modules"
ENV_FILE="$PREFIX/siriusx.env"
if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  cat > "$ENV_FILE" <<ENV
SIRIUSX_SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')
SIRIUSX_DB=$DATA_DIR/control.sqlite
SIRIUSX_DATA_DIR=$DATA_DIR
SIRIUSX_CONTROL_PORT=$PORT
SIRIUSX_DEVICE_PORT=$DEVICE_PORT
SIRIUSX_TOOL_PORT=$TOOL_PORT
GITHUB_TOKEN=
GITLAB_TOKEN=
ENV
fi
cat > "$PREFIX/run-control-plane.sh" <<SH
#!/usr/bin/env bash
set -a; . "$ENV_FILE"; set +a
cd "$PREFIX"
exec node --import tsx apps/control-plane/src/cli.ts serve --db "\${SIRIUSX_DB}" --data-dir "\${SIRIUSX_DATA_DIR}" --port "\${SIRIUSX_CONTROL_PORT}" --device-port "\${SIRIUSX_DEVICE_PORT}"
SH
cat > "$PREFIX/run-tool-gateway.sh" <<SH
#!/usr/bin/env bash
set -a; . "$ENV_FILE"; set +a
cd "$PREFIX"
exec node --import tsx apps/tool-gateway/src/cli.ts
SH
chmod 755 "$PREFIX/run-control-plane.sh" "$PREFIX/run-tool-gateway.sh"
cat > "$PREFIX/systemd/siriusx-control-plane.service" <<UNIT
[Unit]
Description=SiriusX control plane
After=network.target
[Service]
Type=simple
EnvironmentFile=$ENV_FILE
ExecStart=$PREFIX/run-control-plane.sh
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
cat > "$PREFIX/systemd/siriusx-tool-gateway.service" <<UNIT
[Unit]
Description=SiriusX tool gateway
After=network.target
[Service]
Type=simple
EnvironmentFile=$ENV_FILE
Environment=SIRIUSX_TOOL_GATEWAY_PORT=$TOOL_PORT
Environment=SIRIUSX_TOOL_GATEWAY_DB=$DATA_DIR/tool-gateway.sqlite
ExecStart=$PREFIX/run-tool-gateway.sh
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
if [[ "$SYSTEMD" == "1" && "$(id -u)" == "0" && -d /run/systemd/system ]]; then
  cp "$PREFIX/systemd/"*.service /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now siriusx-control-plane siriusx-tool-gateway
  echo "systemd services enabled"
elif [[ "$START" == "1" ]]; then
  cd "$PREFIX"
  nohup ./run-control-plane.sh >"$DATA_DIR/control-plane.log" 2>&1 & echo $! > "$DATA_DIR/control-plane.pid"
  nohup ./run-tool-gateway.sh >"$DATA_DIR/tool-gateway.log" 2>&1 & echo $! > "$DATA_DIR/tool-gateway.pid"
  echo "started control-plane pid $(cat "$DATA_DIR/control-plane.pid") and tool-gateway pid $(cat "$DATA_DIR/tool-gateway.pid")"
fi
if [[ "$START" == "1" ]]; then
  for _ in $(seq 1 100); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 0.1; done
  for _ in $(seq 1 100); do curl -sf "http://127.0.0.1:$TOOL_PORT/health" >/dev/null && break; sleep 0.1; done
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null || { echo "control-plane health failed" >&2; exit 1; }
  curl -sf "http://127.0.0.1:$TOOL_PORT/health" >/dev/null || { echo "tool-gateway health failed" >&2; exit 1; }
  echo "SiriusX native single-box services are healthy"
fi
echo "prefix=$PREFIX data=$DATA_DIR env=$ENV_FILE"
