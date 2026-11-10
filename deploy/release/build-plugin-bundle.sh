#!/usr/bin/env bash
# Bundle enterprise DSH plugins for inclusion in the desktop installer.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$ROOT/artifacts/release}"
STAGE="$OUT/plugin-bundle"
rm -rf "$STAGE"; mkdir -p "$STAGE/plugins"
PLUGINS=(telemetry-off telemetry-off-desktop executor-local client-ui-team client-ui-bots client-ui-tickets client-ui-sessions client-ui-approvals brand-siriusx account-sso)
for name in "${PLUGINS[@]}"; do
  cp -a "$ROOT/plugins/$name" "$STAGE/plugins/"
done
python3 - "$STAGE" "${PLUGINS[@]}" <<'PY'
import json, pathlib, sys
stage = pathlib.Path(sys.argv[1])
names = sys.argv[2:]
plugins = []
for name in names:
    package = json.loads((stage / 'plugins' / name / 'package.json').read_text())
    plugins.append({'name': package['name'], 'path': f'plugins/{name}', 'version': package.get('version', '0.0.0')})
manifest = {'schema': 'siriusx.plugin-bundle/v1', 'plugins': plugins}
(stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
(stage / 'enterprise-plugins.json').write_text(json.dumps({'enabled': False, 'bundledPluginsDir': 'plugins', 'plugins': plugins}, indent=2) + '\n')
PY
mkdir -p "$OUT"
tar -C "$STAGE" -czf "$OUT/siriusx-plugins.tar.gz" .
sha256sum "$OUT/siriusx-plugins.tar.gz" > "$OUT/siriusx-plugins.tar.gz.sha256"
echo "wrote $OUT/siriusx-plugins.tar.gz"
