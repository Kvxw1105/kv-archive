#!/usr/bin/env sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -lt 3 ]; then echo "Usage: $0 /path/to/Bundle.zip PROJECT OUTPUT_DIRECTORY" >&2; exit 2; fi
exec node "$DIR/dist/agent/index.js" benchmark-create --bundle "$1" --project "$2" --output "$3"
