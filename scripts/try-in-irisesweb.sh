#!/usr/bin/env bash
# Copy IrisesWeb at HEAD, overlay the built pack, run its dev server.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
web="${IRISES_WEB_DIR:-$root/../IrisesWeb}"
pack="$root/soul-pack"
out="$root/.try/IrisesWeb"

if [ ! -f "$pack/irises-web/src/worker/prompt/persona.ts" ]; then
  echo "no soul-pack yet, build one in the app first" >&2
  exit 1
fi

rm -rf "$out"
mkdir -p "$out"
git -C "$web" archive HEAD | tar -x -C "$out"
ln -s "$web/node_modules" "$out/node_modules"

cp "$pack/irises-web/src/worker/prompt/persona.ts" "$out/src/worker/prompt/persona.ts"
cp "$pack/irises-web/src/worker/prompt/voice.ts" "$out/src/worker/prompt/voice.ts"

cd "$out"
exec npm run dev -- --host 127.0.0.1
