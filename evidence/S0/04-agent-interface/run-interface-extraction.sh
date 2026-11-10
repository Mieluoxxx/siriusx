#!/usr/bin/env bash
# Reproduce the clean part of S0 Q4: the Agent Domain contract extracts into an
# empty package with no external package imports and passes strict TypeScript.
set -euo pipefail

DSH_TUI_SRC="${DSH_TUI_SRC:-/tmp/dsh-TUI}"
REPO="${REPO:-/root/siriusx/deepseek-harness}"
OUT="${OUT:-/tmp/q4-interface-repro}"

if [[ ! -d "$DSH_TUI_SRC/src/agent" ]]; then
  git clone --depth=1 https://github.com/ccch1mneyyy/dsh-TUI.git "$DSH_TUI_SRC"
fi

rm -rf "$OUT"
mkdir -p "$OUT/src/agent" "$OUT/src/adapter/ports"
cp "$DSH_TUI_SRC"/src/agent/*.ts "$OUT/src/agent/"
cp "$DSH_TUI_SRC"/src/adapter/ports/channel-view.ts "$OUT/src/adapter/ports/"
cp "$DSH_TUI_SRC"/src/adapter/ports/channel-session.ts "$OUT/src/adapter/ports/"
cp "$DSH_TUI_SRC"/LICENSE "$OUT/LICENSE.dsh-TUI"

cat > "$OUT/package.json" <<'EOF'
{
  "name": "siriusx-q4-agent-interface-repro",
  "private": true,
  "type": "module"
}
EOF
cat > "$OUT/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "target": "es2024",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": []
  },
  "include": ["src/**/*.ts"]
}
EOF

cd "$OUT"
"$REPO/node_modules/.bin/tsc" -p tsconfig.json
echo "PASS: interface extraction type-checks"
echo "commit=$(git -C "$DSH_TUI_SRC" rev-parse HEAD)"
echo "files=$(find src -type f | wc -l)"
echo "lines=$(wc -l src/agent/*.ts src/adapter/ports/*.ts | tail -1 | awk '{print $1}')"
