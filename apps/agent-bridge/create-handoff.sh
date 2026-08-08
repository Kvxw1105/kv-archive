#!/usr/bin/env sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -lt 4 ]; then echo "Usage: $0 Bundle.zip PROJECT GOAL OUTPUT_DIRECTORY [POLICY]" >&2; exit 2; fi
POLICY=${5:-balanced}
exec node "$DIR/dist/agent/index.js" handoff-create --bundle "$1" --project "$2" --query "$3" --output "$4" --policy "$POLICY"
