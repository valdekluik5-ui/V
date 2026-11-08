#!/usr/bin/env bash
# Builds ../rnnoise.wasm from RNNoise 0.2 with plain clang + wasm-ld (no Emscripten).
# Usage: RNNOISE=<unpacked rnnoise-0.2 dir> ./build.sh
set -euo pipefail
cd "$(dirname "$0")"
: "${RNNOISE:?set RNNOISE}"
T=$(mktemp -d)
CF=(--target=wasm32 -O3 -msimd128 -ffunction-sections -fdata-sections -nostdinc -isystem "$(clang -print-resource-dir)/include"
    -isystem sysroot/include -I. -I"$RNNOISE/include" -I"$RNNOISE/src")
for f in denoise rnn pitch kiss_fft celt_lpc nnet nnet_default parse_lpcnet_weights rnnoise_data rnnoise_tables; do
  clang "${CF[@]}" -c "$RNNOISE/src/$f.c" -o "$T/$f.o"; done
clang "${CF[@]}" -c bridge.c -o "$T/bridge.o"
clang "${CF[@]}" -fno-builtin -c wlibc.c -o "$T/wlibc.o"
wasm-ld --no-entry --gc-sections --allow-undefined -z stack-size=262144 --initial-memory=16777216 "$T"/*.o -o ../rnnoise.wasm
rm -rf "$T"; echo "built ../rnnoise.wasm"
