#!/bin/bash
# Check of the packaged Mac app on a real Mac (GitHub Actions, macos-14):
#  1. the engine downloads its model and transcribes a sentence spoken by macOS' own voice;
#  2. the whole app runs its dictation pipeline on that recording (paste is never
#     triggered in this mode), "Deviner" uses the system voices, and the windows
#     are captured. Everything lands in release/mac-test (uploaded as an artifact).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
APP="$ROOT/release/FreeFlow-darwin-${1:-arm64}/FreeFlow.app"
OUT="$ROOT/release/mac-test"
CACHE="$ROOT/release/hf-cache"
mkdir -p "$OUT" "$CACHE"

VOICE=$(say -v '?' | awk '/fr_FR/ {print $1; exit}')
say -v "${VOICE:-Thomas}" -o "$OUT/phrase.wav" --file-format=WAVE --data-format=LEI16@16000 \
  "Bonjour, je teste la dictée de FreeFlow sur mon Mac avec n huit n."

echo "== engine"
STT="$APP/Contents/Resources/freeflow-stt/freeflow-stt"
HF_HOME="$CACHE" FREEFLOW_PORT=48199 "$STT" > "$OUT/stt.out" 2> "$OUT/stt.err" &
PID=$!
for _ in $(seq 1 300); do
  grep -q READY "$OUT/stt.out" && break
  if grep -q FAILED "$OUT/stt.out" || ! kill -0 $PID 2>/dev/null; then tail -40 "$OUT/stt.err"; exit 1; fi
  sleep 2
done
curl -s http://127.0.0.1:48199/health | tee "$OUT/health.json"; echo
curl -s -X POST --data-binary @"$OUT/phrase.wav" -H 'Content-Type: audio/wav' \
  "http://127.0.0.1:48199/transcribe?lang=fr" | tee "$OUT/transcribe.json"; echo
kill $PID || true
grep -qi '"text": *"[^"]*bonjour' "$OUT/transcribe.json"

echo "== field reader (Accessibility)"
"$APP/Contents/Resources/ax-read" | tee "$OUT/ax-read.json"; echo
grep -q '"outcome":"focused"' "$OUT/ax-read.json"

echo "== app"
say -v "${VOICE:-Thomas}" -o "$OUT/autre.wav" --file-format=WAVE --data-format=LEI16@16000 \
  "Salut, oui, le montage est presque fini, il reste la miniature."
PROFILE="$ROOT/release/mac-profile"
mkdir -p "$PROFILE"
printf '{"modelCache":"%s","sidecarPort":48198}' "$CACHE" > "$PROFILE/settings.json"
"$APP/Contents/MacOS/FreeFlow" --user-data-dir="$PROFILE" --test-pipeline="$OUT/phrase.wav" \
  --screenshots="$OUT" --guess-test="Higgsfield,Kling,Seedance" --bar-test="$OUT" \
  --meeting-test="$OUT/phrase.wav,$OUT/autre.wav" --display-name=Alan --exit > "$OUT/app.log" 2>&1 || true
cp "$PROFILE/logs/freeflow.log" "$OUT/freeflow.log" 2>/dev/null || true
grep -E 'TEST_PIPELINE_RESULT|GUESS|BAR_SHOT|MEETING_RESULT|DEV_ERROR' "$OUT/app.log" || true
grep -q TEST_PIPELINE_RESULT "$OUT/app.log"
grep -q 'MEETING_RESULT done' "$OUT/app.log"
