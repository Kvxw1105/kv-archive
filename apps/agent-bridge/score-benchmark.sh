#!/usr/bin/env sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -lt 4 ]; then echo "Usage: $0 /path/to/Bundle.zip answer-key.json response.json OUTPUT_DIRECTORY" >&2; exit 2; fi
exec node "$DIR/dist/agent/index.js" benchmark-score --bundle "$1" --benchmark "$2" --response "$3" --output "$4"
