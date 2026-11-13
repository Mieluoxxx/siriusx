#!/usr/bin/env bash
# Build a SiriusX desktop installer with the upstream packaging scripts.
# Run on the matching OS: macOS for dmg, Windows for exe. Linux is not a
# supported Electron target in the current DSH checkout.
#
#   build-desktop.sh <mac-arm64|mac-x64|win-x64> [--unsigned] [--dry-run]
#
# Without --unsigned the build signs, and on macOS notarizes, so it needs the
# release credentials. --dry-run prints the resolved plan and builds nothing.
#
# Enterprise bundles ship inside the installer. Point SIRIUSX_ENTERPRISE_CONFIG
# at an enterprise.json: each package in its `bundles` is looked up under
# plugins/, built, and packed. SIRIUSX_PLUGIN_DIRS (path-delimited) names the
# directories directly and takes precedence.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
USAGE='usage: build-desktop.sh mac-arm64|mac-x64|win-x64 [--unsigned] [--dry-run]'

TARGET=""
MODE=""
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    mac-arm64|mac-x64|win-x64)
      [ -z "$TARGET" ] || { echo "$USAGE" >&2; exit 2; }
      TARGET="$arg" ;;
    --unsigned) MODE=":unsigned" ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "$USAGE" >&2; exit 2 ;;
  esac
done
[ -n "$TARGET" ] || { echo "$USAGE" >&2; exit 2; }

# mac-arm64 maps to the harness root script package:desktop:mac:arm64. The root script is required: it puts the
# checkout's JS pnpm first on PATH, and package-target.ts re-runs `node $npm_execpath`, which fails with a
# SyntaxError when npm_execpath is a globally installed native pnpm.
SCRIPT="package:desktop:${TARGET/-/:}$MODE"
ARTIFACTS="$ROOT/deepseek-harness/apps/desktop/.desktop-build/targets/$TARGET/${MODE:+unsigned-}artifacts"

# Branding is opt-in. smoke-packaged-runtime.ts opens "DeepSeek Harness.app" (and "DeepSeek Harness.exe") by name,
# so a build whose productName differs packages fine and then fails with ENOENT on app.asar. Fail up front instead.
# SIRIUSX_ARTIFACT_PREFIX, SIRIUSX_ICON_MACOS and SIRIUSX_ICON_WINDOWS pass through to electron-builder untouched.
if [ -n "${SIRIUSX_PRODUCT_NAME:-}" ] && [ "$SIRIUSX_PRODUCT_NAME" != "DeepSeek Harness" ]; then
  echo "SIRIUSX_PRODUCT_NAME=$SIRIUSX_PRODUCT_NAME is not supported yet: the upstream smoke step opens 'DeepSeek Harness.app' by name" >&2
  exit 1
fi

# Print the plugin directories that hold the config's `bundles`, joined by the platform path delimiter.
bundle_dirs() {
  node --input-type=module - "$ROOT/plugins" "$1" <<'JS'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'

const [pluginsRoot, configPath] = process.argv.slice(2)
const names = JSON.parse(readFileSync(configPath, 'utf8')).bundles ?? []
const directories = new Map()
for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
  const manifest = join(pluginsRoot, entry.name, 'package.json')
  if (entry.isDirectory() && existsSync(manifest)) {
    directories.set(JSON.parse(readFileSync(manifest, 'utf8')).name, join(pluginsRoot, entry.name))
  }
}
const missing = names.filter(name => !directories.has(name))
if (missing.length > 0) {
  console.error(`enterprise bundles with no directory under plugins/: ${missing.join(', ')}`)
  process.exit(1)
}
process.stdout.write(names.map(name => directories.get(name)).join(delimiter))
JS
}

# The packer ships whatever a plugin's `files` finds on disk, so build first and fail when its entry is still missing.
build_plugin() {
  local dir="$1" has_build main
  has_build="$(node -p "Boolean(require(process.argv[1]).scripts?.build)" "$dir/package.json")"
  if [ "$has_build" = true ]; then pnpm --dir "$dir" run build; fi
  main="$(node -p "require(process.argv[1]).main ?? ''" "$dir/package.json")"
  if [ -n "$main" ] && [ ! -f "$dir/$main" ]; then
    echo "built entry is missing: $dir/$main" >&2
    return 1
  fi
}

if [ -n "${SIRIUSX_ENTERPRISE_CONFIG:-}" ]; then
  [ -f "$SIRIUSX_ENTERPRISE_CONFIG" ] || { echo "SIRIUSX_ENTERPRISE_CONFIG is not a file: $SIRIUSX_ENTERPRISE_CONFIG" >&2; exit 1; }
  # electron-builder resolves a relative path against apps/desktop, not against the caller's directory.
  SIRIUSX_ENTERPRISE_CONFIG="$(cd "$(dirname "$SIRIUSX_ENTERPRISE_CONFIG")" && pwd)/$(basename "$SIRIUSX_ENTERPRISE_CONFIG")"
  export SIRIUSX_ENTERPRISE_CONFIG
  if [ -z "${SIRIUSX_PLUGIN_DIRS:-}" ]; then
    SIRIUSX_PLUGIN_DIRS="$(bundle_dirs "$SIRIUSX_ENTERPRISE_CONFIG")"
  fi
fi

PLUGIN_DIRS=()
if [ -n "${SIRIUSX_PLUGIN_DIRS:-}" ]; then
  export SIRIUSX_PLUGIN_DIRS
  IFS="$(node -p "require('node:path').delimiter")" read -r -a PLUGIN_DIRS <<< "$SIRIUSX_PLUGIN_DIRS"
  for dir in "${PLUGIN_DIRS[@]}"; do
    [ -f "$dir/package.json" ] || { echo "not a plugin directory: $dir" >&2; exit 1; }
  done
fi

echo "target:      $TARGET${MODE:+ (unsigned)}"
echo "pnpm script: $SCRIPT"
echo "product:     ${SIRIUSX_PRODUCT_NAME:-DeepSeek Harness (upstream default)}"
echo "enterprise:  ${SIRIUSX_ENTERPRISE_CONFIG:-<upstream resources/enterprise.json>}"
if [ "${#PLUGIN_DIRS[@]}" -gt 0 ]; then
  for dir in "${PLUGIN_DIRS[@]}"; do echo "bundle:      $dir"; done
else
  echo "bundle:      <none>"
fi
echo "artifacts:   $ARTIFACTS"
[ "$DRY_RUN" = 0 ] || exit 0

if [ "${#PLUGIN_DIRS[@]}" -gt 0 ]; then
  for dir in "${PLUGIN_DIRS[@]}"; do build_plugin "$dir"; done
fi

STAMP="$(mktemp)"
trap 'rm -f "$STAMP"' EXIT
cd "$ROOT/deepseek-harness"
pnpm run "$SCRIPT"

# An older installer left in the same directory must not pass for this build's output.
shopt -s nullglob
BUILT=0
for installer in "$ARTIFACTS"/*.dmg "$ARTIFACTS"/*.exe; do
  if [ "$installer" -nt "$STAMP" ]; then echo "installer:   $installer"; BUILT=$((BUILT + 1)); fi
done
[ "$BUILT" -gt 0 ] || { echo "no installer newer than this build's start under $ARTIFACTS" >&2; exit 1; }
