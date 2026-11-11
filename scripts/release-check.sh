#!/usr/bin/env bash
# Local release gate: static checks, tests, install coverage, plugin bundle and feed syntax.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo '== typecheck'
pnpm typecheck
echo '== tests'
pnpm test
echo '== fork discipline'
./scripts/check-fork-discipline.sh
echo '== install coverage'
./scripts/check-install-coverage.sh
./scripts/check-script-portability.sh
python3 scripts/check-k8s-manifests.py
python3 scripts/check-observability.py
python3 scripts/check-ci.py
echo '== plugin bundle'
OUT="$(mktemp -d)" ./deploy/release/build-plugin-bundle.sh
echo '== update feed syntax'
bash -n deploy/release/update-feed/build-feed.sh
node --check deploy/release/update-feed/server.mjs
echo '== sbom'
mkdir -p artifacts/release
pnpm list -r --depth 0 --json > artifacts/release/dependencies.json
node scripts/build-sbom.mjs
node scripts/check-license-policy.mjs
node scripts/build-release-manifest.mjs
 echo 'release checks OK'
