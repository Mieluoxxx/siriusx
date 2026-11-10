#!/usr/bin/env bash
# Stage a local DSH Web image. Requires a local deepseek-harness checkout and
# Node 24 installed at /opt/node24; no network is used by this script.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DSH="${DSH:-$ROOT/deepseek-harness}"
NODE_DIR="${NODE_DIR:-/opt/node24}"
OUT="${OUT:-$ROOT/artifacts/dsh-web}"
STAGE="$OUT/context"
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp -al "$NODE_DIR" "$STAGE/node24" 2>/dev/null || cp -a "$NODE_DIR" "$STAGE/node24"
cp -al "$DSH" "$STAGE/dsh" 2>/dev/null || cp -a "$DSH" "$STAGE/dsh"
rm -rf "$STAGE/dsh/.git"
cp -al "$ROOT/plugins" "$STAGE/plugins" 2>/dev/null || cp -a "$ROOT/plugins" "$STAGE/plugins"
# Build a profile template on the host, then rewrite plugin links to /opt/plugins.
DSH_HOME="$STAGE/dsh-home" node "$DSH/apps/cli/lib/bin.js" --from-default-profile web --profile siriusxweb --dump-config >/dev/null
DSH_HOME="$STAGE/dsh-home" node "$DSH/apps/cli/lib/bin.js" plugin --profile siriusxweb add \
  "link:$ROOT/plugins/telemetry-off" "link:$ROOT/plugins/brand-siriusx" "link:$ROOT/plugins/client-ui-team" >/dev/null
python3 - "$STAGE/dsh-home" "$ROOT/plugins" <<'PYEOF'
import json, os, pathlib, sys
home, plugins = sys.argv[1], sys.argv[2]
profile = pathlib.Path(home) / 'profiles' / 'siriusxweb'
package = json.loads((profile / 'package.json').read_text())
for name, value in list(package.get('dependencies', {}).items()):
    if isinstance(value, str) and value.startswith('link:'):
        package['dependencies'][name] = 'link:' + value[5:].replace(plugins, '/opt/plugins')
(profile / 'package.json').write_text(json.dumps(package, indent=2) + '\n')
links = profile / 'node_modules' / '@siriusx'
if links.exists():
    for link in links.iterdir():
        if link.is_symlink():
            real = os.path.realpath(link)
            if real.startswith(os.path.realpath(plugins)):
                target = '/opt/plugins/' + os.path.relpath(real, os.path.realpath(plugins))
                link.unlink()
                link.symlink_to(target)
PYEOF
cp "$ROOT/deploy/single-box/dsh-web-entrypoint.sh" "$STAGE/"
cp "$ROOT/deploy/single-box/Dockerfile.dsh-web" "$STAGE/Dockerfile"
docker build -t "${IMAGE:-siriusx/dsh-web:offline}" "$STAGE" >"$OUT/build.log" 2>&1
docker save "${IMAGE:-siriusx/dsh-web:offline}" -o "$OUT/dsh-web-image.tar"
echo "built ${IMAGE:-siriusx/dsh-web:offline} and wrote $OUT/dsh-web-image.tar"
