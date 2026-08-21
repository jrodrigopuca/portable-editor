#!/bin/sh
# Times a single portable-editor launch until it prints PORTABLE_EDITOR_READY
# to stdout (see signal_ready in src-tauri/src/lib.rs), then kills it. Meant
# to be run BY hyperfine — hyperfine measures this script's own wall-clock
# time, which corresponds to "time until the editor is ready to use".
#
# Usage: hyperfine --warmup 2 "scripts/bench-startup.sh <bin> <file>"
#
# <bin> must be a build made via `npm run tauri build -- --no-bundle` (or a
# full `tauri build`) — a plain `cargo build --release` does NOT correctly
# embed the bundled frontend and opens a blank window. See docs/RELEASE.md.
set -e
BIN="$1"
FILE="$2"
OUT="$(mktemp)"
"$BIN" "$FILE" > "$OUT" 2>&1 &
PID=$!
for _ in $(seq 1 200); do
  if grep -q "PORTABLE_EDITOR_READY" "$OUT" 2>/dev/null; then
    break
  fi
  sleep 0.02
done
kill -9 "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
rm -f "$OUT"
