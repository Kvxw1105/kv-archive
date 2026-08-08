#!/usr/bin/env sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -lt 5 ]; then echo "Usage: $0 Bundle.zip answer-key.json response-off.json response-on.json OUTPUT_DIRECTORY" >&2; exit 2; fi
exec node "$DIR/dist/agent/index.js" benchmark-gate-score --bundle "$1" --benchmark "$2" --response-off "$3" --response-on "$4" --output "$5"
